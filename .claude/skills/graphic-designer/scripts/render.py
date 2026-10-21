#!/usr/bin/env python3
"""Render every HTML file in <project>/src/ to a PNG in <project>/.

Each HTML file sets its size with:  <meta name="size" content="1080x1350">
Usage:  python3 render.py output/<project-name>
"""
import re
import sys
from pathlib import Path

DEFAULT_SIZE = (1080, 1350)


def read_size(html: str):
    m = re.search(r'<meta\s+name=["\']size["\']\s+content=["\'](\d+)\s*x\s*(\d+)["\']', html, re.I)
    return (int(m.group(1)), int(m.group(2))) if m else DEFAULT_SIZE


def main():
    if len(sys.argv) != 2:
        print("Usage: python3 render.py output/<project-name>")
        sys.exit(1)

    project = Path(sys.argv[1]).resolve()
    src = project / "src"
    files = sorted(src.glob("*.html"))
    if not files:
        print(f"No .html files found in {src}")
        sys.exit(1)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("MISSING: playwright. Install with:\n"
              "  pip install playwright   (add --break-system-packages if needed)\n"
              "  python3 -m playwright install chromium")
        sys.exit(2)

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception as e:
            print("MISSING: Chromium for playwright. Install with:\n"
                  "  python3 -m playwright install chromium\n"
                  f"Details: {e}")
            sys.exit(2)

        for f in files:
            w, h = read_size(f.read_text(encoding="utf-8"))
            page = browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
            page.goto(f.as_uri())
            page.wait_for_load_state("networkidle")
            page.evaluate("document.fonts.ready")
            out = project / f"{f.stem}.png"
            page.screenshot(path=str(out), clip={"x": 0, "y": 0, "width": w, "height": h})
            page.close()
            print(f"Rendered {out.name}  ({w}x{h})")
        browser.close()

    print(f"\nDone. {len(files)} image(s) saved in {project}")


if __name__ == "__main__":
    main()
