// Rebuilds page.html (used by the run_*.js Playwright tests) by substituting the
// app from ../index.html into test.html's __PAGE_BODY__ placeholder.
// Only the regions between the APP-HEAD / APP-BODY markers are used — the
// Supabase scripts outside them are left out, so the tests keep running
// against the in-memory window.claude mock defined in test.html.
// Run this after every change to index.html and before running the tests.
const fs = require('fs');
const path = require('path');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function region(name) {
  const m = index.match(new RegExp('<!-- ' + name + ':START -->([\\s\\S]*?)<!-- ' + name + ':END -->'));
  if (!m) throw new Error('marker ' + name + ' not found in index.html');
  return m[1];
}
const app = region('APP-HEAD') + region('APP-BODY');
const test = fs.readFileSync(path.join(__dirname, 'test.html'), 'utf8');
const out = test.replace('__PAGE_BODY__', () => app);
fs.writeFileSync(path.join(__dirname, 'page.html'), out);
console.log('rebuilt tests/page.html (' + out.length + ' bytes)');
