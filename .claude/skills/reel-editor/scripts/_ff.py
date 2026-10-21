"""Find ffmpeg (system install or the bundled imageio-ffmpeg) and probe videos."""
import json
import re
import shutil
import subprocess


def ffmpeg_exe():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        raise SystemExit("MISSING: ffmpeg. Install with:  pip install imageio-ffmpeg "
                         "(add --break-system-packages if needed)")


def probe(path):
    """Duration, size, and whether there's audio, using ffmpeg's own output."""
    r = subprocess.run([ffmpeg_exe(), "-hide_banner", "-i", str(path)],
                       capture_output=True, text=True)
    err = r.stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err)
    dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0.0
    v = re.search(r"Video: .*?(\d{2,5})x(\d{2,5})", err)
    rot = re.search(r"rotate\s*:\s*(-?\d+)|displaymatrix: rotation of (-?[\d.]+)", err)
    w, h = (int(v.group(1)), int(v.group(2))) if v else (0, 0)
    if rot and abs(float(rot.group(1) or rot.group(2))) in (90.0, 270.0):
        w, h = h, w
    return {"duration": dur, "width": w, "height": h, "has_audio": "Audio:" in err}
