'use strict';

// Search and creation are separate. Explicit search language always takes priority.
const SEARCH_VERB = /\b(?:find|look\s+for|look\s+up|show\s+me|fetch|source|locate|browse)\b|\bsearch(?:\s+(?:online\s+)?(?:for\s+)?(?:an?\s+|the\s+)?(?:real\s+|existing\s+)?(?:images?|pictures?|photos?|photographs?))\b/i;
const CREATE_VERB = /\b(?:generate|create|make|draw|design|produce|render|illustrate)\b/i;
const IMAGE_NOUN = /\b(?:images?|pictures?|photos?|photographs?|visuals?|illustrations?|artwork|logos?|posters?|flyers?|banners?|graphics?|wallpapers?|screenshots?)\b/i;
const NEGATED_CREATE = /\b(?:do\s+not|don't|dont|never|without|no)\s+(?:(?:please|just)\s+)?(?:generate|create|make|draw|design|produce|render)\b/i;
const SEARCH_ONLY = /\b(?:existing|real|actual|online|from\s+the\s+web|on\s+the\s+internet|web)\b/i;

function classifyImageIntent(input) {
  const text = String(input || '').trim();
  if (!text) return 'none';
  if (/^\/examples(?:\s|$)/i.test(text)) return 'search';
  if (SEARCH_VERB.test(text) && IMAGE_NOUN.test(text)) return 'search';
  if (NEGATED_CREATE.test(text) && IMAGE_NOUN.test(text)) return 'search';
  if (SEARCH_ONLY.test(text) && IMAGE_NOUN.test(text) && !CREATE_VERB.test(text)) return 'search';
  if (/^\/image(?:\s|$)/i.test(text)) return 'create';
  if (IMAGE_NOUN.test(text) && CREATE_VERB.test(text)) return 'create';
  return 'none';
}

function extractImageSearchQuery(input) {
  let q = String(input || '').trim();
  q = q.replace(/^\/(?:examples|search|find)(?:\s+images?)?\s*/i, '');
  q = q.replace(/^(?:please\s+)?(?:can\s+you\s+)?(?:find|search(?:\s+online)?|look\s+for|look\s+up|show)\s+(?:me\s+)?(?:for\s+)?/i, '');
  q = q.replace(/[,;]\s*(?:please\s+)?(?:do\s+not|don't|dont|never|without|no)\b[\s\S]*$/i, '');
  q = q.replace(/\b(?:existing|real|actual|online|from\s+the\s+web|on\s+the\s+internet|on\s+google|on\s+the\s+web)\b/ig, ' ');
  q = q.replace(/\b(?:do\s+not|don't|dont|never|without|no)\s+(?:(?:please|just)\s+)?(?:generate|create|make|draw|design|produce|render)\b[\s\S]*$/ig, ' ');
  q = q.replace(/\b(?:an?|the)\s+(?=(?:image|picture|photo|photograph|visual|illustration)\b)/ig, ' ');
  q = q.replace(/\b(?:image|images|picture|pictures|photo|photos|photograph|photographs|visual|visuals)\b/ig, ' ');
  q = q.replace(/[,:;.!?]+/g, ' ').replace(/\s+/g, ' ').trim();
  q = q.replace(/^(?:(?:me|an?|the|of|for|about|showing|at)\s+)+/i, '').trim();
  q = q.replace(/^(?:the|a|an)\s+/i, '').trim();
  return q.slice(0, 180);
}

module.exports = { classifyImageIntent, extractImageSearchQuery };
