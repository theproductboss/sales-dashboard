import openpyxl, sys, json, re, datetime
files = {"2026-09": "b.xlsx", "2026-10": "c.xlsx", "2026-11": "nov.xlsx"}
closers = ["JILL", "JACQUELINE", "JESSICA"]
rows = []; summaries = {}
for month, fn in files.items():
    wb = openpyxl.load_workbook(f"{sys.argv[1]}/{fn}", data_only=True)
    for c in closers:
        if c not in wb.sheetnames: continue
        ws = wb[c]
        # summary block rows 3..23, col A label / B value
        summ = {}
        for r in range(3, 24):
            lab = ws.cell(r, 1).value
            if lab: summ[str(lab).strip()] = ws.cell(r, 2).value
        summaries[f"{month}/{c}"] = summ
        week = None; header = None; weeklabel=None
        for r in range(24, ws.max_row + 1):
            a = ws.cell(r, 1).value
            if isinstance(a, str) and a.strip().upper().startswith("WEEK"):
                m = re.match(r"WEEK\s*(\d)\s*\(?([^)]*)", a.strip(), re.I)
                week = int(m.group(1)); weeklabel = m.group(2); header = None; continue
            b = ws.cell(r, 2).value
            if isinstance(b, str) and b.strip().upper() == "LEAD NAME":
                header = [str(ws.cell(r, k).value or "").strip() for k in range(1, 14)]; continue
            if week and header and b not in (None, ""):
                vals = [ws.cell(r, k).value for k in range(1, 14)]
                rec = {"month": month, "closer": c.title(), "week": week, "week_range": weeklabel, "row": r}
                for h, v in zip(header, vals):
                    if h: rec[h] = v.isoformat()[:10] if isinstance(v, datetime.datetime) else v
                rows.append(rec)
json.dump({"rows": rows, "summaries": summaries}, open(f"{sys.argv[2]}", "w"), indent=1, default=str)
print(len(rows), "rows")
from collections import Counter
print(Counter((r["month"], r["closer"]) for r in rows))
print("statuses", Counter(str(r.get("Sales Status")).strip().upper() for r in rows))
print("offer", Counter(str(r.get("OFFER MADE?")).strip().upper() for r in rows))
print("noshow", Counter(str(r.get("NO SHOW?")).strip().upper() for r in rows))
print("cxl", Counter(str(r.get("LEAD CXL?")).strip().upper() for r in rows))
print("calltype", Counter(str(r.get("CALL TYPE")).strip().upper() for r in rows))
print("confirmed", Counter(str(r.get(header[0] if header else "")).strip().upper() for r in rows))
print("headers seen", Counter(tuple(k for k in r if k not in("month","closer","week","week_range","row")) for r in rows).most_common(3))
