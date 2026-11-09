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

/* The brief every scheduled task receives. It asks for a full, structured result for ANY kind of task
   (films, products, prices, news, jobs, places, plans), not a short paragraph. */
function fullReportBrief(instruction) {
  return [
    'You are preparing a COMPLETE scheduled report. A short paragraph is not acceptable.',
    'Use this structure with clear headings, and skip a heading only when it truly does not apply:',
    '1. Title: the subject, with its year or date where relevant.',
    '2. Summary: the key facts, in full, with numbers, dates and names.',
    '3. Why it is worth it: the concrete reasons to watch, buy, read, visit or act, one by one.',
    '4. Rating: out of 10, with the reason for the score, when the subject can be rated.',
    '5. Pictures: show real pictures of the subject with the find_images tool and include their image links. If none suitable exist, generate one with image_generate and include it.',
    '6. Practical details: where to get it, cost, availability, timing, or what to do next.',
    '7. Conclusion: three to five sentences giving your honest recommendation and who it is for.',
    '8. Sources: the links used.',
    'Do not claim an external action was completed unless a connected tool confirms it.',
    '',
    'Task: ' + instruction
  ].join('\n');
}

function scheduledChatTitle(row) {
  const subject = safeText(row.instruction, 180)
    .split(/\nSource website:/i)[0]
    .replace(/\s+/g, ' ')
    .trim() || 'Scheduled report';
  const runAt = row.next_run && !Number.isNaN(Date.parse(row.next_run))
    ? new Date(row.next_run)
    : new Date();
  const stamp = runAt.toISOString().slice(0, 16).replace('T', ' ');
  return safeText(`Scheduled: ${subject.slice(0, 78)} · ${stamp}`, 120);
}

async function ensureResultChat(ctx, row, result) {
  const title = scheduledChatTitle(row);
  const userId = encodeURIComponent(String(row.user_id));
  const titleQuery = encodeURIComponent(title);
  const find = await ctx.sbFetch(
    `/rest/v1/chats?select=id&user_id=eq.${userId}&title=eq.${titleQuery}&order=updated_at.desc&limit=1`
  );
  if (!find.ok) throw new Error(`Could not check the scheduled-result chat (${find.status}): ${safeText(await find.text().catch(() => ''), 300)}`);
  const found = await find.json().catch(() => []);
  let chatId = Array.isArray(found) && found[0] ? found[0].id : null;
  let created = false;

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

  const messagesUrl = `/rest/v1/messages?select=role,content&chat_id=eq.${encodeURIComponent(chatId)}&order=created_at.desc&limit=2`;
  const readMessages = await ctx.sbFetch(messagesUrl);
  if (!readMessages.ok) throw new Error(`Could not check scheduled-result messages (${readMessages.status}).`);
  const previous = await readMessages.json().catch(() => []);
  const latestAssistant = Array.isArray(previous) ? previous.find(m => m.role === 'assistant') : null;

  if (!latestAssistant || latestAssistant.content !== result) {
    const payload = created || !previous.length
      ? [
          { chat_id: chatId, role: 'user', content: 'Scheduled task: ' + safeText(row.instruction, 6000) },
          { chat_id: chatId, role: 'assistant', content: result }
        ]
      : [{ chat_id: chatId, role: 'assistant', content: result }];
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
  return { confirmed: true, result, chatId: chat.chatId, chatTitle: chat.title };
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
    const output = await ctx.runAgent({
      sid: `sched-${row.id}`,
      text: fullReportBrief(instruction),
      memoryText: instruction,
      meta: { userId: row.user_id, userName: safeText(row.user_name || 'user', 120), scheduledTaskId: row.id },
      privacy: 'private',
      uid: row.user_id,
      agentId: bot
    });
    const result = safeText(output && output.output || '', MAX_RESULT_CHARS);
    if (!result.trim()) throw new Error('Agent returned an empty result.');
    const delivery = await deliver(ctx, row, result);
    const recurring = row.active !== false && row.frequency && String(row.frequency).toLowerCase() !== 'once';
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
