# Pelex Backend

Pelex is a multi-agent backend designed to grow through committed agent and tool modules. The active agent structure is **General, Business, Pitch and Mailbot**. There is no Personal Agent in the current product structure.

## Architecture

- **Render** runs the Node.js API from the repository-root `server.js` using `npm start`.
- **Cloudflare Worker** (`worker.js`) is the public edge proxy between the Pelex frontend and Render. It forwards supported API requests; it is not a second agent backend.
- **Supabase** provides persistent memory, media storage and scheduled-task records.
- **Agent registry** (`registry.js`) defines canonical agent IDs, labels, readiness and agent capabilities.
- **Command registry** (`command.js`) supplies the shared slash-command catalogue and feature state to the frontend and chat router.
- **Tools** in `tools/*.js` are discovered and loaded by the backend at startup.
- **Background jobs** in `jobs/*.js` are discovered and started by the backend at startup.

The design is shared: agents use common model routing, provider fallback, identity handling, memory boundaries, tool loading, usage controls and scheduling infrastructure. Each agent can add its own instructions, tools and execution module without creating a separate server or scheduler.

## Current agent structure

| Canonical ID | Product name | Current state |
|---|---|---|
| `general` | General Agent | Existing shared execution path |
| `business` | Business Agent | Registered; implementation can be added |
| `pitch` | Pitch Agent | Registered; implementation can be added |
| `mailbot` | Mailbot Agent | Registered; UI/command alias is `gmail` |

Use canonical IDs in database records and backend code. Keep aliases at the UI boundary. Do not add a retired Personal Agent or introduce WhatsApp/Telegram as agents or scheduled-task delivery channels.

## Adding an agent

New agent work should extend the shared structure rather than fork the backend:

1. Add the agent's canonical ID, display label and capabilities to `registry.js`.
2. Add its UI/command identity and readiness information in `command.js`.
3. Add the agent implementation in the established agent module location, keeping its instructions and execution logic separate from other agents.
4. Register the implementation with the shared agent execution path. Do not mark an agent ready until its implementation and required integrations are connected.
5. Add only the tools the agent actually needs under `tools/`; tools are shared modules and should not be duplicated per agent.
6. Add focused tests for the new agent, its routing, permissions/data boundaries and tool calls.
7. Update this README and `REQUIREMENTS_AND_STATUS.md` when the implementation state changes.

An unfinished agent must remain registered as not ready; it must not be silently routed to another agent's private context or claim to have completed an action.

## Adding tools and background jobs

### Tools

Place each shared tool in `tools/<tool_name>.js`. Export a unique `name`, a useful `description`, and a `run(args, context)` function. Export `parameters`, `label(args)` and `enabled(config)` when the tool needs them. The loader reports invalid files and duplicate tool names in the Render logs. Keep credentials in Render environment variables; never commit secrets.

### Background jobs

Place each job in `jobs/<job_name>.js` and export `name` and `start(context)`. The backend scans this directory on startup. Jobs should use shared services passed in their context, handle their own errors, avoid overlapping runs, and log useful operational details.

The scheduled-task engine is shared by the agents. It reads the canonical agent ID from each task and invokes the common agent execution interface. Results are persisted in `scheduled_tasks.last_result`. The supported delivery channel at present is `website`; saving a result is not proof that an external notification was delivered.

## Models, providers and usage controls

Model selection and provider fallback belong to the shared backend model layer, not individual agent files. Agents should request the appropriate task/capability and use the common model-routing service. Provider availability and configured credentials determine which providers can actually be used.

Keep product usage controls centralised: request/text limits, account usage limits, rate limits and any plan-based quotas. Do not add arbitrary restrictions to agent capabilities, tool discovery or future agent registration. Security, authentication, privacy boundaries, validated inputs and provider terms remain mandatory.

## Render deployment

- Runtime: Node.js 18 or newer.
- Build command: none required for the current JavaScript service.
- Start command: `npm start` (runs `node server.js`).
- Configure environment variables in Render, not in source control.

Core environment variables include:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `EDGE_SECRET` (must match the Cloudflare Worker secret)
- `OPENROUTER_API_KEY` and/or `GROQ_API_KEY`
- `ALLOWED_ORIGINS` containing the deployed Pelex frontend origins

Configure optional provider and integration credentials only when enabling those capabilities, for example search, YouTube, image generation, email or payments. Keep the shared model fallback configuration in the backend environment.

When GitHub auto-deploy is enabled for the Render service, commits to its configured branch trigger deployment. Confirm the deployment and inspect Render logs after each backend change; a GitHub commit alone does not prove that a deployment succeeded.

## Cloudflare Worker deployment and frontend connection

Deploy the repository-root `worker.js` as the Pelex public Worker. Set these Worker variables/secrets:

- `ORIGIN_URL`: Render backend base URL, without a trailing slash.
- `EDGE_SECRET`: secret matching Render's `EDGE_SECRET`.
- `ALLOWED_ORIGINS`: deployed Pelex frontend origins.

The Worker currently proxies:
- `GET /health`
- `GET /commands`
- `POST /chat`
- `POST /chat/stream`
- `POST /auth/guest`
- `POST /voice/stt`
- `GET /media/download`

The payment webhook handler is a separate optional Worker route and requires its own provider and Supabase secrets. Do not expose any secret in frontend code.

After deploying the Worker:
1. Copy its public URL.
2. Set Render's `MEDIA_PUBLIC_URL` to that Worker URL.
3. Configure the frontend API base URL to the Worker URL.
4. Confirm the frontend origin is allowed by both Worker and Render.
5. Test Worker `/health`, `/commands`, guest authentication and chat before testing scheduled tasks.

The Worker is a separate Cloudflare deployment. A Render GitHub auto-deploy does not by itself publish Worker changes unless a Cloudflare deployment pipeline has explicitly been configured.

## Supabase and scheduled tasks

The current Supabase inspection confirmed that `public.scheduled_tasks` already contains the scheduler fields used by the backend, RLS is enabled with an owner policy, and the V2 claim, complete and fail RPC functions exist. Do not apply a replacement scheduler migration just to recreate these objects. Change the schema only when a tested code requirement demonstrates a real mismatch.

The scheduler:
- is loaded from `jobs/scheduled_tasks.js`;
- uses `jobs/scheduler_recurrence.js`;
- claims due tasks through `claim_due_scheduled_tasks_v2`;
- uses claim tokens to fence completion/failure updates;
- stores results for in-app display;
- supports the `website` channel only.

A live task execution still needs to be verified after Render deployment.

## Repository layout

```
server.js                 Main Render API and shared agent execution
worker.js                 Cloudflare public edge proxy
registry.js               Canonical agent registry
command.js                Shared commands, channels and feature state
jobs/                     Auto-loaded background jobs and scheduler
tools/                    Auto-loaded shared tool modules
migrations/               Explicit Supabase SQL migrations and checks
docs/                     Agent specifications and implementation notes
src/                      Separate TypeScript experiment; not current runtime
pelex-desktop/            Desktop client
```

## Quality and deployment workflow

For every backend change:

1. Put new code in the correct existing directory and reuse shared modules.
2. Check for an existing equivalent before creating another file.
3. Keep one canonical implementation; remove a duplicate only after confirming it is truly redundant.
4. Run syntax checks and focused tests for changed files.
5. Commit the change to the configured GitHub branch.
6. Verify the Render deployment and review startup logs for skipped tools/jobs or runtime errors.
7. Deploy `worker.js` separately when it changes, unless automated Cloudflare deployment is configured.
8. Smoke-test the affected API route and agent flow.

Do not claim a feature is live merely because its source file has been committed. Report repository changes, deployment status and live test results separately.
