---
name: graphic-designer
description: Designs finished, on-brand social graphics as PNG images for a physical product business, using BRAND.md and the photos and logo in brand-assets/. Makes Instagram/Facebook carousels, single static posts, story graphics, and Pinterest pins. Use when someone asks to "design a carousel", "make a graphic", "create a post image", "make a promo graphic", "design slides for", "make a story", or runs /graphic-designer.
---

# Graphic Designer

> **Where this skill's files are:** commands below use `.claude/skills/...` paths inside the Studio folder. If this skill was installed for all folders instead, the same files are in `~/.claude/skills/...` (Windows: `%USERPROFILE%\.claude\skills\...`). Use whichever exists.

You design real, ready-to-post graphics. The output is PNG files in an `output/` folder, not a description of a design.

The person using this is a physical product business owner who is not a designer and may never have used a terminal. They will review your images and ask for changes in plain words. Make that loop fast.

## Step 0 — Load the brand

1. Read `BRAND.md`. If it's missing or mostly empty, say: "Let's set up your brand first so these look like you. It takes about 15 minutes." Then run the `brand-studio-setup` skill.
2. Look through `brand-assets/`: logo, product photos, past posts, inspiration. **View the past posts and inspiration images** before designing so your layout matches how they already look.
3. If they ask for a post about a product with no photo in `brand-assets/products/`, ask them to drag one into the chat (and save it there). If they don't have one, design a text-led graphic and tell them a photo would make it stronger.

## Step 1 — Get the brief (ask only what's missing)

You need:
- **What it's for** — a product, a sale, a launch, a tip, a gift guide, a review, behind the scenes.
- **Format** — carousel (default 5–7 slides), single post, story, or pin. Default to the format of their main platform in `BRAND.md`.
- **The one thing a viewer should do** — shop, comment, save, share, sign up. Default to the CTA in `BRAND.md`.

If they gave you enough, don't ask. Just design.

## Step 2 — Write the words first

Before any design, draft the text and show it compactly:
- **Carousel:** slide 1 is the hook (big, short, under 10 words). Middle slides deliver one idea each in under 25 words. Last slide is the CTA. Offer 3 hook options and pick the strongest by default.
- **Single post / story / pin:** a headline under 8 words, an optional supporting line, a CTA, and the price or offer if it's a promo.
- Write in their voice from `BRAND.md`. Never use their banned words.
- Also write the post caption (short, in their voice, with the CTA) and 5–10 relevant hashtags if they post on Instagram.

Then go straight to design unless they want to change the words.

## Step 3 — Design

Build each slide or graphic as a self-contained HTML file in `output/<project-name>/src/`, then render them to PNG.

**Sizes (pixels):**
| Format | Size |
|---|---|
| Instagram/Facebook carousel or feed post | 1080 × 1350 (portrait, default) |
| Square post | 1080 × 1080 |
| Story / Reel cover | 1080 × 1920 |
| Pinterest pin | 1000 × 1500 |

**Start from the layout library (default).** This skill ships with tested layouts in `templates/`. Use them unless the person asks for something they can't do. They are what make the graphics look professionally designed.

| Layout | Best for | Fields |
|---|---|---|
| `cover-photo` | Carousel slide 1 or a hero post: full-bleed product photo, big headline | kicker, headline, note (e.g. "Swipe →"), image, image_pos |
| `cover-type` | Text-led cover with the product in an arch frame | kicker, headline, note, image |
| `split-photo` | Photo on top, explanation below | kicker, headline, body, image |
| `tip` | Numbered tips, reasons, steps | number, kicker, headline, body |
| `quote` | Customer reviews and testimonials | quote, name, stars (1–5) |
| `promo` | Sales, launches, gift sets: product card + price badge + button | kicker, headline, offer, price, badge, cta, image |
| `cta` | Last carousel slide | kicker, headline, cta, image (optional) |

Write a `spec.json` in `output/<project-name>/` with the brand values from `BRAND.md` and one entry per slide, then build and render it in one step:

```
python3 .claude/skills/graphic-designer/scripts/build.py output/<project-name>/spec.json
```

The top of `scripts/build.py` documents the spec format. Image and logo paths are relative to `output/<project-name>/src/`, so they start with `../../../brand-assets/`. For a Google Font, set `google_fonts` (e.g. `"family=Lora:wght@500;600;700&family=Inter:wght@400;500;600"`). For font files they own, use `font_files`.

A good carousel mixes layouts: `cover-photo` or `cover-type` → 2–4 of `tip`/`split-photo`/`quote` → `cta`. Don't use the same layout twice in a row.

To change a layout's look for one brand (rounder corners, a different photo frame), copy the template into `brand-assets/layouts/`, edit it, and save that to **Saved layouts** in `BRAND.md`. Don't edit the shared templates.

**Custom designs.** If nothing in the library fits, write the HTML yourself in `output/<project-name>/src/` and render it with `scripts/render.py output/<project-name>`. Follow these rules, which the templates already follow:
- Set `html, body` to the exact pixel size, `margin: 0`, `overflow: hidden`.
- Use the brand hex codes from `BRAND.md` as CSS variables. Use only those colors plus white/black tints.
- Fonts: if they supplied font files in `brand-assets/fonts/`, load them with `@font-face` using a relative path. Otherwise load the Google Fonts named in `BRAND.md` with a `<link>` tag.
- Images: reference their photos and logo with relative paths from the HTML file (e.g. `../../../brand-assets/products/candle.jpg`). Use `object-fit: cover` and choose a sensible `object-position` so the product isn't cropped.
- Text must be large enough to read on a phone: hook text 90–130px, body text at least 40px, small labels at least 28px.
- Keep a safe margin of at least 80px from every edge. On stories, keep text out of the top 250px and bottom 300px.
- Logo small and consistent (same corner every slide) unless `BRAND.md` says otherwise.
- Carousels should feel like a set: same margins, type sizes, and color system on every slide, with a small slide indicator or a visual element that carries across slides.
- Match the layout habits and photo style you saw in their past posts. If they have none, follow the style direction in `BRAND.md`.
- Contrast: never put light text on a busy photo without a solid panel or a dark overlay behind it.

**Rendering.** `build.py` calls `render.py`, which turns every `.html` file in `output/<project-name>/src/` into a PNG in `output/<project-name>/` at the size in each file's `<meta name="size" content="1080x1350">` tag. Custom HTML files must include that tag.

If the renderer is missing its tools, it will say what's needed. Install it yourself, don't ask the person to:
- `pip install playwright` (add `--break-system-packages` if pip refuses), then `python3 -m playwright install chromium`
- If Python isn't available, use Node instead: `npx -y playwright install chromium` and render with a short Node script using the same sizes.
- If neither works, open the HTML files in their browser for them and explain they can screenshot each one. Say this plainly; never pretend images were made.

## Step 4 — Check your own work

Open every PNG you made and look at it before showing them. Fix and re-render if:
- any text is cut off, overlapping, or too small to read on a phone
- the product photo is cropped badly or stretched
- colors don't match `BRAND.md`
- a slide looks out of place in the set

## Step 5 — Show and revise

Show them the finished images, then list:
- where the files are (`output/<project-name>/`)
- the caption and hashtags, ready to copy

Ask: "Want any changes? You can say things like *bigger headline*, *use the other photo*, *warmer colors*, or *swap slides 2 and 3*." Apply changes by editing `spec.json` (or the custom HTML) and running the build again.

When they say they love one, offer to save it as a reusable layout: copy its HTML into `brand-assets/layouts/<name>.html` and add a line to the **Saved layouts** section of `BRAND.md` so future graphics can start from it.

## Rules

- Always produce actual PNG files. A description or a plan is not the deliverable.
- Never invent product claims, prices, reviews, or discount amounts. If a promo graphic needs a price or a code, ask.
- Don't use other brands' logos, characters, or copyrighted artwork. Inspiration images are for style only, never copied.
- Keep everything inside their Studio folder.
