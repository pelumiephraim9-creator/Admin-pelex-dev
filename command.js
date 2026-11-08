'use strict';
/* PELEX COMMANDS (wrapper)
   Adds /general to the command set and keeps every other command from command.js exactly as it is.
   The server loads this file first, so it is the one that answers. */

const base = require('./command.js');

const GENERAL_COMMAND = {
  name: 'general',
  aliases: ['chat', 'ask'],
  agent: 'general',
  category: 'Basics',
  description: 'Ask the General Agent directly',
  usage: '/general <message>',
  example: '/general what is a savings box loan?',
  implemented: true,
  args: 'optional'
};

function resolve(text) {
  const m = /^\/general(?:\s+([\s\S]*))?$/i.exec(String(text || '').trim());
  if (m) {
    const rest = (m[1] || '').trim();
    if (!rest) {
      return {
        immediate: 'Type your message after /general, for example: `/general what is a savings box loan?`',
        command: { name: 'general', status: 'needs_input', agent: 'general' }
      };
    }
    return { run: { text: rest, task: null, name: 'general' }, command: { name: 'general', status: 'ok', agent: 'general' } };
  }
  return base.resolve(text);
}

function list(agent) {
  const out = base.list(agent);
  if (!agent || agent === 'general') {
    out.commands = [GENERAL_COMMAND].concat(out.commands || []);
    out.count = (out.count || 0) + 1;
  }
  return out;
}

module.exports = Object.assign({}, base, {
  resolve,
  list,
  count: (base.count || 0) + 1
});
