'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const backend = require('../server');

test('SambaNova configuration excludes the obsolete Qwen3-32B model ID', () => {
  const models = backend.CFG.sambaModels;
  assert.ok(models.includes('Meta-Llama-3.3-70B-Instruct'));
  assert.equal(models.some(model => model.toLowerCase() === 'qwen3-32b'), false);
});
