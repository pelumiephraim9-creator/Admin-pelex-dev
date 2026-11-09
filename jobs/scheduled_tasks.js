'use strict';
/* SCHEDULED TASKS (website delivery)
   Every result is a complete report: summary, reasons, rating, pictures, next steps and a conclusion.
   Results are saved to the task and open in the side panel of the app, not under the Schedule list. */

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
function scheduledTaskBrief(instruction) {
  return [
    'You are preparing a scheduled delivery for the user. This is a full professional briefing, not a short chat reply.',
    'DEPTH: Give a thorough, detailed, useful answer. Do not default to a short response. Do not give only a headline, teaser, generic summary, or a few bullets.',
    'STRUCTURE: Start with a clear title and executive summary. Then provide the relevant context and scope; detailed findings organised under useful headings; specific facts, dates, figures and examples; explain WHY each important point matters and the reasons behind your conclusions; practical implications; advantages and disadvantages where relevant; risks, limitations and what could change the conclusion; concrete recommendations and next steps; and a concise conclusion.',
    'COMPLETENESS: Answer the whole instruction and cover the entire requested period, location, subject or set of items. For recurring news or monitoring tasks, distinguish new developments from background and explain what changed since the prior run when history is available. Avoid repeating old material as new.',
    'EVIDENCE: Use current research and relevant sources for factual or time-sensitive tasks. Cite the source names and links. Clearly separate verified facts, estimates and analysis. Never invent facts, citations, images, live feeds or exact figures. If information cannot be verified, say so.',
    'IMAGES — STRICT RELEVANCE: If the task asks for a real-world view or environmental picture, use find_images to retrieve existing photographs from the web. Search only for the exact requested location and its immediate surroundings. For Akure, the scope is Akure, Ondo State, Nigeria only. Never mix in Benue, other Nigerian states, US weather, unrelated cities, generic weather graphics, posters, flyers, infographics, collages, mock-ups, AI art or generated illustrations. Return at most 1–2 strong, relevant photographs, not a gallery of loosely related results. Inspect image titles and context; if relevance cannot be established, do not show the image and explain that a suitable photo could not be verified. A web photograph is not necessarily live: never call it live camera footage or real-time imagery unless it is an actual functioning live camera feed. If no live webcam exists, say briefly that you found the latest available real photographs, not a live stream. Do not use image generation as a substitute for real-world weather or location photography.',
    'WEATHER TASKS: First use get_weather for the exact requested city and country. Keep every forecast figure tied to that location and its local time zone. If the person asks to see the environment, separately search for real photographs of that same city only. Do not use generic weather posters, forecast cards or images from other regions as environmental photographs. Clearly separate measured/current weather data from illustrative location photographs. Do not imply that a static photograph shows the current weather.',
    'PRESENTATION: Use the clean minimalist response standard. Start with a concise title naming the exact location and report date. Give current conditions, a compact forecast, practical interpretation and useful advice in clear sections. Do not dump numbered source lists, raw URLs, search snippets or source-by-source commentary into the report. Keep any necessary attribution discreet and separate from the main explanation; do not let source notes interrupt the report.',
    'DOCUMENTS: For editing or document tasks, preserve meaning and layout unless asked otherwise. If the user supplied document text, work from it without asking them to paste it again. If a downloadable file is requested, create the requested file and include its working preview/download links. Do not claim file creation unless it succeeds.',
    'If a task genuinely has little information available, explain what was checked and why detail is limited instead of padding or inventing.',
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
  const taskRef = safeText(row.id || '', 12);
  return safeText(`Scheduled: ${subject.slice(0, 78)} · ${taskRef}`, 120);
}

async function ensureResultChat(ctx, row, result, knownChatId = null) {
  const title = scheduledChatTitle(row);
  const userId = encodeURIComponent(String(row.user_id));
  const titleQuery = encodeURIComponent(title);
  let chatId = knownChatId || null;
  let created = false;
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
  for (const row of Array.isArray(rows) ? rows : []) {
    const match = String(row.last_result || '').match(/<!--pelex-scheduled-chat:([0-9a-f-]{20,})-->/i);
    if (!match || !row.user_id || String(row.channel || 'website').toLowerCase() !== 'website') continue;
    const result = String(row.last_result).replace(/\n?\n?<!--pelex-scheduled-chat:[0-9a-f-]{20,}-->/ig, '').trim();
    if (!result) continue;
    await ensureResultChat(ctx, row, result, match[1]);
    repaired++;
  }
  if (repaired) ctx.log('scheduled chat recovery checked:', repaired, 'delivered results');
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
        meta: { userId: row.user_id, userName: safeText(row.user_name || 'user', 120), scheduledTaskId: row.id, custom: { tone: 'Professional', length: 'Detailed', instructions: 'Scheduled deliveries must be comprehensive, evidence-based and structured with clear headings. Explain the reasons behind findings, practical implications, limitations and next steps. Do not provide a short chat-style answer.' } },
        privacy: 'private',
        uid: row.user_id,
        agentId: bot
      });
      result = safeText(output && output.output || '', MAX_RESULT_CHARS);
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
    if (!ctx._scheduledChatRepairDone) {
      try { await repairDeliveredScheduledChats(ctx); ctx._scheduledChatRepairDone = true; }
      catch (repairErr) { ctx.log('scheduled chat recovery deferred:', repairErr.message); }
    }
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
  start(ctx) {
    if (!ctx.sbOn()) { ctx.log('scheduler not started: Supabase is not configured'); return; }
    const timer = setInterval(() => tick(ctx), 30000);
    timer.unref();
    const first = setTimeout(() => tick(ctx), 5000);
    first.unref();
  }
};
