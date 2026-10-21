#!/usr/bin/env python3
"""Week of Oct 26, 2026: three Primally Pure carousels. Run from the repo root:
    python3 brand-assets/layouts/week-2026-10-26.py
    python3 .claude/skills/graphic-designer/scripts/render.py output/<project>
"""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("pp", Path(__file__).with_name("primally-pure-carousels.py"))
pp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pp)
P = f"{pp.A}/products"

# ---------- 1. Hosting checklist (save-worthy; your pumpkin-centerpiece reel + the non-toxic home gap)
host = [
    ("stone grain", pp.cover("Hosting this year?", "Your cozy, <em>non-toxic</em> holiday checklist",
                             "Save this for party day", f"{P}/bergamot-eucalyptus-candle-match.jpg", "center 60%")),
    ("light", pp.textslide("01", "Before the doorbell", "Mist the <em>room</em>",
                           "A few sprays of Holiday Room Spray: black spruce, cinnamon, vanilla + mint. No synthetic fragrance.")),
    ("green", pp.product("02 · As guests arrive", "Light the <em>candle</em>",
                         "Clean-burning beeswax + coconut wax, scented only with essential oils.",
                         "Holiday Candle · from $46", f"{P}/holiday-candle.png")),
    ("sand", pp.product("03 · The table", "Make it a <em>centerpiece</em>",
                        "A candle, a white pumpkin, dried orange slices + cinnamon sticks. Done in five minutes.",
                        "Warm Citrus Spice Candle · from $54", f"{P}/warm-citrus-spice-candle-pumpkin.jpg", "15% 85%")),
    ("light", pp.textslide("04", "At the sink", "Stock the <em>hand soap</em>",
                           "Holiday Hand Soap: peppermint, spearmint + vanilla, with cold-pressed oils for dry winter hands.")),
    ("green", pp.textslide("05", "On the way out", "Send them home with a <em>favor</em>",
                           "A Holiday Tinted Lip Balm ($12): sheer cranberry shimmer in icy mint + toasty vanilla.")),
    ("stone grain", pp.cta("Room spray + candle + hand soap", "The Holiday <em>Home</em> Collection",
                           "All three, only here for the holidays. $114.", "Comment HOST for the checklist",
                           f"{P}/holiday-candle.png")),
]
pp.write("hosting-checklist", host, "<em>Holiday</em> Hosting")

# ---------- 2. Natural deodorant myths (trust; answers the price + adjustment objections Lauren confirmed)
deo = [
    ("stone grain", pp.cover("Thinking about switching?", "Natural deodorant <em>myths</em>, busted",
                             "Swipe before you give up", f"{P}/jet-set-holiday-lifestyle.jpg", "30% 60%")),
    ("light", pp.myth("01", "Natural deodorant doesn't work.", "It <em>works</em>, all day",
                      "Odor control is the #1 thing reviewers praise. Our Unscented Deodorant: 4.7★ from 1,900+ reviews.")),
    ("green", pp.myth("02", "If it fails in week one, it's not for me.", "Give it a few <em>weeks</em>",
                      "Many people notice an adjustment period after years of antiperspirant. Stick with it for 2–4 weeks.")),
    ("light", pp.myth("03", "Baking soda bothers my skin, so I can't go natural.", "Go <em>baking soda free</em>",
                      "Our Unscented + Charcoal Baking Soda Free formulas are made for sensitive underarms. From $14.")),
    ("sand", pp.myth("04", "Natural means boring scents.", "Pick your <em>scent</em>",
                     "Lavender, Charcoal, Blue Tansy, Vanilla + Citrus, and the limited Holiday: icy sweet mint + toasty vanilla.")),
    ("stone grain", pp.cta("Ready to make the switch?", "Comment <em>SWITCH</em>",
                           "and we'll DM you our switching guide + the right formula for you.",
                           "Holiday Deodorant · $18", f"{P}/holiday-gift-set.png")),
]
pp.write("deodorant-myths", deo, "<em>Clean</em> Switch")

# ---------- 3. Stocking stuffers under $20 (impulse price, like Toups' $6 lip balm; gift guides get saved)
stuff = [
    ("stone grain", pp.cover("The label-reader's stocking", "Stocking stuffers <em>under $20</em>",
                             "Save this for your list", f"{P}/holiday-gift-set.png", "center")),
    ("light", pp.listslide("All limited edition or fan favorites", "Small gifts, <em>real</em> ingredients", [
        ("Holiday Tinted Lip Balm", "Sheer cranberry shimmer · icy mint + toasty vanilla", "$12"),
        ("Holiday Deodorant", "Aluminum-free · no synthetic fragrance", "$18"),
        ("Mini Holiday Whipped Body Butter", "Fluffy, fast-absorbing, a hint of mineral shimmer", "$18"),
        ("Latte Lip Oil", "Coffee + grass-fed tallow + lanolin", "$20"),
    ], "Holiday Collection pieces are only here for the holidays.")),
    ("green", pp.product("For the friend who's always cold", "Whipped Body <em>Butter</em>",
                         "Icy sweet mint + warm toasty vanilla, with a light holiday glow. The mini fits right in a stocking.",
                         "Mini · $18", f"{P}/jet-set-holiday-lifestyle.jpg", "30% 60%")),
    ("sand", pp.textslide("Tip", "Gift like a pro", "Tuck it in the <em>pouch</em>",
                          "Want the whole set? The Jet Set, Holiday edition ($76) comes zipped in an organic cotton bag.")),
    ("stone grain", pp.cta("Want the links?", "Comment <em>STOCKING</em>",
                           "and we'll send all four straight to your DMs.", "Shop the Holiday Collection",
                           f"{P}/holiday-candle.png")),
]
pp.write("stocking-stuffers", stuff, "<em>Holiday</em> Gift Guide")
