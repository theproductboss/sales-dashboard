require('dotenv').config();

const { DateTime } = require('luxon');
const { requireEnv } = require('./config');
const zoom = require('./zoom');
const drive = require('./drive');
const { parseVtt, toTurns, renderTurns, speakerWordCounts, formatTimestamp } = require('./vtt');

const TIME_ZONE = process.env.REPORT_TIMEZONE || 'America/New_York';
const LOOKBACK_DAYS = Number(process.env.TRANSCRIPT_LOOKBACK_DAYS || 7);
const DRY_RUN = String(process.env.DRY_RUN).toLowerCase() === 'true';

const splitList = (value) =>
  (value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

// Zoom rejects a from/to range wider than one month, so a long backfill has to
// be walked in chunks.
function dateWindows(days, timeZone) {
  const end = DateTime.now().setZone(timeZone).startOf('day');
  const start = end.minus({ days });
  const windows = [];

  let cursor = start;
  while (cursor <= end) {
    const chunkEnd = DateTime.min(cursor.plus({ days: 29 }), end);
    windows.push({ from: cursor.toFormat('yyyy-MM-dd'), to: chunkEnd.toFormat('yyyy-MM-dd') });
    cursor = chunkEnd.plus({ days: 1 });
  }

  return windows;
}

// Normally ZOOM_HOST_EMAILS names the one host whose calls we want (Jill), and
// we look that user up directly. Leaving it unset falls back to every active user
// on the account, which needs the broader list-users scope.
async function resolveHosts(token) {
  const wanted = splitList(process.env.ZOOM_HOST_EMAILS);
  if (wanted.length === 0) {
    console.warn('ZOOM_HOST_EMAILS is not set — pulling transcripts for every active user on the account.');
    return zoom.listActiveUsers(token);
  }

  const hosts = [];
  for (const email of wanted) {
    try {
      hosts.push(await zoom.getUser(token, email));
    } catch (err) {
      // A typo'd or non-existent email shouldn't take the whole run down.
      console.error(`Could not resolve Zoom user "${email}": ${err.message}`);
    }
  }

  if (hosts.length === 0) {
    throw new Error(`None of the ZOOM_HOST_EMAILS could be resolved: ${wanted.join(', ')}`);
  }
  return hosts;
}

// Not every Zoom recording is a sales call. These optional keyword filters match
// against the meeting topic so team syncs and internal calls stay out.
function topicAllowed(topic) {
  const include = splitList(process.env.TRANSCRIPT_TOPIC_INCLUDE);
  const exclude = splitList(process.env.TRANSCRIPT_TOPIC_EXCLUDE);
  const lower = (topic || '').toLowerCase();

  if (exclude.some((keyword) => lower.includes(keyword))) return false;
  if (include.length && !include.some((keyword) => lower.includes(keyword))) return false;
  return true;
}

const safeFilename = (value) => value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();

function buildMarkdown({ meeting, host, turns }) {
  const started = DateTime.fromISO(meeting.start_time).setZone(TIME_ZONE);
  const words = speakerWordCounts(turns);
  const totalWords = Object.values(words).reduce((sum, count) => sum + count, 0) || 1;

  const talkShare = Object.entries(words)
    .sort(([, a], [, b]) => b - a)
    .map(([speaker, count]) => `| ${speaker} | ${count} | ${Math.round((count / totalWords) * 100)}% |`)
    .join('\n');

  const lastTurn = turns[turns.length - 1];

  return [
    `# ${meeting.topic || 'Zoom call'}`,
    '',
    `- **Host:** ${host.first_name || ''} ${host.last_name || ''} (${host.email})`.replace(/\s+\(/, ' ('),
    `- **Date:** ${started.toFormat('cccc, LLLL d yyyy')} at ${started.toFormat('h:mm a ZZZZ')}`,
    `- **Scheduled length:** ${meeting.duration} min`,
    `- **Transcript length:** ${formatTimestamp(lastTurn ? lastTurn.start : 0)}`,
    `- **Meeting ID:** ${meeting.id}`,
    meeting.share_url ? `- **Recording:** ${meeting.share_url}` : null,
    '',
    '## Talk share',
    '',
    '| Speaker | Words | Share |',
    '| --- | --- | --- |',
    talkShare,
    '',
    '## Transcript',
    '',
    renderTurns(turns),
    '',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

async function main() {
  const zoomToken = await zoom.getAccessToken({
    accountId: requireEnv('ZOOM_ACCOUNT_ID'),
    clientId: requireEnv('ZOOM_CLIENT_ID'),
    clientSecret: requireEnv('ZOOM_CLIENT_SECRET'),
  });

  const folderId = DRY_RUN ? null : requireEnv('TRANSCRIPT_DRIVE_FOLDER_ID');
  const driveToken = DRY_RUN
    ? null
    : await drive.getAccessToken({
        clientEmail: requireEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
        // GitHub secrets flatten newlines, so the PEM arrives with literal \n.
        privateKey: requireEnv('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n'),
        subject: process.env.GOOGLE_IMPERSONATE_SUBJECT || undefined,
      });

  const hosts = await resolveHosts(zoomToken);
  const windows = dateWindows(LOOKBACK_DAYS, TIME_ZONE);
  console.log(
    `Checking ${hosts.length} host(s) over ${LOOKBACK_DAYS} day(s): ` +
      `${windows[0].from} to ${windows[windows.length - 1].to}`
  );

  const stats = { found: 0, skipped: 0, pending: 0, filtered: 0, uploaded: 0, failed: 0 };

  for (const host of hosts) {
    for (const window of windows) {
      const meetings = await zoom.listUserRecordings(zoomToken, host.id, window);

      for (const meeting of meetings) {
        if (!topicAllowed(meeting.topic)) {
          stats.filtered += 1;
          continue;
        }

        const transcriptFile = zoom.findTranscriptFile(meeting);
        if (!transcriptFile) {
          // Zoom takes roughly 2x the meeting length to produce a transcript,
          // so recent calls legitimately have nothing yet. The next run gets it.
          stats.pending += 1;
          console.log(`  … transcript not ready: ${meeting.topic} (${meeting.start_time})`);
          continue;
        }

        stats.found += 1;
        const started = DateTime.fromISO(meeting.start_time).setZone(TIME_ZONE);
        const name = safeFilename(
          `${started.toFormat('yyyy-MM-dd')} ${host.first_name || host.email} - ${meeting.topic} [${meeting.id}].md`
        );

        try {
          if (!DRY_RUN) {
            const existing = await drive.findByZoomFileId(driveToken, folderId, transcriptFile.id);
            if (existing) {
              stats.skipped += 1;
              continue;
            }
          }

          const vtt = await zoom.downloadTranscript(zoomToken, transcriptFile.download_url);
          const turns = toTurns(parseVtt(vtt));
          if (turns.length === 0) {
            console.warn(`  ! empty transcript, skipping: ${name}`);
            stats.failed += 1;
            continue;
          }

          const markdown = buildMarkdown({ meeting, host, turns });

          if (DRY_RUN) {
            console.log(`  [dry run] would upload: ${name} (${turns.length} turns)`);
            continue;
          }

          const file = await drive.uploadMarkdown(driveToken, {
            folderId,
            name,
            content: markdown,
            zoomFileId: transcriptFile.id,
          });
          stats.uploaded += 1;
          console.log(`  ✓ ${name} -> ${file.webViewLink}`);
        } catch (err) {
          // One bad call shouldn't abort the whole run.
          stats.failed += 1;
          console.error(`  ! failed on ${name}: ${err.message}`);
        }
      }
    }
  }

  console.log(
    `Done. ${stats.uploaded} uploaded, ${stats.skipped} already had, ${stats.pending} awaiting ` +
      `transcript, ${stats.filtered} filtered out, ${stats.failed} failed.`
  );
  if (stats.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
