-- Unidades — Fase 2D: chave final de `documents` = (path, unit_id).
-- Só rodar DEPOIS de o app novo estar publicado (ele grava com on_conflict = path,unit_id).
-- Contém `drop constraint`: rodar no SQL Editor do Supabase (o conector trava em comandos com drop).
-- Pode rodar de novo sem estragar (só troca se a chave ainda for só `path`).
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.documents'::regclass and contype = 'p'
       and pg_get_constraintdef(oid) = 'PRIMARY KEY (path)'
  ) then
    alter table public.documents drop constraint documents_pkey;
    alter table public.documents add constraint documents_pkey primary key using index documents_path_unit_key;
  end if;
end $$;

-- Conferência: deve mostrar PRIMARY KEY (path, unit_id)
select pg_get_constraintdef(oid) as chave_de_documents
  from pg_constraint
 where conrelid = 'public.documents'::regclass and contype = 'p';
