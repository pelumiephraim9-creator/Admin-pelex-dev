'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const reader = require('../tools/read_document');

function dataUrl(mime, text) {
  return 'data:' + mime + ';base64,' + Buffer.from(text).toString('base64');
}
function context(value) {
  return { images: [value] };
}

test('text documents are extracted locally without saving or importing ledger rows', async () => {
  const old = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const result = JSON.parse(await reader.run({}, context(dataUrl('text/plain', 'Quarterly report\nRevenue: NGN 500,000'))));
    assert.equal(result.document_type, 'txt');
    assert.match(result.text, /Quarterly report/);
    assert.deepEqual(result.rows, []);
    assert.match(result.summary, /Text extracted locally/);
  } finally {
    if (old !== undefined) process.env.GEMINI_API_KEY = old;
  }
});

test('CSV and JSON files are read as document content without automatic imports', async () => {
  const old = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const csv = JSON.parse(await reader.run({}, context(dataUrl('text/csv', 'Date,Amount\n2026-11-01,1500'))));
    assert.match(csv.text, /2026-11-01,1500/);
    assert.deepEqual(csv.rows, []);
    const json = JSON.parse(await reader.run({}, context(dataUrl('application/json', '{"sales":12}'))));
    assert.match(json.text, /"sales":12/);
    assert.deepEqual(json.rows, []);
  } finally {
    if (old !== undefined) process.env.GEMINI_API_KEY = old;
  }
});

test('unsupported legacy binary Office formats return a clear conversion instruction', async () => {
  const old = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const result = JSON.parse(await reader.run({ prompt: 'File name: accounts.xls' }, context(dataUrl('application/octet-stream', 'binary'))));
    assert.match(result.error, /Legacy Office files/);
    assert.deepEqual(result.rows, []);
  } finally {
    if (old !== undefined) process.env.GEMINI_API_KEY = old;
  }
});

test('PDF and image reading fail clearly when the vision API key is unavailable', async () => {
  const old = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const pdf = JSON.parse(await reader.run({ prompt: 'File name: report.pdf' }, context(dataUrl('application/pdf', '%PDF-1.4'))));
    assert.match(pdf.error, /GEMINI_API_KEY/);
  } finally {
    if (old !== undefined) process.env.GEMINI_API_KEY = old;
  }
});
