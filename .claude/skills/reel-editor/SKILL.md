---
name: reel-editor
description: Edits raw phone footage into finished vertical Reels/TikToks for a physical product business. It handles B-roll with text overlays, talking-head videos with B-roll cutaways, voiceovers over B-roll, and batches (a folder of footage in, several different videos out). It watches the clips, picks the best moments, adds on-brand text, captions, punch-in cuts, music, and an end card, then takes plain-language changes like "swap the audio" or "faster cuts". Use when someone says "edit my video", "make a reel", "cut this into a TikTok", "turn these clips into reels", "make a bunch of videos from my b-roll", "add captions", "swap the music", or runs /reel-editor.
---

# Reel Editor

> **Where this skill's files are:** commands below use `.claude/skills/...` paths inside the Studio folder. If this skill was installed for all folders instead, the same files are in `~/.claude/skills/...` (Windows: `%USERPROFILE%\.claude\skills\...`). Use whichever exists.

You turn raw clips into finished, ready-to-post vertical videos. The person shoots on their phone and hands you the footage. You do the editing, then they direct changes in plain words.

## Step 0 — Load the brand

Read `BRAND.md` for colors, fonts, voice, handle, and CTA. Use the same brand values as the graphic designer.

## Step 1 — Get the footage and the goal

Ask them to drag clips into the chat or drop them in `footage/`. Then figure out which kind of video this is. Ask only if it isn't obvious:

| Kind | What they have | How you edit it |
|---|---|---|
| **B-roll + text** | Product clips, no talking | Quick cuts, a text overlay telling the story, music or original sound, end card |
| **Talking head** | Someone talking to camera about the product, plus optional B-roll | Their voice plays the whole time; cut away to B-roll to show what they're describing; captions on |
| **Voiceover** | B-roll plus a separate voice recording (voice memo, phone audio) | The recording plays the whole time; B-roll covers it; captions on |
| **Batch** | A big folder of footage | Log everything, propose several different videos, cut them all |

Also ask what it's for in one line (e.g. "announce our holiday gift box") and the CTA, unless `BRAND.md` already answers it.

**Music:** only use a song they have the rights to and give you as a file. Otherwise leave music off and tell them to add trending audio in Instagram or TikTok after uploading. That often helps reach anyway.

## Step 2 — Watch the footage

Run:

```
python3 .claude/skills/reel-editor/scripts/frames.py footage output/<project>/frames 1
```

This makes a contact sheet per clip, with a frame every second and timestamps. **View every sheet.** For each clip, note the strongest moments (close-ups, hands using the product, reveals, movement, reactions), what to cut (blur, shake, dead air, phone-tapping at the start and end), and whether it's horizontal (it gets cropped to vertical, so check the subject stays in frame; use `focus` left/center/right).

**For a batch,** write a footage log first in `output/<project>/footage-log.md`: one line per usable moment with clip name, time range, what's on screen, and tags (product name, close-up, lifestyle, packaging, hands, person). This is your library for every video in the batch, and they can reuse it next time.

## Step 3 — Transcribe anything with speech

For talking-head and voiceover videos:
1. Install the transcriber yourself if needed: `pip install faster-whisper` (add `--break-system-packages` if pip refuses).
2. Transcribe the voice file with word timestamps.
3. Pick the section of the talk to use: the strongest 15–45 seconds, starting on a line that works as a hook. Cut false starts, "ums", and repeats when they fall at the edges of a section.
4. Write `output/<project>/captions.srt` timed from the start of that section (the section start is 0:00), 2 lines max, about 6 words per line. Fix product and brand names the transcriber got wrong.

## Step 4 — Plan the edit

**B-roll + text (10–20s):** hook shot with hook text (0–2s) → 3–6 cuts of 1–3s showing the product in use → best final shot → end card. Use `punch: 1.15–1.25` on a second cut from the same shot to keep energy up.

**Talking head:** set `voice` to the talking-head file and `start` to where the chosen section begins. Then lay out the timeline in order. Use `{"aroll": true, "duration": N}` to show the speaker, and normal clips for B-roll cutaways. Cut away to B-roll **when they mention something you can show** ("we hand-pour every candle" → the pouring clip), and come back to them for emotion or the CTA. Open on the speaker or a striking shot with the hook as text. Keep shots 1.5–4s.

**Voiceover:** same as talking head, with `voice` set to the recording and every clip as B-roll.

**Batch:** propose 3–6 videos that are genuinely different, not five versions of one: e.g. a product reveal, a "3 reasons it makes a great gift", a behind-the-scenes, a talking-head explainer, a sale announcement. Each gets its own folder: `output/<batch>/01-<name>/edit.json`. Spread the best shots so the same hero clip doesn't open every video. Show the list of ideas and let them pick or tweak before you cut. If they're watching live and want speed, just cut them all.

Show single-video plans as a short list (time, what's on screen, text) and ask "Good to cut?" Skip asking if they've said to just go.

## Step 5 — Cut it

Write `edit.json` in each project folder (the format is documented at the top of `scripts/reel.py`), then run all of them in one command:

```
python3 .claude/skills/reel-editor/scripts/reel.py output/<project>/edit.json [more edit.json files...]
```

If tools are missing, install them yourself:
- `pip install imageio-ffmpeg` (a bundled ffmpeg; no other install needed)
- `pip install playwright` then `python3 -m playwright install chromium`

## Step 6 — Check your own work

Run `frames.py` on each finished video and view the sheet. Check that the subject is in frame on every cut, overlays and captions are readable and don't overlap (use `text_pos: "top"` when captions are on), the hook lands in the first 2 seconds, and talking-head cuts land on natural pauses. Fix and re-cut if anything's off.

## Step 7 — Deliver and take directions

Tell them where each video is and give each one a post caption and hashtags in their voice. Then invite changes in plain words. Here's how common requests map to the plan:

| They say | You change |
|---|---|
| "Swap the audio / use this song instead" | `keep_audio: false` + `music` with their file |
| "Keep the original sound but add music under it" | keep `keep_audio: true`, add `music` with `volume` about 0.15–0.25 |
| "Mute it" | `keep_audio: false`, remove `music` and `voice` |
| "Use my voice memo as the voiceover" | add `voice` with the recording; transcribe; captions |
| "Music's too loud" | lower `music.volume` |
| "Faster cuts" / "slower" | shorter or longer `duration`s; more or fewer clips |
| "Open on the unboxing" | reorder clips so that shot is first |
| "Show more of me" / "more product" | swap B-roll clips for `aroll` clips, or the reverse |
| "Change the text" | edit `text`, `text_pos` |
| "Make it shorter" | trim the voice section and drop clips; re-time captions |
| "No end card" | remove `end_card` |

Re-run only the videos that changed.

## Rules

- Only use music and audio they have the rights to. Never download audio from the internet.
- Never add claims, prices, or discounts they didn't give you.
- Never edit their original footage. All output goes in `output/`.
- Don't cut a talking head mid-word or mid-sentence. Use the transcript's timestamps.
