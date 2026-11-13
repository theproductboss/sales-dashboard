# Sales Call Analyzer: a Claude skill

A skill that teaches Claude to review recorded sales calls like an experienced sales manager. Give it a call transcript and it scores the call out of 100, finds the moment the sale was won or lost, explains why, rewrites the key moments, and gives the rep one drill to practice before their next call. Give it several calls and it ranks them and spots patterns across the team.

It's built from the training material of well-known closers: Alex Hormozi (CLOSER), Jeremy Miner (NEPQ), Shelby Sapp (gap selling and her four-step objection method), and Dan Martell, plus Gong's research on what winning calls look like.

## What's in this package

| File | What it's for |
|---|---|
| `sales-call-analyzer.skill` | The skill, ready to upload to Claude (claude.ai or the Claude desktop app) |
| `sales-call-analyzer/` | The same skill as a plain folder, for Claude Code users |
| `README.md` | This guide |

## How to install it

### On claude.ai or the Claude desktop app

1. Make sure skills are turned on for your account. Look under **Settings**, in the capabilities or customize section, for **Skills**. On Team and Enterprise plans an admin may need to enable them first.
2. In the Skills section, choose to upload a skill and select `sales-call-analyzer.skill`. If it asks for a .zip, rename the file's ending from `.skill` to `.zip` and upload that; it's the same file.
3. Make sure the skill is switched on.

Menu names change from time to time. If you can't find it, search Anthropic's help center for "skills."

### In Claude Code

Copy the `sales-call-analyzer` folder into your skills folder:

- For you, in every project: `~/.claude/skills/sales-call-analyzer/`
- For one project, shared with your team through git: `.claude/skills/sales-call-analyzer/` inside that project

Restart Claude Code and the skill is picked up.

## How to use it

Start a new chat and paste in a sales call transcript (from Zoom, Fathom, Fireflies, Gong, Granola, or similar). Then ask something like:

- "Review this sales call and give me feedback."
- "Score this call. Why didn't it close?"
- "Here are five calls from this week. Rank them and tell me what the team keeps getting wrong."
- "Give Sarah one drill to work on based on her last three calls."

The first time you use it, it will ask a few setup questions: what you sell, the price, what kind of call it is, and ideally your best recorded call so it can calibrate its scoring. Answer those once and the reviews get much sharper.

### Tips for good results

- **Use full transcripts, not summaries.** The skill backs every point with a quote and a timestamp, so it needs the real words. It will tell you if all it has is notes.
- **Correct it.** If it flags something your team does on purpose, say so. It keeps a running list of house rules and applies them to later reviews.
- **Review in batches.** One call is noise. Five to ten per rep is where the patterns show up.
- **Tone is partly invisible in text.** It flags what it can see in the transcript (hedging, filler words, talking after the price) and says when you'd need the audio to judge.

## What you get back

For each call: a score and grade, the outcome, talk-time and question stats, the turning-point moment quoted, three things to keep doing, three things to fix (each with the exact line and a better version), a breakdown of any objection and where earlier in the call it was really caused, and one practice drill.

For a batch: a ranked list, the deals that closed despite a weak call (refund risk), the strong calls that still lost (often a lead-quality problem), and the team's most common gaps.

## A note on the sources

The frameworks inside were put together from transcripts of public videos and podcasts by these closers. In the skill's reference files, each idea is tagged by how directly it comes from the person: word-for-word, from a summary, or secondhand. This skill isn't affiliated with or endorsed by any of them. If you want their full methods, go to their own programs.
