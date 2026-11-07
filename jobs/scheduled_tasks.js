'use strict';

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
async function deliver(ctx, row, result) {
  // The current supported channel is in-app website storage only.
  // Saving last_result is not proof that a user opened or received a notification.
  const channel = String(row.channel || 'website').toLowerCase();
  if (!ALLOWED_CHANNELS.has(channel)) {
    const error = new Error(`Unsupported scheduled-task channel: ${channel}`);
    error.permanent = true;
    throw error;
  }
  return { confirmed: false, result };
}
async function processTask(ctx, row) {
  const token = row.claim_token;
  try {
    // Keep all task-specific validation inside this handler. One bad task
    // must not abort the rest of the batch or strand their claim locks.
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
    const output = await ctx.runAgent({
      sid: `sched-${row.id}`,
      text: `Execute this scheduled task. Produce the complete result, with sources where appropriate. Do not claim an external action was completed unless a connected tool confirms it.\n\nTask: ${safeText(row.instruction, 6000)}`,
      memoryText: safeText(row.instruction, 6000),
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
      // RPC may return a scalar boolean depending on PostgREST configuration.
      if (ok !== true) throw new Error('Completion was rejected; task may have been reclaimed by another worker.');
    }
    ctx.log('scheduled task completed:', row.id, 'channel:', row.channel || 'website', 'frequency:', row.frequency);
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
    const rows = await rpc(ctx, 'claim_due_scheduled_tasks_v2', {
      p_limit: 3, p_lock_seconds: 300
    });
    // Advertise scheduling only after the database confirms that the canonical
    // claim RPC exists and is callable with the service-role credentials.
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
