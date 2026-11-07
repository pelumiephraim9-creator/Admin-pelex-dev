# Agent module contract

The server automatically discovers JavaScript modules in this directory through `registry.js`. Use the canonical filenames:

- `business.js` — Business Agent
- `pitch.js` — Pitch Agent
- `mailbot.js` — Mailbot Agent

General Agent remains the shared default execution path in the root backend; do not create a second General server.

## Module shape

Each module must export:

```js
'use strict';

module.exports = {
  id: 'business', // business | pitch | mailbot
  label: 'Business Agent',
  implemented: false, // change to true only when its end-to-end flow is ready
  instructions: 'Agent-specific role, scope, workflow and response rules.',
  tools: [] // optional list of shared tool names used by this agent
};
```

The module's `id` must match one of the pre-registered canonical IDs. The loader validates the ID, label and non-empty instructions. A module with `implemented: false` is registered but remains unavailable to users. The server only marks it ready when `implemented: true`.

## Shared execution behavior

When a registered agent is ready, the server:
- routes its chat to the common `runAgent` execution loop;
- adds its `instructions` to the shared system prompt;
- keeps its conversation memory under its canonical agent ID;
- uses shared model routing, provider fallback, tools, usage limits, authentication and safety checks.

Do not duplicate the server, model manager, memory layer, scheduler or shared tools in an agent module. Put reusable tools in `tools/` and background work in `jobs/`. Add agent-specific integration modules as needed and test them before setting `implemented: true`.

The active canonical IDs are `general`, `business`, `pitch` and `mailbot`. The UI alias `gmail` maps to `mailbot`. Personal Agent is retired.
