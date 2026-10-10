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
// Scripts próprios do app dentro dos marcadores (ex.: /js/redes.js) entram embutidos,
// porque a página de teste fica em tests/ e não serve a pasta js/.
const app = (region('APP-HEAD') + region('APP-BODY')).replace(/<script src="\/js\/([\w.-]+\.js)"><\/script>/g, (m, f) =>
  '<script>\n' + fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8').replace(/<\/script/gi, '<\\/script') + '\n</script>');
const test = fs.readFileSync(path.join(__dirname, 'test.html'), 'utf8');
const out = test.replace('__PAGE_BODY__', () => app);
fs.writeFileSync(path.join(__dirname, 'page.html'), out);
console.log('rebuilt tests/page.html (' + out.length + ' bytes)');

// Mesma coisa para o teste de condição de corrida (test_race.html -> page_race.html).
const raceSrc = path.join(__dirname, 'test_race.html');
if (fs.existsSync(raceSrc)) {
  const race = fs.readFileSync(raceSrc, 'utf8').replace('__PAGE_BODY__', () => app);
  fs.writeFileSync(path.join(__dirname, 'page_race.html'), race);
  console.log('rebuilt tests/page_race.html (' + race.length + ' bytes)');
}
