'use strict';

// Image search and image creation are separate intents. Search language wins,
// including explicit negation of creation ("find a photo, don't create one").
const SEARCH_VERB = /\b(?:find|search(?:\s+for)?|look\s+for|look\s+up|show\s+me|fetch|source|locate|browse(?:\s+for)?)\b/i;
const CREATE_VERB = /\b(?:generate|create|make|draw|design|produce|render|illustrate)\b/i;
const IMAGE_NOUN = /\b(?:images?|pictures?|photos?|photographs?|visuals?|illustrations?|artwork|logos?|posters?|flyers?|banners?|graphics?|wallpapers?|screenshots?)\b/i;
const NEGATED_CREATE = /\b(?:do\s+not|don't|dont|never|without|no)\s+(?:(?:please|just)\s+)?(?:generate|create|make|draw|design|produce|render)\b/i;
const SEARCH_ONLY = /\b(?:existing|real|actual|online|from\s+the\s+web|on\s+the\s+internet|web)\b/i;

function classifyImageIntent(input) {
  const text = String(input || '').trim();
  if (!text) return 'none';
  if (SEARCH_VERB.test(text) && IMAGE_NOUN.test(text)) return 'search';
  if (SEARCH_ONLY.test(text) && IMAGE_NOUN.test(text) && !CREATE_VERB.test(text)) return 'search';
  if (NEGATED_CREATE.test(text) && (IMAGE_NOUN.test(text) || /\bimage\b/i.test(text))) return 'search';
  if (/^\/examples(?:\s|$)/i.test(text)) return 'search';
  if (/^\/image(?:\s|$)/i.test(text)) return 'create';
  if (IMAGE_NOUN.test(text) && CREATE_VERB.test(text)) return 'create';
  return 'none';
}

function extractImageSearchQuery(input) {
  let q = String(input || '').trim();
  q = q.replace(/^\/(?:examples|search|find)(?:\s+images?)?\s*/i, '');
  q = q.replace(/\b(?:please\s+)?(?:find|search(?:\s+for)?|look\s+for|look\s+up|show\s+me|fetch|source|locate|browse(?:\s+for)?)\b/ig, ' ');
  q = q.replace(/\b(?:existing|real|actual|online|from\s+the\s+web|on\s+the\s+internet|on\s+google|on\s+the\s+web)\b/ig, ' ');
  q = q.replace(/\b(?:do\s+not|don't|dont|never|without|no)\s+(?:(?:please|just)\s+)?(?:generate|create|make|draw|design|produce|render)\b/ig, ' ');
  q = q.replace(/\b(?:generate|create|make|draw|design|produce|render)\b/ig, ' ');
  q = q.replace(/\b(?:an?|the)\s+(?=(?:image|picture|photo|photograph|visual|illustration)\b)/ig, ' ');
  q = q.replace(/\b(?:image|images|picture|pictures|photo|photos|photograph|photographs|visual|visuals)\b/ig, ' ');
  q = q.replace(/\b(?:for\s+me|please|instead|not\s+create|do\s+not\s+create|don't\s+create|dont\s+create)\b/ig, ' ');
  q = q.replace(/[,:;.!?]+/g, ' ').replace(/\s+/g, ' ').trim();
  return q.slice(0, 180);
}

module.exports = { classifyImageIntent, extractImageSearchQuery };
