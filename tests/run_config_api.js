// api/config.js: devolve a marca pública de CADA unidade (e a da Unidade 1 como padrão). Sem navegador: fetch simulado.
let fails = 0;
const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };
process.env.SUPABASE_URL = 'http://db.test';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_x';
const rows = [
  { unit_id: 'unidade-1', data: { nome: 'Clínica Pipo', subtitulo: 'Matriz', corBotoes: '#112233', redes: [{ rede: 'instagram', url: 'https://instagram.com/pipo' }, { rede: 'site', url: 'javascript:alert(1)' }] } },
  { unit_id: 'unidade-2', data: { nome: 'Pipo Joinville', corBotoes: 'vermelho' } }
];
let asked = [];
global.fetch = async (url) => { asked.push(url); return { ok: true, json: async () => rows }; };
const handler = require('../api/config.js');
(async () => {
  let out = null;
  await handler({}, { setHeader() {}, status(c) { this.code = c; return this; }, json(b) { out = b; } });
  check('reads the clinic of every unit in one query?', asked.length === 1 && /path=eq\.config%2Fclinic/.test(asked[0]) && !/unit_id=eq/.test(asked[0]), asked[0]);
  check('top level keeps the first unit brand?', out.clinica.nome === 'Clínica Pipo' && out.theme.corBotoes === '#112233');
  check('each unit has its own brand?', out.unidades['unidade-2'].clinica.nome === 'Pipo Joinville' && out.unidades['unidade-1'].clinica.subtitulo === 'Matriz');
  check('invalid color becomes default (null)?', out.unidades['unidade-2'].theme === null);
  check('dangerous link is dropped from the social list?', out.redes.length === 1 && out.redes[0].rede === 'instagram');
  check('never exposes the service key?', !JSON.stringify(out).includes('sb_secret_x'));
  console.log(fails ? 'FALHOU: ' + fails : 'Tudo certo');
  process.exit(fails ? 1 : 0);
})();
