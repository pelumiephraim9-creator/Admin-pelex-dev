# Pelex backend — Render + Cloudflare Worker

## Runtime architecture

- **Render** runs the main Node.js backend from `server.js`.
- **Cloudflare Worker** (`worker.js`) is the public edge/proxy layer. It forwards chat, streaming chat, guest-auth, speech-to-text, command-list and signed-media requests to Render. It must not contain a second copy of the agent.
- **Supabase** stores private agent memory, uploaded media and scheduled-task records.
- **Tools** are loaded automatically from `tools/*.js` when the Render server starts. A tool is registered only when its exported `name` is valid, it has a `description` and `run` function, and any `enabled(cfg)` check passes.
- **Scheduled tasks** are loaded from `jobs/*.js`. The scheduler is now in `jobs/scheduled_tasks.js`, with its recurrence helper at `jobs/scheduler_recurrence.js`.

## Render deployment

Build command: none required. Start command: `npm start` (runs `node server.js`). Node.js 18 or newer is required.

Set secrets and configuration in Render's Environment page, not in source control. At minimum, configure the keys required by the features you intend to use:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `EDGE_SECRET` (same secret as the Worker)
- `OPENROUTER_API_KEY` and/or `GROQ_API_KEY`
- `ALLOWED_ORIGINS=https://pelex.tech,https://www.pelex.tech`

Add optional provider keys only for tools/features you want enabled, such as `SERPER_API_KEY`, `TAVILY_API_KEY`, `YOUTUBE_API_KEY`, `GEMINI_API_KEY`, Cloudflare AI credentials, and email/payment credentials.

## Cloudflare Worker deployment

Deploy `worker.js` as a new Worker. Configure:
- `ORIGIN_URL` — the Render backend base URL, without a trailing slash.
- `EDGE_SECRET` — secret matching Render's `EDGE_SECRET`.
- `ALLOWED_ORIGINS` — `https://pelex.tech,https://www.pelex.tech`.

Only add the payment webhook variables (`PAYSTACK_SECRET_KEY`, `FLW_SECRET_HASH`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) if you are intentionally using the Worker payment-ledger webhook feature. Keep all secrets in Cloudflare secrets/variables, never in the browser or committed code.

Set Render's `MEDIA_PUBLIC_URL` to the deployed Worker URL so signed file links return through the Worker. Point the frontend API base to the Worker URL/custom API hostname, not directly to Render.

The Worker currently proxies:
- `GET /health`
- `GET /commands`
- `POST /chat`
- `POST /chat/stream`
- `POST /auth/guest`
- `POST /voice/stt`
- `GET /media/download`

Other paths intentionally return 404 unless added to the allowlist and implemented by the Render server.

## Scheduled-task status — IMPORTANT

The scheduler worker is now in the active `jobs/` folder, which is the directory `server.js` scans at startup. It polls every 30 seconds and processes up to three due tasks per claim. The UI's scheduled feature is advertised only after the database confirms that the canonical claim RPC can be called.

**Do not run a scheduler migration until the live Supabase schema has been checked.** The current scheduler implementation expects the `scheduled_tasks` table to expose fields including `id`, `user_id`, `bot`, `instruction`, `frequency`, `channel`, `active`, `status`, `next_run`, `locked_until`, `claim_token`, `attempts`, `last_run`, `last_result`, `last_error`, and `delivered_at`. The schema previously reported for this project did not confirm all of those columns. Run `migrations/scheduler_preflight_readonly.sql` in Supabase SQL Editor first and review its results before applying `migrations/scheduler_v3_canonical.sql`. The preflight is read-only; the canonical migration changes schema and creates privileged RPCs.

The scheduler currently persists results to `scheduled_tasks.last_result` for in-app display. It does not send Telegram or WhatsApp messages; those delivery adapters are not implemented in this scheduler.

## Checks and limitations

- `GET /health` reports configured providers, loaded tools, memory and media status.
- `GET /commands` reports the slash-command registry and feature flags.
- A tool appearing in `/commands` does not prove its external provider key, quota, database table or third-party integration is working. Verify each integration using its own health/credential check.
- No live Render, Supabase, Cloudflare, email, payment, Gmail, Telegram or WhatsApp integration is claimed as verified by a repository-only review.
- `src/server.ts` and `src/src/model-manager.ts` are a separate incomplete TypeScript experiment. Render's configured entrypoint is the root `server.js`; do not switch the Render start command to the TypeScript files.

## Repository structure

```
server.js                 Main Render API
worker.js                 Cloudflare edge Worker
command.js                Slash-command registry
registry.js               Agent registry module
jobs/                     Background jobs loaded by server.js
tools/                    Tool modules loaded by server.js
migrations/               Explicit Supabase migrations and read-only preflight
docs/                     Product and implementation specifications
```
