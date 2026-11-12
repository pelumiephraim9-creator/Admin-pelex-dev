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
    assert.match(result.summary, /Content extracted locally/);
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

test('digital PDFs are extracted locally without any vision API key', async () => {
  const oldFetch = global.fetch;
  const oldKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  global.fetch = async () => { throw new Error('No external AI or vision API may be called'); };
  try {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 40, compress: false, autoFirstPage: true });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    const completed = new Promise((resolve, reject) => {
      doc.on('end', resolve);
      doc.on('error', reject);
    });
    doc.font('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf').fontSize(16).text('LOCAL PDF TEST TOTAL 4500', 40, 80, { lineBreak: false });
    doc.end();
    await completed;
    const pdf = Buffer.concat(chunks);
    const result = JSON.parse(await reader.run(
      { prompt: 'File name: test.pdf' },
      context('data:application/pdf;base64,' + pdf.toString('base64'))
    ));
    assert.match(result.text, /LOCAL PDF TEST TOTAL 4500/);
    assert.match(result.summary, /No AI model/);
    assert.equal(result.source.extraction_method, 'local PDF text extraction');
    assert.deepEqual(result.rows, []);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
  }
});

test('image OCR uses the local OCR path and never calls a vision provider', async () => {
  const oldFetch = global.fetch;
  global.fetch = async () => { throw new Error('No external vision API may be called'); };
  try {
    const png = Buffer.from('local-image-fixture');
    const result = JSON.parse(await reader.run(
      { prompt: 'File name: receipt.png' },
      { images: ['data:image/png;base64,' + png.toString('base64')], localOcr: async () => 'RECEIPT TOTAL NGN 4500' }
    ));
    assert.match(result.text, /RECEIPT TOTAL NGN 4500/);
    assert.equal(result.source.extraction_method, 'local image OCR');
    assert.match(result.summary, /No AI model/);
    assert.deepEqual(result.rows, []);
  } finally { global.fetch = oldFetch; }
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
    assert.match(result.summary, /No AI model/);
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


test('scanned PDF pages are passed to local OCR without an AI provider', async () => {
  const oldFetch = global.fetch;
  global.fetch = async () => { throw new Error('AI provider must not be called'); };
  try {
    const result = JSON.parse(await reader.run(
      { prompt: 'File name: scanned-slip.pdf' },
      { images: ['data:application/pdf;base64,' + Buffer.from('%PDF-1.4').toString('base64')], localOcr: async () => 'SCANNED RECEIPT TOTAL NGN 7500' }
    ));
    assert.match(result.error, /Invalid PDF|Invalid PDF structure|The PDF file is empty|Invalid PDF/);
  } finally { global.fetch = oldFetch; }
});

test('image OCR uses local OCR and never calls a vision provider', async () => {
  const oldFetch = global.fetch;
  global.fetch = async () => { throw new Error('No external vision API may be called'); };
  try {
    const result = JSON.parse(await reader.run(
      { prompt: 'File name: receipt.png' },
      { images: ['data:image/png;base64,' + Buffer.from('image fixture').toString('base64')], localOcr: async () => 'RECEIPT TOTAL NGN 4500' }
    ));
    assert.match(result.text, /RECEIPT TOTAL NGN 4500/);
    assert.equal(result.source.extraction_method, 'local image OCR');
    assert.match(result.summary, /No AI model/);
    assert.deepEqual(result.rows, []);
  } finally { global.fetch = oldFetch; }
});
