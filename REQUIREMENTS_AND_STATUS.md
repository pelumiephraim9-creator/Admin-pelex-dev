# Pelex backend requirements and implementation status

Last aligned with the current backend structure: 7 November 2026.

## Product agent structure

The active agents are:

1. **General Agent** — existing shared execution foundation.
2. **Business Agent** — registered; implementation is being developed.
3. **Pitch Agent** — registered; implementation is being developed.
4. **Mailbot Agent** — registered under canonical ID `mailbot`; `gmail` is its UI/command alias.

Personal Agent is retired and must not be reintroduced into the registry, command menu, scheduled-task routing or product documentation.

WhatsApp and Telegram are not current agents or scheduled-task delivery channels. The scheduler currently supports in-app website results.

## Shared backend foundation

All agents use the same backend service and should align with these shared components:

- common model selection, provider availability and fallback;
- central usage, request and text limits;
- shared authentication and verified user identity;
- agent-scoped conversation memory;
- shared tools and tool discovery;
- shared scheduled-task engine and recurrence handling;
- shared API and Cloudflare Worker edge layer;
- consistent logging, error handling and deployment checks.

Agent-specific instructions, integrations, tools and execution modules belong to their own implementation files. Adding an agent must not require cloning the server, model manager, scheduler or shared tools.

## Current repository structure

- `server.js`: active Node.js backend entrypoint.
- `worker.js`: Cloudflare Worker proxy.
- `registry.js`: canonical agent registry.
- `command.js`: shared command and feature registry.
- `tools/`: automatically discovered shared tools.
- `jobs/`: automatically discovered background jobs.
- `docs/`: agent specifications and implementation guidance.
- `src/server.ts` and `src/src/model-manager.ts`: separate TypeScript experiment; not the active Render entrypoint.

## Existing capabilities and implementation notes

The repository includes shared chat/model routing, provider fallback logic, session memory, web search, weather, image search and generation, document/data tools, video search, remote job search, pitch link checking, payment webhook code, email-related SQL and scheduled-task infrastructure. Each capability still depends on its required credentials, provider access, schema and deployment being configured.

The General Agent is the current execution foundation. Business, Pitch and Mailbot remain registered agent identities; their agent-specific implementations and integrations should be connected as they are completed. Do not report an agent as operational until its own end-to-end flow has been tested.

## Scheduled-task database status

The user-provided Supabase inspection on 7 November 2026 confirmed:

- `public.scheduled_tasks` exists with the columns used by the scheduler, including `bot`, `instruction`, `frequency`, `channel`, `next_run`, `last_run`, `status`, `active`, `timezone`, `last_result`, `attempts`, `locked_until`, `last_error` and `claim_token`.
- RLS is enabled; FORCE RLS is disabled.
- The `own scheduled tasks` policy restricts authenticated users to rows where `auth.uid() = user_id`.
- V2 RPCs exist: `claim_due_scheduled_tasks_v2`, `complete_scheduled_task_v2` and `fail_scheduled_task_v2`.
- The inspected V2 definitions use row locks/skip-locked claiming and claim-token checks for completion and failure.

No replacement scheduler migration is currently indicated by these inspection results. Render execution and a real scheduled General Agent task still require live verification.

## Deployment requirements

- Render runs `npm start` / `node server.js`.
- Cloudflare Worker runs `worker.js` and proxies the frontend to Render.
- Frontend API requests should use the Worker URL, not the Render origin.
- Render GitHub auto-deploy must be enabled for commits to deploy automatically.
- Cloudflare Worker updates need their own deployment unless a Cloudflare CI/CD pipeline is configured.
- Keep secrets in Render/Cloudflare environment settings, never in Git.

## Ongoing build workflow

When a new agent, tool, job or integration is committed:

1. Inspect the existing structure and reuse shared services.
2. Place the file in its canonical directory.
3. Register it with the relevant shared loader/registry.
4. Add focused tests and update documentation.
5. Commit to the configured branch.
6. Verify the Render deployment and startup logs.
7. Deploy Worker changes separately when applicable.
8. Run an end-to-end smoke test.

The only product-level usage restrictions should be the centrally configured account/request/text limits and applicable plan quotas. Security, authentication, privacy isolation, input validation and provider requirements remain necessary engineering safeguards.
