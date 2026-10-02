-- =====================================================================
-- Agenda Pipo — nome do usuário = nome do profissional (2026-10-02, parte 10)
--
--   * Usuário ligado a um profissional (profiles.professional_id) sempre tem
--     o mesmo nome do cadastro do profissional (config/professionals).
--   * Quem manda é o cadastro do profissional: ao salvar o profissional, o
--     nome do usuário ligado é atualizado sozinho; na tela Usuários o nome
--     desse usuário fica travado. Ligar um usuário a um profissional também
--     copia o nome.
--   * No fim, acerta de uma vez os usuários que já estão diferentes.
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Salvou o cadastro de profissionais → atualiza o nome dos usuários ligados.
create or replace function public.sync_professional_user_names()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles pr
     set full_name = btrim(item ->> 'name')
    from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) item
   where pr.professional_id = item ->> 'id'
     and coalesce(btrim(item ->> 'name'), '') <> ''
     and pr.full_name is distinct from btrim(item ->> 'name');
  return new;
end;
$$;

drop trigger if exists documents_sync_professional_names on public.documents;
create trigger documents_sync_professional_names
  after insert or update on public.documents
  for each row when (new.path = 'config/professionals')
  execute function public.sync_professional_user_names();

-- 2. Usuário ligado a um profissional: o nome vem sempre do cadastro dele.
create or replace function public.profiles_professional_name()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.professional_id is not null then
    select btrim(item ->> 'name') into v_name
      from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) item
     where d.path = 'config/professionals' and item ->> 'id' = new.professional_id
     limit 1;
    if coalesce(v_name, '') <> '' then new.full_name := v_name; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_professional_name on public.profiles;
create trigger profiles_professional_name
  before insert or update on public.profiles
  for each row execute function public.profiles_professional_name();

-- 3. Acerta agora os que já estão diferentes.
update public.profiles pr
   set full_name = btrim(item ->> 'name')
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) item
 where d.path = 'config/professionals'
   and pr.professional_id = item ->> 'id'
   and coalesce(btrim(item ->> 'name'), '') <> ''
   and pr.full_name is distinct from btrim(item ->> 'name');
