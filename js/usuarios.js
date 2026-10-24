/* =====================================================================
 * Agenda Pipo — abas "Usuários" e "Níveis de Permissão" (só Administrador)
 *
 * Usuários: quem entra no sistema e em qual NÍVEL está (tabela profiles,
 *   coluna role_id). Criar / senha / ativar / excluir passam por
 *   /api/admin-users (precisa da service role key); nome e nível são
 *   gravados direto no banco — a política RLS só deixa administrador alterar.
 * Níveis de Permissão: a grade módulo × ação de cada nível (tabela roles).
 *   O nível Administrador tem sempre acesso total e não é editável.
 * ===================================================================== */
(function () {
  "use strict";
  if (!window.pipoAuth) return;

  var auth = window.pipoAuth;
  // actions: ações que fazem sentido na tela (as demais aparecem como "—").
  // Em grupos, na mesma ordem do menu do topo: Cadastros, Planner, Agenda, Prontuário, (CRM, vindo do app), Menu Acesso.
  // Item novo: entra no grupo do assunto, na ordem em que aparece no menu.
  var MODULES = [
    { key: "pacientes", label: "Pacientes", hint: "", group: "Cadastros" },
    { key: "pgrp_ident", label: "Pacientes – Identificação", hint: "ver o grupo Identificação na janela do cadastro, na ficha impressa e na revisão", actions: ["view"], dflt: true },
    { key: "pgrp_contato", label: "Pacientes – Contato", hint: "ver o grupo Contato na janela do cadastro, na ficha impressa e na revisão", actions: ["view"], dflt: true },
    { key: "pgrp_endereco", label: "Pacientes – Endereço", hint: "ver o grupo Endereço na janela do cadastro, na ficha impressa e na revisão", actions: ["view"], dflt: true },
    { key: "pgrp_filiacao", label: "Pacientes – Filiação", hint: "ver o grupo Filiação na janela do cadastro, na ficha impressa e na revisão", actions: ["view"], dflt: true },
    { key: "pgrp_financeiro", label: "Pacientes – Responsável Financeiro", hint: "ver o grupo Responsável Financeiro na janela do cadastro, na ficha impressa e na revisão", actions: ["view"], dflt: true },
    { key: "pgrp_rotina", label: "Pacientes – Responsáveis pela Retirada", hint: "ver o grupo Responsáveis pela Retirada na janela do cadastro, na ficha impressa e na revisão", actions: ["view"], dflt: true },
    { key: "pgrp_protetiva", label: "Pacientes – Medida Protetiva", hint: "ver o grupo Medida Protetiva na janela do cadastro, na ficha impressa e na revisão", actions: ["view"], dflt: true },
    { key: "pgrp_convenio", label: "Pacientes – Convênio", hint: "ver o grupo Convênio na janela do cadastro, na ficha impressa e na revisão", actions: ["view"], dflt: true },
    { key: "pgrp_encaminhamento", label: "Pacientes – Encaminhamento", hint: "ver o grupo Encaminhamento (data, validade e especialidades) na janela do cadastro e na ficha impressa; os dados também exigem Pacientes – Saúde", actions: ["view"], dflt: true },
    { key: "pgrp_tratamento", label: "Pacientes – Tratamento", hint: "ver o grupo Tratamento (resumo do tratamento atual) na janela do cadastro", actions: ["view"], dflt: true },
    { key: "saude_paciente", label: "Pacientes – Saúde", hint: "ver/editar médico, CID, diagnóstico, suporte, comunicação, alergias, medicações e restrições", actions: ["view", "edit"] },
    { key: "pgrp_escola", label: "Pacientes – Escola", hint: "ver o grupo Escola na janela do cadastro, na ficha impressa e na revisão", actions: ["view"], dflt: true },
    { key: "pgrp_rotinaatual", label: "Pacientes – Rotina Atual", hint: "ver o grupo Rotina Atual na janela do cadastro, na ficha impressa e na revisão", actions: ["view"], dflt: true },
    { key: "pgrp_admin", label: "Pacientes – Administrativo", hint: "ver o grupo Administrativo na janela do cadastro, na ficha impressa e na revisão", actions: ["view"], dflt: true },
    { key: "pgrp_bloqueio", label: "Pacientes – Bloqueio de Agendamento", hint: "ver o grupo Bloqueio de Agendamento na janela do cadastro, na ficha impressa e na revisão", actions: ["view"], dflt: true },
    { key: "pabas_agenda", label: "Pacientes – Aba Agenda", hint: "ver a aba Agenda na janela do paciente (também exige ver a Agenda)", actions: ["view"], dflt: true },
    { key: "pabas_prontuario", label: "Pacientes – Aba Prontuário", hint: "ver a aba Prontuário na janela do paciente (também exige ver o Prontuário)", actions: ["view"], dflt: true },
    { key: "pabas_anamneses", label: "Pacientes – Aba Anamneses", hint: "ver a aba Anamneses na janela do paciente (também exige ver algum modelo de anamnese)", actions: ["view"], dflt: true },
    { key: "pacientes_anexos", label: "Pacientes – Anexos", hint: "aba Anexos da janela do paciente: ver e baixar, incluir arquivos, renomear e excluir (Documentos também exige Pacientes – Saúde)", dflt: true },
    { key: "campos_paciente", label: "Pacientes – Campos", hint: "botão Campos: quais campos aparecem e quais são obrigatórios", actions: ["view", "edit"] },
    { key: "tratamentos", label: "Tratamentos", hint: "convênio, pacote, Intervenção ABA, especialidades e horários" },
    { key: "tratamentos_valores", label: "Tratamentos – Valores", hint: "ver/editar valor, descontos e valor final", actions: ["view", "edit"] },
    { key: "tipos_tratamento", label: "Tipos de Tratamento", hint: "cadastro dos tipos de tratamento (além das especialidades e serviços)" },
    { key: "convenios", label: "Convênios", hint: "" },
    { key: "motivos_cancelamento", label: "Motivos de Cancelamento", hint: "lista de motivos usada ao cancelar um tratamento" },
    { key: "medicos", label: "Médicos", hint: "médicos dos pacientes" },
    { key: "escolas", label: "Escolas", hint: "escolas dos pacientes" },
    { key: "diagnosticos", label: "Diagnósticos", hint: "lista de diagnósticos (CID) do paciente e do lead do CRM" },
    { key: "origens", label: "Origens", hint: "como o paciente conheceu a clínica (paciente e lead do CRM)" },
    { key: "motivos_bloqueio", label: "Motivos de Bloqueio", hint: "motivos para bloquear o agendamento de um paciente" },
    { key: "colaboradores", label: "Colaboradores", hint: "cadastro de todas as pessoas, inclusive os profissionais (atendimento e horário)" },
    { key: "colaboradores_valores", label: "Colaboradores – Valores", hint: "ver/editar a Remuneração: valor contratado, formas de pagamento, PIX e dados bancários", actions: ["view", "edit"] },
    { key: "especialidades", label: "Especialidades", hint: "" },
    { key: "servicos", label: "Serviços", hint: "" },
    { key: "cbo", label: "CBO", hint: "lista de CBO usada no cadastro dos profissionais" },
    { key: "conselhos", label: "Conselhos", hint: "conselhos profissionais (CRP, CRFa…) do cadastro dos profissionais" },
    { key: "salas", label: "Salas", hint: "" },
    { key: "grupos", label: "Grupos de Suporte", hint: "" },
    { key: "feriados", label: "Feriados e Recessos", hint: "feriados e recessos (Agenda fica cinza; o Gerar mês pula)" },
    { key: "cadastro_status", label: "Status (Cadastro)", hint: "criar e alterar os status dos atendimentos" },
    { key: "planner", label: "Planner", hint: "grade de 4 semanas", group: "Planner" },
    { key: "planner_list", label: "Agendamentos Planner", hint: "Planner ▾ → Agendamentos Planner: lista dos atendimentos do Planner", actions: ["view"] },
    { key: "bloqueio_horario", label: "Bloqueio de Horário", hint: "Planner: bloquear (incluir) e liberar (excluir) horários — botões da grade e Outras Opções" },
    { key: "resumo", label: "Resumo", hint: "relatório de atendimentos do Planner", actions: ["view"] },
    { key: "disponibilidade", label: "Disponibilidade", hint: "relatório de atendidos e vagas livres do Planner por dia, horário e especialidade", actions: ["view"] },
    { key: "historico_planner", label: "Histórico de Alterações – Planner", hint: "Planner → Outras Opções: quem criou, alterou ou excluiu agendamentos", actions: ["view"] },
    { key: "agenda", label: "Agenda", hint: "atendimentos por data", group: "Agenda" },
    { key: "agenda_planner", label: "Agenda Planner", hint: "Agenda ▾ → Agenda Planner: a Agenda do dia no visual do Planner (incluir, editar e excluir seguem a permissão da Agenda)", actions: ["view"] },
    { key: "agendamentos_lista", label: "Agendamentos", hint: "Agenda ▾ → Agendamentos: lista de todos os atendimentos dos pacientes", actions: ["view"] },
    { key: "esp_bloqueado", label: "Atendimento Especial – Bloqueado", hint: "Planner e Agenda: horário marcado como Bloqueado (vale independente da permissão do Planner e da Agenda)", actions: ["create", "edit", "delete"] },
    { key: "esp_reuniao", label: "Atendimento Especial – Reunião Clínica", hint: "Planner e Agenda: horário marcado como Reunião Clínica (vale independente da permissão do Planner e da Agenda)", actions: ["create", "edit", "delete"] },
    { key: "esp_treinamento", label: "Atendimento Especial – Treinamento", hint: "Planner e Agenda: horário marcado como Treinamento (vale independente da permissão do Planner e da Agenda)", actions: ["create", "edit", "delete"] },
    { key: "esp_reserva", label: "Atendimento Especial – Reserva", hint: "Planner e Agenda: horário marcado como Reserva (vale independente da permissão do Planner e da Agenda)", actions: ["create", "edit", "delete"] },
    { key: "visao_geral", label: "Visão Geral", hint: "Agenda ▾ → Visão Geral: todos os atendimentos do dia numa tela", actions: ["view"] },
    { key: "gerenciar_status", label: "Gerenciar Status", hint: "Agenda ▾ → Agendamentos → Outras Opções: mudar o status de vários atendimentos de uma vez (só os status que o nível pode usar; Finalizado não entra)", actions: ["view"] },
    { key: "historico_agenda", label: "Histórico de Alterações – Agenda", hint: "Agenda → Outras Opções: quem criou, alterou ou excluiu atendimentos", actions: ["view"] },
    { key: "prontuario", label: "Prontuário", hint: "evoluções dos atendimentos (só o autor edita a sua)", group: "Prontuário" },
    { key: "plano_terapeutico", label: "Plano Terapêutico", hint: "ver: consultar; incluir: criar e revisar; editar: tudo. Profissional sem editar muda só situação/status nas especialidades dele" },
    { key: "objetivos", label: "Objetivos", hint: "objetivos prontos para usar no plano terapêutico" },
    { key: "atividades", label: "Atividades", hint: "atividades sugeridas para os objetivos do plano terapêutico" },
    { key: "anamneses", label: "Anamneses", hint: "tela Anamneses (ver). Incluir, editar e excluir são dados em cada tipo, nas linhas \"Anamnese – …\" abaixo", actions: ["view"] },
    { key: "tipos_anamnese", label: "Modelos de Anamnese", hint: "modelos de formulário das anamneses (perguntas, regras e validade)" },
    { key: "escalas", label: "Escalas", hint: "escalas do plano terapêutico (níveis e cores)" },
    { key: "habilidades", label: "Habilidades", hint: "habilidades dos objetivos do plano terapêutico" },
    { key: "financeiro", label: "Financeiro", hint: "Lançamentos: movimentação das contas (valores, extrato, subcategorias)", group: "Financeiro" },
    { key: "fornecedores", label: "Fornecedores", hint: "empresas e pessoas que fornecem produtos ou serviços para a clínica" },
    { key: "categorias_fornecedor", label: "Categorias de Fornecedor", hint: "lista de categorias usada no cadastro de fornecedores" },
    { key: "contas_bancarias", label: "Contas Bancárias", hint: "contas e caixa da clínica (banco, agência, CNPJ)" },
    { key: "plano_contas", label: "Plano de Contas", hint: "tipo, categoria e subcategoria dos lançamentos financeiros" },
    { key: "financeiro_valores", label: "Financeiro – Valores", hint: "ver/editar o saldo inicial das contas bancárias", actions: ["view", "edit"] },
    { key: "vendas", label: "Vendas", hint: "vendas dos tratamentos (nova, renovação, aditivo), vendedor e parcelas no Contas a Receber" },
    { key: "comissoes", label: "Comissões", hint: "regras e comissões de venda (conta a pagar do vendedor, estorno ao cancelar)" },
    { key: "fechamento_mes", label: "Fechamento de Mês", hint: "incluir = fechar o mês; excluir = reabrir; ver = histórico dos fechamentos", actions: ["view", "create", "delete"] },
    { key: "gerencial", label: "Gerencial", hint: "painel gerencial: contratos, avaliações e triagens; editar = definir as metas por mês", actions: ["view", "edit"] },
    { key: "gerencial_fechamento", label: "Fechamento do Gerencial", hint: "ver = consultar os meses fechados; editar = fechar e reabrir meses do Gerencial", actions: ["view", "edit"] },
    { key: "clinica", label: "Clínica", hint: "dados, horários, cores e logo", actions: ["view", "edit"], group: "Menu Acesso" },
    { key: "usuarios", label: "Usuários", hint: "contas de acesso (Níveis de Permissão e administradores: só o Administrador)" },
    { key: "contratos", label: "Contratos", hint: "modelos de termo e contrato (empréstimo a colaborador e outros)" },
    { key: "backup", label: "Backup", hint: "baixar o backup (restaurar: só o Administrador)", actions: ["view"] },
    { key: "conector_claude", label: "Conector Claude", hint: "usar o sistema pelo Claude (conector MCP); lá vale o mesmo que o nível já pode no sistema", actions: ["view"] },
    { key: "senha", label: "Senha", hint: "trocar a própria senha", actions: ["view"], dflt: true },
    { key: "ajuda", label: "Ajuda", hint: "guia do sistema", actions: ["view"], dflt: true }
  ];
  function modActs(m) { return m.actions || ["view", "create", "edit", "delete"]; }
  // Permissão "Usuários" do nível (o Administrador pode tudo). Níveis de Permissão e
  // contas de administrador continuam só com o Administrador (a API e o banco conferem).
  function uCan(a) { return auth.isAdmin() || auth.can("usuarios", a); }
  var ACTIONS = [
    { key: "view", label: "Ver" },
    { key: "create", label: "Incluir" },
    { key: "edit", label: "Editar" },
    { key: "delete", label: "Excluir" }
  ];

  var users = [], roles = [];
  var loaded = { users: false, roles: false };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // Busca sem acento e sem diferenciar maiúsculas (igual ao normText do app).
  function normText(s) {
    return String(s == null ? "" : s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }
  function toast(msg, isErr) { if (typeof window.showToast === "function") window.showToast(msg, isErr); }
  // Relatórios da aba "Relatórios" (ids iguais a RP_TYPES no index.html).
  var REPORTS = [
    { key: "lista", label: "Lista de Atendimentos" },
    { key: "elegibilidade", label: "Elegibilidade" },
    { key: "planner-fora-horario", label: "Planner Fora do Horário do Paciente" },
    { key: "planner-sem-horario", label: "Planner Sem Horário de Atendimento" },
    { key: "produtividade", label: "Produtividade por Profissional" },
    { key: "frequencia", label: "Frequência por Paciente" },
    { key: "convenios", label: "Atendimentos por Convênio" },
    { key: "pacote", label: "Pacote Contratado × Realizado" },
    { key: "pendentes", label: "Evoluções Pendentes" },
    { key: "ocupacao", label: "Ocupação" },
    { key: "bloqueios", label: "Bloqueios, Reuniões e Treinamentos" },
    { key: "sem-atendimento", label: "Pacientes sem Atendimento" },
    { key: "tratamentos", label: "Tratamentos Novos e Renegociados" },
    { key: "financeiro", label: "Relatório Financeiro" },
    { key: "evolucao-habilidade", label: "Evolução por Habilidade" }
  ];
  function confirmBox(opts) { return window.pipoConfirm ? window.pipoConfirm(opts) : Promise.resolve(window.confirm(opts.title)); }
  // Gestor = is_manager (acesso total, todas as unidades); níveis com all_units (Supervisor) acessam todas as unidades.
  function roleRank(r) { return r.is_manager ? 0 : r.all_units ? 1 : r.is_admin ? 2 : 3; }
  function isMgr() { return !!(auth.isManager && auth.isManager()); }
  // Só o Gestor mexe nos níveis travados para os demais: Gestor/Administrador (sempre travados) e os de todas as unidades.
  function roleLockedFor(r) { return !!(r && (r.is_admin || (r.all_units && !isMgr()))); }
  function roleById(id) { return roles.filter(function (r) { return r.id === id; })[0] || null; }
  function friendlyDbError(e) {
    var m = (e && e.message) || String(e || "");
    if (/administrador ativo/i.test(m)) return "É preciso manter pelo menos um administrador ativo.";
    if (/permission|42501|row-level/i.test(m)) return "Sem permissão para esta alteração. (" + m + ")";
    return m;
  }

  function injectStyles() {
    var css =
      ".adm-wrap{padding:0 14px 14px;overflow:auto;flex:1}" +
      ".adm-table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:clip}" +
      ".adm-table thead th{position:sticky;top:0;z-index:1}" +
      ".adm-table th{text-align:left;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);padding:8px 12px;border-bottom:1px solid var(--line);background:var(--surface)}" +
      ".adm-table td{padding:9px 12px;border-bottom:1px solid var(--line);font-size:12.5px;vertical-align:middle}" +
      ".adm-table tbody tr{cursor:pointer}" +
      ".adm-table tbody tr:hover{background:var(--surface-2)}" +
      ".adm-table tr.inactive td{color:var(--muted)}" +
      ".adm-table .u-name{font-weight:700;color:var(--ink)}" +
      ".u-badge{display:inline-block;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:999px;background:var(--surface-2);color:var(--ink-2);margin-right:4px;white-space:nowrap}" +
      ".u-badge.admin{background:var(--accent-weak);color:var(--accent)}" +
      ".u-badge.off{background:var(--danger-weak);color:var(--danger)}" +
      ".u-badge.ok{background:#e3f1e2;color:#3d7a39}" +
      ".perm-grid{width:100%;border-collapse:collapse;font-size:12.5px}" +
      ".perm-grid{table-layout:fixed}" +
      ".perm-grid th:not(:first-child),.perm-grid td:not(:first-child){width:84px}" +
      ".perm-grid th,.perm-grid td{padding:7px 6px;border-bottom:1px solid var(--line);text-align:center}" +
      ".perm-grid th:first-child,.perm-grid td:first-child{text-align:left}" +
      ".perm-grid th{font-size:10.5px;font-weight:800;text-transform:uppercase;color:var(--muted)}" +
      // Títulos das colunas (Tela, Ver, Incluir, Editar, Excluir) presos no alto da janela ao rolar.
      ".perm-grid thead th{position:sticky;top:-4px;z-index:2;background:var(--surface);box-shadow:inset 0 -1px 0 var(--line)}" +
      ".perm-grid td small{display:block;color:var(--muted);font-size:10.5px;font-weight:500}" +
      ".perm-grid tr.perm-group td{background:var(--surface-2);font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);text-align:left}" +
      ".perm-grid input{width:16px;height:16px;cursor:pointer}" +
      ".perm-grid input:disabled{cursor:default}" +
      ".perm-grp{margin-bottom:6px}.perm-grp-head{display:flex;align-items:center;gap:8px}.perm-grp-head .tr-sec{flex:1;margin-bottom:6px}" +
      ".perm-grp-head .btn{padding:4px 10px;font-size:12px}" +
      ".perm-quad{border:1px solid var(--line);border-radius:9px;background:var(--bg);margin-bottom:6px;overflow:hidden}" +
      ".perm-qrow{display:flex;align-items:center;gap:8px;padding:9px 11px;min-height:44px}" +
      ".perm-qrow .room-info{flex:1;min-width:0}.perm-qrow .rn{font-weight:600;font-size:13.5px}.perm-qrow .rs{font-size:12px;color:var(--ink-3)}" +
      ".perm-qrow .btn{padding:5px 10px;font-size:12px;flex:none}" +
      ".perm-qbody{padding:6px 11px 12px;border-top:1px solid var(--line);background:var(--surface)}" +
      ".perm-qbody .perm-section{margin-top:8px}" +
      "@media (max-width:760px){.perm-qrow{flex-wrap:wrap}.perm-qrow .room-info{flex:1 1 100%}.perm-grp-head{flex-wrap:wrap}}" +
      // Um nível por linha: bolinha · nome · resumo (cortado com "…", texto inteiro no title).
      // Os seletores levam ".field" para vencer as regras gerais ".field label"/".field input"
      // do app (que esticam todo input a 100% e quebram o radio).
      ".field .role-pick{display:flex;flex-direction:column;gap:4px}" +
      ".field .role-pick label{display:grid;grid-template-columns:auto 130px minmax(0,1fr);align-items:center;column-gap:10px;" +
        "margin:0;border:1px solid var(--line);border-radius:8px;padding:7px 10px;cursor:pointer;font-size:12.5px;font-weight:500;color:var(--ink-2)}" +
      ".field .role-pick label:hover{border-color:var(--line-strong)}" +
      ".field .role-pick label:has(input:checked){border-color:var(--accent);background:var(--accent-weak)}" +
      ".field .role-pick label.disabled{opacity:.6;cursor:default}" +
      ".field .role-pick input{width:16px;height:16px;margin:0;padding:0;accent-color:var(--accent);cursor:inherit}" +
      ".field .role-pick b{color:var(--ink);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".field .role-pick span{color:var(--muted);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".u-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end}" +
      ".u-kind{display:flex;flex-direction:column;gap:8px}.u-kind .btn{justify-content:center;padding:10px 12px}" +
      ".u-actions .field{flex:1;min-width:160px;margin:0}" +
      // Níveis de Permissão: cada nível numa linha só (textos longos com "…"; o resumo inteiro aparece ao passar o mouse).
      ".adm-roles{table-layout:fixed;width:100%}" +
      ".adm-roles :is(th,td){white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".adm-roles :is(th,td):nth-child(1){width:150px}.adm-roles :is(th,td):nth-child(2){width:210px}.adm-roles :is(th,td):nth-child(3){width:80px}" +
      ".adm-roles :is(th,td):nth-child(5){width:170px;text-align:right}" +
      ".adm-roles td.rl-acts{overflow:visible}.adm-roles .rl-acts .btn{display:inline-flex;margin-left:4px}" +
      // Celular: lista de usuários só com Nome e Situação; busca na linha toda.
      "@media (max-width:760px){" +
        "#tab-usuarios .pat-toolbar{flex-wrap:wrap}" +
        "#tab-usuarios .pat-toolbar .search-wrap{flex:1 1 100%;max-width:none!important}" +
        ".adm-wrap{padding:0 8px 10px}" +
        ".adm-users :is(th,td):nth-child(2),.adm-users :is(th,td):nth-child(3),.adm-users.has-unit :is(th,td):nth-child(4){display:none}" +
        ".adm-users td.u-name{overflow-wrap:anywhere}" +
        ".adm-users :is(th,td):last-child{width:1%;white-space:nowrap}" +
        // Níveis de Permissão: só Nível e Usuários (o resumo das permissões aparece ao abrir o nível).
        ".adm-roles :is(th,td):nth-child(2),.adm-roles :is(th,td):nth-child(4){display:none}" +
        ".adm-roles :is(th,td):first-child{width:auto!important}" +
        ".adm-roles :is(th,td):last-child{width:150px!important;white-space:nowrap}" +
      "}";
    var st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------------- dados ---------------- */
  var dbNew = true;
  function loadRoles() {
    return auth.client.from("roles").select("*").order("sort", { ascending: true }).then(function (r) {
      if (r.error) { toast("Não foi possível carregar os níveis: " + r.error.message, true); return; }
      // Ordem dos níveis: Gestor, Supervisor (todas as unidades), Administrador, demais (na ordem do cadastro).
      // Permissões sempre no formato novo na tela; dbNew = o banco já está no formato novo
      // (atualização 2026-10-07e). Antes dela, grava convertendo para o formato antigo.
      dbNew = (r.data || []).some(function (x) { return window.pipoPerms.isNew(x.permissions); });
      (r.data || []).forEach(function (x) { x.permissions = window.pipoPerms.upgrade(x.permissions); });
      roles = (r.data || []).sort(function (a, b) { return roleRank(a) - roleRank(b) || (a.sort || 0) - (b.sort || 0) || (a.name || "").localeCompare(b.name || "", "pt-BR", { sensitivity: "base" }); });
      loaded.roles = true;
    });
  }
  function loadUsers() {
    return auth.client.from("profiles").select("*").order("full_name", { ascending: true }).then(function (r) {
      if (r.error) { toast("Não foi possível carregar os usuários: " + r.error.message, true); return; }
      users = r.data || [];
      loaded.users = true;
    });
  }
  function reloadAll() {
    return Promise.all([loadRoles(), loadUsers(), refreshProfStaff()]).then(renderAll);
  }

  function adminApi(payload) {
    var s = auth.session();
    return fetch("/api/admin-users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (s ? s.access_token : "") },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (!r.ok) throw new Error(b.error || ("Erro " + r.status));
        return b;
      });
    });
  }

  // Telas fixas + uma linha por lista do CRM (cadastro das listas vem do app: window.pipoCrmModules).
  // As linhas do CRM (vêm do app) entram antes do grupo "Menu Acesso", como no menu do topo.
  function allModules() {
    var crm = window.pipoCrmModules ? window.pipoCrmModules() : [];
    var cut = MODULES.findIndex(function (m) { return m.group === "Financeiro"; });
    if (cut === -1) cut = MODULES.findIndex(function (m) { return m.group === "Menu Acesso"; });
    var all = cut === -1 ? MODULES.concat(crm) : MODULES.slice(0, cut).concat(crm, MODULES.slice(cut));
    // uma linha por tipo de anamnese, logo depois de "Modelos de Anamnese"
    var anam = window.pipoAnamModules ? window.pipoAnamModules() : [];
    var at = all.findIndex(function (m) { return m.key === "tipos_anamnese"; });
    all = at === -1 || !anam.length ? all : all.slice(0, at + 1).concat(anam, all.slice(at + 1));
    return all.concat(toolModules());
  }
  // Ferramentas (window.pipoTools): uma chave "ferr_…" por ferramenta, só com "Ver" (ligada/desligada).
  function toolModules() {
    return ((window.pipoTools && window.pipoTools.list) || []).map(function (t) {
      return { key: t.key, label: t.label, hint: t.hint || "", actions: ["view"], tool: true, panel: t.panel, from: t.from || [] };
    });
  }
  // Valor de um item na grade: o gravado no nível; ferramenta ainda não gravada herda da tela onde fica.
  function permOn(perms, m, a) {
    if (perms[m.key]) return !!perms[m.key][a];
    if (m.tool) return (m.from || []).some(function (f) { return perms[f[0]] && perms[f[0]][f[1]]; });
    return !!m.dflt;
  }
  // Resumo curto das permissões de um nível, para a escolha no cadastro.
  function roleSummary(role) {
    if (!role) return "";
    if (role.is_admin) return "Acesso total, inclusive Usuários e Níveis de Permissão";
    var p = role.permissions || {};
    var parts = allModules().filter(function (m) { return !m.tool; }).map(function (m) {
      var mp = p[m.key] || {};
      if (!mp.view) return null;
      var w = [];
      if (mp.create) w.push("incluir");
      if (mp.edit) w.push("editar");
      if (mp["delete"]) w.push("excluir");
      return m.label + (w.length ? " (ver, " + w.join(", ") + ")" : " (só ver)");
    }).filter(Boolean);
    var st = statusNames(p.status);
    if (st.length) parts.push("Status: " + st.join(", "));
    var rp = REPORTS.filter(function (x) { return p.relatorios && p.relatorios[x.key]; }).length;
    if (rp) parts.push("Relatórios: " + rp + " de " + REPORTS.length);
    return parts.length ? parts.join(" · ") : "Sem acesso a nenhuma aba";
  }

  /* ================= Tela: Usuários ================= */
  // Barra de ferramentas montada uma vez só (para a busca não perder o foco a
  // cada tecla); a lista embaixo é que é refeita.
  function renderUsers() {
    var h = document.getElementById("tab-usuarios");
    if (!h) return;
    if (!document.getElementById("userSearch")) {
      h.innerHTML =
        '<div class="pat-toolbar">' +
          '<div class="search-wrap" style="max-width:280px">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/></svg>' +
            '<input id="userSearch" type="text" placeholder="Buscar por nome, e-mail ou nível…">' +
          "</div>" +
          '<span class="pat-count" id="userCount"></span>' +
          '<div class="spacer"></div>' +
          '<button class="btn ghost" id="bulkProfBtn" hidden>Criar Acessos dos Profissionais</button>' +
          '<button class="btn ghost" id="rolesBtn">Níveis de Permissão</button>' +
          '<button class="btn primary" id="addUserBtn">+ Incluir</button>' +
        "</div>" +
        '<div class="adm-wrap" id="usersListHost"></div>';
      document.getElementById("userSearch").addEventListener("input", renderUsers);
      document.getElementById("addUserBtn").addEventListener("click", function () { newUser(); });
      document.getElementById("rolesBtn").addEventListener("click", function () { openRolesModal(); });
      document.getElementById("bulkProfBtn").addEventListener("click", function () { openBulkProfModal(); });
    }
    document.getElementById("rolesBtn").hidden = !auth.isAdmin();
    document.getElementById("addUserBtn").hidden = !uCan("create");
    // Só aparece enquanto houver profissional sem usuário ligado.
    document.getElementById("bulkProfBtn").hidden = !(uCan("create") && loaded.users && profsWithoutUser().length);
    var host = document.getElementById("usersListHost");
    var countEl = document.getElementById("userCount");
    if (!(loaded.users && loaded.roles)) {
      host.innerHTML = '<div class="pat-count" style="padding:12px">Carregando…</div>';
      return;
    }
    var me = auth.profile();
    var q = normText(document.getElementById("userSearch").value.trim());
    var list = users.filter(function (u) {
      if (!q) return true;
      var role = roleById(u.role_id);
      return normText(u.full_name).indexOf(q) !== -1 || normText(u.email).indexOf(q) !== -1 ||
        normText(role ? role.name : "").indexOf(q) !== -1;
    });
    countEl.textContent = list.length + " de " + users.length + (users.length === 1 ? " usuário" : " usuários");
    if (!list.length) {
      host.innerHTML = '<div class="empty-state"><b>Nenhum usuário encontrado</b>Ajuste a busca ou cadastre um novo usuário.</div>';
      return;
    }
    var showUnit = !!(auth.isManager && auth.isManager() && auth.units && auth.units().length > 1);
    host.innerHTML =
        '<table class="adm-table adm-users' + (showUnit ? " has-unit" : "") + '"><thead><tr><th>Nome</th><th>E-mail</th><th>Nível de Permissão</th>' + (showUnit ? "<th>Unidade</th>" : "") + '<th>Situação</th></tr></thead><tbody>' +
          list.map(function (u) {
            var role = roleById(u.role_id);
            return '<tr data-uid="' + esc(u.id) + '" class="' + (u.active ? "" : "inactive") + '" tabindex="0">' +
              '<td class="u-name">' + esc(u.full_name || "(sem nome)") + (me && me.id === u.id ? ' <span class="u-badge">você</span>' : "") + "</td>" +
              "<td>" + esc(u.email) + "</td>" +
              '<td><span class="u-badge' + (role && role.is_admin ? " admin" : "") + '">' + esc(role ? role.name : u.role_id) + "</span></td>" +
              (showUnit ? "<td>" + esc(auth.unitName(u.unit_id || "unidade-1")) + "</td>" : "") +
              "<td>" + (u.active ? '<span class="u-badge ok">Ativo</span>' : '<span class="u-badge off">Desativado</span>') + "</td>" +
            "</tr>";
          }).join("") +
        "</tbody></table>";
    host.querySelectorAll("tbody tr[data-uid]").forEach(function (tr) {
      function open() {
        var u = users.filter(function (x) { return x.id === tr.getAttribute("data-uid"); })[0];
        if (u) openUserModal(u);
      }
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", function (e) { if (e.key === "Enter") open(); });
    });
  }

  // seção "Acesso ao sistema"). Só o Administrador pode criar uma
  // Prestadores, seção "Acesso ao sistema"). Só o Administrador pode criar uma
  // conta sem colaborador (ex.: contador externo).
  function newUser() {
    if (!window.pipoOpenStaffNew) { openUserModal(null); return; }
    var canStaff = auth.can("colaboradores", "create");
    if (!auth.isAdmin()) {
      if (canStaff) window.pipoOpenStaffNew();
      else toast("O usuário é criado no cadastro da pessoa (Cadastros → Colaboradores). Seu nível não tem permissão para incluir.", true);
      return;
    }
    var mh = document.getElementById("modalHost");
    mh.innerHTML =
      '<div class="overlay" id="ovUserKind"><div class="modal" style="max-width:460px">' +
        '<div class="modal-head"><div><h3>Incluir Usuário</h3><div class="modal-sub">O acesso fica ligado ao cadastro da pessoa.</div></div>' +
          '<button class="modal-close" id="ukClose" aria-label="Fechar">✕</button></div>' +
        '<div class="modal-body"><div class="u-kind">' +
          '<button type="button" class="btn primary" id="ukStaff">Novo Colaborador (Recomendado)</button>' +
          '<button type="button" class="btn ghost" id="ukPlain">Conta sem Colaborador (Ex.: Contador)</button>' +
        "</div></div></div></div>";
    var ov = document.getElementById("ovUserKind");
    function close() { mh.innerHTML = ""; }
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) close(); });
    document.getElementById("ukClose").addEventListener("click", close);
    document.getElementById("ukStaff").addEventListener("click", function () { close(); window.pipoOpenStaffNew(); });
    document.getElementById("ukPlain").addEventListener("click", function () { openUserModal(null); });
    document.getElementById("ukStaff").focus();
  }

  function rolePickerHtml(selectedId, disabled) {
    // Quem não é Administrador não vê (nem escolhe) o nível Administrador.
    return '<div class="role-pick" id="uRolePick">' + roles.filter(function (r) { return isMgr() || !(r.is_admin || r.all_units) || r.id === selectedId; }).map(function (r) {
      var sum = r.is_admin ? (r.is_manager ? "Acesso total a todas as telas e unidades." : "Acesso total na própria unidade.") : roleShort(r);
      return '<label class="' + (disabled ? "disabled" : "") + '" title="' + esc(r.name + " — " + sum) + '">' +
        '<input type="radio" name="uRole" value="' + esc(r.id) + '"' +
        (r.id === selectedId ? " checked" : "") + (disabled ? " disabled" : "") + ">" +
        "<b>" + esc(r.name) + "</b><span>" + esc(sum) + "</span></label>";
    }).join("") + "</div>";
  }

  function openUserModal(u) {
    if (window.edKey) window.edKey(u && u.id ? "usuario:" + u.id : null);
    var isNew = !u;
    var me = auth.profile();
    var isMe = !!(u && me && u.id === me.id);
    var tRole = u ? roleById(u.role_id) : null;
    // Somente leitura: sem "editar" em Usuários, ou conta de administrador vista por quem não é Administrador.
    var mgr = !!(auth.isManager && auth.isManager());
    // Gestor altera tudo; os demais não mexem em conta de Gestor, de outro Administrador nem de Supervisor (o banco também recusa).
    var ro = !isNew && !mgr && ((tRole && (tRole.is_manager || ((tRole.is_admin || tRole.all_units) && !isMe))) || (!auth.isAdmin() && !uCan("edit")));
    var canDel = !ro && uCan("delete"), canEd = !ro && uCan("edit");
    function unitFieldHtml(usr, disabled) {
      var list = (auth.units && auth.units()) || [];
      if (!list.length) return "";
      var cur = usr ? (usr.unit_id || "unidade-1") : ((auth.unit && auth.unit()) || {}).id;
      if (!mgr || disabled) return '<div class="field"><label>Unidade</label><div class="pat-count" style="font-size:13.5px">' + esc(auth.unitName(cur)) + "</div></div>";
      return '<div class="field"><label for="uUnit">Unidade</label><select id="uUnit">' + list.map(function (x) {
        return '<option value="' + esc(x.id) + '"' + (x.id === cur ? " selected" : "") + ">" + esc(x.name) + "</option>";
      }).join("") + "</select>" +
        '<div class="pat-count" style="margin-top:6px">Só o Gestor escolhe a unidade do usuário.</div></div>';
    }
    var defaultRole = roleById("secretaria") ? "secretaria" : (roles.filter(function (x) { return !x.is_admin; })[0] || {}).id;
    var mh = document.getElementById("modalHost");
    mh.innerHTML =
      '<div class="overlay" id="ovUser"><div class="modal wide" style="max-width:560px">' +
        '<div class="modal-head"><div><h3>' + (isNew ? "Novo Usuário" : ro ? "Usuário" : "Editar Usuário") + "</h3>" +
          '<div class="modal-sub">' + (isNew
            ? "A pessoa entra com este e-mail e a senha inicial, e pode trocar a senha depois no menu \"Acesso\" do topo."
            : esc(u.email)) + "</div></div>" +
          '<button class="modal-close" id="uClose" aria-label="Fechar">✕</button></div>' +
        '<div class="modal-body">' +
          // Usuário ligado a um profissional: o nome vem do cadastro do profissional (o banco também garante).
          '<div class="field"><label for="uName">Nome</label><input id="uName" type="text" value="' + esc(u ? u.full_name : "") + '"' + ((u && u.professional_id) || ro ? " disabled" : "") + '>' +
            (u && u.professional_id ? '<div class="pat-count" style="margin-top:6px">Igual ao cadastro do profissional. Para mudar, altere em Cadastros → Colaboradores.</div>' : "") + "</div>" +
          (isNew
            ? '<div class="field-row">' +
                '<div class="field"><label for="uEmail">E-mail</label><input id="uEmail" type="email" autocomplete="off"></div>' +
                '<div class="field"><label for="uPass">Senha Inicial (Mín. 8)</label><input id="uPass" type="text" autocomplete="off"></div>' +
              "</div>"
            : "") +
          '<div class="field"><label>Nível de Permissão</label>' + rolePickerHtml(isNew ? defaultRole : u.role_id, isMe || ro) +
            (isMe ? '<div class="pat-count" style="margin-top:6px">Você não pode mudar o seu próprio nível.</div>' :
              (ro && tRole && (tRole.is_admin || tRole.all_units) ? '<div class="pat-count" style="margin-top:6px">Conta de Gestor, Supervisor ou Administrador: só o Gestor altera.</div>' : "")) + "</div>" +
          unitFieldHtml(u, ro) +
          (!isNew && canEd
            ? '<div class="field" style="margin-top:4px"><label>Senha e Acesso</label><div class="u-actions">' +
                '<div class="field"><input id="uNewPass" type="text" placeholder="Nova senha (mín. 8)" autocomplete="off"></div>' +
                '<button type="button" class="btn" id="uSetPass">Definir Senha</button>' +
              "</div>" +
              (isMe ? "" : '<div class="u-actions" style="margin-top:8px">' +
                '<button type="button" class="btn" id="uToggle">' + (u.active ? "Desativar Acesso" : "Reativar Acesso") + "</button>" +
                (canDel ? '<button type="button" class="btn danger" id="uDelete">Excluir Usuário</button>' : "") + "</div>") +
              "</div>"
            : "") +
        "</div>" +
        '<div class="modal-foot"><div class="spacer"></div>' +
          '<button class="btn ghost" id="uCancel">' + (ro ? "Fechar" : "Cancelar") + "</button>" +
          (ro ? "" : '<button class="btn primary" id="uSave">' + (isNew ? "Criar Usuário" : "Salvar") + "</button>") + "</div>" +
      "</div></div>";

    var ov = document.getElementById("ovUser");
    function close() { mh.innerHTML = ""; }
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) close(); });
    document.getElementById("uClose").addEventListener("click", close);
    document.getElementById("uCancel").addEventListener("click", close);

    function selectedRole() {
      var c = document.querySelector('#uRolePick input[name="uRole"]:checked');
      return c ? c.value : "";
    }

    var saveBtn = document.getElementById("uSave");
    if (saveBtn) saveBtn.addEventListener("click", function () {
      var name = document.getElementById("uName").value.trim();
      if (!name) { toast("Informe o nome.", true); return; }
      var roleId = selectedRole();
      if (!roleId) { toast("Escolha o nível de permissão.", true); return; }
      saveBtn.disabled = true;
      var p;
      if (isNew) {
        p = adminApi({
          action: "create",
          email: document.getElementById("uEmail").value.trim(),
          password: document.getElementById("uPass").value,
          full_name: name,
          role_id: roleId,
          unit_id: (document.getElementById("uUnit") || {}).value || ((auth.unit && auth.unit()) || {}).id || undefined
        }).then(function () { toast("Usuário criado."); });
      } else {
        var patch = u.professional_id ? {} : { full_name: name };
        if (!isMe) patch.role_id = roleId;
        var uSel = document.getElementById("uUnit");
        if (uSel && uSel.value && uSel.value !== (u.unit_id || "unidade-1")) patch.unit_id = uSel.value;
        p = !Object.keys(patch).length ? Promise.resolve(toast("Nada para salvar: o nome vem do cadastro do profissional.")) :
          auth.client.from("profiles").update(patch).eq("id", u.id).then(function (r) {
          if (r.error) throw new Error(friendlyDbError(r.error));
          toast("Usuário atualizado.");
        });
      }
      p.then(function () { close(); reloadAll(); }).catch(function (e) {
        saveBtn.disabled = false;
        toast(e.message, true);
      });
    });

    if (!isNew && canEd) {
      document.getElementById("uSetPass").addEventListener("click", function () {
        var pw = document.getElementById("uNewPass").value;
        if (pw.length < 8) { toast("A senha precisa ter pelo menos 8 caracteres.", true); return; }
        adminApi({ action: "set_password", id: u.id, password: pw })
          .then(function () { document.getElementById("uNewPass").value = ""; toast("Senha alterada. Informe a nova senha à pessoa."); })
          .catch(function (e) { toast(e.message, true); });
      });
      var tg = document.getElementById("uToggle");
      if (tg) tg.addEventListener("click", function () {
        var activate = !u.active;
        (activate ? Promise.resolve(true) : confirmBox({
          title: "Desativar Acesso",
          message: "Desativar o acesso de <b>" + esc(u.full_name || u.email) + "</b>? A pessoa não conseguirá mais entrar até ser reativada.",
          confirmLabel: "Desativar"
        })).then(function (ok) {
          if (!ok) return;
          adminApi({ action: "set_active", id: u.id, active: activate })
            .then(function () { toast(activate ? "Acesso reativado." : "Acesso desativado."); close(); reloadAll(); })
            .catch(function (e) { toast(e.message, true); });
        });
      });
      var del = document.getElementById("uDelete");
      if (del) del.addEventListener("click", function () {
        // Tarefas abertas do CRM com a pessoa como responsável: ao excluir, ela sai delas.
        var cnt = auth.client ? auth.client.rpc("crm_user_open_tasks", { p_user: u.id }).then(function (r) { return r.error ? 0 : (+r.data || 0); }, function () { return 0; }) : Promise.resolve(0);
        cnt.then(function (nTasks) { return confirmBox({
          title: "Excluir Usuário",
          message: "Excluir definitivamente o usuário <b>" + esc(u.full_name || u.email) + "</b>? Isso não pode ser desfeito.<br>Para só bloquear a entrada, use \"Desativar acesso\"." +
            (nTasks ? "<br><br>A pessoa é responsável por <b>" + nTasks + (nTasks === 1 ? " tarefa aberta" : " tarefas abertas") + "</b> no CRM e sairá delas. Se quiser, passe as tarefas para outra pessoa antes." : "<br><br>Se a pessoa for responsável por tarefas do CRM, ela sai delas."),
          confirmLabel: "Excluir Usuário"
        }); }).then(function (ok) {
          if (!ok) return;
          adminApi({ action: "delete", id: u.id })
            .then(function () { toast("Usuário excluído."); close(); reloadAll(); })
            .catch(function (e) { toast(e.message, true); });
        });
      });
    }

    document.getElementById("uName").focus();
  }

  /* ================= Tela: Níveis de Permissão ================= */
  function dbPerms(p) { return dbNew ? p : window.pipoPerms.downgrade(p); }
  function normalizePerms(p) {
    var out = {};
    p = p || {};
    allModules().forEach(function (m) {
      out[m.key] = {};
      // Item ainda não gravado no nível: vale o padrão (Ajuda e Trocar senha = marcados).
      ACTIONS.forEach(function (a) { out[m.key][a.key] = modActs(m).indexOf(a.key) !== -1 && permOn(p, m, a.key); });
    });
    // Status dos atendimentos que o nível pode usar na Agenda: {id: true}.
    out.status = {};
    Object.keys(p.status || {}).forEach(function (k) { if (p.status[k]) out.status[k] = true; });
    out.relatorios = {};
    REPORTS.forEach(function (x) { if (p.relatorios && p.relatorios[x.key]) out.relatorios[x.key] = true; });
    if (Object.keys(out.relatorios).length) out.relatorios.view = true;
    return out;
  }
  // Status cadastrados (config/statuses, vêm do app).
  function statusList() { return window.pipoStatuses ? window.pipoStatuses() : []; }
  function statusNames(map) {
    map = map || {};
    return statusList().filter(function (s) { return map[s.id]; }).map(function (s) { return s.name; });
  }
  function statusPermsHtml(perms, locked) {
    var list = statusList();
    if (!list.length) return "";
    var map = (perms && perms.status) || {};
    return '<div class="perm-section" id="rStatusPerms"><div class="perm-title">Status dos atendimentos (Agenda)</div>' +
      '<div class="pat-count">Quais status este nível pode marcar nos atendimentos.</div><div class="perm-opts">' +
      list.map(function (s) {
        var on = locked || !!map[s.id];
        return '<label class="perm-opt"><input type="checkbox" data-status="' + esc(s.id) + '"' + (on ? " checked" : "") + (locked ? " disabled" : "") + ">" +
          '<span class="perm-dot" style="background:' + esc(s.color || "#5b6b68") + '"></span><span>' + esc(s.name) + "</span></label>";
      }).join("") + "</div></div>";
  }
  function reportPermsHtml(perms, locked) {
    var map = (perms && perms.relatorios) || {};
    return '<div class="perm-section" id="rReportPerms"><div class="perm-title">Relatórios</div>' +
      '<div class="pat-count">Quais relatórios este nível pode gerar na aba Relatórios. O Profissional só vê os dados dele.</div><div class="perm-opts">' +
      REPORTS.map(function (x) {
        var on = locked || !!map[x.key];
        return '<label class="perm-opt"><input type="checkbox" data-report="' + x.key + '"' + (on ? " checked" : "") + (locked ? " disabled" : "") + "><span>" + esc(x.label) + "</span></label>";
      }).join("") + "</div></div>";
  }
  function slugify(s) {
    return String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "nivel";
  }

  // Janela "Níveis de Permissão" (aberta pelo botão na tela de Usuários, como
  // "Especialidades" em Pacientes): lista dos níveis + "Novo nível".
  // Resumo curto do nível no quadro (sem a lista de tudo que está liberado).
  function roleShort(r) {
    var p = r.permissions || {}, mods = allModules().filter(function (m) { return !m.tool; });
    var see = 0, write = 0;
    mods.forEach(function (m) {
      if (permOn(p, m, "view")) see++;
      if (["create", "edit", "delete"].some(function (a) { return modActs(m).indexOf(a) !== -1 && permOn(p, m, a); })) write++;
    });
    var rp = REPORTS.filter(function (x) { return p.relatorios && p.relatorios[x.key]; }).length;
    if (!see && !rp) return "Sem acesso a nenhuma tela.";
    return see + (see === 1 ? " tela" : " telas") + " com acesso · " + write + " com inclusão ou edição" + (rp ? " · Relatórios: " + rp + " de " + REPORTS.length : "") + ".";
  }
  function roleBadges(r) {
    return (r.is_manager ? ' <span class="u-badge admin">Acesso Total · Todas as Unidades</span>'
      : r.all_units ? ' <span class="u-badge admin">Todas as Unidades</span>'
      : r.is_admin ? ' <span class="u-badge admin">Acesso Total</span>' : "");
  }
  function openRolesModal() {
    if (!auth.isAdmin()) return;   // Níveis de Permissão: Gestor e Administrador (valem para todas as unidades)
    var counts = {};
    users.forEach(function (u) { counts[u.role_id] = (counts[u.role_id] || 0) + 1; });
    var q0 = "";
    var mh = document.getElementById("modalHost");
    mh.innerHTML =
      '<div class="overlay" id="ovRoles"><div class="modal wide" style="max-width:940px">' +
        '<div class="modal-head"><div><h3>Níveis de Permissão</h3>' +
          '<div class="modal-sub">O que cada nível pode fazer em cada tela. Os níveis valem para todas as unidades; ' +
          'uma mudança vale na hora para todos os usuários daquele nível.</div></div>' +
          '<button class="modal-close" id="rlClose" aria-label="Fechar">✕</button></div>' +
        '<div class="modal-body">' +
          '<div class="search-wrap" style="margin-bottom:10px">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/></svg>' +
            '<input id="rlSearch" type="text" placeholder="Buscar nível…"></div>' +
          '<div id="rlList"></div>' +
        "</div>" +
        '<div class="modal-foot">' +
          '<button class="btn primary" id="addRoleBtn">+ Incluir</button>' +
          '<button class="btn ghost" id="rlHist">Histórico</button>' +
          '<div class="spacer"></div>' +
          '<button class="btn ghost" id="rlDone">Fechar</button>' +
        "</div>" +
      "</div></div>";
    function draw() {
      var q = normText(q0);
      var list = roles.filter(function (r) { return !q || normText(r.name).indexOf(q) !== -1; });
      document.getElementById("rlList").innerHTML = list.length ?
        '<table class="adm-table adm-roles"><thead><tr><th>Nível de Permissão</th><th>Acesso</th><th>Usuários</th><th>Resumo</th><th></th></tr></thead><tbody>' +
        list.map(function (r) {
          var n = counts[r.id] || 0, lk = roleLockedFor(r);
          var sum = r.is_admin ? (r.is_manager ? "Acesso total a todas as telas e unidades. Cadastra unidades, níveis e regras do Sistema." : "Acesso total a todas as telas da própria unidade.") : roleShort(r);
          return '<tr data-role-id="' + esc(r.id) + '"><td class="u-name">' + esc(r.name) + "</td>" +
            "<td>" + (roleBadges(r) || "—") + "</td><td>" + n + '</td><td title="' + esc(sum) + '">' + esc(sum) + "</td>" +
            '<td class="rl-acts">' + (!lk ? '<button type="button" class="btn ghost" data-rl-copy="' + esc(r.id) + '">Duplicar</button> ' : "") +
            '<button type="button" class="btn ghost" data-rl-edit="' + esc(r.id) + '">' + (lk ? "Ver" : "Editar") + "</button></td></tr>";
        }).join("") + "</tbody></table>" : '<div class="hours-empty">Nenhum nível encontrado.</div>';
    }
    draw();
    var ov = document.getElementById("ovRoles");
    function close() { mh.innerHTML = ""; }
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) close(); });
    document.getElementById("rlClose").addEventListener("click", close);
    document.getElementById("rlDone").addEventListener("click", close);
    document.getElementById("rlSearch").addEventListener("input", function () { q0 = this.value; draw(); });
    document.getElementById("addRoleBtn").addEventListener("click", function () { openRoleModal(null); });
    document.getElementById("rlHist").addEventListener("click", openRoleHistoryAll);
    document.getElementById("rlList").addEventListener("click", function (e) {
      var c = e.target.closest("[data-rl-copy]");
      if (c) { var rc = roleById(c.getAttribute("data-rl-copy")); if (rc) openRoleModal(null, rc); return; }
      var row = e.target.closest("[data-role-id]");
      if (row) { var r = roleById(row.getAttribute("data-role-id")); if (r) openRoleModal(r); }
    });
  }

  // ---- Histórico de mudanças nos níveis (tabela role_history, gravada por gatilho no banco) ----
  function permDiff(a, b) {
    var A = a || {}, B = b || {};
    a = window.pipoPerms.upgrade(A.permissions || {}) || {};
    b = window.pipoPerms.upgrade(B.permissions || {}) || {};
    var out = [];
    if ((A.name || "") !== (B.name || "") && A.name && B.name) out.push("Nome: " + A.name + " → " + B.name);
    if (!!A.all_units !== !!B.all_units && (A.name || B.name)) out.push("Acessa Todas as Unidades: " + (B.all_units ? "ligado" : "desligado"));
    allModules().forEach(function (m) {
      if (m.tool && !a[m.key] && !b[m.key]) return;   // ferramenta que só acompanha a tela: já aparece na tela
      var on = [], off = [];
      ACTIONS.forEach(function (ac) {
        if (modActs(m).indexOf(ac.key) === -1) return;
        var x = permOn(a, m, ac.key), y = permOn(b, m, ac.key);
        if (x !== y) (y ? on : off).push(m.tool ? "" : ac.label);
      });
      if (m.tool && (on.length || off.length)) { out.push(m.label + ": " + (on.length ? "liberada" : "bloqueada")); return; }
      if (on.length || off.length) out.push(m.label + ": " + (on.length ? "ligou " + on.join(", ") : "") + (on.length && off.length ? "; " : "") + (off.length ? "desligou " + off.join(", ") : ""));
    });
    var sa = a.status || {}, sb = b.status || {};
    statusList().forEach(function (st) { if (!!sa[st.id] !== !!sb[st.id]) out.push("Status " + st.name + ": " + (sb[st.id] ? "ligou" : "desligou")); });
    var ra = a.relatorios || {}, rb = b.relatorios || {};
    REPORTS.forEach(function (x) { if (!!ra[x.key] !== !!rb[x.key]) out.push("Relatório " + x.label + ": " + (rb[x.key] ? "ligou" : "desligou")); });
    return out;
  }
  function roleHistLoad(roleId) {
    var q = auth.client.from("role_history").select("*").order("created_at", { ascending: false }).limit(roleId ? 60 : 300);
    if (roleId) q = q.eq("role_id", roleId);
    return q.then(function (r) { if (r.error) throw r.error; return r.data || []; });
  }
  function roleHistWhen(t) { var d = new Date(t); return isNaN(d) ? "" : d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
  // Lista de mudanças. canBack(row) diz se a linha ganha o botão de voltar.
  function roleHistHtml(rows, showRole, canBack) {
    if (!rows.length) return '<div class="pat-count">Nenhuma mudança registrada ainda (o histórico começou em 20/10/2026).</div>';
    return '<div class="room-list tl-list">' + rows.map(function (h) {
      var acao = h.acao === "criou" ? "Criou o nível" : h.acao === "excluiu" ? "Excluiu o nível" : "Alterou";
      var diff = h.acao === "alterou" ? permDiff(h.antes, h.depois) : [];
      var more = diff.length > 6 ? diff.length - 6 : 0;
      var back = canBack(h);
      return '<div class="room-row tl-row"><div class="room-info"><div class="rn">' + esc(roleHistWhen(h.created_at)) + " · " + esc(h.by_name || "—") + " · " + acao +
        (showRole ? " <b>" + esc(h.role_name || h.role_id) + "</b>" : "") + "</div>" +
        (diff.length ? '<div class="rs">' + diff.slice(0, 6).map(esc).join("<br>") + (more ? "<br>… e mais " + more + (more === 1 ? " mudança" : " mudanças") : "") + "</div>" : "") + "</div>" +
        (back ? '<button type="button" class="btn ghost" data-rh-back="' + h.id + '">' + (h.acao === "excluiu" ? "Recriar Nível" : "Voltar ao que Era Antes") + "</button>" : "") +
        "</div>";
    }).join("") + "</div>";
  }
  // Volta o nível ao estado "antes" da mudança (ou recria o nível excluído).
  function roleHistRestore(h, done) {
    var prev = h.antes || {}, exists = roleById(h.role_id);
    var msg = h.acao === "excluiu"
      ? "Recriar o nível <b>" + esc(prev.name || h.role_id) + "</b> com as permissões que ele tinha? Os usuários que estavam nele não voltam sozinhos."
      : "Voltar o nível <b>" + esc((exists && exists.name) || prev.name) + "</b> ao que era antes da mudança de " + esc(roleHistWhen(h.created_at)) + "? As mudanças feitas depois disso também são desfeitas.";
    confirmBox({ title: h.acao === "excluiu" ? "Recriar Nível" : "Voltar Versão do Nível", message: msg, confirmLabel: h.acao === "excluiu" ? "Recriar" : "Voltar" }).then(function (ok) {
      if (!ok) return;
      var row = { name: prev.name, permissions: prev.permissions || {} };
      if (isMgr()) row.all_units = !!prev.all_units;
      var q = exists ? auth.client.from("roles").update(row).eq("id", h.role_id) : auth.client.from("roles").insert(Object.assign({ id: h.role_id }, row));
      q.then(function (r) {
        if (r.error) { toast("Não foi possível voltar: " + friendlyDbError(r.error), true); return; }
        toast(exists ? "Nível voltou ao que era antes." : "Nível recriado.");
        reloadAll().then(done);
      });
    });
  }
  function openRoleHistoryAll() {
    var mh = document.getElementById("modalHost");
    mh.innerHTML =
      '<div class="overlay" id="ovRoleHist"><div class="modal wide" style="max-width:760px">' +
        '<div class="modal-head"><div><h3>Histórico dos Níveis de Permissão</h3>' +
          '<div class="modal-sub">Quem mudou qual permissão e quando. "Voltar ao que Era Antes" desfaz a mudança; um nível excluído pode ser recriado.</div></div>' +
          '<button class="modal-close" id="rhClose" aria-label="Fechar">✕</button></div>' +
        '<div class="modal-body"><div id="rhBody"><div class="pat-count">Carregando…</div></div></div>' +
        '<div class="modal-foot"><div class="spacer"></div><button class="btn ghost" id="rhDone">Fechar</button></div>' +
      "</div></div>";
    function close() { openRolesModal(); }
    var ov = document.getElementById("ovRoleHist");
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) close(); });
    document.getElementById("rhClose").addEventListener("click", close);
    document.getElementById("rhDone").addEventListener("click", close);
    var rows = [];
    function canBack(h) {
      var cur = roleById(h.role_id);
      if (h.acao === "excluiu") return !cur && !!h.antes;
      if (h.acao !== "alterou" || !cur || !h.antes) return false;
      return !roleLockedFor(cur) && !(h.antes.all_units && !isMgr());
    }
    function draw() { document.getElementById("rhBody").innerHTML = roleHistHtml(rows, true, canBack); }
    roleHistLoad(null).then(function (r) { rows = r; draw(); }, function (e) {
      document.getElementById("rhBody").innerHTML = '<div class="pat-count">Não foi possível ler o histórico: ' + esc(friendlyDbError(e)) + "</div>";
    });
    document.getElementById("rhBody").addEventListener("click", function (e) {
      var b = e.target.closest("[data-rh-back]"); if (!b) return;
      var h = rows.filter(function (x) { return String(x.id) === b.getAttribute("data-rh-back"); })[0];
      if (h) roleHistRestore(h, openRoleHistoryAll);
    });
  }

  // ---- Testar como este nível: abre outra aba com o sistema como esse nível veria, sem gravar nada ----
  function testRole(role) {
    try { window.open(location.origin + location.pathname + "?testeNivel=" + encodeURIComponent(role.id) + (location.hash || ""), "_blank", "noopener"); }
    catch (e) { toast("Não foi possível abrir a aba de teste.", true); }
  }

  // ---- Níveis de Permissão em quadros: um grupo por menu do topo, um quadro por tela/janela ----
  function crmKeys() { return (window.pipoCrmModules ? window.pipoCrmModules() : []).map(function (m) { return m.key; }); }
  function anamKeys() { return (window.pipoAnamModules ? window.pipoAnamModules() : []).map(function (m) { return m.key; }); }
  function layout() {
    function one(key) { return { id: key, keys: [key] }; }
    return [
      { title: "Cadastros", panels: [
        { id: "pacientes", keys: ["pacientes", "pgrp_ident", "pgrp_contato", "pgrp_endereco", "pgrp_filiacao", "pgrp_financeiro", "pgrp_rotina", "pgrp_protetiva", "pgrp_convenio", "pgrp_encaminhamento", "pgrp_tratamento", "saude_paciente", "pgrp_escola", "pgrp_rotinaatual", "pgrp_admin", "pgrp_bloqueio", "pabas_agenda", "pabas_prontuario", "pabas_anamneses", "pacientes_anexos", "campos_paciente"], wins: ["medicos", "escolas", "diagnosticos", "origens", "motivos_bloqueio"] },
        { id: "tratamentos", keys: ["tratamentos", "tratamentos_valores"], wins: ["tipos_tratamento", "motivos_cancelamento"] },
        one("convenios"),
        { id: "colaboradores", keys: ["colaboradores", "colaboradores_valores"], wins: ["cbo", "conselhos"] },
        one("especialidades"), one("servicos"),
        { id: "salas", keys: ["salas"], wins: ["grupos"] },
        one("feriados"), one("cadastro_status")
      ] },
      { title: "Planner", panels: [
        { id: "planner", keys: ["planner", "bloqueio_horario", "historico_planner"] },
        one("planner_list"),
        one("resumo"), one("disponibilidade")
      ] },
      { title: "Agenda", panels: [
        { id: "agenda", keys: ["agenda", "gerenciar_status", "historico_agenda"], extra: "status" },
        one("agenda_planner"), one("agendamentos_lista"), one("visao_geral"),
        { id: "especiais", title: "Atendimentos Especiais", keys: ["esp_bloqueado", "esp_reuniao", "esp_treinamento", "esp_reserva"] }
      ] },
      { title: "Prontuário", panels: [
        one("prontuario"), one("plano_terapeutico"), one("objetivos"), one("atividades"),
        { id: "anamneses", keys: ["anamneses"].concat(anamKeys()) },
        one("tipos_anamnese"), one("escalas"), one("habilidades")
      ] },
      { title: "CRM", panels: [ { id: "crm", keys: crmKeys() } ] },
      { title: "Relatórios", panels: [ { id: "relatorios", keys: [], extra: "reports", title: "Relatórios" } ] },
      { title: "Financeiro", panels: [
        one("financeiro"), { id: "fornecedores", keys: ["fornecedores"], wins: ["categorias_fornecedor"] }, one("contas_bancarias"), one("plano_contas"), one("financeiro_valores"),
        one("vendas"), one("comissoes"), one("fechamento_mes"), one("gerencial"), one("gerencial_fechamento")
      ] },
      { title: "Menu Acesso", panels: [ one("clinica"), one("usuarios"), one("contratos"), one("backup"), one("conector_claude"), one("senha"), one("ajuda") ] }
    ];
  }
  function permRowHtml(m, perms, locked) {
    var cols = m.tool ? [ACTIONS[0]] : ACTIONS;
    return "<tr><td><b>" + esc(m.label) + "</b>" + (m.hint ? "<small>" + esc(m.hint) + "</small>" : "") + "</td>" +
      ACTIONS.map(function (a) {
        if (modActs(m).indexOf(a.key) === -1) return '<td class="pt-muted">—</td>';
        var on = locked || permOn(perms, m, a.key);
        return '<td><input type="checkbox" data-m="' + m.key + '" data-a="' + a.key + '"' + (on ? " checked" : "") +
          (locked ? " disabled" : "") + ' aria-label="' + a.label + " em " + esc(m.label) + '"></td>';
      }).join("") + "</tr>";
  }
  function panelHtml(pn, perms, locked, byKey, tools) {
    var mods = pn.keys.map(function (k) { return byKey[k]; }).filter(Boolean);
    // Janelas abertas pelas Outras Opções da tela (cadastros de apoio): ficam dentro do quadro dela.
    var wins = (pn.wins || []).map(function (k) { return byKey[k]; }).filter(Boolean);
    var tls = tools.filter(function (t) { return t.panel === pn.id; });
    var title = pn.title || (mods[0] ? mods[0].label : pn.id);
    var body = "";
    if (mods.length || tls.length || wins.length) {
      body += '<table class="perm-grid"><thead><tr><th>Item</th>' + ACTIONS.map(function (a) { return "<th>" + a.label + "</th>"; }).join("") + "</tr></thead><tbody>" +
        mods.map(function (m) { return permRowHtml(m, perms, locked); }).join("") +
        (wins.length ? '<tr class="perm-group"><td colspan="' + (ACTIONS.length + 1) + '">Janelas em Outras Opções</td></tr>' + wins.map(function (m) { return permRowHtml(m, perms, locked); }).join("") : "") +
        (tls.length ? '<tr class="perm-group"><td colspan="' + (ACTIONS.length + 1) + '">Ferramentas e Janelas</td></tr>' + tls.map(function (m) { return permRowHtml(m, perms, locked); }).join("") : "") +
        "</tbody></table>";
    }
    if (pn.extra === "status") body += statusPermsHtml(perms, locked);
    if (pn.extra === "reports") body += reportPermsHtml(perms, locked);
    return '<div class="perm-quad" data-q="' + esc(pn.id) + '">' +
      '<div class="perm-qrow">' +
        '<div class="room-info"><div class="rn">' + esc(title) + '</div><div class="rs perm-qsum"></div></div>' +
        (locked ? "" : '<button type="button" class="btn ghost" data-qview>Ver Tudo</button><button type="button" class="btn ghost" data-qall="1">Ativar Tudo</button><button type="button" class="btn ghost" data-qall="0">Desativar Tudo</button>') +
        '<button type="button" class="btn ghost" data-qedit aria-expanded="false">Editar</button></div>' +
      '<div class="perm-qbody" hidden>' + body + "</div></div>";
  }
  function rolePanelsHtml(perms, locked) {
    var all = allModules(), byKey = {}, tools = all.filter(function (m) { return m.tool; });
    all.forEach(function (m) { if (!m.tool) byKey[m.key] = m; });
    var lay = layout(), used = {};
    lay.forEach(function (g) { g.panels.forEach(function (pn) { pn.keys.concat(pn.wins || []).forEach(function (k) { used[k] = true; }); }); });
    var rest = all.filter(function (m) { return !m.tool && !used[m.key]; }).map(function (m) { return m.key; });
    if (rest.length) lay.push({ title: "Outros", panels: [{ id: "outros", keys: rest, title: "Outras Telas" }] });
    return '<div id="rPermBox">' + lay.map(function (g) {
      return '<div class="perm-grp" data-g="' + esc(g.title) + '"><div class="perm-grp-head"><div class="tr-sec">' + esc(g.title) + "</div>" +
        (locked ? "" : '<button type="button" class="btn ghost" data-gview>Ver Tudo</button><button type="button" class="btn ghost" data-gall="1">Ativar Tudo</button><button type="button" class="btn ghost" data-gall="0">Desativar Tudo</button>') + "</div>" +
        g.panels.map(function (pn) { return panelHtml(pn, perms, locked, byKey, tools); }).join("") + "</div>";
    }).join("") + "</div>";
  }
  // Atualiza "N de M ativas" de cada quadro.
  function permSums(root) {
    Array.prototype.forEach.call(root.querySelectorAll(".perm-quad"), function (q) {
      var all = q.querySelectorAll('.perm-qbody input[type="checkbox"]'), on = q.querySelectorAll('.perm-qbody input[type="checkbox"]:checked');
      var el = q.querySelector(".perm-qsum"); if (el) el.textContent = all.length ? on.length + " de " + all.length + " ativas" : "Sem itens";
    });
  }
  // Ver / incluir / editar / excluir se ajudam: marcar qualquer ação marca "Ver"; desmarcar "Ver" tira o resto.
  function permLink(root, c) {
    var m = c.getAttribute("data-m"), a = c.getAttribute("data-a");
    if (!m) return;
    if (a !== "view" && c.checked) {
      var v = root.querySelector('input[data-m="' + m + '"][data-a="view"]');
      if (v) v.checked = true;
    }
    if (a === "view" && !c.checked) root.querySelectorAll('input[data-m="' + m + '"]').forEach(function (x) { x.checked = false; });
  }
  function permBulk(root, scope, on) {
    scope.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach(function (x) { x.checked = on; });
    permSums(root);
  }
  // Ver Tudo: marca só a ação "Ver" das telas (não mexe em incluir/editar/excluir nem nas ferramentas).
  function permViewAll(root, scope) {
    scope.querySelectorAll('input[type="checkbox"][data-a="view"]:not(:disabled)').forEach(function (x) {
      if (/^ferr_/.test(x.getAttribute("data-m") || "")) return;
      x.checked = true;
    });
    permSums(root);
  }
  function wirePermBox(box) {
    permSums(box);
    box.addEventListener("change", function (e) {
      if (e.target.matches('input[type="checkbox"]')) { permLink(box, e.target); permSums(box); }
    });
    box.addEventListener("click", function (e) {
      var ed = e.target.closest("[data-qedit]");
      if (ed) {
        var q = ed.closest(".perm-quad"), bd = q.querySelector(".perm-qbody"), open = bd.hidden;
        bd.hidden = !open; ed.textContent = open ? "Fechar" : "Editar"; ed.setAttribute("aria-expanded", open ? "true" : "false");
        return;
      }
      var qv = e.target.closest("[data-qview]");
      if (qv) { permViewAll(box, qv.closest(".perm-quad").querySelector(".perm-qbody")); return; }
      var gv = e.target.closest("[data-gview]");
      if (gv) { permViewAll(box, gv.closest(".perm-grp")); return; }
      var qa = e.target.closest("[data-qall]");
      if (qa) { permBulk(box, qa.closest(".perm-quad").querySelector(".perm-qbody"), qa.getAttribute("data-qall") === "1"); return; }
      var ga = e.target.closest("[data-gall]");
      if (ga) permBulk(box, ga.closest(".perm-grp"), ga.getAttribute("data-gall") === "1");
    });
  }

  function openRoleModal(role, copyFrom) {
    if (window.edKey) window.edKey(role && role.id && !copyFrom ? "nivel:" + role.id : null);
    var isNew = !role;
    var locked = roleLockedFor(role);
    var members = role ? users.filter(function (u) { return u.role_id === role.id; }) : [];
    var n = members.length;
    var allU = role ? !!role.all_units : !!(copyFrom && copyFrom.all_units && isMgr());
    var lockMsg = !role ? "" : role.is_manager
      ? "Acesso total a todas as telas e a todas as unidades. Este nível não pode ser alterado nem excluído."
      : role.is_admin ? "Acesso total a todas as telas da própria unidade, inclusive Usuários e Níveis de Permissão. Este nível não pode ser alterado nem excluído."
      : "Este nível acessa todas as unidades: só o Gestor altera ou exclui.";
    var mh = document.getElementById("modalHost");
    mh.innerHTML =
      '<div class="overlay" id="ovRole"><div class="modal wide" style="max-width:760px">' +
        '<div class="modal-head"><div><h3>' + (isNew ? "Novo Nível de Permissão" : locked ? "Nível " + esc(role.name) : "Editar Nível de Permissão") + "</h3>" +
          '<div class="modal-sub">' + (locked ? lockMsg
            : (copyFrom ? "Cópia de <b>" + esc(copyFrom.name) + "</b>. " : "") + "Marque o que este nível pode fazer em cada tela. Incluir, editar ou excluir marcam \"Ver\" junto.") + "</div></div>" +
          (role && !role.is_manager ? '<button type="button" class="btn ghost" id="rTest" title="Abre o sistema em outra aba como este nível veria. Nada é gravado.">Testar como Este Nível</button>' : "") +
          '<button class="modal-close" id="rClose" aria-label="Fechar">✕</button></div>' +
        '<div class="modal-body">' +
          '<div class="tr-sec tr-sec-top">Nível</div>' +
          '<div class="field"><label for="rName">Nome do Nível</label><input id="rName" type="text" maxlength="40" value="' + esc(role ? role.name : copyFrom ? "Cópia de " + copyFrom.name : "") + '"' + (locked ? " disabled" : "") + "></div>" +
          (role && role.is_admin ? "" : '<label class="chk-line" style="margin:2px 0 4px"><input type="checkbox" id="rAllUnits"' + (allU ? " checked" : "") + (locked || !isMgr() ? " disabled" : "") + "> Acessa Todas as Unidades (troca de unidade no topo)</label>" +
            (isMgr() ? "" : '<div class="pat-count">Só o Gestor marca um nível para acessar todas as unidades.</div>')) +
          '<div class="tr-sec">Permissões</div>' +
          rolePanelsHtml(role ? (role.permissions || {}) : copyFrom ? (copyFrom.permissions || {}) : { agenda: { view: true }, planner: { view: true }, resumo: { view: true }, pacientes: { view: true }, convenios: { view: true }, servicos: { view: true }, especialidades: { view: true }, salas: { view: true }, grupos: { view: true } }, locked) +
          (!isNew ? '<div class="tr-sec">Usuários neste Nível (' + n + ")</div>" + (n ? '<div class="pat-count">' + members.map(function (u) { return esc(u.full_name || u.email) + (u.active ? "" : " (desativado)"); }).join(" · ") + "</div>" : '<div class="pat-count">Nenhum usuário neste nível.</div>') : "") +
          (!isNew ? '<button type="button" class="tr-sec tr-sec-toggle" id="rHistToggle" aria-expanded="false">Histórico de Mudanças<span class="tr-sec-arrow" aria-hidden="true">▾</span></button><div id="rHistBody" hidden></div>' : "") +
        "</div>" +
        '<div class="modal-foot">' +
          (!isNew && !locked ? '<button class="btn danger" id="rDelete">Excluir Nível</button>' : "<span></span>") +
          '<div class="spacer"></div>' +
          '<button class="btn ghost" id="rCancel">' + (locked ? "Fechar" : "Cancelar") + "</button>" +
          (locked ? "" : '<button class="btn primary" id="rSave">' + (isNew ? "Criar Nível" : "Salvar") + "</button>") +
        "</div>" +
      "</div></div>";

    var ov = document.getElementById("ovRole");
    // Fechar o cadastro de um nível volta para a lista de níveis.
    function close() { openRolesModal(); }
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) close(); });
    document.getElementById("rClose").addEventListener("click", close);
    document.getElementById("rCancel").addEventListener("click", close);
    var tb = document.getElementById("rTest");
    if (tb) tb.addEventListener("click", function () { testRole(role); });
    var hTog = document.getElementById("rHistToggle"), hBody = document.getElementById("rHistBody"), hRows = null;
    function hCanBack(h) { return !locked && h.acao === "alterou" && !!h.antes && !(h.antes.all_units && !isMgr()); }
    if (hTog) hTog.addEventListener("click", function () {
      var open = hBody.hidden; hBody.hidden = !open; hTog.setAttribute("aria-expanded", open ? "true" : "false");
      if (open && !hRows) {
        hBody.innerHTML = '<div class="pat-count">Carregando…</div>';
        roleHistLoad(role.id).then(function (r) { hRows = r; hBody.innerHTML = roleHistHtml(r, false, hCanBack); },
          function (e) { hBody.innerHTML = '<div class="pat-count">Não foi possível ler o histórico: ' + esc(friendlyDbError(e)) + "</div>"; });
      }
    });
    if (hBody) hBody.addEventListener("click", function (e) {
      var b = e.target.closest("[data-rh-back]"); if (!b || !hRows) return;
      var h = hRows.filter(function (x) { return String(x.id) === b.getAttribute("data-rh-back"); })[0];
      if (h) roleHistRestore(h, function () { openRoleModal(roleById(role.id)); });
    });
    if (locked) return;

    var grid = document.getElementById("rPermBox");
    wirePermBox(grid);
    function readPerms() {
      var p = normalizePerms({});
      grid.querySelectorAll("input[type=checkbox][data-m]").forEach(function (c) {
        p[c.getAttribute("data-m")][c.getAttribute("data-a")] = c.checked;
      });
      document.querySelectorAll("#rStatusPerms input[data-status]").forEach(function (c) {
        if (c.checked) p.status[c.getAttribute("data-status")] = true;
      });
      p.relatorios = {};
      document.querySelectorAll("#rReportPerms input[data-report]").forEach(function (c) {
        if (c.checked) p.relatorios[c.getAttribute("data-report")] = true;
      });
      if (Object.keys(p.relatorios).length) p.relatorios.view = true;
      // Status que existiam no nível mas não estão mais no cadastro: mantém como estava.
      var prev = (role && role.permissions && role.permissions.status) || {};
      var known = statusList().map(function (s) { return s.id; });
      Object.keys(prev).forEach(function (k) { if (prev[k] && known.indexOf(k) === -1) p.status[k] = true; });
      return p;
    }

    var saveBtn = document.getElementById("rSave");
    saveBtn.addEventListener("click", function () {
      var name = document.getElementById("rName").value.trim();
      if (!name) { toast("Informe o nome do nível.", true); document.getElementById("rName").focus(); return; }
      var clash = roles.filter(function (r) {
        return (!role || r.id !== role.id) && r.name.trim().toLowerCase() === name.toLowerCase();
      })[0];
      if (clash) { toast("Já existe um nível com esse nome.", true); return; }
      saveBtn.disabled = true;
      var q;
      if (isNew) {
        var base = slugify(name), id = base, i = 2;
        while (roleById(id)) id = base + "-" + (i++);
        var ins = { id: id, name: name, permissions: dbPerms(readPerms()) };
        if (isMgr()) ins.all_units = !!(document.getElementById("rAllUnits") || {}).checked;
        q = auth.client.from("roles").insert(ins);
      } else {
        var upd = { name: name, permissions: dbPerms(readPerms()) };
        if (isMgr() && document.getElementById("rAllUnits")) upd.all_units = document.getElementById("rAllUnits").checked;
        q = auth.client.from("roles").update(upd).eq("id", role.id);
      }
      q.then(function (r) {
        if (r.error) {
          saveBtn.disabled = false;
          var m = /duplicate|unique|roles_name_unique/i.test(r.error.message || "") ? "Já existe um nível com esse nome." : friendlyDbError(r.error);
          toast("Não foi possível salvar: " + m, true);
          return;
        }
        toast(isNew ? "Nível \"" + name + "\" criado." : "Nível \"" + name + "\" salvo.");
        reloadAll().then(openRolesModal);
      });
    });

    var delBtn = document.getElementById("rDelete");
    if (delBtn) delBtn.addEventListener("click", function () {
      if (n > 0) {
        toast("Este nível ainda tem " + n + (n === 1 ? " usuário. Mude-o" : " usuários. Mude-os") + " de nível no cadastro de usuários antes de excluir.", true);
        return;
      }
      confirmBox({
        title: "Excluir Nível",
        message: "Excluir o nível de permissão <b>" + esc(role.name) + "</b>? Isso não pode ser desfeito.",
        confirmLabel: "Excluir Nível"
      }).then(function (ok) {
        if (!ok) return;
        auth.client.from("roles").delete().eq("id", role.id).then(function (r) {
          if (r.error) { toast("Não foi possível excluir: " + friendlyDbError(r.error), true); return; }
          toast("Nível \"" + role.name + "\" excluído.");
          reloadAll().then(openRolesModal);
        });
      });
    });

    document.getElementById("rName").focus();
  }

  /* ======== Criar acessos dos profissionais (uso pontual) ========
   * Gera, para cada profissional sem usuário, um usuário no nível
   * "Profissional": primeiro nome sem acento @clinicapipo.com e a senha
   * informada. Tudo aparece numa lista para revisar (dá para mudar o e-mail
   * ou desmarcar alguém) antes de criar. Não é regra do sistema: o padrão do
   * e-mail é só uma sugestão para os profissionais já cadastrados.
   */
  var BULK_DOMAIN = "clinicapipo.com";
  var BULK_PASSWORD = "Pipo1234!";
  // Profissionais (colaboradores com o tipo Profissional, ativos) que ainda NÃO têm
  // usuário. Já tem usuário quem está ligado ao profissional (professional_id), ao
  // cadastro do colaborador (staff_id) ou tem conta com o e-mail de contato dele.
  var PROF_STAFF = null;
  function refreshProfStaff() {
    if (!window.pipoProfStaff) return Promise.resolve();
    return window.pipoProfStaff().then(function (l) { PROF_STAFF = l; }, function () {});
  }
  function profsWithoutUser() {
    var byProf = {}, byStaff = {}, byMail = {};
    users.forEach(function (u) {
      if (u.professional_id) byProf[u.professional_id] = true;
      if (u.staff_id) byStaff[u.staff_id] = true;
      if (u.email) byMail[String(u.email).toLowerCase()] = true;
    });
    var all = PROF_STAFF || (window.pipoProfessionals ? window.pipoProfessionals() : []).map(function (p) { return { prof: p, staffId: "", email: "" }; });
    return all.filter(function (x) {
      return !byProf[x.prof.id] && !(x.staffId && byStaff[x.staffId]) && !(x.email && byMail[x.email]);
    }).sort(function (a, b) { return (a.prof.nome || a.prof.name || "").localeCompare(b.prof.nome || b.prof.name || "", "pt-BR"); });
  }
  function emailPart(s) { return normText(s).replace(/[^a-z0-9]/g, ""); }
  function suggestEmails(list) {
    var taken = {};
    users.forEach(function (u) { taken[String(u.email || "").toLowerCase()] = true; });
    return list.map(function (x) {
      var p = x.prof;
      // E-mail de contato do colaborador, se houver; senão a sugestão primeironome@.
      if (x.email && !taken[x.email]) { taken[x.email] = true; return { prof: p, staffId: x.staffId, email: x.email }; }
      var parts = String(p.name || "").trim().split(/\s+/).map(emailPart).filter(Boolean);
      var base = parts[0] || "profissional";
      var email = base + "@" + BULK_DOMAIN;
      // Nome repetido: primeiro.segundo nome, depois número.
      if (taken[email] && parts[1]) email = base + "." + parts[1] + "@" + BULK_DOMAIN;
      var n = 2;
      while (taken[email]) email = base + n++ + "@" + BULK_DOMAIN;
      taken[email] = true;
      return { prof: p, staffId: x.staffId, email: email };
    });
  }
  function openBulkProfModal() {
    // Relê usuários e colaboradores antes, para nunca oferecer quem já tem acesso.
    Promise.all([loadUsers(), refreshProfStaff()]).then(function () { renderUsers(); openBulkProfModalNow(); });
  }
  function openBulkProfModalNow() {
    var rows = suggestEmails(profsWithoutUser());
    if (!rows.length) { toast("Todos os profissionais já têm usuário."); return; }
    var mh = document.getElementById("modalHost");
    mh.innerHTML =
      '<div class="overlay" id="ovBulk"><div class="modal wide" style="max-width:640px">' +
        '<div class="modal-head"><div><h3>Criar Acessos dos Profissionais</h3>' +
          '<div class="modal-sub">' + rows.length + (rows.length === 1 ? " profissional ainda não tem" : " profissionais ainda não têm") +
          ' usuário. Confira os e-mails (dá para editar) e desmarque quem não deve ter acesso. Todos entram no nível "Profissional".</div></div>' +
          '<button class="modal-close" id="bkClose" aria-label="Fechar">✕</button></div>' +
        '<div class="modal-body">' +
          '<div class="field"><label for="bkPass">Senha Inicial (a Mesma para Todos)</label><input id="bkPass" type="text" value="' + esc(BULK_PASSWORD) + '"></div>' +
          '<table class="adm-table"><thead><tr><th style="width:36px"></th><th>Profissional</th><th>Usuário (E-mail)</th><th style="width:90px">Situação</th></tr></thead><tbody>' +
            rows.map(function (r, i) {
              return '<tr data-i="' + i + '"><td><input type="checkbox" class="bk-on" checked aria-label="Criar acesso"></td>' +
                '<td class="u-name">' + esc(r.prof.nome || r.prof.name) + "</td>" +
                '<td><input type="email" class="bk-email" value="' + esc(r.email) + '" style="width:100%;padding:5px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);font:inherit;font-size:12.5px"></td>' +
                '<td class="bk-status pt-muted">—</td></tr>';
            }).join("") +
          "</tbody></table>" +
          '<div class="pat-count">Depois, peça para cada profissional trocar a senha no menu "Acesso › Senha".</div>' +
        "</div>" +
        '<div class="modal-foot"><div class="spacer"></div>' +
          '<button class="btn ghost" id="bkCancel">Cancelar</button>' +
          '<button class="btn primary" id="bkGo">Criar Acessos</button></div>' +
      "</div></div>";
    var ov = document.getElementById("ovBulk");
    var running = false;
    function close() { if (!running) mh.innerHTML = ""; }
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) close(); });
    document.getElementById("bkClose").addEventListener("click", close);
    document.getElementById("bkCancel").addEventListener("click", close);
    var go = document.getElementById("bkGo");
    go.addEventListener("click", function () {
      var pass = document.getElementById("bkPass").value;
      if (pass.length < 8) { toast("A senha precisa ter pelo menos 8 caracteres.", true); return; }
      var trs = Array.prototype.slice.call(ov.querySelectorAll("tbody tr"));
      var todo = trs.filter(function (tr) { return tr.querySelector(".bk-on").checked && tr.getAttribute("data-done") !== "1"; });
      var seen = {}, bad = null;
      todo.forEach(function (tr) {
        var e = tr.querySelector(".bk-email").value.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || seen[e]) bad = bad || tr;
        seen[e] = true;
      });
      if (bad) { toast("Confira os e-mails: há algum inválido ou repetido.", true); bad.querySelector(".bk-email").focus(); return; }
      if (!todo.length) { toast("Nenhum profissional marcado.", true); return; }
      running = true; go.disabled = true; go.textContent = "Criando…";
      var ok = 0, fail = 0;
      // Um de cada vez, mostrando o resultado em cada linha.
      todo.reduce(function (chain, tr) {
        return chain.then(function () {
          var r = rows[+tr.getAttribute("data-i")];
          var email = tr.querySelector(".bk-email").value.trim().toLowerCase();
          var st = tr.querySelector(".bk-status");
          st.textContent = "criando…";
          var body = { action: "create", email: email, password: pass, full_name: r.prof.nome || r.prof.name, role_id: "profissional", professional_id: r.prof.id, unit_id: ((auth.unit && auth.unit()) || {}).id };
          if (r.staffId) body.staff_id = r.staffId;
          return adminApi(body)
            .then(function () { ok++; tr.setAttribute("data-done", "1"); st.innerHTML = '<span class="u-badge ok">Criado</span>'; tr.querySelector(".bk-on").disabled = true; })
            .catch(function (e) {
              // Conta com esse e-mail já existe: não cria outra (não conta como erro).
              if (/já existe/i.test(e.message || "")) { tr.setAttribute("data-done", "1"); tr.querySelector(".bk-on").disabled = true; st.innerHTML = '<span class="u-badge" title="' + esc(e.message) + '">Já tem usuário</span>'; return; }
              fail++; st.innerHTML = '<span class="u-badge off" title="' + esc(e.message) + '">Erro</span>';
            });
        });
      }, Promise.resolve()).then(function () {
        running = false;
        go.disabled = false; go.textContent = fail ? "Tentar de novo os que falharam" : "Criar Acessos";
        toast(ok + (ok === 1 ? " acesso criado" : " acessos criados") + (fail ? ", " + fail + " com erro (passe o mouse em \"Erro\" para ver o motivo)." : "."), !!fail);
        loadUsers().then(function () { renderUsers(); });
        if (!fail) document.getElementById("bkCancel").textContent = "Fechar";
      });
    });
  }

  function renderAll() { renderUsers(); }
  // Gancho só para os testes (abre a janela de um nível sem passar pela tela de Usuários).
  window.__pipoRolesTest = { diff: function (a, b) { return permDiff(a, b); }, setRoles: function (r) { roles = r; }, openRole: function (id) { openRoleModal(roleById(id)); }, openList: function () { openRolesModal(); }, sortRoles: function () { roles.sort(function (a, b) { return roleRank(a) - roleRank(b) || (a.sort || 0) - (b.sort || 0); }); }, normalize: normalizePerms };

  /* ---------------- ligação com as abas ---------------- */
  function init() {
    injectStyles();
    // A tela de Usuários abre pelo menu "Acesso" do topo, que clica no botão
    // (oculto) da aba "usuarios" — ouvimos esse clique para carregar os dados.
    var tabs = document.getElementById("mainTabs");
    if (tabs) tabs.addEventListener("click", function (e) {
      var b = e.target.closest('button[data-tab="usuarios"]');
      if (!b || !uCan("view")) return;
      if (!(loaded.users && loaded.roles)) renderAll();
      reloadAll();
    });
    // Usuário criado/alterado pela janela do colaborador (index.html): atualiza a lista.
    document.addEventListener("pipo:users-changed", function () { if (loaded.users && uCan("view")) reloadAll(); });
    // Outro administrador criou/mudou/excluiu um nível: atualiza a lista.
    if (auth.onRoleChange) auth.onRoleChange(function () {
      if (loaded.roles && uCan("view")) reloadAll();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
