'use strict';

/**
 * Server-side agent registry.
 * `gmail` is the UI/command name; `mailbot` is the canonical database agent_id.
 * Readiness is deliberately conservative: environment flags alone cannot make
 * an unimplemented agent ready.
 */
const DEFINITIONS = {
  general: {
    id: 'general', uiId: 'general', label: 'General Agent',
    implemented: true, requiresAuth: false,
    tools: ['web_search', 'tavily_search', 'find_images', 'image_generate', 'calculator', 'document_generation']
  },
  business: {
    id: 'business', uiId: 'business', label: 'Business Agent',
    implemented: false, requiresAuth: true,
    tools: ['business_knowledge', 'lead_capture', 'calendar_read', 'meeting_request', 'document_generation']
  },
  pitch: {
    id: 'pitch', uiId: 'pitch', label: 'Pitch Agent',
    implemented: false, requiresAuth: true,
    tools: ['remote_jobs', 'pitch_link_check', 'resume_read', 'application_draft']
  },
  mailbot: {
    id: 'mailbot', uiId: 'gmail', label: 'Mailbot Agent',
    implemented: false, requiresAuth: true,
    tools: ['gmail_read', 'gmail_draft', 'gmail_send']
  }
};

// Agent modules are discovered from agents/*.js. A module is activated only when
// it exports an explicit implemented:true flag and non-empty instructions.
function loadAgentModules() {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, 'agents');
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.js')).sort()) {
    try {
      const mod = require(path.join(dir, file));
      const id = String(mod && mod.id || '').trim().toLowerCase();
      if (!['business', 'pitch', 'mailbot'].includes(id)) {
        console.warn('[agents] skipped', file, '- unsupported agent id');
        continue;
      }
      if (!mod || typeof mod.label !== 'string' || typeof mod.instructions !== 'string' || !mod.instructions.trim()) {
        console.warn('[agents] skipped', file, '- export id, label and non-empty instructions');
        continue;
      }
      DEFINITIONS[id] = {
        ...DEFINITIONS[id],
        label: mod.label,
        implemented: mod.implemented === true,
        instructions: mod.instructions.trim(),
        tools: Array.isArray(mod.tools) ? mod.tools.filter(x => typeof x === 'string') : DEFINITIONS[id].tools
      };
      console.log('[agents] loaded module:', id, 'ready:', DEFINITIONS[id].implemented);
    } catch (e) {
      console.warn('[agents] skipped', file, '-', e.message);
    }
  }
}
loadAgentModules();

function canonicalAgentId(value) {
  const id = String(value || 'general').trim().toLowerCase();
  if (id === 'gmail' || id === 'mail') return 'mailbot';
  return id;
}
function getAgent(value) { return DEFINITIONS[canonicalAgentId(value)]; }
function listAgents() {
  return Object.values(DEFINITIONS).map(a => ({
    id: a.uiId, label: a.label,
    ready: !!a.implemented
  }));
}
function isToolAllowed(agentId, toolName) {
  const a = getAgent(agentId);
  return !!(a && a.implemented && a.tools.includes(String(toolName || '')));
}
module.exports = { DEFINITIONS, canonicalAgentId, getAgent, listAgents, isToolAllowed };
