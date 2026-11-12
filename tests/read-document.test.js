'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const reader = require('../tools/read_document');
const zlib = require('node:zlib');

function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, source] of Object.entries(files)) {
    const filename = Buffer.from(name);
    const raw = Buffer.from(source);
    const packed = zlib.deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, filename);
    offset += local.length + filename.length + packed.length;
  }
  const centralSize = centrals.reduce((n, part) => n + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

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
    const result = JSON.parse(await reader.run({ prompt: 'File name: quarterly-report.txt' }, context(dataUrl('text/plain', 'Quarterly report\nRevenue: NGN 500,000'))));
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
    const csv = JSON.parse(await reader.run({ prompt: 'File name: sales.csv' }, context(dataUrl('text/csv', 'Date,Amount\n2026-11-01,1500'))));
    assert.match(csv.text, /2026-11-01,1500/);
    assert.deepEqual(csv.rows, []);
    const json = JSON.parse(await reader.run({ prompt: 'File name: sales.json' }, context(dataUrl('application/json', '{"sales":12}'))));
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
    assert.match(pdf.error, /No document vision provider is configured/);
  } finally {
    if (old !== undefined) process.env.GEMINI_API_KEY = old;
  }
});

test('locally supported documents bypass Gemini even when a key is configured', async () => {
  const oldKey = process.env.GEMINI_API_KEY;
  const oldFetch = global.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  global.fetch = async () => { throw new Error('Gemini must not be called for local extraction'); };
  try {
    const result = JSON.parse(await reader.run(
      { prompt: 'File name: sales.csv' },
      context(dataUrl('text/csv', 'Date,Item,Amount\\n2026-11-12,Inventory,4500'))
    ));
    assert.match(result.text, /Inventory,4500/);
    assert.match(result.summary, /No AI model was used/);
    assert.deepEqual(result.rows, []);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
  }
});

test('DOCX files are unpacked and their paragraph text is extracted locally', async () => {
  const old = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const docx = makeZip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Board meeting report</w:t></w:r></w:p><w:p><w:r><w:t>Net sales: 250000</w:t></w:r></w:p></w:body></w:document>'
    });
    const result = JSON.parse(await reader.run({ prompt: 'File name: board-report.docx' }, context('data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,' + docx.toString('base64'))));
    assert.match(result.text, /Board meeting report/);
    assert.match(result.text, /Net sales: 250000/);
    assert.deepEqual(result.rows, []);
  } finally {
    if (old !== undefined) process.env.GEMINI_API_KEY = old;
  }
});

test('XLSX extraction preserves worksheet names and row structure', async () => {
  const old = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const xlsx = makeZip({
      'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>Date</t></si><si><t>Amount</t></si><si><t>2026-11-01</t></si>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1500</v></c></row></sheetData></worksheet>'
    });
    const result = JSON.parse(await reader.run({ prompt: 'File name: monthly-sales.xlsx' }, context('data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + xlsx.toString('base64'))));
    assert.match(result.text, /WORKSHEET: Sales/);
    assert.match(result.text, /Date\tAmount/);
    assert.match(result.text, /2026-11-01\t1500/);
  } finally {
    if (old !== undefined) process.env.GEMINI_API_KEY = old;
  }
});

test('PPTX and ODS files expose slide text and spreadsheet cell structure', async () => {
  const old = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const pptx = makeZip({
      'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Quarterly outlook</a:t></a:r></a:p></p:sld>'
    });
    const slides = JSON.parse(await reader.run({ prompt: 'File name: outlook.pptx' }, context('data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,' + pptx.toString('base64'))));
    assert.match(slides.text, /SLIDE 1/);
    assert.match(slides.text, /Quarterly outlook/);

    const ods = makeZip({
      'content.xml': '<office:document-content><office:body><office:spreadsheet><table:table table:name="Ledger"><table:table-row><table:table-cell><text:p>Date</text:p></table:table-cell><table:table-cell><text:p>Amount</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>2026-11-01</text:p></table:table-cell><table:table-cell office:value="1500"><text:p>1500</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>'
    });
    const sheet = JSON.parse(await reader.run({ prompt: 'File name: ledger.ods' }, context('data:application/vnd.oasis.opendocument.spreadsheet;base64,' + ods.toString('base64'))));
    assert.match(sheet.text, /WORKSHEET: Ledger/);
    assert.match(sheet.text, /Date\tAmount/);
    assert.match(sheet.text, /2026-11-01\t1500/);
  } finally {
    if (old !== undefined) process.env.GEMINI_API_KEY = old;
  }
});


test('PDF vision retries another configured provider after a temporary 503', async () => {
  const old = {
    gemini: process.env.GEMINI_API_KEY, groq: process.env.GROQ_API_KEY,
    groqVision: process.env.GROQ_VISION_MODEL, openrouter: process.env.OPENROUTER_API_KEY,
    openrouterVision: process.env.OPENROUTER_VISION_MODELS, fetch: global.fetch
  };
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.GROQ_API_KEY = 'test-groq-key';
  process.env.GROQ_VISION_MODEL = 'test-vision-model';
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_VISION_MODELS;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url).includes('api.groq.com')) {
      return { ok: false, status: 503, text: async () => 'temporary high demand' };
    }
    return {
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        document_type: 'receipt', currency: 'NGN', summary: 'Test receipt read successfully',
        text: 'Total NGN 4500', rows: [{ date: '2026-11-12', type: 'receipt', party: 'Test Shop', amount: 4500, currency: 'NGN' }],
        notes: 'Test fallback'
      }) }] } }] })
    };
  };
  try {
    const result = JSON.parse(await reader.run(
      { prompt: 'File name: test-slip.pdf' },
      context('data:application/pdf;base64,' + Buffer.from('%PDF-1.4 test').toString('base64'))
    ));
    assert.equal(result.document_type, 'receipt');
    assert.equal(result.rows[0].amount, 4500);
    assert.match(result.source.analysis_provider, /Gemini/);
    assert.ok(calls.length >= 2);
    assert.match(calls[0], /api.groq.com/);
    assert.ok(calls.some(url => /generativelanguage.googleapis.com/.test(url)));
  } finally {
    global.fetch = old.fetch;
    for (const [key, value] of Object.entries({ GEMINI_API_KEY: old.gemini, GROQ_API_KEY: old.groq, GROQ_VISION_MODEL: old.groqVision, OPENROUTER_API_KEY: old.openrouter, OPENROUTER_VISION_MODELS: old.openrouterVision })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
