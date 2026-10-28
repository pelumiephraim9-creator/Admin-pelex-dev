'use strict';
module.exports = {
  name: 'base64_text',
  description: 'Encode text to base64 or decode base64 back to text (not for files).',
  parameters: { type: 'object', properties: { action: { type: 'string', enum: ['encode', 'decode'] }, text: { type: 'string' } }, required: ['action', 'text'] },
  label: a => (a.action === 'decode' ? 'Decoding base64' : 'Encoding to base64'),
  run: async ({ action, text }) => {
    const t = String(text || ''); if (!t) throw new Error('Give me some text.'); if (t.length > 20000) throw new Error('That is too long.');
    if (action === 'decode') {
      const c = t.replace(/\s+/g, ''); if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(c)) throw new Error('That is not valid base64.');
      const out = Buffer.from(c.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); const s = out.toString('utf8');
      if (s.includes('\uFFFD')) throw new Error('That base64 is not plain text (it may be a file).');
      return s;
    }
    return Buffer.from(t, 'utf8').toString('base64');
  },
};
