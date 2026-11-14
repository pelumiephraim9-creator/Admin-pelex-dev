'use strict';
/* SCHEDULED TASKS (website delivery)
   Execute the requested task and present only its customer-facing result.
   Internal run metadata remains private; delivered content is clean and task-appropriate. */

const { nextAfter } = require('./scheduler_recurrence');
const AGENTS = require('../registry');

const MAX_RESULT_CHARS = 18000;
const ALLOWED_CHANNELS = new Set(['website']);

function safeText(v, max = 4000) {
  return String(v == null ? '' : v).replace(/\u0000/g, '').slice(0, max);
}
function toCanonicalAgent(bot) {
  const raw = String(bot || 'general').trim().toLowerCase();
  const supported = new Set(['general', 'business', 'pitch', 'mailbot', 'gmail', 'mail']);
  if (!supported.has(raw)) {
    const error = new Error(`Unknown or retired agent ID: ${raw || '(empty)'}. Supported agents: general, business, pitch and mailbot.`);
    error.permanent = true;
    throw error;
  }
  return AGENTS.canonicalAgentId(raw);
}
async function rpc(ctx, name, body) {
  const r = await ctx.sbFetch('/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const details = await r.text().catch(() => '');
    throw new Error(`${name} failed (${r.status}): ${safeText(details, 500)}`);
  }
  return r.json().catch(() => null);
}

/* Keep scheduled instructions task-focused. Do not turn editing, writing, or file tasks into research reports. */

function cleanScheduledReport(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/<!--\s*pelex-[\s\S]*?-->/gi, '')
    .split('\n')
    .map(line => line
      .replace(/\b(?:Supabase|Render\.com|Cloudflare|GitHub|PostgreSQL|PostgREST|Row[- ]Level[- ]Security|RLS policy|scheduler worker|scheduled_tasks|claim_token)\b/gi, '')
      .replace(/\b(?:https?:\/\/)?[a-z0-9.-]*(?:supabase\.co|onrender\.com|github\.com|workers\.dev)[^\s)]*/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trimEnd())
    .filter(line => !/^\s*(?:internal (?:task|run|claim) id|scheduled task id|backend status)\s*:/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* Execute the user's requested deliverable; do not force every task into a long report. */
function scheduledTaskBrief(instruction) {
  return [
    'You are Pelex completing a scheduled task for the user. Do the task itself; do not explain the scheduler or describe internal execution.',
    'FIRST classify the requested deliverable: research/update, monitoring, writing, planning, reminder, calculation, or another concrete task. Match the output to that deliverable. Do not turn every instruction into an essay.',
    'LENGTH: Be complete enough to fulfil the exact instruction, but concise. Do not add generic introductions, conclusions, recommendations, next steps, definitions or filler unless requested or genuinely useful.',
    'FORMATTING IS REQUIRED: Return clean Markdown that renders as a polished document. Put the main title alone on its own line as # **Title**. Put every section heading alone on its own line as ## **Section heading**. Headings such as Executive Summary, Introduction, Findings, New Releases, Trending Now, Conclusion and Recommendations must be bold and visually distinct from body text. Keep body paragraphs beneath their headings, with a blank line between sections. Use consistent hyphen bullets and consistent indentation. Bold important labels. Never put a heading and its body on the same line. Never leave unmatched asterisks, decorative star symbols, raw Markdown markers as literal text, ASCII art or ornamental separators.',
    'RESEARCH: Verify current facts. State the relevant date and region when availability differs by location. Separate confirmed facts from estimates. Include relevant clickable source links in a concise Sources section or beside claims; do not invent titles, dates, sources, URLs or rankings.',
    'MONITORING: Report what changed since the previous check. If nothing material changed, say so directly. Do not repeat old background as a new update.',
    'WRITING: Deliver the requested finished writing directly, in the requested tone and format. Do not preface it with an essay about the writing.',
    'PLANNING: Give the actual requested schedule, timetable or plan, covering the full period requested. Use a clear table or day-by-day structure when helpful.',
    'REMINDERS: State the reminder directly and briefly.',
    'CONFIDENTIALITY: Never mention or reveal internal systems, infrastructure, providers, databases, hosting, repositories, source code, private URLs, task IDs, run IDs, claim tokens, execution traces, tool names or backend errors. These are never part of a customer deliverable. If an operation fails, report only a clear, non-technical status and useful next step.',
    'IMAGES AND FILES: When an image is created, show the image itself with one short caption only. Do not expose source code, raw URLs, storage paths, filenames or implementation details. For requested files, provide the actual in-app file result and do not invent a link.',
    'If reliable information is unavailable, state the limitation plainly instead of guessing or padding.',
    '',
    'USER TASK:',
    instruction
  ].join('\n');
}
function scheduledChatTitle(row) {
  const subject = safeText(row.instruction, 180)
    .split(/\nSource website:/i)[0]
    .replace(/\s+/g, ' ')
    .trim() || 'Scheduled task';
  // Stable across retries: next_run changes after a retry, but the same task
  // must always deliver into the same chat.
  return safeText(`Scheduled: ${subject.slice(0, 96)}`, 120);
}

async function ensureResultChat(ctx, row, result, knownChatId = null) {
  const title = scheduledChatTitle(row);
  const userId = encodeURIComponent(String(row.user_id));
  const titleQuery = encodeURIComponent(title);
  let chatId = knownChatId || null;
  let created = false;

  // A stored scheduled-chat marker can outlive its chat row (for example, if
  // the user deleted the chat). Never trust that marker without checking the
  // owner-scoped row first, otherwise inserting messages raises FK 23503.
  if (chatId) {
    const verify = await ctx.sbFetch(
      `/rest/v1/chats?select=id&user_id=eq.${userId}&id=eq.${encodeURIComponent(chatId)}&limit=1`
    );
    if (!verify.ok) throw new Error(`Could not verify the scheduled-result chat (${verify.status}): ${safeText(await verify.text().catch(() => ''), 300)}`);
    const existing = await verify.json().catch(() => []);
    if (!Array.isArray(existing) || !existing.some(chat => String(chat.id) === String(chatId))) {
      ctx.log('scheduled result chat no longer exists; creating a replacement:', row.id, chatId);
      chatId = null;
    }
  }

  if (!chatId) {
    const find = await ctx.sbFetch(
      `/rest/v1/chats?select=id&user_id=eq.${userId}&title=eq.${titleQuery}&order=updated_at.desc&limit=1`
    );
    if (!find.ok) throw new Error(`Could not check the scheduled-result chat (${find.status}): ${safeText(await find.text().catch(() => ''), 300)}`);
    const found = await find.json().catch(() => []);
    chatId = Array.isArray(found) && found[0] ? found[0].id : null;
  }

  if (!chatId) {
    const create = await ctx.sbFetch('/rest/v1/chats', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: row.user_id, title, project_id: null })
    });
    if (!create.ok) throw new Error(`Could not create the scheduled-result chat (${create.status}): ${safeText(await create.text().catch(() => ''), 300)}`);
    const rows = await create.json().catch(() => []);
    chatId = Array.isArray(rows) && rows[0] ? rows[0].id : (rows && rows.id);
    if (!chatId) throw new Error('The scheduled-result chat was created without returning its ID.');
    created = true;
  }

  // A stable run marker makes delivery idempotent across retries and workers.
  const runMarkerMatch = String(result).match(/<!--pelex-scheduled-run:[^>]+-->/);
  const runMarker = runMarkerMatch ? runMarkerMatch[0] : '';
  const messagesUrl = `/rest/v1/messages?select=role,content&chat_id=eq.${encodeURIComponent(chatId)}&order=created_at.desc&limit=30`;
  const readMessages = await ctx.sbFetch(messagesUrl);
  if (!readMessages.ok) throw new Error(`Could not check scheduled-result messages (${readMessages.status}).`);
  const previous = await readMessages.json().catch(() => []);
  const alreadyDelivered = Array.isArray(previous) && (
    (runMarker && previous.some(m => m.role === 'assistant' && String(m.content || '').includes(runMarker))) ||
    previous.some(m => m.role === 'assistant' && m.content === result)
  );

  if (!alreadyDelivered) {
    const payload = created || !previous.length
      ? [
          { chat_id: chatId, user_id: row.user_id, role: 'user', content: 'Scheduled task: ' + safeText(row.instruction, 6000) },
          { chat_id: chatId, user_id: row.user_id, role: 'assistant', content: result }
        ]
      : [{ chat_id: chatId, user_id: row.user_id, role: 'assistant', content: result }];
    const save = await ctx.sbFetch('/rest/v1/messages', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(payload)
    });
    if (!save.ok) throw new Error(`Could not save the scheduled result to its chat (${save.status}): ${safeText(await save.text().catch(() => ''), 300)}`);
  }

  const touch = await ctx.sbFetch(`/rest/v1/chats?id=eq.${encodeURIComponent(chatId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ updated_at: new Date().toISOString() })
  });
  if (!touch.ok) throw new Error(`Could not update the scheduled chat timestamp (${touch.status}).`);
  return { chatId, title };
}

async function repairDeliveredScheduledChats(ctx) {
  // Repair older completed website tasks whose chat row exists but whose
  // messages failed to save (older versions omitted messages.user_id).
  const r = await ctx.sbFetch(
    '/rest/v1/scheduled_tasks?select=id,user_id,instruction,last_result,next_run,frequency,channel,delivered_at&delivered_at=not.is.null&last_result=not.is.null&order=delivered_at.desc&limit=40'
  );
  if (!r.ok) throw new Error(`Could not scan delivered scheduled tasks for chat repair (${r.status}).`);
  const rows = await r.json().catch(() => []);
  let repaired = 0;
  let failures = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const match = String(row.last_result || '').match(/<!--pelex-scheduled-chat:([0-9a-f-]{20,})-->/i);
    if (!match || !row.user_id || String(row.channel || 'website').toLowerCase() !== 'website') continue;
    const result = String(row.last_result).replace(/\n?\n?<!--pelex-scheduled-chat:[0-9a-f-]{20,}-->/ig, '').trim();
    if (!result) continue;
    try {
      const chat = await ensureResultChat(ctx, row, result, match[1]);
      // Persist the replacement ID in the completed task itself. This restores
      // the frontend deep-link/card target and prevents the stale ID returning
      // on every future recovery pass.
      if (String(chat.chatId) !== String(match[1])) {
        const updatedResult = String(row.last_result).replace(
          match[0],
          '<!--pelex-scheduled-chat:' + chat.chatId + '-->'
        );
        const update = await ctx.sbFetch(
          `/rest/v1/scheduled_tasks?id=eq.${encodeURIComponent(row.id)}&delivered_at=not.is.null`,
          {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ last_result: updatedResult })
          }
        );
        if (!update.ok) throw new Error(`Could not save the replacement scheduled-chat ID (${update.status}).`);
      }
      repaired++;
    } catch (rowErr) {
      failures++;
      ctx.log('scheduled chat recovery skipped task:', row.id, rowErr.message);
    }
  }
  if (repaired) ctx.log('scheduled chat recovery checked:', repaired, 'delivered results');
  if (failures) throw new Error(`${failures} delivered scheduled chat(s) still need recovery; retry will be backoff-limited.`);
}

async function deliver(ctx, row, result) {
  // Website delivery means the complete result has been written to a normal chat
  // owned by the scheduled-task user. Only then may the task be marked delivered.
  const channel = String(row.channel || 'website').toLowerCase();
  if (!ALLOWED_CHANNELS.has(channel)) {
    const error = new Error(`Unsupported scheduled-task channel: ${channel}`);
    error.permanent = true;
    throw error;
  }
  const chat = await ensureResultChat(ctx, row, result);
  // The frontend reads this hidden marker from the task row to open the exact chat.
  const taskResult = result + '\n\n<!--pelex-scheduled-chat:' + chat.chatId + '-->';
  return { confirmed: true, result: taskResult, chatId: chat.chatId, chatTitle: chat.title };
}
async function processTask(ctx, row) {
  const token = row.claim_token;
  try {
    if (!row.id || !token) throw new Error('Claimed task is missing its fencing token.');
    if (!row.user_id) throw new Error('Scheduled task has no owner user_id.');
    const requestedBot = String(row.bot || 'general').trim().toLowerCase();
    const bot = toCanonicalAgent(requestedBot);
    const channel = String(row.channel || 'website').toLowerCase();
    if (!ALLOWED_CHANNELS.has(channel)) {
      const error = new Error(`Unsupported scheduled-task channel: ${channel}`);
      error.permanent = true;
      throw error;
    }
    // Scheduled tasks currently store no workspace/project binding. Do not
    // run workspace agents without that authorization context, even though
    // their interactive chat modules are available.
    if (bot !== 'general') {
      const error = new Error('Scheduled execution for ' + bot + ' is not connected to an authorized workspace context yet.');
      error.permanent = true;
      throw error;
    }
    const agent = AGENTS.getAgent(bot);
    if (!agent || !agent.implemented) {
      const error = new Error(`The ${bot} agent is registered but its execution module is not implemented yet.`);
      error.permanent = true;
      throw error;
    }
    if (!row.instruction || !String(row.instruction).trim()) throw new Error('Scheduled task has no instruction.');
    const instruction = safeText(row.instruction, 6000);
    // Persist the generated result before delivery. If delivery or completion fails,
    // the next claim reuses this exact result instead of asking the model to run again.
    const pendingPrefix = '<!--pelex-scheduled-pending:';
    const legacyPendingPrefix = '<!--pelex-scheduled-pending-->\n';
    let result = '';
    let runMarkerId = '';
    const prior = String(row.last_result || '');
    const pendingMatch = prior.match(/^<!--pelex-scheduled-pending:([a-z0-9-]+)-->\n/i);
    if (pendingMatch) {
      runMarkerId = pendingMatch[1];
      result = safeText(prior.slice(pendingMatch[0].length), MAX_RESULT_CHARS);
      ctx.log('scheduled task resuming saved result:', row.id);
    } else if (prior.startsWith(legacyPendingPrefix)) {
      result = safeText(prior.slice(legacyPendingPrefix.length), MAX_RESULT_CHARS);
      runMarkerId = require('crypto').createHash('sha256').update(String(row.id) + result).digest('hex').slice(0, 20);
      ctx.log('scheduled task resuming legacy saved result:', row.id);
    } else {
      const output = await ctx.runAgent({
        sid: `sched-${row.id}`,
        text: scheduledTaskBrief(instruction),
        memoryText: instruction,
        meta: { userId: row.user_id, userName: safeText(row.user_name || 'user', 120), scheduledTaskId: row.id, custom: { tone: 'Professional', length: 'Adaptive', instructions: 'Complete the exact scheduled task in its natural format. Use bold standalone headings, aligned paragraphs and consistent lists when structure is useful. Do not force a long report or generic sections. Never expose internal execution or infrastructure details.' } },
        privacy: 'private',
        uid: row.user_id,
        agentId: bot
      });
      result = cleanScheduledReport(safeText(output && output.output || '', MAX_RESULT_CHARS));
      if (!result.trim()) throw new Error('Agent returned an empty result.');
      runMarkerId = require('crypto').randomUUID();
      const staged = await ctx.sbFetch(
        `/rest/v1/scheduled_tasks?id=eq.${encodeURIComponent(row.id)}&status=eq.running&claim_token=eq.${encodeURIComponent(token)}`,
        { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_result: pendingPrefix + runMarkerId + '-->\n' + result }) }
      );
      if (!staged.ok) throw new Error(`Could not checkpoint scheduled result (${staged.status}): ${safeText(await staged.text().catch(() => ''), 300)}`);
    }
    if (!result.trim()) throw new Error('Saved scheduled result is empty.');
    // This run ID is saved alongside the result, so retries retain the same identity.
    // A later recurring occurrence gets a fresh ID.
    const runMarker = '<!--pelex-scheduled-run:' + safeText(row.id, 80) + ':' + runMarkerId + '-->';
    const resultForDelivery = result + '\n\n' + runMarker;
    const delivery = await deliver(ctx, row, resultForDelivery);
    const recurring = row.active !== false && row.frequency && String(row.frequency).trim().toLowerCase() !== 'once';
    const nextRun = recurring ? nextAfter(row.next_run || new Date().toISOString(), row.frequency) : null;
    const ok = await rpc(ctx, 'complete_scheduled_task_v2', {
      p_task_id: row.id,
      p_claim_token: token,
      p_result: delivery.result,
      p_next_run: nextRun,
      p_delivery_confirmed: delivery.confirmed
    });
    if (ok !== true && !(Array.isArray(ok) && ok[0] === true)) {
      if (ok !== true) throw new Error('Completion was rejected; task may have been reclaimed by another worker.');
    }
    ctx.log('scheduled task completed:', row.id, 'chat:', delivery.chatId, 'channel:', row.channel || 'website', 'frequency:', row.frequency);
  } catch (err) {
    ctx.log('scheduled task failed:', row.id, err.message);
    try {
      await rpc(ctx, 'fail_scheduled_task_v2', {
        p_task_id: row.id, p_claim_token: token,
        p_error: safeText(err.message, 1800),
        p_max_attempts: err.permanent ? 1 : 3, p_retry_seconds: 300
      });
    } catch (failErr) {
      ctx.log('could not release failed scheduled task:', row.id, failErr.message);
    }
  }
}
let running = false;
async function tick(ctx) {
  if (running || !ctx.sbOn()) return;
  running = true;
  try {
    // Do not automatically recreate chats for already-delivered tasks.
    // A user may intentionally clear/delete a result chat; startup recovery
    // must not resurrect it or create another chat on every backend restart.
    // New task deliveries create their result chat exactly once in deliver().
    const rows = await rpc(ctx, 'claim_due_scheduled_tasks_v2', { p_limit: 3, p_lock_seconds: 300 });
    if (ctx.COMMANDS && typeof ctx.COMMANDS.setFeature === 'function') ctx.COMMANDS.setFeature('scheduled', true);
    if (!Array.isArray(rows) || !rows.length) return;
    ctx.log('scheduler claimed tasks:', rows.length);
    for (const row of rows) {
      ctx.log('scheduled task started:', row.id, 'owner:', row.user_id, 'frequency:', row.frequency);
      await processTask(ctx, row);
    }
  } catch (e) {
    ctx.log('scheduler tick failed:', e.message);
  } finally { running = false; }
}
module.exports = {
  name: 'scheduled_tasks',
  tick,
  processTask,
  ensureResultChat,
  repairDeliveredScheduledChats,
  cleanScheduledReport,
  scheduledTaskBrief,
  start(ctx) {
    if (!ctx.sbOn()) { ctx.log('scheduler not started: Supabase is not configured'); return; }
    const timer = setInterval(() => tick(ctx), 30000);
    timer.unref();
    const first = setTimeout(() => tick(ctx), 5000);
    first.unref();
  }
};
