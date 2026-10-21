#!/usr/bin/env python3
"""Build on-brand social graphics from a JSON spec using the Studio layout library.

Usage:  python3 build.py output/<project>/spec.json

Spec format:
{
  "brand": {
    "primary": "#3B2A20", "secondary": "#C9A27E", "accent": "#D9643A",
    "background": "#F6EFE6", "text": "#1F1A17",
    "font_head": "Lora", "font_body": "Inter",
    "google_fonts": "family=Lora:wght@500;600;700&family=Inter:wght@400;500;600",
    "font_files": {"Brand Head": "../../../brand-assets/fonts/Head.otf"},   (optional)
    "logo": "../../../brand-assets/logo/logo.png",                           (optional)
    "name": "Copper Kettle", "handle": "@copperkettle"
  },
  "size": "1080x1350",
  "slides": [
    {"layout": "cover-photo", "kicker": "...", "headline": "...", "image": "../../../brand-assets/products/x.jpg"},
    ...
  ]
}
Image and logo paths are relative to output/<project>/src/.
Layouts live in ../templates/. Unused fields can be left out.
"""
import html
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEMPLATES = HERE.parent / "templates"
FIELDS = ["kicker", "headline", "body", "image", "image_pos", "number", "quote",
          "name", "stars", "price", "offer", "cta", "note", "badge"]
RAW_FIELDS = {"image", "image_pos"}


def brand_css(b):
    faces = ""
    for fam, path in (b.get("font_files") or {}).items():
        faces += f'@font-face{{font-family:"{fam}";src:url("{path}");font-display:block}}\n'
    return f"""{faces}:root{{
--primary:{b['primary']};--secondary:{b.get('secondary', b['primary'])};
--accent:{b.get('accent', b['primary'])};--bg:{b.get('background', '#ffffff')};
--text:{b.get('text', '#111111')};
--font-head:"{b.get('font_head', 'Georgia')}",Georgia,serif;
--font-body:"{b.get('font_body', 'Helvetica')}",Helvetica,Arial,sans-serif;}}"""


def fill(tpl, slide, brand, idx, total, size):
    w, h = size.split("x")
    vals = {f: "" for f in FIELDS}
    for k, v in slide.items():
        if k in FIELDS:
            vals[k] = str(v) if k in RAW_FIELDS else html.escape(str(v)).replace("\n", "<br>")
    vals["image_pos"] = vals["image_pos"] or "center"
    vals.update({
        "W": w, "H": h,
        "brand_css": brand_css(brand),
        "google_fonts": (f'<link rel="stylesheet" href="https://fonts.googleapis.com/css2?{brand["google_fonts"]}&display=block">'
                         if brand.get("google_fonts") else ""),
        "brand_mark": (f'<img class="logo" src="{brand["logo"]}" alt="">' if brand.get("logo")
                       else f'<span class="wordmark">{html.escape(brand.get("name", ""))}</span>'),
        "handle": html.escape(brand.get("handle", "")),
        "counter": f"{idx:02d} / {total:02d}" if total > 1 else "",
        "stars_html": "★" * int(slide.get("stars", 0) or 0),
    })
    out = tpl
    for k, v in vals.items():
        out = out.replace("{{" + k + "}}", v)
    leftover = re.findall(r"\{\{(\w+)\}\}", out)
    for k in leftover:
        out = out.replace("{{" + k + "}}", "")
    return out


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    spec_path = Path(sys.argv[1]).resolve()
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    project = spec_path.parent
    src = project / "src"
    src.mkdir(parents=True, exist_ok=True)
    base = (TEMPLATES / "_base.css").read_text(encoding="utf-8")
    size = spec.get("size", "1080x1350")
    slides = spec["slides"]
    for old in src.glob("*.html"):
        old.unlink()
    for i, s in enumerate(slides, 1):
        tpl_file = TEMPLATES / f"{s['layout']}.html"
        if not tpl_file.exists():
            names = ", ".join(p.stem for p in TEMPLATES.glob("*.html"))
            print(f"Unknown layout '{s['layout']}'. Available: {names}")
            sys.exit(1)
        tpl = tpl_file.read_text(encoding="utf-8").replace("{{base_css}}", base)
        (src / f"{i:02d}-{s['layout']}.html").write_text(
            fill(tpl, s, spec["brand"], i, len(slides), s.get("size", size)), encoding="utf-8")
    print(f"Built {len(slides)} slide(s). Rendering...")
    sys.exit(subprocess.call([sys.executable, str(HERE / "render.py"), str(project)]))


if __name__ == "__main__":
    main()
