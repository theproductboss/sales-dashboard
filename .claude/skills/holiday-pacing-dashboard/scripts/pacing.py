#!/usr/bin/env python3
"""Holiday Pacing Dashboard engine.

Reads every sales export in a folder (Shopify, Wix, Etsy, Amazon, Square, or any
spreadsheet with a date and an amount), combines them, paces sales against the
holiday goal by window, and checks inventory if an inventory file is present.

Usage:  python3 pacing.py <data-folder> <goals.json> <output-folder>

Writes:
  <output>/dashboard.html   the dashboard (open in any browser)
  <output>/summary.json     the numbers, for Claude to explain
  <output>/sales-combined.csv  every order line from every channel, cleaned
"""
import csv
import html
import json
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

# ---------------------------------------------------------------- reading files

CANDIDATES = {
    "date": ["created at", "date created", "order date", "sale date", "purchase-date", "purchase date",
             "paid at", "date", "order created", "transaction date", "created"],
    "order": ["name", "order #", "order number", "order id", "amazon-order-id", "order-id", "order no",
              "transaction id", "receipt id", "order"],
    "total": ["total", "order total", "order value", "total sales", "grand total", "net sales", "amount",
              "gross sales", "sales", "revenue"],
    "product": ["lineitem name", "item's name", "item name", "product-name", "product name", "product",
                "item", "title", "description", "sku"],
    "qty": ["lineitem quantity", "quantity-purchased", "quantity", "qty", "units", "count"],
    "line_price": ["lineitem price", "item-price", "item price", "price", "unit price"],
    "status": ["financial status", "payment status", "order-status", "status"],
}
SKIP_STATUS = {"refunded", "voided", "cancelled", "canceled", "pending payment"}
INVENTORY_HINTS = ["inventory", "on hand", "available", "stock"]


def norm(s):
    return re.sub(r"\s+", " ", (s or "").strip().lower().replace("﻿", ""))


def find_col(headers, key, override=None):
    if override:
        for h in headers:
            if norm(h) == norm(override):
                return h
    hn = {norm(h): h for h in headers}
    for cand in CANDIDATES[key]:
        if cand in hn:
            return hn[cand]
    return None


def money(v):
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = re.sub(r"[^\d.,\-]", "", s)
    if s.count(",") and s.count(".") == 0 and re.search(r",\d{2}$", s):
        s = s.replace(",", ".")
    s = s.replace(",", "")
    try:
        x = float(s)
    except ValueError:
        return None
    return -x if neg else x


DATE_FORMATS = ["%Y-%m-%d %H:%M:%S %z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d", "%m/%d/%Y %H:%M", "%m/%d/%Y %I:%M %p", "%m/%d/%Y", "%m/%d/%y", "%b %d, %Y",
                "%B %d, %Y", "%d %b %Y", "%m-%d-%Y"]


def parse_date(v):
    s = str(v or "").strip()
    if not s:
        return None
    s2 = re.sub(r"\.\d+", "", s).replace("Z", "+0000")
    s2 = re.sub(r"([+-]\d{2}):(\d{2})$", r"\1\2", s2)
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s2, fmt).date()
        except ValueError:
            continue
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def guess_channel(path, headers):
    n = path.stem.lower()
    hs = {norm(h) for h in headers}
    for name in ["shopify", "wix", "etsy", "amazon", "square", "faire", "squarespace", "woocommerce", "tiktok"]:
        if name in n:
            return name.title() if name != "tiktok" else "TikTok Shop"
    if {"lineitem name", "financial status"} & hs:
        return "Shopify"
    if "amazon-order-id" in hs:
        return "Amazon"
    if "sale date" in hs and ("order value" in hs or "item name" in hs):
        return "Etsy"
    if "item's name" in hs:
        return "Wix"
    return path.stem.replace("_", " ").replace("-", " ").title()


def read_csv(path):
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    sample = text[:4000]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;")
    except csv.Error:
        dialect = csv.excel
    rows = list(csv.DictReader(text.splitlines(), dialect=dialect))
    return rows, (rows[0].keys() if rows else [])


def read_table(path):
    if path.suffix.lower() in (".xlsx", ".xlsm"):
        try:
            import openpyxl
        except ImportError:
            raise SystemExit("MISSING: openpyxl (to read Excel). Install with: pip install openpyxl")
        ws = openpyxl.load_workbook(path, read_only=True, data_only=True).active
        it = ws.iter_rows(values_only=True)
        headers = [str(h or "") for h in next(it)]
        rows = [dict(zip(headers, ["" if v is None else v for v in r])) for r in it]
        return rows, headers
    return read_csv(path)


def is_inventory(path, headers):
    n = path.stem.lower()
    hs = " ".join(norm(h) for h in headers)
    return any(k in n for k in ["inventory", "stock"]) or (
        any(k in hs for k in INVENTORY_HINTS) and not find_col(headers, "date"))


def load_sales(path, rows, headers, cfg):
    over = (cfg.get("mappings") or {}).get(path.name, {})
    cols = {k: find_col(headers, k, over.get(k)) for k in CANDIDATES}
    channel = (cfg.get("channels") or {}).get(path.name) or guess_channel(path, headers)
    if not cols["date"] or not (cols["total"] or cols["line_price"]):
        return channel, [], f"Couldn't find a date and an amount column in {path.name}. Headers: {list(headers)}"

    lines, last_order, last_date, order_totals = [], None, None, {}
    for r in rows:
        oid = str(r.get(cols["order"], "")).strip() if cols["order"] else ""
        d = parse_date(r.get(cols["date"])) or (last_date if oid and oid == last_order else None)
        if not d:
            continue
        st = norm(str(r.get(cols["status"], ""))) if cols["status"] else ""
        if st in SKIP_STATUS:
            continue
        qty = money(r.get(cols["qty"])) if cols["qty"] else None
        qty = qty if qty else 1
        lp = money(r.get(cols["line_price"])) if cols["line_price"] else None
        tot = money(r.get(cols["total"])) if cols["total"] else None
        if oid and tot is not None and oid not in order_totals:
            order_totals[oid] = tot
        prod = str(r.get(cols["product"], "")).strip() if cols["product"] else ""
        lines.append({"date": d, "order": oid or f"{path.stem}-{len(lines)}", "channel": channel,
                      "product": prod or "(not listed)", "qty": qty,
                      "line_total": (lp * qty) if lp is not None else None, "row_total": tot})
        last_order, last_date = oid, d

    # Order revenue: use the order total once per order (Shopify repeats rows per line item);
    # fall back to line totals when there's no order total.
    orders = {}
    for ln in lines:
        o = orders.setdefault(ln["order"], {"date": ln["date"], "channel": channel, "lines": []})
        o["lines"].append(ln)
    for oid, o in orders.items():
        if oid in order_totals:
            o["revenue"] = order_totals[oid]
        else:
            lt = [ln["line_total"] for ln in o["lines"] if ln["line_total"] is not None]
            rt = [ln["row_total"] for ln in o["lines"] if ln["row_total"] is not None]
            o["revenue"] = sum(lt) if lt else sum(rt)
    return channel, list(orders.values()), None


def load_inventory(rows, headers):
    pc = find_col(headers, "product")
    hn = {norm(h): h for h in headers}
    qc = next((hn[k] for k in ["on hand", "available", "inventory", "stock", "quantity", "qty", "on hand (new)",
                                "inventory available"] if k in hn), None)
    if not qc:
        qc = next((h for h in headers if any(k in norm(h) for k in INVENTORY_HINTS)), None)
    lead_c = next((h for h in headers if "lead" in norm(h)), None)
    inv = {}
    for r in rows:
        name = str(r.get(pc, "")).strip() if pc else ""
        q = money(r.get(qc)) if qc else None
        if name and q is not None:
            lead = money(r.get(lead_c)) if lead_c else None
            inv[name] = {"on_hand": q, "lead_days": lead}
    return inv


# ---------------------------------------------------------------- the numbers

def iso(d):
    return d.isoformat()


def compute(orders, cfg, inventory):
    today = parse_date(cfg.get("today")) if cfg.get("today") else date.today()
    wins = []
    for w in cfg["windows"]:
        wins.append({"name": w["name"], "start": parse_date(w["start"]), "end": parse_date(w["end"]),
                     "goal": float(w.get("goal", 0))})
    season_start, season_end = wins[0]["start"], wins[-1]["end"]
    goal = float(cfg.get("season_goal") or sum(w["goal"] for w in wins))
    season_orders = [o for o in orders if season_start <= o["date"] <= min(season_end, today)]

    daily = defaultdict(float)
    by_channel = defaultdict(lambda: {"revenue": 0.0, "orders": 0})
    by_product = defaultdict(lambda: {"revenue": 0.0, "units": 0.0})
    units_by_day_product = defaultdict(lambda: defaultdict(float))
    for o in season_orders:
        daily[o["date"]] += o["revenue"]
        by_channel[o["channel"]]["revenue"] += o["revenue"]
        by_channel[o["channel"]]["orders"] += 1
        known = [ln for ln in o["lines"] if ln["line_total"] is not None]
        for ln in o["lines"]:
            if ln["product"] == "(not listed)":
                continue
            share = (ln["line_total"] if ln["line_total"] is not None
                     else (o["revenue"] / len(o["lines"]) if not known else 0))
            by_product[ln["product"]]["revenue"] += share
            by_product[ln["product"]]["units"] += ln["qty"]
            units_by_day_product[ln["product"]][o["date"]] += ln["qty"]

    total = sum(o["revenue"] for o in season_orders)
    n_orders = len(season_orders)

    # Goal line: each window's goal spread evenly across its days
    goal_daily = {}
    for w in wins:
        days = (w["end"] - w["start"]).days + 1
        for i in range(days):
            goal_daily[w["start"] + timedelta(days=i)] = w["goal"] / days

    series, cum, cum_goal = [], 0.0, 0.0
    d = season_start
    while d <= season_end:
        cum_goal += goal_daily.get(d, 0)
        if d <= today:
            cum += daily.get(d, 0)
        series.append({"date": iso(d), "actual": round(cum, 2) if d <= today else None,
                       "goal": round(cum_goal, 2), "day": round(daily.get(d, 0), 2) if d <= today else None})
        d += timedelta(days=1)

    goal_to_date = sum(v for k, v in goal_daily.items() if k <= today)
    last7 = sum(daily.get(today - timedelta(days=i), 0) for i in range(7)) / 7
    days_left = max((season_end - today).days, 0)
    remaining = max(goal - total, 0)
    need_per_day = remaining / days_left if days_left else 0
    remaining_goal_shape = sum(v for k, v in goal_daily.items() if k > today)
    # Projection: assume the rest of the season keeps today's pace relative to the plan
    pace_ratio = (total / goal_to_date) if goal_to_date else 0
    projected = total + remaining_goal_shape * pace_ratio

    win_out = []
    for w in wins:
        actual = sum(v for k, v in daily.items() if w["start"] <= k <= w["end"])
        if today < w["start"]:
            status, expected = "upcoming", 0
        else:
            elapsed_end = min(today, w["end"])
            expected = sum(goal_daily[w["start"] + timedelta(days=i)]
                           for i in range((elapsed_end - w["start"]).days + 1))
            ratio = actual / expected if expected else 0
            status = ("done" if today > w["end"] else "live")
            status += "-ahead" if ratio >= 1 else ("-close" if ratio >= .85 else "-behind")
        win_out.append({"name": w["name"], "start": iso(w["start"]), "end": iso(w["end"]), "goal": w["goal"],
                        "actual": round(actual, 2), "expected_to_date": round(expected, 2), "status": status})

    # Inventory check: units/day over the last 14 days vs units on hand
    inv_out = []
    if inventory:
        last_window_end = next((w["end"] for w in wins if "last" in w["name"].lower()), season_end)
        lookback = 14
        names = {norm(k): k for k in units_by_day_product}
        for prod, info in inventory.items():
            key = names.get(norm(prod))
            sold14 = sum(units_by_day_product[key].get(today - timedelta(days=i), 0)
                         for i in range(lookback)) if key else 0
            rate = sold14 / lookback
            # Holiday demand ramps up; scale by how much bigger the remaining plan is than the recent plan
            recent_plan = sum(goal_daily.get(today - timedelta(days=i), 0) for i in range(lookback)) / lookback
            future_plan = (sum(v for k, v in goal_daily.items() if today < k <= last_window_end)
                           / max((last_window_end - today).days, 1))
            ramp = (future_plan / recent_plan) if recent_plan else 1
            ramp = max(1.0, min(ramp, 6.0))
            proj_rate = rate * ramp
            cover = (info["on_hand"] / proj_rate) if proj_rate else None
            stockout = today + timedelta(days=int(cover)) if cover is not None else None
            lead = info.get("lead_days") or float(cfg.get("default_lead_days", 21))
            reorder_by = (stockout - timedelta(days=int(lead))) if stockout else None
            if proj_rate == 0:
                flag = "no recent sales"
            elif stockout and stockout <= last_window_end:
                flag = "reorder now" if reorder_by <= today else "reorder soon"
            else:
                flag = "ok"
            inv_out.append({"product": prod, "on_hand": info["on_hand"], "units_per_day_now": round(rate, 2),
                            "units_per_day_holiday": round(proj_rate, 2),
                            "days_of_stock": round(cover, 1) if cover is not None else None,
                            "stockout_date": iso(stockout) if stockout else None,
                            "reorder_by": iso(reorder_by) if reorder_by else None,
                            "lead_days": lead, "flag": flag})
        order_rank = {"reorder now": 0, "reorder soon": 1, "ok": 2, "no recent sales": 3}
        inv_out.sort(key=lambda r: (order_rank[r["flag"]], r["days_of_stock"] or 9e9))

    return {
        "business": cfg.get("business", ""),
        "today": iso(today), "season_start": iso(season_start), "season_end": iso(season_end),
        "goal": goal, "total": round(total, 2), "pct_of_goal": round(100 * total / goal, 1) if goal else 0,
        "goal_to_date": round(goal_to_date, 2),
        "pace_vs_plan_pct": round(100 * pace_ratio, 1),
        "projected_total": round(projected, 2),
        "orders": n_orders, "aov": round(total / n_orders, 2) if n_orders else 0,
        "avg_day_last7": round(last7, 2), "need_per_day": round(need_per_day, 2), "days_left": days_left,
        "windows": win_out,
        "channels": sorted(({"channel": k, **{kk: round(vv, 2) for kk, vv in v.items()}}
                            for k, v in by_channel.items()), key=lambda r: -r["revenue"]),
        "products": sorted(({"product": k, "revenue": round(v["revenue"], 2), "units": v["units"]}
                            for k, v in by_product.items()), key=lambda r: -r["revenue"])[:10],
        "series": series,
        "inventory": inv_out,
    }


# ---------------------------------------------------------------- the dashboard

def fm(x, cents=False):
    return f"${x:,.2f}" if cents else f"${x:,.0f}"


def fdate(s):
    d = date.fromisoformat(s)
    return d.strftime("%b ") + str(d.day)


def chart_svg(s):
    series = s["series"]
    W, H, L, R, T, B = 1000, 340, 64, 20, 20, 44
    n = len(series)
    ymax = max(s["goal"], max((p["actual"] or 0) for p in series)) * 1.08 or 1
    x = lambda i: L + (W - L - R) * i / max(n - 1, 1)
    y = lambda v: T + (H - T - B) * (1 - v / ymax)
    parts = [f'<svg viewBox="0 0 {W} {H}" class="chart" role="img" aria-label="Cumulative sales vs goal">']
    # window bands
    idx = {p["date"]: i for i, p in enumerate(series)}
    for k, w in enumerate(s["windows"]):
        i0, i1 = idx.get(w["start"], 0), idx.get(w["end"], n - 1)
        parts.append(f'<rect x="{x(i0):.1f}" y="{T}" width="{x(i1) - x(i0):.1f}" height="{H - T - B}" '
                     f'class="band b{k % 2}"/>')
        parts.append(f'<text x="{(x(i0) + x(i1)) / 2:.1f}" y="{H - 14}" class="bandlabel">{html.escape(w["name"])}</text>')
    for g in range(5):
        v = ymax * g / 4
        parts.append(f'<line x1="{L}" x2="{W - R}" y1="{y(v):.1f}" y2="{y(v):.1f}" class="grid"/>'
                     f'<text x="{L - 10}" y="{y(v) + 5:.1f}" class="axis" text-anchor="end">'
                     f'{"$" + format(v / 1000, ".0f") + "k" if v >= 1000 else fm(v)}</text>')
    gpts = " ".join(f"{x(i):.1f},{y(p['goal']):.1f}" for i, p in enumerate(series))
    parts.append(f'<polyline points="{gpts}" class="goal"/>')
    apts = [(x(i), y(p["actual"])) for i, p in enumerate(series) if p["actual"] is not None]
    if apts:
        area = f"{apts[0][0]:.1f},{y(0):.1f} " + " ".join(f"{a:.1f},{b:.1f}" for a, b in apts) + f" {apts[-1][0]:.1f},{y(0):.1f}"
        parts.append(f'<polygon points="{area}" class="area"/>')
        parts.append(f'<polyline points="{" ".join(f"{a:.1f},{b:.1f}" for a, b in apts)}" class="actual"/>')
        ax, ay = apts[-1]
        parts.append(f'<circle cx="{ax:.1f}" cy="{ay:.1f}" r="6" class="dot"/>'
                     f'<line x1="{ax:.1f}" x2="{ax:.1f}" y1="{T}" y2="{H - B}" class="today"/>'
                     f'<text x="{ax + 8:.1f}" y="{T + 14}" class="axis">Today</text>')
    parts.append("</svg>")
    return "".join(parts)


def build_html(s):
    status_text = {"ahead": "Ahead", "close": "Close", "behind": "Behind"}
    pace = s["pace_vs_plan_pct"]
    pace_cls = "good" if pace >= 100 else ("warn" if pace >= 85 else "bad")
    pace_word = "ahead of plan" if pace >= 100 else ("slightly behind plan" if pace >= 85 else "behind plan")

    win_cards = []
    for w in s["windows"]:
        st = w["status"]
        if st == "upcoming":
            badge, cls, pct = "Upcoming", "muted", 0
        else:
            tone = st.split("-")[1]
            badge = ("Done · " if st.startswith("done") else "Live · ") + status_text[tone]
            cls = {"ahead": "good", "close": "warn", "behind": "bad"}[tone]
            pct = min(100, 100 * w["actual"] / w["goal"]) if w["goal"] else 0
        exp_pct = min(100, 100 * w["expected_to_date"] / w["goal"]) if w["goal"] else 0
        win_cards.append(f"""<div class="win">
<div class="win-top"><h3>{html.escape(w["name"])}</h3><span class="badge {cls}">{badge}</span></div>
<div class="dates">{fdate(w["start"])} – {fdate(w["end"])}</div>
<div class="win-num"><b>{fm(w["actual"])}</b> <span>of {fm(w["goal"])}</span></div>
<div class="bar"><i class="{cls}" style="width:{pct:.1f}%"></i>{f'<em style="left:{exp_pct:.1f}%" title="Where the plan says you should be today"></em>' if st.startswith("live") else ""}</div>
</div>""")

    ch_max = max((c["revenue"] for c in s["channels"]), default=1) or 1
    channels = "".join(
        f'<div class="row"><span class="lbl">{html.escape(c["channel"])}</span>'
        f'<span class="track"><i style="width:{100 * c["revenue"] / ch_max:.1f}%"></i></span>'
        f'<span class="val">{fm(c["revenue"])}<small>{100 * c["revenue"] / s["total"]:.0f}% · {c["orders"]} orders</small></span></div>'
        for c in s["channels"]) if s["total"] else "<p class='empty'>No sales in the season yet.</p>"

    prods = "".join(f'<tr><td>{i + 1}</td><td>{html.escape(p["product"])}</td><td class="n">{p["units"]:,.0f}</td>'
                    f'<td class="n">{fm(p["revenue"])}</td></tr>' for i, p in enumerate(s["products"]))

    inv_html = ""
    if s["inventory"]:
        flag_cls = {"reorder now": "bad", "reorder soon": "warn", "ok": "good", "no recent sales": "muted"}
        rows = "".join(
            f'<tr><td>{html.escape(r["product"])}</td><td class="n">{r["on_hand"]:,.0f}</td>'
            f'<td class="n">{r["units_per_day_now"]:.1f} → {r["units_per_day_holiday"]:.1f}</td>'
            f'<td class="n">{"—" if r["days_of_stock"] is None else f"{r["days_of_stock"]:.0f} days"}</td>'
            f'<td class="n">{fdate(r["stockout_date"]) if r["stockout_date"] else "—"}</td>'
            f'<td class="n">{fdate(r["reorder_by"]) if r["reorder_by"] else "—"}</td>'
            f'<td><span class="badge {flag_cls[r["flag"]]}">{r["flag"].capitalize()}</span></td></tr>'
            for r in s["inventory"])
        inv_html = f"""<section class="card wide"><div class="card-h"><h2>Will you run out?</h2>
<p>Daily units sold now vs. expected during the holidays, based on your plan ramping up. Reorder dates assume each item's lead time.</p></div>
<div class="scroll"><table><thead><tr><th>Product</th><th class="n">On hand</th><th class="n">Units/day now → holidays</th>
<th class="n">Lasts</th><th class="n">Runs out</th><th class="n">Reorder by</th><th>Status</th></tr></thead><tbody>{rows}</tbody></table></div></section>"""

    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Holiday Pacing</title><style>
:root{{--bg:#F6F4EF;--card:#FFFFFF;--ink:#1D1B18;--muted:#6E6A63;--line:#E7E3DA;--accent:#2E5D50;--accent-soft:#DCE8E2;
--good:#2E7D5B;--warn:#C27A12;--bad:#B4412F;--goal:#A39E93;--band:#F3F0E9}}
@media (prefers-color-scheme:dark){{:root{{--bg:#151513;--card:#1F1F1C;--ink:#F1EEE7;--muted:#A7A298;--line:#34332F;--accent:#7FC2A9;--accent-soft:#25362F;--good:#6CC59A;--warn:#E3A84A;--bad:#E57C67;--goal:#7A766D;--band:#262622}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 Inter,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}}
.wrap{{max-width:1180px;margin:0 auto;padding:36px 24px 60px}}
header{{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:26px}}
.eyebrow{{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}}
h1{{font-size:34px;margin:6px 0 0;letter-spacing:-.02em}}.asof{{color:var(--muted);font-size:14px}}
.hero{{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px;display:grid;grid-template-columns:1.3fr 1fr;gap:28px;margin-bottom:18px}}
.big{{font-size:56px;font-weight:700;letter-spacing:-.03em;line-height:1}}.big small{{font-size:22px;color:var(--muted);font-weight:500;letter-spacing:0}}
.goalbar{{height:14px;background:var(--line);border-radius:99px;margin:18px 0 10px;overflow:hidden}}.goalbar i{{display:block;height:100%;background:var(--accent);border-radius:99px}}
.pace{{font-size:18px;margin-top:6px}}.pace b.good{{color:var(--good)}}.pace b.warn{{color:var(--warn)}}.pace b.bad{{color:var(--bad)}}
.kpis{{display:grid;grid-template-columns:1fr 1fr;gap:12px}}.kpi{{background:var(--bg);border-radius:14px;padding:14px 16px}}
.kpi span{{font-size:13px;color:var(--muted)}}.kpi b{{display:block;font-size:24px;letter-spacing:-.01em;margin-top:2px}}
.wins{{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}}
.win{{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px}}.win-top{{display:flex;justify-content:space-between;align-items:center;gap:8px}}
.win h3{{margin:0;font-size:17px}}.dates{{color:var(--muted);font-size:13px;margin:4px 0 14px}}.win-num b{{font-size:24px}}.win-num span{{color:var(--muted);font-size:14px}}
.bar{{position:relative;height:8px;background:var(--line);border-radius:99px;margin-top:12px}}.bar i{{display:block;height:100%;border-radius:99px;background:var(--goal)}}
.bar i.good{{background:var(--good)}}.bar i.warn{{background:var(--warn)}}.bar i.bad{{background:var(--bad)}}
.bar em{{position:absolute;top:-4px;width:2px;height:16px;background:var(--ink);opacity:.6}}
.badge{{font-size:12px;font-weight:600;padding:4px 9px;border-radius:99px;white-space:nowrap;background:var(--line);color:var(--muted)}}
.badge.good{{background:color-mix(in srgb,var(--good) 16%,transparent);color:var(--good)}}.badge.warn{{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)}}.badge.bad{{background:color-mix(in srgb,var(--bad) 16%,transparent);color:var(--bad)}}
.grid2{{display:grid;grid-template-columns:1fr 1fr;gap:18px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:24px;margin-bottom:18px}}.card.wide{{grid-column:1/-1}}
.card-h h2{{margin:0;font-size:19px}}.card-h p{{margin:4px 0 16px;color:var(--muted);font-size:14px}}
.chart{{width:100%;height:auto;display:block}}.chart .grid{{stroke:var(--line)}}.chart .axis{{fill:var(--muted);font-size:13px}}
.chart .band.b0{{fill:var(--band)}}.chart .band.b1{{fill:transparent}}.chart .bandlabel{{fill:var(--muted);font-size:13px;text-anchor:middle;font-weight:600}}
.chart .goal{{fill:none;stroke:var(--goal);stroke-width:2.5;stroke-dasharray:7 6}}.chart .actual{{fill:none;stroke:var(--accent);stroke-width:3.5;stroke-linejoin:round}}
.chart .area{{fill:var(--accent);opacity:.12}}.chart .dot{{fill:var(--accent);stroke:var(--card);stroke-width:3}}.chart .today{{stroke:var(--ink);opacity:.25;stroke-dasharray:3 4}}
.legend{{display:flex;gap:20px;font-size:14px;color:var(--muted);margin-top:8px}}.legend i{{display:inline-block;width:22px;height:0;border-top:3px solid var(--accent);vertical-align:middle;margin-right:6px}}.legend i.g{{border-top:3px dashed var(--goal)}}
.row{{display:grid;grid-template-columns:120px 1fr 150px;gap:12px;align-items:center;padding:9px 0}}.lbl{{font-weight:600}}
.track{{height:12px;background:var(--bg);border-radius:99px;overflow:hidden}}.track i{{display:block;height:100%;background:var(--accent);border-radius:99px}}
.val{{text-align:right;font-weight:600}}.val small{{display:block;color:var(--muted);font-weight:400;font-size:12px}}
table{{width:100%;border-collapse:collapse;font-size:15px}}th{{text-align:left;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--line)}}
td{{padding:10px;border-bottom:1px solid var(--line)}}tr:last-child td{{border-bottom:0}}.n{{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}}td:first-child{{color:var(--muted)}}
.scroll{{overflow-x:auto}}.empty{{color:var(--muted)}}
footer{{color:var(--muted);font-size:13px;margin-top:10px}}
@media (max-width:900px){{.hero,.grid2{{grid-template-columns:1fr}}.wins{{grid-template-columns:1fr 1fr}}}}
@media (max-width:560px){{.wins{{grid-template-columns:1fr}}.big{{font-size:44px}}.row{{grid-template-columns:90px 1fr 110px}}}}
</style></head><body><div class="wrap">
<header><div><div class="eyebrow">Holiday Pacing Dashboard</div><h1>{html.escape(s["business"] or "Holiday season")}</h1></div>
<div class="asof">Through {fdate(s["today"])} · season {fdate(s["season_start"])} – {fdate(s["season_end"])}</div></header>

<section class="hero"><div>
<div class="big">{fm(s["total"])} <small>of {fm(s["goal"])} goal</small></div>
<div class="goalbar"><i style="width:{min(100, s["pct_of_goal"]):.1f}%"></i></div>
<div class="pace">You're <b class="{pace_cls}">{pace:.0f}% of where your plan says you should be</b> today ({pace_word}).
At this pace you'd finish around <b>{fm(s["projected_total"])}</b>.</div>
</div><div class="kpis">
<div class="kpi"><span>Orders</span><b>{s["orders"]:,}</b></div>
<div class="kpi"><span>Average order</span><b>{fm(s["aov"], True)}</b></div>
<div class="kpi"><span>Avg per day, last 7 days</span><b>{fm(s["avg_day_last7"])}</b></div>
<div class="kpi"><span>Needed per day to hit goal</span><b>{fm(s["need_per_day"])}</b></div>
</div></section>

<div class="wins">{"".join(win_cards)}</div>

<section class="card"><div class="card-h"><h2>Sales vs. plan</h2><p>Running total this season compared with your goal, spread across the four holiday windows.</p></div>
{chart_svg(s)}<div class="legend"><span><i></i>Actual sales</span><span><i class="g"></i>Goal pace</span></div></section>

<div class="grid2">
<section class="card"><div class="card-h"><h2>Where sales come from</h2><p>Revenue by sales channel this season.</p></div>{channels}</section>
<section class="card"><div class="card-h"><h2>Top products</h2><p>By revenue this season.</p></div>
<table><thead><tr><th>#</th><th>Product</th><th class="n">Units</th><th class="n">Revenue</th></tr></thead><tbody>{prods}</tbody></table></section>
{inv_html}
</div>
<footer>Built from your sales exports. Refunded and cancelled orders are excluded. Totals include tax and shipping when your export's order total does.</footer>
</div></body></html>"""


# ---------------------------------------------------------------- main

def main():
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)
    data, goals_path, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    cfg = json.loads(goals_path.read_text(encoding="utf-8"))
    out.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in data.iterdir() if p.suffix.lower() in (".csv", ".tsv", ".txt", ".xlsx", ".xlsm")
                   and not p.name.startswith("."))
    if not files:
        raise SystemExit(f"No CSV or Excel files in {data}")

    orders, inventory, notes = [], {}, []
    for f in files:
        rows, headers = read_table(f)
        if not rows:
            notes.append(f"{f.name}: empty")
            continue
        if is_inventory(f, headers):
            inventory.update(load_inventory(rows, headers))
            notes.append(f"{f.name}: inventory, {len(inventory)} products")
            continue
        channel, os_, err = load_sales(f, rows, headers, cfg)
        if err:
            notes.append(err)
            continue
        orders.extend(os_)
        notes.append(f"{f.name}: {channel}, {len(os_)} orders, ${sum(o['revenue'] for o in os_):,.0f}")

    s = compute(orders, cfg, inventory)
    s["files"] = notes
    (out / "summary.json").write_text(json.dumps({k: v for k, v in s.items() if k != "series"}, indent=2))
    (out / "dashboard.html").write_text(build_html(s), encoding="utf-8")
    with open(out / "sales-combined.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["date", "channel", "order", "order_revenue", "product", "qty"])
        for o in sorted(orders, key=lambda o: o["date"]):
            for ln in o["lines"]:
                w.writerow([o["date"], o["channel"], ln["order"], round(o["revenue"], 2), ln["product"], ln["qty"]])
    print("\n".join(notes))
    print(f"\nSeason so far: ${s['total']:,.0f} of ${s['goal']:,.0f} ({s['pct_of_goal']}%), "
          f"{s['pace_vs_plan_pct']}% of plan to date. Dashboard: {out / 'dashboard.html'}")


if __name__ == "__main__":
    main()
