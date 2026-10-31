-- PELEX EMAIL DEDUPLICATION LOG
-- Required by server.js POST /hooks/user-created.
-- Run in Supabase SQL Editor. This does not send emails or configure Auth SMTP.
create table if not exists public.email_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('welcome','receipt','product_update','verification')),
  sent_at timestamptz not null default now(),
  primary key (user_id, kind)
);

alter table public.email_log enable row level security;
revoke all on public.email_log from anon, authenticated;

-- The backend uses the Supabase service-role key to claim and remove log rows.
-- No browser policies are intentionally created.
create index if not exists email_log_sent_at_idx on public.email_log(sent_at desc);

select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='email_log'
order by ordinal_position;

 
-- Paystack receipt idempotency. Separate table because Paystack references
-- are strings, not Supabase Auth user UUIDs.
create table if not exists public.payment_receipts (
  reference text primary key,
  created_at timestamptz not null default now()
);
alter table public.payment_receipts enable row level security;
revoke all on public.payment_receipts from anon, authenticated;
create index if not exists payment_receipts_created_at_idx on public.payment_receipts(created_at desc);
