'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const AGENTS = require('../registry');
const COMMANDS = require('../command');
const scheduler = require('../jobs/scheduled_tasks');
const { nextAfter } = require('../jobs/scheduler_recurrence');

test('the canonical registry contains only the four active agents', () => {
  assert.deepEqual(Object.keys(AGENTS.DEFINITIONS).sort(), ['business', 'general', 'mailbot', 'pitch']);
  assert.equal(AGENTS.canonicalAgentId('gmail'), 'mailbot');
  assert.equal(AGENTS.canonicalAgentId('mail'), 'mailbot');
  assert.equal(AGENTS.getAgent('personal'), undefined);
});

test('command registry exposes the active agent set without Personal', () => {
  assert.deepEqual(Object.keys(COMMANDS.AGENTS).sort(), ['business', 'general', 'gmail', 'pitch']);
  assert.equal(COMMANDS.AGENTS.gmail.label, 'Mailbot Agent');
  assert.equal(COMMANDS.list().agents.personal, undefined);
});

test('recurrence advances daily schedules from the scheduled instant', () => {
  const next = nextAfter('2026-11-07T09:00:00.000Z', 'daily', new Date('2026-11-07T10:00:00.000Z'));
  assert.equal(next, '2026-11-08T09:00:00.000Z');
});

function context({ output = 'scheduled result', rpcResult = true } = {}) {
  const calls = [];
  return {
    calls,
    log() {},
    async runAgent(args) { calls.push({ type: 'agent', args }); return { output }; },
    async sbFetch(path, init = {}) {
      calls.push({ type: 'rpc', path, body: init.body ? JSON.parse(init.body) : null, method: init.method || 'GET' });
      let payload = rpcResult;
      if (path.startsWith('/rest/v1/chats?')) payload = [];
      else if (path === '/rest/v1/chats' && init.method === 'POST') payload = [{ id: 'scheduled-chat-1' }];
      else if (path.startsWith('/rest/v1/messages?')) payload = [];
      return { ok: true, async json() { return payload; }, async text() { return ''; } };
    }
  };
}

test('General scheduled task runs through the shared agent interface and saves an in-app result', async () => {
  const ctx = context();
  await scheduler.processTask(ctx, {
    id: 'task-1', claim_token: 'claim-1', user_id: 'user-1',
    bot: 'general', instruction: 'Prepare my daily summary',
    frequency: 'once', active: true, channel: 'website'
  });
  const agent = ctx.calls.find(x => x.type === 'agent');
  const complete = ctx.calls.find(x => x.path && x.path.endsWith('/complete_scheduled_task_v2'));
  assert.ok(agent);
  assert.equal(agent.args.agentId, 'general');
  assert.equal(agent.args.uid, 'user-1');
  assert.ok(complete);
  assert.equal(complete.body.p_delivery_confirmed, true);
  assert.match(complete.body.p_result, /scheduled result/);
  assert.match(complete.body.p_result, /<!--pelex-scheduled-run:task-1:/);
  assert.match(complete.body.p_result, /<!--pelex-scheduled-chat:scheduled-chat-1-->/);
  assert.equal(complete.body.p_next_run, null);
});

test('unfinished agents are not silently routed to General', async () => {
  const ctx = context();
  await scheduler.processTask(ctx, {
    id: 'task-2', claim_token: 'claim-2', user_id: 'user-1',
    bot: 'business', instruction: 'Review my sales pipeline',
    frequency: 'once', active: true, channel: 'website'
  });
  assert.equal(ctx.calls.some(x => x.type === 'agent'), false);
  const failed = ctx.calls.find(x => x.path && x.path.endsWith('/fail_scheduled_task_v2'));
  assert.ok(failed);
  assert.equal(failed.body.p_max_attempts, 1);
});

test('unknown and retired agent IDs are permanently rejected', async () => {
  for (const bot of ['personal', 'not-an-agent']) {
    const ctx = context();
    await scheduler.processTask(ctx, {
      id: 'task-3', claim_token: 'claim-3', user_id: 'user-1',
      bot, instruction: 'Do not run',
      frequency: 'once', active: true, channel: 'website'
    });
    assert.equal(ctx.calls.some(x => x.type === 'agent'), false);
    const failed = ctx.calls.find(x => x.path && x.path.endsWith('/fail_scheduled_task_v2'));
    assert.ok(failed);
    assert.equal(failed.body.p_max_attempts, 1);
  }
});

test('unsupported external channels are not falsely marked delivered', async () => {
  const ctx = context();
  await scheduler.processTask(ctx, {
    id: 'task-4', claim_token: 'claim-4', user_id: 'user-1',
    bot: 'general', instruction: 'Prepare a report',
    frequency: 'once', active: true, channel: 'whatsapp'
  });
  assert.equal(ctx.calls.some(x => x.type === 'agent'), false);
  assert.equal(ctx.calls.some(x => x.path && x.path.endsWith('/complete_scheduled_task_v2')), false);
  const failed = ctx.calls.find(x => x.path && x.path.endsWith('/fail_scheduled_task_v2'));
  assert.ok(failed);
  assert.equal(failed.body.p_max_attempts, 1);
});


test('stale scheduled chat IDs are replaced instead of causing a messages foreign-key failure', async () => {
  const calls = [];
  const ctx = {
    log() {},
    async sbFetch(path, init = {}) {
      calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
      if (path.includes('/chats?') && path.includes('id=eq.deleted-chat')) {
        return { ok: true, async json() { return []; }, async text() { return ''; } };
      }
      if (path.includes('/chats?') && path.includes('title=eq.')) {
        return { ok: true, async json() { return []; }, async text() { return ''; } };
      }
      if (path === '/rest/v1/chats' && init.method === 'POST') {
        return { ok: true, async json() { return [{ id: 'replacement-chat' }]; }, async text() { return ''; } };
      }
      if (path.startsWith('/rest/v1/messages?')) {
        return { ok: true, async json() { return []; }, async text() { return ''; } };
      }
      return { ok: true, async json() { return []; }, async text() { return ''; } };
    }
  };
  const result = await scheduler.ensureResultChat(ctx, {
    id: 'task-stale', user_id: 'user-1', instruction: 'Prepare a report'
  }, 'A saved report', 'deleted-chat');
  assert.equal(result.chatId, 'replacement-chat');
  const messageWrite = calls.find(x => x.path === '/rest/v1/messages' && x.method === 'POST');
  assert.ok(messageWrite);
  assert.equal(messageWrite.body[0].chat_id, 'replacement-chat');
  assert.equal(calls.some(x => x.path.includes('id=eq.deleted-chat') && x.method === 'GET'), true);
});


test('scheduled report cleanup removes internal markers and infrastructure disclosures', () => {
  const cleaned = scheduler.cleanScheduledReport([
    '# **Netflix Update**',
    '',
    '## **New Releases**',
    '- Confirmed title.',
    '<!--pelex-scheduled-run:secret-->',
    'The request failed because Supabase row-level security blocked it.',
    'Internal link: https://example.supabase.co/rest/v1/private',
    '## **Conclusion**',
    'Check the official catalogue.'
  ].join('\\n'));
  assert.match(cleaned, /# \\*\\*Netflix Update\\*\\*/);
  assert.match(cleaned, /## \\*\\*New Releases\\*\\*/);
  assert.match(cleaned, /## \\*\\*Conclusion\\*\\*/);
  assert.doesNotMatch(cleaned, /pelex-scheduled-run|Supabase|row-level security|supabase\\.co|secret/i);
});

test('scheduled task instructions require bold standalone headings and task-appropriate output', () => {
  const prompt = scheduler.scheduledTaskBrief('Find the latest Netflix releases');
  assert.match(prompt, /## \\*\\*Section heading\\*\\*/);
  assert.match(prompt, /Do not turn every instruction into an essay/);
  assert.match(prompt, /Never mention or reveal internal systems/);
});
