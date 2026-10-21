---
name: competitor-research
description: Researches the brands a physical product business competes with or admires, looking at what those brands post, how they sell, and what their customers say, then turns it into content ideas and gaps to own. Use when someone says "research my competitors", "what are other brands posting", "who should I watch", "competitor research", "what's working in my category", or runs /competitor-research.
---

# Competitor Research

You study the brands they compete with or admire and bring back ideas they can use this week. You don't produce a giant report. The goal is to help them see what works in their category and where they can stand out.

## Step 0 — Load the brand

Read `BRAND.md` for what they sell, who buys, their channels, and the **Brands we watch** list. If `BRAND.md` is missing, run `brand-studio-setup` first.

## Step 1 — Pick the brands

If **Brands we watch** is empty, ask for 3–8 brands and note the kind for each:
- **Direct competitor** — sells something similar to the same customer
- **Dream brand** — a bigger brand they'd love to be like someday
- **Style crush** — any brand whose posts they love, even in another category

If they aren't sure, suggest 5 candidates from a web search of their category and let them pick. Save the final list to **Brands we watch** in `BRAND.md` with each brand's website and social handles.

## Step 2 — Research

For each brand, use web search and web fetch to look at:
- **Website:** hero message, bestsellers, price points, bundles and gift sets, current promo, shipping and returns promises
- **Reviews:** what customers praise and complain about (product pages, Amazon, Etsy, Google reviews). Complaints are opportunities.
- **Social:** public posts you can reach, plus press, roundups, and gift guides they appear in

Social platforms often block automated viewing. When you can't see a brand's posts, say so and ask: "Can you drag in screenshots of 3–5 of their recent posts that got lots of likes or comments?" Screenshots work great. View them and include them in the analysis.

Only report what you actually found. Mark anything you couldn't verify.

## Step 3 — Report

Save the report to `output/research/<date>-competitor-research.md` and show a short version in chat:

1. **The big takeaway**: one or two sentences on what matters most this week.
2. **Brand snapshots**: per brand, 3–4 lines covering their angle, price range, what they post most, and one thing they do well.
3. **Patterns that work**: hooks, formats, and offers showing up across several brands, each with a real example.
4. **What customers complain about**: recurring gripes from reviews that this business can answer in its content (e.g. "scent fades fast" → a post about burn time).
5. **Gaps to own**: things no one is saying that fit this brand.
6. **5 post ideas**: each with a hook in their voice, a format, and the product it features.

Never suggest copying a competitor's post, wording, or visuals. Borrow the pattern, not the content.

## Step 4 — Hand off

Offer: "Want me to write one of these, or design it?" Then pass the idea to `content-writer` or `graphic-designer`.
