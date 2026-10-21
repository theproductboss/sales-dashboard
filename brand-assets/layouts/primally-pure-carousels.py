#!/usr/bin/env python3
"""Generate Primally Pure carousel slides as HTML (rendered by graphic-designer/scripts/render.py)."""
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")  # repo root
A = "../../../brand-assets"
FONTS = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500'
         '&family=DM+Mono:wght@400;500&family=Figtree:wght@400;500;600&display=block">')

CSS = """
:root{--green:#3F4E3D;--black:#1E1D21;--stone:#958F80;--bg:#F3F1EC;--text:#303433;--sand:#E4D8C7;--sage:#A9A795;
--serif:"Cormorant Garamond",Georgia,serif;--mono:"DM Mono",ui-monospace,monospace;--sans:"Figtree",Helvetica,Arial,sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1350px;overflow:hidden;-webkit-font-smoothing:antialiased}
body{font-family:var(--sans);color:var(--text);background:var(--bg)}
.page{position:relative;width:1080px;height:1350px;overflow:hidden}
.stone{background:var(--stone);color:#fff}
.green{background:var(--green);color:#fff}
.black{background:var(--black);color:#fff}
.light{background:var(--bg);color:var(--text)}
.sand{background:var(--sand);color:var(--text)}
.grain:after{content:"";position:absolute;inset:0;pointer-events:none;opacity:.22;mix-blend-mode:multiply;
background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.35  0 0 0 0 0.33  0 0 0 0 0.3  0 0 0 .9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
.top{position:absolute;left:88px;right:88px;top:72px;display:flex;align-items:center;gap:28px;
font-family:var(--mono);font-size:26px;letter-spacing:.16em;text-transform:uppercase;z-index:3}
.top .series{font-family:var(--serif);font-size:38px;letter-spacing:0;text-transform:none;white-space:nowrap}
.top .series em{font-style:italic}
.top .line{flex:1;height:1.5px;background:currentColor;opacity:.55}
.foot{position:absolute;left:0;right:0;bottom:62px;display:flex;justify-content:center;z-index:3}
.logo{height:22px;width:auto;display:block}
.kicker{font-family:var(--mono);font-size:28px;letter-spacing:.16em;text-transform:uppercase}
h1,h2{font-family:var(--serif);font-weight:500;letter-spacing:-.01em;line-height:1.02;text-wrap:balance}
h1 em,h2 em{font-style:italic;font-weight:400}
.body{font-family:var(--sans);font-size:40px;line-height:1.36;text-wrap:pretty}
.price{font-family:var(--mono);font-size:30px;letter-spacing:.1em}
.arrow{display:inline-flex;align-items:center;width:150px;height:20px;position:relative}
.arrow:before{content:"";flex:1;height:2px;background:currentColor}
.arrow:after{content:"";position:absolute;right:1px;width:16px;height:16px;border-top:2px solid currentColor;border-right:2px solid currentColor;transform:rotate(45deg)}
.frame{position:absolute;overflow:hidden;background:#f3f3f3}
.frame img{width:100%;height:100%;object-fit:cover;display:block}
.center{text-align:center}
"""


def page(cls, inner, series, n, total):
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="size" content="1080x1350">{FONTS}<style>{CSS}</style></head>
<body><div class="page {cls}">
<div class="top"><span class="series">{series}</span><span class="line"></span><span>{n:02d} / {total:02d}</span></div>
{inner}
<div class="foot"><img class="logo" src="{A}/logo/primally-pure-wordmark-{'charcoal' if any(c in cls for c in ('light','sand')) else 'white'}.png" alt=""></div>
</div></body></html>"""


def cover(kicker, headline, sub, img, pos="center"):
    # Text-led cover on grainy stone with a tall framed photo, like the "Daily Essentials" post
    return f"""
<div class="center" style="position:absolute;left:88px;right:88px;top:170px">
  <div class="kicker" style="margin-bottom:26px">{kicker}</div>
  <h1 style="font-size:112px">{headline}</h1>
</div>
<div class="frame" style="left:190px;right:190px;top:520px;height:640px;border-radius:350px 350px 0 0">
  <img src="{img}" style="object-position:{pos}"></div>
<div class="center" style="position:absolute;left:88px;right:88px;top:1186px;display:flex;justify-content:center;align-items:center;gap:22px;font-family:var(--sans);font-size:30px">
  {sub}<span class="arrow"></span></div>"""


def product(kicker, headline, body, price, img, pos="center", side=None):
    # Centered photo at the photo's own shape (no heavy crop/upscale), text centered below
    return f"""
<div class="frame" style="left:284px;width:512px;top:150px;height:640px;border-radius:256px 256px 0 0"><img src="{img}" style="object-position:{pos}"></div>
<div class="center" style="position:absolute;left:88px;right:88px;top:836px">
  <div class="kicker" style="margin-bottom:18px;font-size:26px">{kicker}</div>
  <h2 style="font-size:88px;margin-bottom:24px">{headline}</h2>
  <p class="body" style="font-size:36px;margin:0 auto 26px;max-width:860px">{body}</p>
  <div class="price">{price}</div>
</div>"""


def textslide(number, kicker, headline, body):
    return f"""
<div style="position:absolute;left:88px;right:88px;top:330px">
  <div style="font-family:var(--serif);font-style:italic;font-size:220px;line-height:1;opacity:.55;margin-bottom:40px">{number}</div>
  <div class="kicker" style="margin-bottom:30px">{kicker}</div>
  <h2 style="font-size:100px;margin-bottom:46px">{headline}</h2>
  <div style="width:100%;height:1.5px;background:currentColor;opacity:.4;margin-bottom:46px"></div>
  <p class="body" style="font-size:46px">{body}</p>
</div>"""


def stat(kicker, big, line, words, img=None, pos="center"):
    return f"""
<div class="center" style="position:absolute;left:88px;right:88px;top:330px">
  <div class="kicker" style="margin-bottom:40px">{kicker}</div>
  <h2 style="font-size:300px;line-height:.9;margin-bottom:40px">{big}</h2>
  <p class="body" style="margin-bottom:70px">{line}</p>
  <div style="width:120px;height:1.5px;background:currentColor;opacity:.5;margin:0 auto 70px"></div>
  <div style="font-family:var(--serif);font-style:italic;font-size:76px;line-height:1.2">{words}</div>
  <div class="kicker" style="margin-top:26px;font-size:22px;opacity:.7">What customers say they notice most</div>
</div>"""


def cta(kicker, headline, body, action, img=None, pos="center"):
    photo = (f'<div class="frame" style="left:330px;right:330px;top:190px;height:530px;border-radius:220px 220px 0 0">'
             f'<img src="{img}" style="object-position:{pos}"></div>') if img else ""
    top = 790 if img else 330
    return f"""{photo}
<div class="center" style="position:absolute;left:88px;right:88px;top:{top}px">
  <div class="kicker" style="margin-bottom:26px">{kicker}</div>
  <h2 style="font-size:{92 if img else 120}px;margin-bottom:30px">{headline}</h2>
  <p class="body" style="margin-bottom:40px">{body}</p>
  <div style="display:inline-flex;align-items:center;gap:22px;font-family:var(--mono);font-size:30px;letter-spacing:.14em;text-transform:uppercase;border-bottom:1.5px solid currentColor;padding-bottom:12px">{action}</div>
</div>"""


def write(project, slides, series):
    src = ROOT / "output" / project / "src"
    src.mkdir(parents=True, exist_ok=True)
    for old in src.glob("*.html"):
        old.unlink()
    for i, (cls, inner) in enumerate(slides, 1):
        (src / f"{i:02d}.html").write_text(page(cls, inner, series, i, len(slides)), encoding="utf-8")
    print(f"{project}: {len(slides)} slides")

def listslide(kicker, headline, items, note=""):
    # Price list: [(name, detail, price), ...]
    rows = "".join(
        f'<div style="display:flex;align-items:baseline;gap:24px;padding:30px 0;border-bottom:1.5px solid color-mix(in srgb,currentColor 25%,transparent)">'
        f'<div style="flex:1"><div style="font-family:var(--serif);font-size:56px;line-height:1.05">{n}</div>'
        f'<div style="font-family:var(--sans);font-size:30px;opacity:.8;margin-top:8px">{d}</div></div>'
        f'<div class="price" style="font-size:34px">{pr}</div></div>' for n, d, pr in items)
    return f"""
<div style="position:absolute;left:88px;right:88px;top:200px">
  <div class="kicker" style="margin-bottom:22px">{kicker}</div>
  <h2 style="font-size:92px;margin-bottom:24px">{headline}</h2>
  {rows}
  <p class="body" style="font-size:30px;margin-top:30px;opacity:.85">{note}</p>
</div>"""


def myth(number, myth_text, truth_head, truth_body):
    return f"""
<div style="position:absolute;left:88px;right:88px;top:250px">
  <div style="font-family:var(--serif);font-style:italic;font-size:150px;line-height:1;opacity:.5;margin-bottom:36px">{number}</div>
  <div class="kicker" style="margin-bottom:18px;opacity:.75">Myth</div>
  <div style="font-family:var(--serif);font-size:62px;line-height:1.1;margin-bottom:56px;text-decoration:line-through;text-decoration-thickness:2px;opacity:.75">“{myth_text}”</div>
  <div class="kicker" style="margin-bottom:18px">Truth</div>
  <h2 style="font-size:92px;margin-bottom:34px">{truth_head}</h2>
  <p class="body">{truth_body}</p>
</div>"""


P = f"{A}/products"

if __name__ == "__main__":

    # ---------- Carousel 1: Holiday gift guide (discovery + sales, built to be saved and shared)
    gift = [
        ("stone grain", cover("The 2026 Holiday Gift Guide", "Gifts for your <em>non-toxic</em> people",
                              "Save this for your list", f"{P}/jet-set-holiday-lifestyle.jpg", "30% 60%")),
        ("light", product("For the one always on the go", "The Jet Set, <em>Holiday</em>",
                          "Our best sellers in nostalgic holiday scents. TSA-approved + zipped in an organic cotton bag.",
                          "$76 · Limited edition", f"{P}/holiday-gift-set.png", "center")),
        ("green", product("For the homebody", "Holiday <em>Candle</em>",
                          "Black spruce, sweet cinnamon + vanilla in clean-burning beeswax. Only here for the holidays.",
                          "From $46", f"{P}/holiday-candle.png", "center", side="right")),
        ("light", product("For the skincare lover", "Antioxidant <em>Balm</em>",
                          "Grass-fed tallow + antioxidant-rich superfoods for a glow-ready finish, naturally.",
                          "From $42 · 4.8★ from 5,800+ reviews", f"{P}/antioxidant-balm-lifestyle.png", "center")),
        ("sand", product("For the cozy-scent lover", "Warm Citrus <em>Spice</em>",
                         "Citrus spice with hints of cacao, honey, golden hay + apple blossom. Fall, in a candle.",
                         "From $54", f"{P}/warm-citrus-spice-candle-pumpkin.jpg", "12% 80%", side="right")),
        ("stone grain", cta("Want every link?", "Comment <em>GIFT</em>", "and we'll send the full guide straight to your DMs.",
                            "Shop the Holiday Collection", f"{P}/holiday-candle.png")),
    ]
    write("holiday-gift-guide", gift, "<em>Holiday</em> Gift Guide")

    # ---------- Carousel 2: Tallow education (answers tallow skepticism + price with proof)
    balm = [
        ("stone grain", cover("The ingredient everyone asks about", "Tallow on your <em>face?</em>",
                              "Here's what's in our Antioxidant Balm", f"{P}/antioxidant-balm-lifestyle.png", "center 30%")),
        ("light", textslide("01", "Grass-fed tallow", "The <em>original</em> ingredient",
                            "Rich, nourishing fatty acids. It's the first ingredient our founder rendered on her family's farm.")),
        ("green", textslide("02", "Astaxanthin", "An antioxidant from <em>red algae</em>",
                            "Gives the balm its golden color + helps brighten and restore radiance.")),
        ("light", textslide("03", "Frankincense, lavender + helichrysum", "Scented by <em>nature</em>",
                            "Organic essential oils give it a grounding, herbal warmth. Never synthetic fragrance.")),
        ("sand", product("How to use it", "The <em>final</em> step",
                         "Morning or night, massage a light layer over your mist, serum or cream to seal it all in.",
                         "1 oz · $42  |  2 oz · $72", f"{P}/antioxidant-balm.png", "center")),
        ("black", stat("Real customer reviews", "4.8<span style='font-size:150px'>★</span>",
                       "from 5,800+ reviews of the Antioxidant Balm", "Radiant · dewy · smooth",
                       f"{P}/antioxidant-balm-lifestyle.png", "center 35%")),
        ("stone grain", cta("Ready to glow?", "Comment <em>GLOW</em>", "and we'll DM you the full balm routine.",
                            "Antioxidant Balm · from $42", f"{P}/antioxidant-balm.png")),
    ]
    write("tallow-antioxidant-balm", balm, "<em>Skincare</em>, Simplified")
