-- Pelex signup -> welcome email webhook
-- Enable pg_net and Vault in Supabase Database -> Extensions.
-- In Supabase Vault, create these secrets (names must match exactly):
--   pelex_user_created_url    = https://pelexn8n.onrender.com/hooks/user-created
--   pelex_user_created_secret = the exact HOOK_SECRET value configured on Render
-- Do not put the secret in this file or commit it to GitHub.
--
-- This adds only the signup notification trigger. It does not alter existing
-- auth settings, user records, or the email_log/payment_receipts tables.

create or replace function public.pelex_notify_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'pelex_user_created_url'
  limit 1;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'pelex_user_created_secret'
  limit 1;

  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    raise warning 'Pelex welcome email webhook skipped: Vault secrets are missing.';
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-pelex-hook', v_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'users',
      'schema', 'auth',
      'record', to_jsonb(new)
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

drop trigger if exists pelex_user_created_email on auth.users;

create trigger pelex_user_created_email
after insert on auth.users
for each row
execute function public.pelex_notify_user_created();

select trigger_name, event_manipulation, event_object_schema, event_object_table
from information_schema.triggers
where trigger_name = 'pelex_user_created_email';
