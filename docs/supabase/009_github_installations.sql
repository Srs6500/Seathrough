-- GitHub App installations for /data-flow Connect GitHub.
-- Safe to re-run.

create table if not exists public.github_installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  installation_id bigint not null,
  account_login text,
  account_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint github_installations_user_install_unique unique (user_id, installation_id)
);

create index if not exists github_installations_user_idx
  on public.github_installations (user_id);

alter table public.github_installations enable row level security;

drop policy if exists "github_installations_select_own" on public.github_installations;

create policy "github_installations_select_own"
  on public.github_installations for select
  to authenticated
  using (auth.uid() = user_id);
