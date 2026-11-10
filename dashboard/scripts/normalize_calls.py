import json, sys, datetime, re, hashlib
d = json.load(open(sys.argv[1]))
def yn(v):
    s = str(v or "").strip().upper()
    return True if s in ("YES","Y","CONFIRMED","TRUE") else False
def num(v):
    try: return float(v) if v not in (None,"") else 0
    except: return 0
def week_start(month, wk):
    y, m = map(int, month.split("-"))
    first = datetime.date(y, m, 1)
    # week 1 = 1st..first Sunday (if 1st is Sunday, through the next Sunday)
    dow = first.weekday()  # Mon=0..Sun=6
    first_sunday = first + datetime.timedelta(days=(6 - dow) % 7)
    if dow == 6: first_sunday += datetime.timedelta(days=7)
    if wk == 1: return first
    return first_sunday + datetime.timedelta(days=1 + 7 * (wk - 2))
out = []
for r in d["rows"]:
    status = str(r.get("Sales Status") or "").strip().upper()
    noshow = yn(r.get("NO SHOW?")) or status == "NO-SHOW"
    cxl = yn(r.get("LEAD CXL?")) or status == "CXL'D"
    if cxl and status == "NO-SHOW": noshow = False  # cancelled before the call, per notes
    if status == "": status = "NO-SHOW" if noshow else ("CXL'D" if cxl else "OPEN")
    if status == "SET TO JILL": status = "SET TO JILL"
    date = r.get("DATE OF CALL") or ""
    est = False
    if not re.match(r"\d{4}-\d{2}-\d{2}", str(date)):
        date = week_start(r["month"], r["week"]).isoformat(); est = True
    ct = str(r.get("CALL TYPE") or "").strip().upper()
    rec = {
        "closer": r["closer"], "lead": str(r["LEAD NAME"]).strip(), "date": date,
        "dateEstimated": est, "confirmed": yn(r.get("Confirmed Appt? LEAVE BLANK IF RESCHEDULED)")),
        "offer": yn(r.get("OFFER MADE?")), "noShow": noshow, "cxl": cxl, "status": status,
        "deposit": yn(r.get("DEPOSIT RECEIVED?")),
        "revenue": num(r.get("TOTAL REVENUE GENERATED")), "cash": num(r.get("CASH COLLECTED TODAY")),
        "callType": "New Consult" if ct == "NEW CONSULT" else ("Follow-up" if "FOLLOW" in ct else ""),
        "notes": str(r.get("NEXT STEPS") or "").strip(),
        "source": f"Closer Tracker {r['month']} / {r['closer'].upper()} tab, week {r['week']}",
        "createdAt": "2026-11-10T00:00:00Z",
    }
    rec["id"] = "h" + hashlib.sha1(f"{rec['source']}|{r['row']}".encode()).hexdigest()[:10]
    out.append(rec)
json.dump(out, open(sys.argv[2], "w"), indent=1)
from collections import Counter
print(len(out), Counter(o["status"] for o in out), sum(o["dateEstimated"] for o in out), "estimated dates")
print("ids unique:", len({o["id"] for o in out}))
