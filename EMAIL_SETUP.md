# Pelex email delivery setup and verification

Pelex has two separate mail paths:

- Signup welcome emails and Paystack receipts: Pelex backend -> Lockally Email API.
- Signup confirmation codes and password-reset emails: Supabase Auth SMTP. These do not use the Lockally API key in Render.

## Welcome-email trigger

1. In Supabase, enable the `pg_net` and Vault extensions.
2. In Supabase Vault, create secrets:
   - `pelex_user_created_url` = `https://pelexn8n.onrender.com/hooks/user-created`
   - `pelex_user_created_secret` = the exact value of Render's `HOOK_SECRET`.
3. Run `welcome_email.sql` once if the `public.email_log` and `public.payment_receipts` tables do not already exist.
4. Run `welcome_email_trigger.sql` in the Supabase SQL Editor.
5. In Render, confirm these environment variables exist:
   - `LOCKALLY_API_KEY`: a LIVE key with `send:write` (not an `lk_test_` key).
   - `HOOK_SECRET`: same secret stored in Vault.
   - `EMAIL_NOREPLY_FROM`: `Pelex <no-reply@pelex.tech>` (only if that sender/domain is verified in Lockally).
   - `SITE_URL`: `https://pelex.tech`.
6. Redeploy Render after changing environment variables.

The trigger sends an asynchronous HTTP request when a row is inserted into `auth.users`. Render logs should show `user-created webhook received` followed by `welcome email queued`. A queued response means accepted by Lockally, not yet delivered; check Lockally message activity for delivered/bounced status.

## Confirmation codes and password resets

These are sent by Supabase Auth, not by `/hooks/user-created`. In Supabase Dashboard, open Authentication -> SMTP Settings and enable custom SMTP. Use the SMTP host, port, username, and password supplied by the mail provider. Set the sender email to a verified sender on `pelex.tech`. Save and test.

The Lockally REST API key is not an SMTP username/password. Do not paste it into Supabase SMTP fields.

## Paystack receipts

The Paystack dashboard must send the `charge.success` webhook to:

`https://pelexn8n.onrender.com/hooks/paystack`

Render must have `PAYSTACK_SECRET_KEY`, `LOCKALLY_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_KEY`. The `payment_receipts` table from `welcome_email.sql` is used for duplicate prevention.

## Safe test sequence

1. Use a new email address you control to create a Pelex account.
2. Confirm the signup confirmation code arrives (Supabase SMTP path).
3. Check Render logs for the welcome webhook and Lockally queue result.
4. Check Lockally message activity for final delivery status.
5. Test a Paystack receipt only with a genuine test-mode payment and matching test webhook configuration.

Never put API keys, SMTP passwords, or the HOOK_SECRET in GitHub or chat.
