'use strict';

function pdfEscape(value) {
  const cp1252 = { '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159 };
  let s = String(value == null ? '' : value).replace(/[€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—™š›œžŸ]/g, ch => String.fromCharCode(cp1252[ch]));
  s = s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  return Array.from(s, ch => ch.charCodeAt(0) > 255 ? '?' : ch).join('');
}
function wrapLine(line, max = 88) {
  const words = String(line).split(/\s+/);
  const out = [];
  let current = '';
  for (const word of words) {
    if (!word) continue;
    if (current && (current + ' ' + word).length > max) {
      out.push(current);
      current = word;
    } else current = current ? current + ' ' + word : word;
  }
  if (current) out.push(current);
  return out.length ? out : [''];
}
function cleanMarkdownLine(raw) {
  let line = String(raw || '').replace(/\t/g, '    ').trimEnd();
  line = line.replace(/^\s{0,3}#{1,6}\s*/, '');
  line = line.replace(/^\s*[-*+]\s+/, '• ');
  line = line.replace(/^\s*\d+[.)]\s+/, '• ');
  line = line.replace(/^\s*\*{1,3}([A-Za-z][A-Za-z /&-]{0,28}):\*{1,3}\s*/, '$1: ');
  line = line.replace(/^\s*([A-Za-z][A-Za-z /&-]{0,28}):\*{1,3}\s*/, '$1: ');
  line = line.replace(/^\s*(Content|Caption|Voiceover|Hashtags|Platform|Format)\.\*+\s*/i, '$1: ');
  line = line.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');
  line = line.replace(/\*+/g, '');
  return line;
}
function buildPdf(title, content) {
  const lines = [];
  if (title) lines.push(...wrapLine(title, 78), '');
  for (const raw of String(content).replace(/\r/g, '').split('\n')) {
    const line = cleanMarkdownLine(raw);
    if (!line.trim()) lines.push('');
    else {
      const bullet = line.startsWith('• ');
      const wrapped = wrapLine(line, bullet ? 84 : 88);
      if (bullet && wrapped.length > 1) {
        lines.push(wrapped[0]);
        for (let n = 1; n < wrapped.length; n++) lines.push('  ' + wrapped[n]);
      } else lines.push(...wrapped);
    }
  }
  const pages = [];
  for (let i = 0; i < lines.length; i += 48) pages.push(lines.slice(i, i + 48));
  if (!pages.length) pages.push(['']);
  const objects = [];
  const add = value => { objects.push(value); return objects.length; };
  const catalogId = add('');
  const pagesId = add('');
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];
  for (const pageLines of pages) {
    const stream = ['BT', '/F1 10 Tf', '50 790 Td', '13 TL'];
    for (const line of pageLines) stream.push('(' + pdfEscape(line) + ') Tj', 'T*');
    stream.push('ET');
    const data = stream.join('\n');
    const streamId = add('<< /Length ' + Buffer.byteLength(data, 'latin1') + ' >>\nstream\n' + data + '\nendstream');
    const pageId = add('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ' + fontId + ' 0 R >> >> /Contents ' + streamId + ' 0 R >>');
    pageIds.push(pageId);
  }
  objects[catalogId - 1] = '<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>';
  objects[pagesId - 1] = '<< /Type /Pages /Kids [' + pageIds.map(id => id + ' 0 R').join(' ') + '] /Count ' + pageIds.length + ' >>';
  let pdf = '%PDF-1.4\n%PelexPDF\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += (i + 1) + ' 0 obj\n' + objects[i] + '\nendobj\n';
  }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root ' + catalogId + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return Buffer.from(pdf, 'latin1');
}

module.exports = {
  name: 'document_generation',
  description: 'Create a downloadable PDF document from finished text. Use this when the user asks to return edited, corrected, or newly written content as a PDF. Provide the complete final text, a short title, and an optional filename.',
  label: args => 'Creating PDF document',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Document title' },
      content: { type: 'string', description: 'Complete final document text, already edited and ready to export' },
      filename: { type: 'string', description: 'Optional PDF filename, for example corrected-document.pdf' }
    },
    required: ['content']
  },
  run: async (args, ctx) => {
    const content = String(args.content || '').trim();
    if (!content) throw new Error('PDF content is required.');
    if (content.length > 50000) throw new Error('The document is too long for this PDF export.');
    const title = String(args.title || '').trim().slice(0, 140);
    const filename = String(args.filename || 'pelex-edited-document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
    const bytes = buildPdf(title, content);
    const saved = await ctx.saveFile({ name: filename.toLowerCase().endsWith('.pdf') ? filename : filename + '.pdf', mime: 'application/pdf', bytes, folder: 'files' });
    return {
      text: 'The PDF has been generated and saved successfully.',
      markdown: '[Open PDF preview](' + saved.url + ')  ·  [Download PDF](' + saved.downloadUrl + ')'
    };
  }
};
