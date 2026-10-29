const fs = require('fs');
const path = require('path');

// Inlines the lead data into the page template. `<` is escaped so a lead's
// name can't close the <script> tag.
//
// The template is written as a claude.ai Artifact body (no <html>/<head>;
// the Artifact host adds those). `standalone: true` adds them so the same
// page also opens straight from disk in a browser.
function renderTracker(payload, { standalone = false } = {}) {
  const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  const body = template.replace('__LEADS_DATA__', () => json);
  if (!standalone) return body;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body>
${body}
</body>
</html>
`;
}

module.exports = { renderTracker };
