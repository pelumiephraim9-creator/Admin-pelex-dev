-- Required by remote_jobs.js. Additive and idempotent.
begin;
create table if not exists public.job_shown(url_hash text not null,user_key text not null,url text not null,shown_at timestamptz not null default now(),constraint job_shown_pkey primary key(url_hash,user_key));
create index if not exists job_shown_url_hash_idx on public.job_shown(url_hash);
create index if not exists job_shown_user_key_idx on public.job_shown(user_key);
alter table public.job_shown enable row level security;
-- Server uses Supabase service-role key; no direct browser policies.
commit;
