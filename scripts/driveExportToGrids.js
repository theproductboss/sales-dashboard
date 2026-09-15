#!/usr/bin/env node
//
// Converts the Google Drive connector's markdown rendering of the closer
// tracker into the {tabName: cellGrid} JSON that src/closer/parseTracker.js
// reads.
//
// This is the no-credentials path: instead of a Google service account
// hitting the Sheets API, a Claude session reads the sheet with the Drive
// connector already attached to the user's account, and this script turns
// that text back into cells. Same parser, same maths, same output as the
// Sheets API path — see README "Running it without a service account".
//
// Usage:
//   node scripts/driveExportToGrids.js <drive-export.txt> [out.json]
//
// The input may be raw markdown or the connector's {"fileContent": "..."}
// JSON wrapper; both are handled.

const fs = require('fs');

// Each tab renders as a markdown table: a header row, then an alignment row
// of ":-:" cells, then the tab's rows. The alignment row is the only
// reliable table delimiter, so tables are cut one line above each one.
const ALIGNMENT_ROW = /^\|\s*:-:/;

function unwrap(raw) {
  const text = raw.trim();
  if (!text.startsWith('{')) return raw;
  try {
    const parsed = JSON.parse(text);
    return parsed.fileContent ?? raw;
  } catch {
    return raw;
  }
}

// Undo the markdown escaping the connector applies, and collapse a merged
// cell range down to one value in its first column so column positions
// still line up with the real sheet.
function parseRow(line) {
  const cells = line.split('|').slice(1, -1);
  const row = [];
  let mergedSeen = false;

  for (const cell of cells) {
    let value = cell.trim();
    const isMerged = value.startsWith('\\[merged\\]') || value.startsWith('[merged]');

    value = value
      .replace(/\\\[merged\\\]/g, '')
      .replace(/\[merged\]/g, '')
      .trim()
      .replace(/\\#/g, '#')
      .replace(/\\!/g, '!')
      .replace(/\\/g, '');

    if (value === ':-:') value = '';

    if (isMerged) {
      if (mergedSeen) value = '';
      else mergedSeen = true;
    }

    row.push(value);
  }

  return row;
}

// A tab is named after the closer in column B of its "<MONTH> OVERALL" row,
// which is the same cell parseTracker reads the month from.
function titleFor(grid, used) {
  let base = 'Unknown';
  for (const row of grid.slice(0, 40)) {
    if (row.length && /OVERALL$/i.test((row[0] || '').trim())) {
      base = (row[1] || '').trim() || 'Unknown';
      break;
    }
  }

  let title = base;
  let suffix = 2;
  while (used.has(title)) {
    title = `${base} ${suffix}`;
    suffix += 1;
  }
  used.add(title);
  return title;
}

function convert(raw) {
  const lines = unwrap(raw).split('\n');
  const starts = [];
  lines.forEach((line, index) => {
    if (ALIGNMENT_ROW.test(line) && index > 0) starts.push(index - 1);
  });
  starts.push(lines.length);

  const grids = {};
  const used = new Set();

  for (let i = 0; i < starts.length - 1; i += 1) {
    const grid = lines
      .slice(starts[i], starts[i + 1])
      .filter((line) => line.startsWith('|'))
      .map(parseRow);

    if (!grid.length) continue;
    grids[titleFor(grid, used)] = grid;
  }

  return grids;
}

function main() {
  const [input, output] = process.argv.slice(2);
  if (!input) {
    console.error('Usage: node scripts/driveExportToGrids.js <drive-export.txt> [out.json]');
    process.exit(1);
  }

  const grids = convert(fs.readFileSync(input, 'utf8'));
  const json = JSON.stringify(grids, null, 1);

  if (output) {
    fs.writeFileSync(output, json);
    console.error(`Wrote ${Object.keys(grids).length} tabs to ${output}: ${Object.keys(grids).join(', ')}`);
  } else {
    process.stdout.write(json);
  }
}

if (require.main === module) main();

module.exports = { convert };
