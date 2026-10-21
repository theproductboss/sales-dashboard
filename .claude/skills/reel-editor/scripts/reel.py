#!/usr/bin/env python3
"""Cut a vertical Reel / TikTok from an edit plan.

Usage:  python3 reel.py output/<project>/edit.json [more edit.json files ...]
        (several plans = a batch; each video is written next to its own edit.json)

edit.json:
{
  "brand": { same keys as the graphic-designer spec: primary, accent, background,
             font_head, font_body, google_fonts, name, handle },
  "size": "1080x1920",
  "output": "reel.mp4",              # file name to write (optional)
  "clips": [
    {"file": "/full/path/clip1.mov", "start": 1.2, "end": 4.0,     # or "duration": 2.8
     "punch": 1.0,                   # 1.0 = none, 1.15 = 15% zoom-in "punch" cut
     "focus": "center",              # crop focus: left / center / right
     "text": "Our best seller is back", "text_pos": "top"},   # top / center / bottom
    {"aroll": true, "duration": 3.5},   # show the speaker (voice file) at this point in the talk
    ...
  ],
  "keep_audio": true,                # keep each clip's own sound (ignored when "voice" is set)

  "voice": {"file": "/full/path/talking-head.mov", "start": 4.0, "volume": 1.0},   (optional)
      # One continuous sound track for the whole video: a talking-head clip or a recorded
      # voiceover. Every cut plays over it. "aroll" clips cut back to the speaker in sync;
      # any other clip is B-roll covering the voice. Caption times start at voice.start = 0.

  "music": {"file": "/full/path/song.mp3", "volume": 0.25},    (optional; default 0.12 under a voice)
  "captions": "output/<project>/captions.srt",                 (optional, burned in)
  "end_card": {"headline": "Shop the gift box", "cta": "Link in bio", "seconds": 2.5}  (optional)
}

To swap audio: set "keep_audio": false and add "music"; or add/replace "voice".
To mute everything: "keep_audio": false with no music or voice.
"""
import html
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _ff import ffmpeg_exe, probe  # noqa: E402

FPS = 30


def run(args):
    r = subprocess.run([ffmpeg_exe(), "-hide_banner", "-v", "error", "-y"] + args,
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("ffmpeg failed:\n" + r.stderr[-2000:])


def brand_vars(b):
    return (f':root{{--primary:{b.get("primary", "#222")};--accent:{b.get("accent", "#e05a33")};'
            f'--bg:{b.get("background", "#fff")};--fh:"{b.get("font_head", "Georgia")}",Georgia,serif;'
            f'--fb:"{b.get("font_body", "Helvetica")}",Helvetica,Arial,sans-serif}}')


def render_pngs(jobs, w, h):
    """jobs: list of (html_string, out_path). Uses the same Playwright the graphic designer uses."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit("MISSING: playwright. Install with:\n  pip install playwright\n"
                         "  python3 -m playwright install chromium")
    with sync_playwright() as p:
        br = p.chromium.launch()
        for doc, out in jobs:
            pg = br.new_page(viewport={"width": w, "height": h})
            pg.set_content(doc)
            pg.wait_for_load_state("networkidle")
            pg.evaluate("document.fonts.ready")
            pg.screenshot(path=str(out), omit_background=True)
            pg.close()
        br.close()


def overlay_html(text, pos, b, w, h):
    fonts = (f'<link rel="stylesheet" href="https://fonts.googleapis.com/css2?{b["google_fonts"]}&display=block">'
             if b.get("google_fonts") else "")
    top = {"top": "300px", "center": "calc(50% - 120px)", "bottom": "auto"}.get(pos, "300px")
    bottom = "420px" if pos == "bottom" else "auto"
    return f"""<!doctype html><html><head><meta charset="utf-8">{fonts}<style>{brand_vars(b)}
html,body{{margin:0;width:{w}px;height:{h}px;background:transparent}}
.t{{position:absolute;left:90px;right:90px;top:{top};bottom:{bottom};text-align:center}}
.t span{{display:inline;font-family:var(--fh);font-weight:700;font-size:78px;line-height:1.32;color:#fff;
background:var(--accent);padding:6px 24px;border-radius:14px;-webkit-box-decoration-break:clone;box-decoration-break:clone}}
</style></head><body><div class="t"><span>{html.escape(text)}</span></div></body></html>"""


def endcard_html(card, b, w, h):
    fonts = (f'<link rel="stylesheet" href="https://fonts.googleapis.com/css2?{b["google_fonts"]}&display=block">'
             if b.get("google_fonts") else "")
    return f"""<!doctype html><html><head><meta charset="utf-8">{fonts}<style>{brand_vars(b)}
html,body{{margin:0;width:{w}px;height:{h}px;background:var(--primary);color:#fff;font-family:var(--fb)}}
.c{{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 110px}}
h1{{font-family:var(--fh);font-size:112px;line-height:1.05;margin:0 0 60px;letter-spacing:-.02em}}
.p{{background:var(--accent);font-size:44px;font-weight:600;padding:30px 56px;border-radius:999px}}
.h{{margin-top:48px;font-size:36px;opacity:.85}}
</style></head><body><div class="c"><h1>{html.escape(card.get("headline", ""))}</h1>
<div class="p">{html.escape(card.get("cta", ""))}</div><div class="h">{html.escape(b.get("handle", ""))}</div></div></body></html>"""


def build(plan_file):
    plan_path = Path(plan_file).resolve()
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    project = plan_path.parent
    b = plan.get("brand", {})
    w, h = (int(x) for x in plan.get("size", "1080x1920").split("x"))
    keep_audio = plan.get("keep_audio", True)

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        # 1) Render text overlays and end card as PNGs
        jobs = []
        for i, c in enumerate(plan["clips"]):
            if c.get("text"):
                jobs.append((overlay_html(c["text"], c.get("text_pos", "top"), b, w, h), td / f"ov{i}.png"))
        card = plan.get("end_card")
        if card:
            jobs.append((endcard_html(card, b, w, h), td / "card.png"))
        if jobs:
            render_pngs(jobs, w, h)

        # 2) Cut each clip: trim, fill the vertical frame, optional punch-in, overlay text
        parts, elapsed = [], 0.0
        voice = plan.get("voice")
        if voice:
            vinfo = probe(voice["file"])
            vstart = float(voice.get("start", 0))
        for i, c in enumerate(plan["clips"]):
            if c.get("aroll"):
                if not voice:
                    raise SystemExit("A clip is marked aroll but the plan has no 'voice' track.")
                c = {**c, "file": voice["file"], "start": vstart + elapsed}
                c["end"] = c["start"] + float(c["duration"])
            info = probe(c["file"])
            start = float(c.get("start", 0))
            end = float(c["end"]) if "end" in c else (start + float(c["duration"]) if "duration" in c
                                                       else info["duration"])
            elapsed += end - start
            punch = float(c.get("punch", 1.0))
            sw, sh = int(w * punch), int(h * punch)
            fx = {"left": "0", "right": f"iw-{w}"}.get(c.get("focus", "center"), f"(iw-{w})/2")
            vf = (f"scale={sw}:{sh}:force_original_aspect_ratio=increase,"
                  f"crop={w}:{h}:{fx}:(ih-{h})/2,setsar=1,fps={FPS},format=yuv420p")
            out = td / f"p{i:02d}.mp4"
            args = ["-ss", str(start), "-to", str(end), "-i", c["file"]]
            ov = td / f"ov{i}.png"
            has_audio = info["has_audio"] and keep_audio and not voice
            if not has_audio:
                args += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
            if ov.exists():
                args += ["-i", str(ov)]
                ov_idx = 2 if not has_audio else 1
                fc = f"[0:v]{vf}[v];[v][{ov_idx}:v]overlay=0:0[vo]"
            else:
                fc = f"[0:v]{vf}[vo]"
            amap = "0:a" if has_audio else "1:a"
            args += ["-filter_complex", fc, "-map", "[vo]", "-map", amap, "-shortest",
                     "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                     "-c:a", "aac", "-ar", "48000", "-ac", "2", str(out)]
            run(args)
            parts.append(out)
            print(f"Cut clip {i + 1}: {Path(c['file']).name} {start:.1f}s–{end:.1f}s")

        if card:
            out = td / "p99.mp4"
            run(["-loop", "1", "-t", str(card.get("seconds", 2.5)), "-i", str(td / "card.png"),
                 "-f", "lavfi", "-t", str(card.get("seconds", 2.5)), "-i", "anullsrc=r=48000:cl=stereo",
                 "-vf", f"scale={w}:{h},fps={FPS},format=yuv420p", "-c:v", "libx264", "-preset", "veryfast",
                 "-c:a", "aac", "-ar", "48000", "-ac", "2", "-shortest", str(out)])
            parts.append(out)

        # 3) Join the parts
        lst = td / "list.txt"
        lst.write_text("".join(f"file '{p}'\n" for p in parts))
        joined = td / "joined.mp4"
        run(["-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(joined)])

        # 4) Voice track (talking head or voiceover): one continuous sound under every cut
        final = joined
        if voice:
            if not vinfo["has_audio"]:
                raise SystemExit(f"The voice file has no audio: {voice['file']}")
            voiced = td / "voiced.mp4"
            run(["-i", str(joined), "-ss", str(vstart), "-i", voice["file"],
                 "-filter_complex", f"[1:a]volume={voice.get('volume', 1.0)},apad[a]",
                 "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-ar", "48000",
                 "-ac", "2", "-shortest", str(voiced)])
            final = voiced

        # 5) Music bed and captions
        music = plan.get("music")
        if music and music.get("file"):
            mixed = td / "mixed.mp4"
            vol = music.get("volume", 0.12 if voice else 0.25)
            clip_vol = 1.0 if (keep_audio or voice) else 0.0
            joined = final
            run(["-i", str(joined), "-stream_loop", "-1", "-i", music["file"], "-filter_complex",
                 f"[0:a]volume={clip_vol}[a0];[1:a]volume={vol}[a1];[a0][a1]amix=inputs=2:duration=first[a]",
                 "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", str(mixed)])
            final = mixed
        caps = plan.get("captions")
        if caps:
            capf = Path(caps)
            if not capf.is_absolute():
                capf = (Path.cwd() / capf).resolve()
            shutil.copy(capf, td / "caps.srt")
            captioned = td / "captioned.mp4"
            style = ("FontName=Arial,FontSize=13,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,"
                     "BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=38")
            r = subprocess.run([ffmpeg_exe(), "-hide_banner", "-v", "error", "-y", "-i", str(final),
                                "-vf", f"subtitles=caps.srt:force_style='{style}'", "-c:a", "copy",
                                str(captioned)], capture_output=True, text=True, cwd=td)
            if r.returncode == 0:
                final = captioned
            else:
                print("Note: this ffmpeg can't burn captions in. Upload the .srt file with the video instead.")

        dest = project / plan.get("output", "reel.mp4")
        shutil.copy(final, dest)
    info = probe(dest)
    print(f"Done. {dest}  ({info['duration']:.1f}s, {info['width']}x{info['height']})\n")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    plans = sys.argv[1:]
    for n, p in enumerate(plans, 1):
        if len(plans) > 1:
            print(f"=== Video {n} of {len(plans)}: {p}")
        build(p)
    if len(plans) > 1:
        print(f"All {len(plans)} videos done.")


if __name__ == "__main__":
    main()
