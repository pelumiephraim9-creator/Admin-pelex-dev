# Pelex Universal Slash Command Registry (Backend)

This update establishes one backend source of truth for slash-command metadata and a routing-ready registry.

## What is implemented
- Existing General Agent commands remain parsed by the existing `/chat` handler and become General Agent instructions.
- `GET /commands` returns the registry plus agent/channel readiness metadata.
- `GET /commands?agent=general|gmail|pitch|business|personal` filters the registry by agent.
- New Gmail, Pitch, Business, and Personal commands are registered but explicitly marked `implemented: false`; they return a clear `not_connected` response instead of pretending an unbuilt agent ran.
- Health response reports slash command count.

## Important current limits
- This backend currently implements the General/Public Agent. Gmail, Pitch, Business, and Personal agents have not been built in this new cloud backend; their commands are registered placeholders.
- Telegram and WhatsApp do not become connected merely by adding commands. Their webhook adapters must be implemented and secured separately, then call the same router/command parser.
- `/canva` creates a Canva-ready brief unless a Canva integration is connected. Image/document commands depend on working existing tools.
- No database migrations or secrets are included in this ZIP.

## Test after deployment
1. `GET https://<your-render-service>/commands` — confirm `version: 3`, `router: "universal"`, and command list.
2. `GET https://<your-render-service>/commands?agent=general` — confirm General commands are listed.
3. Send `/prompt Write a prompt for a fashion bag advertisement` through the existing chat UI — it should be handled as a General Agent prompt-engineering task.
4. Send `/gmail find the latest invoice` — it should return a clear `not_connected` response until the new Gmail Agent is implemented. This is intentional.
5. Send `/help` — the assistant should list commands and identify commands that are not connected yet.

Do not replace the live service until the new deployment has passed the tests above. Preserve current Render environment variables.
