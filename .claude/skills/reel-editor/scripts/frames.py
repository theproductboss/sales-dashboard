#!/usr/bin/env python3
"""Make a contact sheet of frames for each video so Claude can SEE the footage.

Usage:  python3 frames.py <video-or-folder> <out-folder> [every_seconds=1.5]
Writes <out-folder>/<video-name>-sheet.jpg with a timestamp under every frame,
plus <out-folder>/clips.json with each video's duration and resolution.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _ff import ffmpeg_exe, probe  # noqa: E402

VIDEO_EXT = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"}


def sheet(video: Path, out: Path, every: float):
    from PIL import Image, ImageDraw
    info = probe(video)
    dur = info["duration"]
    times, t = [], 0.0
    while t < dur and len(times) < 48:
        times.append(round(t, 2))
        t += every
    thumbs = []
    with tempfile.TemporaryDirectory() as td:
        for i, ts in enumerate(times):
            fp = Path(td) / f"{i}.jpg"
            subprocess.run([ffmpeg_exe(), "-v", "error", "-ss", str(ts), "-i", str(video),
                            "-frames:v", "1", "-vf", "scale=320:-2", str(fp), "-y"], check=False)
            if fp.exists():
                thumbs.append((ts, Image.open(fp).convert("RGB")))
    if not thumbs:
        return info
    tw, th = thumbs[0][1].size
    cols = 6
    rows = (len(thumbs) + cols - 1) // cols
    img = Image.new("RGB", (cols * (tw + 8), rows * (th + 34)), "white")
    d = ImageDraw.Draw(img)
    for n, (ts, im) in enumerate(thumbs):
        x, y = (n % cols) * (tw + 8), (n // cols) * (th + 34)
        img.paste(im, (x, y))
        d.text((x + 4, y + th + 8), f"{ts:.1f}s", fill="black")
    img.save(out / f"{video.stem}-sheet.jpg", quality=85)
    return info


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    every = float(sys.argv[3]) if len(sys.argv) > 3 else 1.5
    out.mkdir(parents=True, exist_ok=True)
    vids = [src] if src.is_file() else sorted(p for p in src.iterdir() if p.suffix.lower() in VIDEO_EXT)
    report = {}
    for v in vids:
        report[str(v)] = sheet(v, out, every)
        print(f"Sheet for {v.name}: {report[str(v)]['duration']:.1f}s, "
              f"{report[str(v)]['width']}x{report[str(v)]['height']}")
    (out / "clips.json").write_text(json.dumps(report, indent=2))
    print(f"Done. View the *-sheet.jpg files in {out}")


if __name__ == "__main__":
    main()
