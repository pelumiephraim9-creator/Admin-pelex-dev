'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const backend = require('../server');

test('Gemini routing retains configured primary and appends free Flash-Lite fallbacks', () => {
  assert.ok(backend.CFG.geminiModels.includes('gemini-3.8-flash'));
  assert.ok(backend.CFG.geminiModels.includes('gemini-3.5-flash-lite'));
  assert.ok(backend.CFG.geminiModels.includes('gemini-3.1-flash-lite'));
  assert.equal(backend.CFG.geminiModels.includes('gemini-2.5-flash-lite'), false);
});
