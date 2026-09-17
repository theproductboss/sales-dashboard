// Zoom's transcript is a WebVTT file where each cue's text is prefixed with the
// speaker's display name:
//
//   1
//   00:00:05.230 --> 00:00:08.110
//   Oz Konar: Hey, how's it going?
//
// Cues are short (a sentence or less), so a raw dump is unreadable. We parse the
// cues, then merge consecutive ones from the same speaker into paragraphs.

const TIMING = /^(\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+(\d{2}:)?\d{2}:\d{2}[.,]\d{3}/;

// "Oz Konar: Hey there" -> speaker. Guarded against ordinary mid-sentence
// colons ("Here's the thing: it works") by requiring a short, single-line,
// sentence-punctuation-free prefix.
function splitSpeaker(text) {
  const index = text.indexOf(':');
  if (index === -1) return { speaker: null, text };

  const candidate = text.slice(0, index).trim();
  if (!candidate || candidate.length > 60 || /[.!?,]/.test(candidate)) {
    return { speaker: null, text };
  }
  return { speaker: candidate, text: text.slice(index + 1).trim() };
}

function toSeconds(stamp) {
  const parts = stamp.replace(',', '.').split(':').map(Number);
  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, ...parts];
  return hours * 3600 + minutes * 60 + seconds;
}

function parseVtt(raw) {
  // Strip a BOM and normalize line endings before splitting on blank lines.
  const blocks = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    const timingIndex = lines.findIndex((line) => TIMING.test(line));
    if (timingIndex === -1) continue; // WEBVTT header, NOTE block, or stray cue id

    const [startStamp] = lines[timingIndex].split('-->').map((part) => part.trim());
    const body = lines.slice(timingIndex + 1).join(' ').trim();
    if (!body) continue;

    const { speaker, text } = splitSpeaker(body);
    cues.push({ start: toSeconds(startStamp), speaker, text });
  }

  return cues;
}

// Collapses runs of cues by the same speaker into one turn.
function toTurns(cues) {
  const turns = [];

  for (const cue of cues) {
    const previous = turns[turns.length - 1];
    if (previous && previous.speaker === cue.speaker) {
      previous.text += ` ${cue.text}`;
    } else {
      turns.push({ start: cue.start, speaker: cue.speaker, text: cue.text });
    }
  }

  return turns;
}

function formatTimestamp(seconds) {
  const total = Math.floor(seconds);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function renderTurns(turns) {
  return turns
    .map((turn) => `**[${formatTimestamp(turn.start)}] ${turn.speaker || 'Unknown'}:** ${turn.text}`)
    .join('\n\n');
}

// Rough talk-time proxy. Zoom's VTT has no per-word timings, so word count is a
// better signal than cue duration (which includes pauses).
function speakerWordCounts(turns) {
  const counts = {};
  for (const turn of turns) {
    const speaker = turn.speaker || 'Unknown';
    counts[speaker] = (counts[speaker] || 0) + turn.text.split(/\s+/).filter(Boolean).length;
  }
  return counts;
}

module.exports = { parseVtt, toTurns, renderTurns, speakerWordCounts, formatTimestamp };
