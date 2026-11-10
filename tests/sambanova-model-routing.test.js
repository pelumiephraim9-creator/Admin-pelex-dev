'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const backend = require('../server');

test('SambaNova model candidates exclude the obsolete Qwen3-32B ID and include supported fallbacks', () => {
  const models = backend.CFG.sambaModels;
  assert.ok(models.includes('DeepSeek-V3.1'));
  assert.ok(models.includes('gpt-oss-120b'));
  assert.ok(models.includes('DeepSeek-V3.2'));
  assert.ok(models.includes('gemma-4-31B-it'));
  assert.equal(models.some(model => model.toLowerCase() === 'qwen3-32b'), false);
});
