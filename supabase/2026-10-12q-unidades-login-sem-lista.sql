-- Unidades — a tela de login não mostra mais a lista de unidades: cada pessoa entra na unidade do próprio perfil
-- e só a Gestão escolhe a unidade, depois de entrar (seletor do topo). Por isso o nome das unidades deixa de ser público.
-- Pode rodar de novo sem estragar.
revoke all on function public.login_units() from public;
revoke execute on function public.login_units() from anon;
grant execute on function public.login_units() to authenticated;

-- Conferência: anon_chama deve ser false e logado_chama true
select has_function_privilege('anon', 'public.login_units()', 'execute') as anon_chama,
       has_function_privilege('authenticated', 'public.login_units()', 'execute') as logado_chama;
