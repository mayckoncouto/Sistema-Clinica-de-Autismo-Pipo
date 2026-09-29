// Rebuilds page.html (used by the run_*.js Playwright tests) by substituting the
// current ../agenda.html source into test.html's __PAGE_BODY__ placeholder.
// Run this after every change to agenda.html and before running the tests.
const fs = require('fs');
const path = require('path');

const agenda = fs.readFileSync(path.join(__dirname, '..', 'agenda.html'), 'utf8');
const test = fs.readFileSync(path.join(__dirname, 'test.html'), 'utf8');
const out = test.replace('__PAGE_BODY__', () => agenda);
fs.writeFileSync(path.join(__dirname, 'page.html'), out);
console.log('rebuilt tests/page.html (' + out.length + ' bytes)');
