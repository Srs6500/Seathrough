-- Plans (unlimited via promo code) + per-feature conversation limits.
-- Run after 009_github_installations.sql.
--
-- Plans live in their own table, NOT on profiles: profiles has an
-- "update own row" policy, so a plan column there could be flipped to 'pro'
-- by any signed-in user straight from the browser. Both tables below are
-- written only by the server (service role).

create table if not exists public.billing_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free',
  -- 'promo' for now (how the user got unlimited access).
  plan_source text,
  promo_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_accounts_plan check (plan in ('free', 'pro'))
);

create trigger billing_accounts_set_updated_at
  before update on public.billing_accounts
  for each row execute function public.set_updated_at();

alter table public.billing_accounts enable row level security;

-- Users may read their own plan; there is deliberately no insert/update policy.
create policy "billing_accounts_select_own"
  on public.billing_accounts for select
  to authenticated
  using (auth.uid() = user_id);

-- One row per conversation started on a feature. Free users get
-- 5 per feature in any rolling 12 hours. Follow-up questions inside the same
-- conversation reuse the row (same conversation_key) and cost nothing.
create table if not exists public.usage_conversations (
  id uuid primary key default gen_random_uuid(),
  feature text not null,
  conversation_key text not null,
  user_id uuid references auth.users (id) on delete cascade,
  -- Random id from an httpOnly cookie, so signed-out visitors are counted too.
  anon_id text,
  created_at timestamptz not null default now(),
  constraint usage_conversations_subject check (user_id is not null or anon_id is not null)
);

create index if not exists usage_conversations_user_idx
  on public.usage_conversations (user_id, feature, created_at desc);
create index if not exists usage_conversations_anon_idx
  on public.usage_conversations (anon_id, feature, created_at desc);

-- No policies: service role only.
alter table public.usage_conversations enable row level security;
