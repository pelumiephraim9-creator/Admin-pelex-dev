'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const catalogue = require('../tools/spotlight_catalog');

function ctx() {
  return { withTimeout(ms) { const controller = new AbortController(); return { signal: controller.signal, done() {} }; }, log() {} };
}
test('Spotlight catalogue hides providers without credentials or configured instances', async () => {
  const saved = {};
  for (const key of ['YOUTUBE_API_KEY','VIMEO_ACCESS_TOKEN','PEXELS_API_KEY','PIXABAY_API_KEY','DAILYMOTION_API_KEY','DAILYMOTION_API_SECRET','PEERTUBE_INSTANCES']) {
    saved[key] = process.env[key]; delete process.env[key];
  }
  const oldFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ response: { docs: [], numFound: 0 } }); } });
  try {
    const out = JSON.parse(await catalogue.run({ action: 'providers' }, ctx()));
    assert.deepEqual(out.providers.map(p => p.id), ['internet_archive']);
  } finally {
    global.fetch = oldFetch;
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
test('Spotlight rejects unknown or unconfigured providers without leaking provider errors', async () => {
  const unknown = JSON.parse(await catalogue.run({ action: 'search', provider: 'unknown', query: 'nature' }, ctx()));
  assert.equal(unknown.unavailable, true);
  const unconfigured = JSON.parse(await catalogue.run({ action: 'search', provider: 'vimeo', query: 'nature' }, ctx()));
  assert.equal(unconfigured.unavailable, true);
});
test('Internet Archive search returns metadata and official watch/embed links without downloading media', async () => {
  const oldFetch = global.fetch;
  global.fetch = async url => {
    assert.match(String(url), /^https:\/\/archive\.org\/advancedsearch\.php/);
    return { ok: true, status: 200, async text() { return JSON.stringify({ response: { numFound: 1, docs: [{ identifier: 'sample-film', title: 'Sample Film', creator: 'Archive Creator', date: '2024' }] } }); } };
  };
  try {
    const out = JSON.parse(await catalogue.run({ action: 'search', provider: 'internet_archive', query: 'sample film' }, ctx()));
    assert.equal(out.videos.length, 1);
    assert.equal(out.videos[0].id, 'sample-film');
    assert.equal(out.videos[0].url, 'https://archive.org/details/sample-film');
    assert.equal(out.videos[0].embedUrl, 'https://archive.org/embed/sample-film');
    assert.equal(out.videos[0].playback.controls, false);
  } finally { global.fetch = oldFetch; }
});
