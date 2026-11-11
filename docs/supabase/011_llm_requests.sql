-- Log every LLM chat completion so admins can see what people used the API for.
-- Safe to run more than once.

create table if not exists public.llm_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  feature text not null default 'unknown',
  provider text,
  model text,
  user_id uuid references auth.users (id) on delete set null,
  anon_id text,
  status text not null default 'ok',
  error_message text,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  prompt text,
  system_preview text,
  response_preview text,
  messages jsonb,
  meta jsonb not null default '{}'::jsonb,
  constraint llm_requests_status_check check (status in ('ok', 'error'))
);

create index if not exists llm_requests_created_at_idx
  on public.llm_requests (created_at desc);

create index if not exists llm_requests_feature_idx
  on public.llm_requests (feature, created_at desc);

create index if not exists llm_requests_user_id_idx
  on public.llm_requests (user_id, created_at desc);

alter table public.llm_requests enable row level security;

grant select, insert on table public.llm_requests to service_role;
