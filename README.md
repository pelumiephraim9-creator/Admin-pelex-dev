# Pelex Cloud Backend — reconciled candidate (not deployed)

## Included
- Updated `server.js` with owner + agent + session scoped memory.
- Original frontend, commands and utility tools from the uploaded ZIP.
- `agents/registry.js` with conservative readiness: only General is implemented here.
- `jobs/scheduled_tasks.js` shared scheduler worker using fenced v2 RPCs.
- `scheduler_recurrence.js` recurrence helper.
- `migrations/scheduler_v2.sql` additive migration for fenced scheduler claims.
- Original SQL files preserved in the root.

## Important
1. This has not been tested against your live Supabase or deployed.
2. Run `migrations/scheduler_v2.sql` only after checking the existing `scheduled_tasks` columns and the installed `pgcrypto`/`gen_random_uuid()` support. It is additive but creates new RPCs and a `claim_token` column.
3. The scheduler supports website result persistence. Telegram/WhatsApp only work if delivery adapters are provided; otherwise the task correctly fails/retries rather than claiming delivery.
4. Business, Pitch, Personal and Mailbot are deliberately marked not implemented in `agents/registry.js`. Do not set environment flags to pretend they are ready. The existing `commands.js` readiness flags still govern the current UI, so reconcile those before deployment.
5. `remote_jobs.js` requires a `job_shown` table. The referenced `job_distribution.sql` is missing from the upload. No job-distribution migration is included in this candidate.
6. `welcome_email.sql` is also referenced by the requirements file but missing from the upload.
7. `server.js` has not been fully refactored to use `agents/registry.js` for prompt/tool enforcement yet. The registry is an architecture module, not an authorization boundary until wired into the request/tool execution path.
8. No live delivery, Gmail, calendar, WhatsApp, Telegram, or provider integrations are asserted as ready by this package.

## Local static checks
Run `node --check server.js`, `node --check commands.js`, and `node --check jobs/scheduled_tasks.js` in an environment with Node 18+. No npm dependencies are needed by these files, but this package does not bypass Node.js itself.
