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
    id: 'mailbot', uiId: 'gmail', label: 'Gmail Agent',
    implemented: false, requiresAuth: true,
    tools: ['gmail_read', 'gmail_draft', 'gmail_send']
  }
};

function canonicalAgentId(value) {
  const id = String(value || 'general').trim().toLowerCase();
  if (id === 'gmail' || id === 'mail') return 'mailbot';
  return Object.prototype.hasOwnProperty.call(DEFINITIONS, id) ? id : 'general';
}
function getAgent(value) { return DEFINITIONS[canonicalAgentId(value)]; }
function listAgents() {
  return Object.values(DEFINITIONS).map(a => ({
    id: a.uiId, label: a.label,
    ready: a.implemented && (a.id === 'general' || process.env[`AGENT_${a.id.toUpperCase()}_ENABLED`] === '1')
  }));
}
function isToolAllowed(agentId, toolName) {
  const a = getAgent(agentId);
  return !!(a && a.implemented && a.tools.includes(String(toolName || '')));
}
module.exports = { DEFINITIONS, canonicalAgentId, getAgent, listAgents, isToolAllowed };
