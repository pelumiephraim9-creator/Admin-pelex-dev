'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const tool = require('../tools/document_generation');

test('document_generation creates and stores a valid PDF attachment', async () => {
  let saved = null;
  const result = await tool.run({
    title: 'Corrected caption',
    content: 'The corrected caption is ready.\\nA second line is included.',
    filename: 'corrected-caption.pdf'
  }, {
    saveFile: async input => { saved = input; return { url: 'https://example.test/preview', downloadUrl: 'https://example.test/download' }; }
  });
  assert.ok(saved);
  assert.equal(saved.mime, 'application/pdf');
  assert.equal(saved.name, 'corrected-caption.pdf');
  assert.equal(saved.bytes.subarray(0, 8).toString('ascii'), '%PDF-1.4');
  assert.ok(saved.bytes.toString('ascii').includes('startxref'));
  assert.match(result.markdown, /\[Download corrected-caption\.pdf\]\(https:\/\/example\.test\/download\)/);
  assert.match(result.markdown, /\[Preview corrected-caption\.pdf\]\(https:\/\/example\.test\/preview\)/);
  assert.doesNotMatch(result.markdown, /Open PDF preview|Download PDF/);
});

test('document_generation rejects empty content', async () => {
  await assert.rejects(() => tool.run({ content: '  ' }, { saveFile: async () => { throw new Error('should not save'); } }), /content is required/i);
});
