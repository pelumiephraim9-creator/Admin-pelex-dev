'use strict';
// Reads an invoice, receipt or sales sheet from a picture the person attached, and returns its rows as JSON for review.
// Used only when the request intent is "extract". Nothing is saved here: the app shows the rows and the person confirms them.
const E = process.env;
const clip = (v, n) => String(v || '').slice(0, n);
const MAGIC = b => b.length > 12 && ((b[0] === 0x89 && b[1] === 0x50) ? 'image/png' : (b[0] === 0xff && b[1] === 0xd8) ? 'image/jpeg' : (b.slice(0, 4).toString() === 'RIFF') ? 'image/webp' : (b.slice(0, 4).toString() === '%PDF') ? 'application/pdf' : null);
const INSTRUCTION = `You read business documents (invoices, receipts, sales sheets) from the picture.
Return ONLY a JSON object, no prose, in this exact shape:
{"document_type":"invoice|receipt|sales|expense|other","currency":"ISO code such as NGN, USD, GBP or null if not shown","rows":[{"date":"YYYY-MM-DD","type":"invoice|receipt|sale|expense|payment|other","party":"customer or vendor name","amount":number,"currency":"ISO code or null","due":"YYYY-MM-DD or null"}],"notes":"anything unclear"}
Rules: one row per line item or invoice total shown. Use numbers without thousands separators. If a date or amount is unreadable, leave that row out and mention it in notes. Never invent values.`;

module.exports = {
  name: 'read_document',
  description: 'Read an attached invoice, receipt or sales sheet picture and return its rows as JSON for the person to review. Used for intent "extract".',
  parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Any note from the person about the document' } }, required: [] },
  label: () => 'Reading the document',
  run: async (args, ctx) => {
    if (!E.GEMINI_API_KEY) throw new Error('Reading documents needs GEMINI_API_KEY in Render.');
    const pics = (Array.isArray(ctx.images) ? ctx.images : []).map(u => /^data:(image\/(?:png|jpeg|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(String(u || ''))).filter(Boolean);
    if (!pics.length) throw new Error('Attach the document (picture or PDF) first.');
    const extra = clip(args && args.prompt, 300);
    const parts = [{ text: INSTRUCTION + (extra ? '\nThe person adds: ' + extra : '') }, ...pics.map(m => ({ inline_data: { mime_type: m[1], data: m[2] } }))];
    const t = ctx.withTimeout(90000); let r;
    try {
      r = await fetch(`${E.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta'}/models/${E.GEMINI_TEXT_MODEL || 'gemini-2.5-flash'}:generateContent`, {
        method: 'POST', signal: t.signal,
        headers: { 'x-goog-api-key': E.GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } })
      });
    } finally { t.done(); }
    if (!r.ok) throw new Error('Document reader HTTP ' + r.status + ': ' + clip((await r.text().catch(() => '')).replace(/\s+/g, ' '), 200));
    const j = await r.json().catch(() => null);
    const txt = (((((j || {}).candidates || [])[0] || {}).content || {}).parts || []).map(p => p.text || '').join('').trim();
    let parsed = null; try { parsed = JSON.parse(txt); } catch (e) {}
    if (!parsed || !Array.isArray(parsed.rows)) throw new Error('The document could not be read. Try a clearer picture.');
    return JSON.stringify(parsed);
  }
};
