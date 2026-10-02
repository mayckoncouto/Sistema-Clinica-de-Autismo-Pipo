// Opções do chromium.launch() dos testes: usa a variável PW_CHROMIUM se existir;
// no Windows, o Chrome instalado; senão o Chromium do ambiente Linux antigo.
const fs = require('fs');
const candidates = [
  process.env.PW_CHROMIUM,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter(Boolean);
const exe = candidates.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
module.exports = exe ? { executablePath: exe, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] };
