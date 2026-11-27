'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyImageIntent, extractImageSearchQuery } = require('../image-intent');

test('search request routes to online image search, not generation', () => {
  const samples = [
    'Find an image of Eko Hotel Lagos',
    'Search for photos of Zuma Rock',
    'Show me real pictures of Victoria Island online',
    "Find me a picture of the book, don't create it",
    'Look for existing images of the Lekki-Ikoyi Bridge'
  ];
  for (const sample of samples) assert.equal(classifyImageIntent(sample), 'search', sample);
});

test('creation request remains distinct from image search', () => {
  for (const sample of ['Create an image of a blue car', 'Generate a poster for my brand', '/image a photorealistic beach']) {
    assert.equal(classifyImageIntent(sample), 'create', sample);
  }
});

test('ordinary text is not classified as an image request', () => {
  for (const sample of ['What is image recognition?', 'Tell me how image search works', 'Good morning']) {
    assert.equal(classifyImageIntent(sample), 'none', sample);
  }
});

test('search query extraction removes intent wording but keeps the subject', () => {
  assert.equal(extractImageSearchQuery("Find me real pictures of Eko Hotel Lagos, don't create it"), 'Eko Hotel Lagos');
  assert.equal(extractImageSearchQuery('Search online for photos of Zuma Rock'), 'Zuma Rock');
});
