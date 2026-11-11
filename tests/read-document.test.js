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
    assert.match(pdf.error, /GEMINI_API_KEY/);
  } finally {
    if (old !== undefined) process.env.GEMINI_API_KEY = old;
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
