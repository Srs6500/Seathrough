-- Smart Tutor (voice / whiteboard) conversation snapshots for signed-in users.
-- Run in Supabase SQL Editor after 001–010.
-- `session` jsonb holds messages + JSON-safe lesson visuals (whiteboard, plan,
-- board text). Student-uploaded media blobs stay on-device only.

create table if not exists public.smart_tutor_sessions (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  title text not null,
  topic text not null default '',
  ended boolean not null default false,
  preview text,
  session jsonb not null,
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint smart_tutor_sessions_id_length
    check (char_length(id) between 1 and 100),
  constraint smart_tutor_sessions_title_length
    check (char_length(title) between 1 and 120),
  constraint smart_tutor_sessions_topic_length
    check (char_length(topic) <= 200),
  constraint smart_tutor_sessions_session_object
    check (jsonb_typeof(session) = 'object')
);

create index if not exists smart_tutor_sessions_user_updated_idx
  on public.smart_tutor_sessions (user_id, client_updated_at desc);

drop trigger if exists smart_tutor_sessions_set_updated_at
  on public.smart_tutor_sessions;
create trigger smart_tutor_sessions_set_updated_at
  before update on public.smart_tutor_sessions
  for each row execute function public.set_updated_at();

alter table public.smart_tutor_sessions enable row level security;

drop policy if exists "smart_tutor_sessions_select_own"
  on public.smart_tutor_sessions;
create policy "smart_tutor_sessions_select_own"
  on public.smart_tutor_sessions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "smart_tutor_sessions_insert_own"
  on public.smart_tutor_sessions;
create policy "smart_tutor_sessions_insert_own"
  on public.smart_tutor_sessions for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "smart_tutor_sessions_update_own"
  on public.smart_tutor_sessions;
create policy "smart_tutor_sessions_update_own"
  on public.smart_tutor_sessions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "smart_tutor_sessions_delete_own"
  on public.smart_tutor_sessions;
create policy "smart_tutor_sessions_delete_own"
  on public.smart_tutor_sessions for delete
  to authenticated
  using (auth.uid() = user_id);
