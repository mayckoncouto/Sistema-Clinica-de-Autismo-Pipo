// Clínica FICTÍCIA com a mesma forma da real (sem dados reais): salas/colunas, terapeutas e distribuição de pacientes,
// quadros e janelas de horário. Usada pelos testes de desempenho do Auto Planner.
function mulberry(seed){ let a = seed >>> 0; return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
module.exports = function makeClinic(opts) {
  opts = opts || {};
  const rnd = mulberry(opts.seed || 7);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const specs = [['psico', 'Psicologia'], ['fono', 'Fonoaudiologia'], ['psicoped', 'Psicopedagogia'], ['to', 'Terapia Ocupacional'], ['psicomot', 'Psicomotricidade'], ['fisio', 'Fisioterapia'], ['musico', 'Musicoterapia'], ['nutri', 'Nutrição'], ['aplic', 'Aplicador ABA']];
  const wk = {}; ['seg', 'ter', 'qua', 'qui', 'sex'].forEach((d) => { wk[d] = { ativo: true, manha: { inicio: '08:00', fim: '12:00' }, tarde: { inicio: '13:30', fim: '18:10' } }; });
  const prof = (id, sp, extra) => Object.assign({ id, nome: id.toUpperCase(), name: id.toUpperCase(), specialtyId: sp, complementares: [], horarios: wk }, extra || {});
  const profs = [prof('g', 'fono'), prof('l', 'fono'), prof('m', 'fono'), prof('au', 'psico'), prof('th', 'psico'), prof('pe', 'psico', { complementares: ['aplic'] }),
    prof('an', 'psicoped'), prof('je', 'psicoped'), prof('ad', 'to'), prof('ju', 'psicomot'), prof('al', 'psicomot'), prof('hi', 'fisio'), prof('fe', 'fisio', { complementares: ['aplic'] }), prof('ji', 'fisio'),
    prof('le', 'musico', { complementares: ['aplic'] }), prof('bi', 'nutri')];
  const cols = (r, ids) => ids.map((p, i) => ({ id: r + '-' + i, name: p, professionalId: p }));
  const room = (id, name, aba, ids) => ({ id, name, aba, color: '#2255aa', therapists: cols(id, ids) });
  const rooms = [room('r-fisio', 'Fisioterapia', false, ['hi', 'hi', 'fe']), room('r-fono', 'Fonoaudiologia', false, ['l', 'l', 'm', 'm']), room('r-fonoa', 'Fonoaudiologia ABA', true, ['g', 'g', 'g', 'l', 'l']),
    room('r-musi', 'Musicoterapia', false, ['le', 'le']), room('r-nutri', 'Nutrição', false, ['bi', 'bi']), room('r-psi', 'Psicologia', false, ['th', 'th']), room('r-psia', 'Psicologia ABA', true, ['au', 'au', 'au', 'au']),
    room('r-pmot', 'Psicomotricidade ABA', true, ['ju', 'ju', 'ju', 'ju']), room('r-ped', 'Psicopedagogia', false, ['je', 'je']), room('r-peda', 'Psicopedagogia ABA', true, ['an', 'an', 'je', 'je']),
    room('r-to', 'Terapia Ocupacional ABA', true, ['ad', 'ad', 'ad']),
    { id: 'g-apl', name: 'Aplicador ABA', group: true, color: 'slate', therapists: cols('g-apl', ['fe', 'pe', 'le']) }];
  // pacientes: faixas 15 (0-4) / 40 (5-9) / 32 (10+), quadros por paciente 5.1 / 6.6 / 3.8
  const bands = [[15, 3, 5.1], [40, 7, 6.6], [32, 12, 3.8]];
  const w = { psico: 75, fono: 67, psicoped: 56, to: 61, psicomot: 54, fisio: 51, musico: 44, nutri: 43 };
  const wl = []; Object.keys(w).forEach((k) => { for (let i = 0; i < w[k]; i++) wl.push(k); });
  const patients = [], treatments = [];
  const DAYS5 = ['seg', 'ter', 'qua', 'qui', 'sex'];
  let n = 0;
  bands.forEach(([count, age, qAvg]) => {
    for (let i = 0; i < count; i++) {
      const id = 'p' + (++n);
      const nq = Math.max(2, Math.round(qAvg + (rnd() - 0.5) * 3));
      const aba = rnd() < (age >= 10 ? 0.5 : 0.8) ? 'Sim' : 'Não';
      const used = {}, lines = [];
      let tries = 0;
      while (lines.length < nq && tries++ < 40) {
        const sp = pick(wl); if (used[sp]) continue; used[sp] = 1;
        lines.push({ id: 'l' + id + sp, specId: sp, hours: pick([2, 4, 4, 4, 4, 8]), service: 'sessao', aba });
      }
      const perWeek = lines.reduce((a, l) => a + l.hours, 0) / 4;
      // janela de horário: ~ o nº de sessões por semana vezes um fator (produção: média 1,0 a 1,6 vezes)
      const factor = opts.windowFactor || (1.0 + rnd() * 0.6);
      const slots = Math.max(2, Math.ceil(perWeek * factor));
      const nd = Math.min(5, Math.max(1, Math.ceil(slots / 3)));
      const days = DAYS5.slice().sort(() => rnd() - 0.5).slice(0, nd);
      const per = Math.ceil(slots / nd);
      const morning = rnd() < 0.9;
      const start = pick(['08:00', '08:00', '08:40', '10:00']);
      const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
      const hh = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
      const ini = morning ? start : '13:30';
      const fimMin = mins(ini) + per * 40;
      const horarios = {};
      days.forEach((d) => { horarios[d] = { ativo: true }; horarios[d][morning ? 'manha' : 'tarde'] = { inicio: ini, fim: hh(Math.min(fimMin, morning ? 720 : 1090)) }; });
      if (opts.noWindow) { for (const k in horarios) delete horarios[k]; }
      patients.push({ id, nome: 'Paciente ' + id.toUpperCase(), nascimento: String(2026 - age) + '-03-01', suporte: pick(['Nível 1', 'Nível 2', 'Nível 3']) });
      treatments.push({ id: 't' + id, patientId: id, specHours: lines, horarios: opts.noWindow ? null : horarios });
    }
  });
  return { specs: specs.map(([id, name]) => ({ id, name })), profs, rooms, patients, treatments };
};
