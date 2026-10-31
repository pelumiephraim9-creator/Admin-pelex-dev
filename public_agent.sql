-- PELEX PUBLIC AGENT memory. Server service-role key only.
create table if not exists public.public_agent_messages(id bigserial primary key,session_id text not null,role text not null check(role in('user','assistant')),content text not null,created_at timestamptz not null default now());
create index if not exists public_agent_messages_session_idx on public.public_agent_messages(session_id,id desc);
create index if not exists public.public_agent_messages_created_idx on public.public_agent_messages(created_at);
alter table public.public_agent_messages enable row level security;
revoke all on public.public_agent_messages from anon,authenticated;
revoke all on sequence public.public_agent_messages_id_seq from anon,authenticated;
create or replace function public.purge_public_agent_messages() returns void language sql security definer set search_path=public as $$ delete from public.public_agent_messages where created_at<now()-interval '30 days' $$;
revoke all on function public.purge_public_agent_messages() from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_extension where extname='pg_cron') then perform cron.schedule('purge-public-agent','10 3 * * *','select public.purge_public_agent_messages()'); end if; exception when others then null; end $$;
