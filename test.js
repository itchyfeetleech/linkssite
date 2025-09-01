const fs = require('fs');

// Load the HTML once for all checks
const html = fs.readFileSync('index.html', 'utf8');

// Ensure the theme toggle button exists
if (!html.includes('id="themeToggle"')) {
  console.error('themeToggle button missing');
  process.exit(1);
}

// Verify we have a card-inner span for each link (7 total)
const matches = html.match(/class="card-inner"/g) || [];
if (matches.length !== 7) {
  console.error(`Expected 7 card-inner spans, found ${matches.length}`);
  process.exit(1);
}

console.log('HTML structure verified');
