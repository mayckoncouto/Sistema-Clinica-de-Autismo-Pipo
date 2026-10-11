-- Financeiro, Fase 1 (2026-10-11): categorias de fornecedor, contas bancárias e plano de contas
--   config/supplier_categories  Cadastros → Categorias de fornecedor  (permissão "categorias_fornecedor")
--   config/bank_accounts        Cadastros → Contas bancárias           (permissão "contas_bancarias")
--   config/chart_accounts       Cadastros → Plano de contas            (permissão "plano_contas")
--   public.bank_account_finance saldo inicial de cada conta, tabela protegida (permissão "financeiro_valores")
-- 1. caminhos permitidos  2. módulo de cada caminho  3. tabela protegida do saldo inicial
-- 4. Plano de contas (67 subcategorias revisadas) e as 3 contas com o saldo de 01/01/2026.
-- Nenhum nível recebe estas permissões: só o Administrador vê e altera até você liberar em Níveis de permissão.
-- Pode rodar de novo (não troca o que já existe).

alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|system|planner_blocks|task_lists|diagnoses|origins|suppliers|supplier_categories|bank_accounts|chart_accounts)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_path like 'schedule/%'           then 'planner'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'colaboradores'   -- profissional = colaborador
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/diagnoses'        then 'diagnosticos'
    when p_path = 'config/origins'          then 'origens'
    when p_path = 'config/suppliers'        then 'fornecedores'
    when p_path = 'config/supplier_categories' then 'categorias_fornecedor'
    when p_path = 'config/bank_accounts'    then 'contas_bancarias'
    when p_path = 'config/chart_accounts'   then 'plano_contas'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'colaboradores'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
    when p_path = 'config/goal_bank'        then 'objetivos'
    when p_path = 'config/planner_blocks'   then 'bloqueio_horario'
    when p_path = 'config/task_lists'       then 'crm_listas'  -- nenhum nível tem: só o Administrador
    when p_path = 'config/system'           then 'sistema'   -- só o Administrador
  end;
$function$;

-- 3. Saldo inicial de cada conta (protegido por "Financeiro – valores")
create table if not exists public.bank_account_finance (
  account_id    text primary key,              -- id da conta em config/bank_accounts
  saldo_inicial numeric(14,2) not null default 0,
  data_saldo    date not null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null
);
alter table public.bank_account_finance enable row level security;
grant select, insert, update, delete on public.bank_account_finance to authenticated;

create or replace function public.bank_account_finance_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    new.updated_at := coalesce(new.updated_at, now());   -- restauração / scripts
    return new;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists bank_account_finance_stamp on public.bank_account_finance;
create trigger bank_account_finance_stamp
  before insert or update on public.bank_account_finance
  for each row execute function public.bank_account_finance_stamp();

drop policy if exists bank_account_finance_select on public.bank_account_finance;
create policy bank_account_finance_select on public.bank_account_finance
  for select to authenticated using (public.has_perm('financeiro_valores', 'view'));
drop policy if exists bank_account_finance_insert on public.bank_account_finance;
create policy bank_account_finance_insert on public.bank_account_finance
  for insert to authenticated with check (public.has_perm('financeiro_valores', 'edit'));
drop policy if exists bank_account_finance_update on public.bank_account_finance;
create policy bank_account_finance_update on public.bank_account_finance
  for update to authenticated
  using (public.has_perm('financeiro_valores', 'edit'))
  with check (public.has_perm('financeiro_valores', 'edit'));
drop policy if exists bank_account_finance_delete on public.bank_account_finance;
create policy bank_account_finance_delete on public.bank_account_finance
  for delete to authenticated
  using (public.has_perm('financeiro_valores', 'edit') or public.has_perm('contas_bancarias', 'delete'));

-- 4. Dados iniciais (só se ainda não existirem)
insert into public.documents (path, data) values
  ('config/chart_accounts', $pl${"list": [{"id": "rendimentos", "name": "Rendimentos", "categoria": "Receita Financeira", "tipo": "Receita"}, {"id": "assefaz", "name": "Assefaz", "categoria": "Receita Operacional", "tipo": "Receita", "convenioId": "assefaz"}, {"id": "avaliacao", "name": "Avaliação", "categoria": "Receita Operacional", "tipo": "Receita"}, {"id": "bradesco", "name": "Bradesco", "categoria": "Receita Operacional", "tipo": "Receita", "convenioId": "bradesco-muz61wekj6ah"}, {"id": "bradesco-eventual", "name": "Bradesco Eventual", "categoria": "Receita Operacional", "tipo": "Receita"}, {"id": "cas-prefeitura", "name": "CAS Prefeitura", "categoria": "Receita Operacional", "tipo": "Receita"}, {"id": "cassi", "name": "Cassi", "categoria": "Receita Operacional", "tipo": "Receita", "convenioId": "cassi"}, {"id": "celos", "name": "Celos", "categoria": "Receita Operacional", "tipo": "Receita", "convenioId": "celos"}, {"id": "crescentis", "name": "Crescentis", "categoria": "Receita Operacional", "tipo": "Receita", "convenioId": "crescentis"}, {"id": "levmed", "name": "Levmed", "categoria": "Receita Operacional", "tipo": "Receita", "convenioId": "levmed"}, {"id": "mediservice", "name": "MediService", "categoria": "Receita Operacional", "tipo": "Receita", "convenioId": "mediservice"}, {"id": "particular", "name": "Particular", "categoria": "Receita Operacional", "tipo": "Receita", "convenioId": "particular-muml2b2jz9qm"}, {"id": "pladisa", "name": "Pladisa", "categoria": "Receita Operacional", "tipo": "Receita", "convenioId": "pladisa"}, {"id": "sc-saude", "name": "SC Saúde", "categoria": "Receita Operacional", "tipo": "Receita", "convenioId": "sc-saude"}, {"id": "sim", "name": "SIM", "categoria": "Receita Operacional", "tipo": "Receita", "convenioId": "sim"}, {"id": "saude-caixa", "name": "Saúde Caixa", "categoria": "Receita Operacional", "tipo": "Receita", "convenioId": "saude-caixa-mumsa0cnvy00"}, {"id": "sulamerica", "name": "SulAmérica", "categoria": "Receita Operacional", "tipo": "Receita", "convenioId": "sulamerica"}, {"id": "unimed-alto-vale", "name": "Unimed Alto Vale", "categoria": "Receita Operacional", "tipo": "Receita", "convenioId": "unimed-alto-vale-muqhx64s770o"}, {"id": "unimed-blumenau", "name": "Unimed Blumenau", "categoria": "Receita Operacional", "tipo": "Receita", "convenioId": "unimed-blumenau-muqhx1bbh4kj"}, {"id": "unimed-campinas", "name": "Unimed Campinas", "categoria": "Receita Operacional", "tipo": "Receita", "convenioId": "unimed-campinas-muqhv0ofqa3s"}, {"id": "unimed-florianopolis", "name": "Unimed Florianópolis", "categoria": "Receita Operacional", "tipo": "Receita", "convenioId": "unimed-florianopolis-muz77oriqqju"}, {"id": "unimed-nacional", "name": "Unimed Nacional", "categoria": "Receita Operacional", "tipo": "Receita", "convenioId": "unimed-nacional"}, {"id": "unimed-santa-catarina", "name": "Unimed Santa Catarina", "categoria": "Receita Operacional", "tipo": "Receita", "convenioId": "unimed-sc-muqhxbx57yem"}, {"id": "bancarias", "name": "Bancárias", "categoria": "Despesas Financeiras", "tipo": "Despesa"}, {"id": "juros", "name": "Juros", "categoria": "Despesas Financeiras", "tipo": "Despesa"}, {"id": "reembolso", "name": "Reembolso", "categoria": "Despesas Financeiras", "tipo": "Despesa"}, {"id": "aluguel", "name": "Aluguel", "categoria": "Despesas Fixas", "tipo": "Despesa"}, {"id": "aplicativos", "name": "Aplicativos", "categoria": "Despesas Fixas", "tipo": "Despesa"}, {"id": "contabilidade", "name": "Contabilidade", "categoria": "Despesas Fixas", "tipo": "Despesa"}, {"id": "energia", "name": "Energia", "categoria": "Despesas Fixas", "tipo": "Despesa"}, {"id": "internet", "name": "Internet", "categoria": "Despesas Fixas", "tipo": "Despesa"}, {"id": "juridico", "name": "Jurídico", "categoria": "Despesas Fixas", "tipo": "Despesa"}, {"id": "limpeza", "name": "Limpeza", "categoria": "Despesas Fixas", "tipo": "Despesa"}, {"id": "seguros", "name": "Seguros", "categoria": "Despesas Fixas", "tipo": "Despesa"}, {"id": "telefone", "name": "Telefone", "categoria": "Despesas Fixas", "tipo": "Despesa"}, {"id": "agua", "name": "Água", "categoria": "Despesas Fixas", "tipo": "Despesa"}, {"id": "alimentacao", "name": "Alimentação", "categoria": "Despesas Variáveis", "tipo": "Despesa"}, {"id": "brindes", "name": "Brindes", "categoria": "Despesas Variáveis", "tipo": "Despesa"}, {"id": "equipamentos", "name": "Equipamentos", "categoria": "Despesas Variáveis", "tipo": "Despesa"}, {"id": "marketing", "name": "Marketing", "categoria": "Despesas Variáveis", "tipo": "Despesa"}, {"id": "materiais", "name": "Materiais", "categoria": "Despesas Variáveis", "tipo": "Despesa"}, {"id": "reforma", "name": "Reforma", "categoria": "Despesas Variáveis", "tipo": "Despesa"}, {"id": "servicos", "name": "Serviços", "categoria": "Despesas Variáveis", "tipo": "Despesa"}, {"id": "auxilio-educacional", "name": "Auxílio Educacional", "categoria": "Despesas com Funcionários", "tipo": "Despesa"}, {"id": "beneficios", "name": "Benefícios", "categoria": "Despesas com Funcionários", "tipo": "Despesa"}, {"id": "comissao", "name": "Comissão", "categoria": "Despesas com Funcionários", "tipo": "Despesa"}, {"id": "decimo-terceiro", "name": "Décimo Terceiro", "categoria": "Despesas com Funcionários", "tipo": "Despesa"}, {"id": "encargos", "name": "Encargos", "categoria": "Despesas com Funcionários", "tipo": "Despesa"}, {"id": "ferias", "name": "Férias", "categoria": "Despesas com Funcionários", "tipo": "Despesa"}, {"id": "rescisao", "name": "Rescisão", "categoria": "Despesas com Funcionários", "tipo": "Despesa"}, {"id": "salarios", "name": "Salários", "categoria": "Despesas com Funcionários", "tipo": "Despesa"}, {"id": "transporte", "name": "Transporte", "categoria": "Despesas com Funcionários", "tipo": "Despesa"}, {"id": "treinamentos", "name": "Treinamentos", "categoria": "Despesas com Funcionários", "tipo": "Despesa"}, {"id": "uniformes", "name": "Uniformes", "categoria": "Despesas com Funcionários", "tipo": "Despesa"}, {"id": "alvara", "name": "Alvará", "categoria": "Imposto", "tipo": "Despesa"}, {"id": "imposto", "name": "Imposto", "categoria": "Imposto", "tipo": "Despesa"}, {"id": "licencas", "name": "Licenças", "categoria": "Imposto", "tipo": "Despesa"}, {"id": "resgates-financeiros", "name": "Resgates Financeiros", "categoria": "Aplicações Financeiras", "tipo": "Entrada"}, {"id": "emprestimos-recebidos", "name": "Empréstimos Recebidos", "categoria": "Empréstimos", "tipo": "Entrada"}, {"id": "recebimento-de-repasse", "name": "Recebimento de Repasse", "categoria": "Receitas de Terceiros", "tipo": "Entrada"}, {"id": "aporte-de-socios", "name": "Aporte de sócios", "categoria": "Sócios", "tipo": "Entrada"}, {"id": "transferencia-entrada", "name": "Transferência Entrada", "categoria": "Transferências entre contas", "tipo": "Entrada"}, {"id": "aplicacao-financeira", "name": "Aplicação Financeira", "categoria": "Aplicações Financeiras", "tipo": "Saída"}, {"id": "emprestimos-concedidos", "name": "Empréstimos Concedidos", "categoria": "Empréstimos", "tipo": "Saída"}, {"id": "pagamento-de-repasse", "name": "Pagamento de Repasse", "categoria": "Repasses a Terceiros", "tipo": "Saída"}, {"id": "retirada", "name": "Retirada", "categoria": "Sócios", "tipo": "Saída"}, {"id": "transferencia-saida", "name": "Transferência Saída", "categoria": "Transferências entre contas", "tipo": "Saída"}]}$pl$::jsonb),
  ('config/bank_accounts',  $pl${"list": [{"id": "viacredi", "name": "Viacredi", "tipo": "Banco", "banco": "Viacredi"}, {"id": "bradesco", "name": "Bradesco", "tipo": "Banco", "banco": "Bradesco"}, {"id": "caixa", "name": "Caixa", "tipo": "Caixa"}]}$pl$::jsonb)
on conflict (path) do nothing;

insert into public.bank_account_finance (account_id, saldo_inicial, data_saldo) values
  ('viacredi', 208724.77, '2026-01-01'),
  ('bradesco', 945549.97, '2026-01-01'),
  ('caixa',    106644.22, '2026-01-01')
on conflict (account_id) do nothing;

-- Conferência: caminhos aceitos | funções ok | subcategorias | contas | saldo total (esperado 1260918.96)
select (select pg_get_constraintdef(oid) like '%chart_accounts%' from pg_constraint where conname = 'documents_path_valid') as caminhos_aceitos,
       (public.module_for_path('config/bank_accounts') = 'contas_bancarias' and public.module_for_path('config/chart_accounts') = 'plano_contas'
         and public.module_for_path('config/supplier_categories') = 'categorias_fornecedor') as funcao_ok,
       (select jsonb_array_length(data -> 'list') from public.documents where path = 'config/chart_accounts') as subcategorias,
       (select jsonb_array_length(data -> 'list') from public.documents where path = 'config/bank_accounts') as contas,
       (select sum(saldo_inicial) from public.bank_account_finance) as saldo_total;
