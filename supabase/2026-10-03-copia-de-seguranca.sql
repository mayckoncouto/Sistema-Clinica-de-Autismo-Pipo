-- =====================================================================
-- Agenda Pipo — cópia de segurança (2026-10-03)
--
--   * Restaurar a cópia (menu Acesso → Cópia de segurança) grava pela
--     função /api/admin-backup com a service role key, ou seja, SEM usuário
--     logado (auth.uid() nulo).
--   * Nesse caso os triggers de carimbo passam a MANTER as datas e os autores
--     que vêm da cópia (antes trocavam tudo por "agora" e "ninguém").
--     Para quem usa o app (usuário logado) nada muda.
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

create or replace function public.appointments_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    -- Restauração / scripts: mantém o que veio, completando o que faltar.
    if tg_op = 'UPDATE' then
      new.id := old.id;
      new.created_by := coalesce(new.created_by, old.created_by);
      new.created_at := coalesce(new.created_at, old.created_at);
    else
      new.created_at := coalesce(new.created_at, now());
    end if;
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create or replace function public.clinical_records_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    -- Restauração / scripts: mantém autor e datas da cópia.
    if tg_op = 'UPDATE' then
      new.created_at := coalesce(new.created_at, old.created_at);
    else
      new.created_at := coalesce(new.created_at, now());
    end if;
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.author_id := coalesce(auth.uid(), new.author_id);
    new.created_at := now();
  else
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.patient_id := old.patient_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
