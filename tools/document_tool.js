'use strict';

const MIME = {
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  html: 'text/html; charset=utf-8'
};

module.exports = {
  name: 'document_tool',
  description: 'Create a real downloadable text, Markdown, JSON, CSV, or standalone HTML document. Use this for substantial written deliverables when a supported format is appropriate. Files are saved through the shared Pelex file storage and returned with a time-limited download link.',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'Filename without extension, for example business-proposal' },
      content: { type: 'string', description: 'Complete document content. For HTML, provide a complete standalone HTML document with embedded CSS.' },
      format: { type: 'string', enum: ['txt', 'md', 'json', 'csv', 'html'] }
    },
    required: ['filename', 'content', 'format']
  },
  label: a => 'Preparing ' + String(a.filename || 'document').slice(0, 50),
  async run(a, ctx) {
    const format = String(a.format || '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(MIME, format)) throw new Error('Unsupported format. Choose TXT, Markdown, JSON, CSV, or HTML.');
    const filename = String(a.filename || '').trim().replace(/\\.[^.]+$/, '');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(filename)) throw new Error('Use a filename with letters, numbers, dots, underscores, or hyphens.');
    let content = String(a.content == null ? '' : a.content);
    if (!content.trim()) throw new Error('The document content is empty.');
    if (Buffer.byteLength(content, 'utf8') > 6 * 1024 * 1024) throw new Error('The document is too large (6 MB maximum).');
    if (format === 'json') {
      try { content = JSON.stringify(JSON.parse(content), null, 2); }
      catch { throw new Error('The content must be valid JSON.'); }
    }
    const name = filename + '.' + format;
    const file = await ctx.saveFile({ name, mime: MIME[format], bytes: Buffer.from(content, 'utf8'), folder: 'files' });
    return {
      text: 'Created ' + name + ' (' + Buffer.byteLength(content, 'utf8') + ' bytes). The secure download link is ready for the user and expires after 48 hours.',
      markdown: '[Download ' + name + '](' + file.downloadUrl + ')'
    };
  }
};
