-- =====================================================================
-- GTplan Follow-up · banco na nuvem (Supabase)
-- Rode este arquivo uma vez em: Supabase → SQL Editor → New query → Run
-- =====================================================================

-- Vínculos De-Para manuais (um item GTplan pode ter vários códigos CBS)
create table if not exists public.depara_vinculos (
  id          uuid primary key default gen_random_uuid(),
  cod_cliente text not null default '',          -- vazio = vale para todos os clientes
  cod_item    text not null,                     -- Cód. Item no GTplan
  desc_item   text not null default '',
  cod_cbs     text not null,                     -- Código do produto no TOTVS (6 dígitos)
  mult        integer not null default 1 check (mult >= 1),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index if not exists depara_vinculos_item_idx on public.depara_vinculos (cod_item);

-- Configurações compartilhadas: motivos revisados, frases, feriados, prazos
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists app_settings_touch on public.app_settings;
create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- Segurança: só usuários logados (criados por você no painel) leem e gravam.
-- Sem isso, qualquer pessoa com a URL e a anon key teria acesso.
alter table public.depara_vinculos enable row level security;
alter table public.app_settings   enable row level security;

drop policy if exists "equipe le e grava depara" on public.depara_vinculos;
create policy "equipe le e grava depara" on public.depara_vinculos
  for all to authenticated using (true) with check (true);

drop policy if exists "equipe le e grava settings" on public.app_settings;
create policy "equipe le e grava settings" on public.app_settings
  for all to authenticated using (true) with check (true);

-- Depois de rodar:
-- 1. Authentication → Providers → Email: desligue "Allow new users to sign up"
--    (assim só entra quem você convidar).
-- 2. Authentication → Users → "Add user" para cada pessoa da equipe.
-- 3. Project Settings → API: copie a "Project URL" e a "anon public key" para o app
--    (Configurações → Nuvem) ou para DEFAULT_CLOUD em src/storage/cloudRepository.js.
