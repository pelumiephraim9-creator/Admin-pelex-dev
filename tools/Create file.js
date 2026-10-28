'use strict';
// Turns text into a downloadable file: .txt, .md, .json, .csv, .html and more. Also writes small base64 data to a real file.
const TYPES = { txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv', tsv: 'text/tab-separated-values', html: 'text/html', xml: 'application/xml', yml: 'text/yaml', log: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf' };
const BIN = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf']);

module.exports = {
  name: 'create_file',
  description: 'Create a downloadable file from text the person gave or you wrote (txt, md, json, csv, tsv, html, xml, yml, log). For small base64 data of an image or PDF, set encoding to base64 and use the png, jpg, gif, webp or pdf extension. Use for "save this as a file", "convert this JSON to a text file", "turn this base64 into a picture".',
  parameters: { type: 'object', properties: { filename: { type: 'string', description: 'For example notes.txt' }, content: { type: 'string' }, encoding: { type: 'string', enum: ['utf8', 'base64'] } }, required: ['filename', 'content'] },
  label: a => 'Creating file ' + String(a.filename || '').slice(0, 40),
  run: async ({ filename, content, encoding }, ctx) => {
    const name = String(filename || '').trim();
    const m = name.match(/^[A-Za-z0-9][A-Za-z0-9 _\-.]{0,60}\.([A-Za-z0-9]{2,5})$/); if (!m) throw new Error('Use a simple file name with an extension, for example notes.txt.');
    const ext = m[1].toLowerCase(); if (!TYPES[ext]) throw new Error('That file type is not supported. Supported: ' + Object.keys(TYPES).join(', ') + '.');
    let bytes;
    if (encoding === 'base64') {
      if (!BIN.has(ext)) throw new Error('Base64 is only for png, jpg, gif, webp and pdf files.');
      const b64 = String(content || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new Error('That is not valid base64.');
      bytes = Buffer.from(b64, 'base64');
      const sig = bytes.subarray(0, 8).toString('hex');
      const ok = { png: sig.startsWith('89504e47'), jpg: sig.startsWith('ffd8ff'), jpeg: sig.startsWith('ffd8ff'), gif: sig.startsWith('47494638'), webp: bytes.subarray(0, 4).toString() === 'RIFF', pdf: bytes.subarray(0, 4).toString() === '%PDF' }[ext];
      if (!ok) throw new Error('The data does not look like a real ' + ext + ' file.');
    } else {
      if (BIN.has(ext)) throw new Error('Use encoding base64 for ' + ext + ' files.');
      const text = String(content == null ? '' : content); if (!text) throw new Error('The file would be empty.');
      if (text.length > 1000000) throw new Error('The text is too long for one file.');
      bytes = Buffer.from(text, 'utf8');
    }
    const f = await ctx.saveFile({ name, mime: TYPES[ext], bytes, folder: 'files' });
    const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
    const md = (isImg ? `![${name}](${f.url})\n` : '') + `[Download ${name}](${f.downloadUrl})`;
    return { text: `File "${name}" created (${bytes.length} bytes), kept for 2 days. The download link is shown to the person automatically.`, markdown: md };
  },
};
