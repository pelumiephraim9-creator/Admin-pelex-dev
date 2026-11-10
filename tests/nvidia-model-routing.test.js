'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function inspectWithEnv(extraEnv) {
  const script = `
    const backend = require(process.env.PELEX_TEST_SERVER_PATH);
    const pick = task => backend.chain(task, 'public').filter(p => p.id === 'nvidia').map(p => ({ id: p.id, name: p.name, url: p.url }));
    console.log(JSON.stringify({ configured: !!backend.CFG.nvidiaKey, base: backend.CFG.nvidiaBase, models: backend.CFG.nvidiaModels, general: pick('general'), coding: pick('coding'), data: pick('data'), vision: pick('vision') }));
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv, PELEX_TEST_SERVER_PATH: path.join(__dirname, '..', 'server.js') }
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split('\\n').at(-1));
}

test('NVIDIA models are added to general, coding and data routes but not vision', () => {
  const result = inspectWithEnv({ NVIDIA_API_KEY: 'test-nvidia-key', NVIDIA_BASE: 'https://integrate.api.nvidia.com/v1/', NVIDIA_MODELS: 'poolside/laguna-xs-2.1,minimaxai/minimax-m3.1-flash' });
  assert.equal(result.configured, true);
  assert.equal(result.base, 'https://integrate.api.nvidia.com/v1');
  assert.deepEqual(result.models, ['poolside/laguna-xs-2.1', 'minimaxai/minimax-m3.1-flash']);
  for (const task of ['general', 'coding', 'data']) {
    assert.deepEqual(result[task].map(model => model.name), ['nvidia:poolside/laguna-xs-2.1', 'nvidia:minimaxai/minimax-m3.1-flash']);
    assert.ok(result[task].every(model => model.url === 'https://integrate.api.nvidia.com/v1/chat/completions'));
  }
  assert.deepEqual(result.vision, []);
});

test('NVIDIA is skipped when no API key is configured', () => {
  const result = inspectWithEnv({ NVIDIA_API_KEY: '', NVIDIA_BASE: 'https://integrate.api.nvidia.com/v1', NVIDIA_MODELS: 'poolside/laguna-xs-2.1' });
  assert.equal(result.configured, false);
  assert.deepEqual(result.general, []);
  assert.deepEqual(result.coding, []);
  assert.deepEqual(result.data, []);
});
