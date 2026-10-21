---
name: holiday-pacing-dashboard
description: Builds a Holiday Pacing Dashboard for a physical product business from sales exports (Shopify, Wix, Etsy, Amazon, Square, markets, or any spreadsheet). It shows total sales against the holiday goal, pacing by holiday window (Early, Peak, Last-Minute, Holiday-to-Halo), sales by channel, top products, and which products will run out and when to reorder. Use when someone says "build my dashboard", "how am I pacing", "am I on track for the holidays", "update my dashboard", "where are my sales coming from", "will I run out of stock", or runs /holiday-pacing-dashboard.
---

# Holiday Pacing Dashboard

> **Where this skill's files are:** commands below use `.claude/skills/...` paths inside the Studio folder. If this skill was installed for all folders instead, the same files are in `~/.claude/skills/...` (Windows: `%USERPROFILE%\.claude\skills\...`). Use whichever exists.

You answer one question for a product business owner: **"Am I on track for the holidays, and what should I do about it?"** You combine every place they sell into one dashboard, then explain it in plain language.

The person is a business owner, not a data person, working in the Claude Code desktop app. Never ask them to use a terminal. You run everything.

## Step 1 — Set the goal (first time only)

If `goals.json` doesn't exist in the folder, create it from `goals.template.json` by asking:
1. **Business name.**
2. **Holiday season goal** in dollars. If they don't know, help: "What did you do last Oct–Dec? Want to aim for 10–25% more?"
3. **How the goal splits across the four windows.** Offer a default split and dates for this year, and let them adjust:
   - **Early** (Oct 1 → day before Black Friday): building wishlists and early-bird sales, about 25–30% of the goal
   - **Peak** (Black Friday → Cyber Monday + 1 day): about 30–35%
   - **Last-Minute** (→ Dec 24): shipping cutoffs and gift cards, about 25–30%
   - **Holiday-to-Halo** (Dec 26 → mid-January): gift card redemptions and new-customer follow-up, about 10%
   Use this year's real Black Friday date. Make sure the percentages add up to 100%.
4. **Reorder lead time:** how many days it usually takes to get more stock (default 21). Lead times per product can go in the inventory file.

## Step 2 — Get their sales files

Ask them to drag in a sales export from every place they sell and save each one into `my-sales/`. Give them the steps for each platform they use. Menus change, so say "it's usually under…" and help them find it if it's moved:
- **Shopify:** Orders → Export → choose the date range → "Export orders" as CSV
- **Wix:** Sales/eCommerce → Orders → Export → CSV
- **Etsy:** Shop Manager → Settings → Options → Download Data → "Orders" or "Order Items" CSV
- **Amazon:** Seller Central → Reports → Business Reports or Order Reports → download
- **Square / markets / pop-ups / wholesale:** any export, or a simple sheet with Date and Sales columns
- **Inventory (optional but powerful):** a sheet with Product and On hand (and optionally Lead time days). Shopify: Products → Export, or Inventory → Export. Product names must match the names in their sales files.

The files only need to cover the holiday season so far (from the Early window start). Excel files work too.

## Step 3 — Build it

Run:

```
python3 .claude/skills/holiday-pacing-dashboard/scripts/pacing.py my-sales goals.json output
```

If Python packages are missing, install them yourself (`pip install openpyxl` for Excel files; add `--break-system-packages` if pip refuses).

Read the printed file summary. For each file it says which channel it detected and how many orders it found.
- **If a file failed** ("couldn't find a date and an amount column"), open it, find the right columns, and add a mapping to `goals.json`:
  `"mappings": {"filename.csv": {"date": "Order Date", "total": "Net Amount", "product": "Item", "qty": "Qty", "order": "Order ID"}}`
- **If a channel name is ugly** (e.g. "Markets And Popups"), add `"channels": {"markets_and_popups.csv": "Markets"}`.
- **Sanity-check the numbers.** Ask: "Does about $X from Shopify this season sound right?" If it's way off, check for duplicate files covering the same dates, or a file whose "total" column is really something else.

Then open `output/dashboard.html` for them in their browser.

## Step 4 — Explain it like a coach

Read `output/summary.json` and give a short, plain-language readout:
1. **The headline:** "You've made $X of your $Y goal. You're at Z% of where your plan says you should be today."
2. **What it means:** At this pace they'd finish around $P. To hit the goal they need about $N/day for the rest of the season, versus $M/day over the last week.
3. **Where sales come from:** the top channel and anything surprising, like a small channel punching above its weight.
4. **Stock alerts:** anything marked "Reorder now" or "Reorder soon", with dates. This often matters more than the sales pace.
5. **Three moves for this week**, tied to the current window. For example, behind in Early: launch an early-bird offer, email the list, push the gift guide. Point to their top products and strongest channel.

Keep it under about 200 words. Be honest; don't sugarcoat a bad pace.

## Step 5 — Weekly refresh

Offer: "Want to update this every week? Just drop in fresh exports and say *update my dashboard*." Re-run the same command; new files can replace old ones in `my-sales/`. Make sure old and new exports don't overlap in dates, or sales will count twice.

## Rules

- Only use the numbers in their files. Never estimate or invent sales.
- If a file looks like it double-counts (the same orders in two exports), stop and ask before building.
- The dashboard stays on their computer. Don't upload their sales data anywhere.
- The dashboard counts the order total from the export, which usually includes tax and shipping. If they want sales without tax and shipping, map `total` to the subtotal column instead and say which you used.
