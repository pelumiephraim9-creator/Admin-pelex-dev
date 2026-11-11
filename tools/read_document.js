'use strict';
// Reads business documents from an attached PDF or image and returns extracted rows for review.
// This tool never saves or imports records; the user confirms the preview in the frontend.
const E = process.env;
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
const INSTRUCTION = `You are a careful OCR and data-extraction engine for business documents.
The attachment may be a PDF, a scanned receipt, an invoice, or a photograph of a sales/expense table.
Read the attachment itself. Do not judge whether an image is aesthetically clear; extract every legible value.
For a PDF, read its pages as a document, not as a photograph. For a table, read all visible rows and columns.
Return ONLY valid JSON in this exact shape:
{"document_type":"invoice|receipt|sales|expense|other","currency":"NGN|USD|GBP|other ISO code|null","rows":[{"date":"YYYY-MM-DD or null","type":"invoice|receipt|sale|expense|payment|other","party":"name or null","amount":0,"currency":"ISO code or null","due":"YYYY-MM-DD or null"}],"notes":"brief limitations, unreadable cells, page or row counts"}
Rules:
- Extract each distinct transaction or invoice total once. Do not double-count line items and their grand total.
- For sales tables, create one row per transaction/receipt when a date and amount are available.
- Convert dates to YYYY-MM-DD only when unambiguous; otherwise use null and explain in notes.
- Convert amounts to numbers without currency symbols or thousands separators.
- Use negative amounts for refunds or expenses only when the source indicates a negative value or outflow.
- Never invent a date, amount, party, or currency. If no transaction rows can be read, return rows: [] and explain why in notes.
- Keep the JSON keys and types exactly as shown.`;

function jsonFromModel(text) {
  const raw = String(text || '').trim().replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/, '').trim();
  try { return JSON.parse(raw); } catch (_) {}
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(raw.slice(start, end + 1)); } catch (_) {} }
  return null;
}
module.exports = {
  name: 'read_document',
  description: 'Extract transaction rows from a PDF or attached business-document image for user review; nothing is saved.',
  parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Optional context about the attached document' } }, required: [] },
  label: () => 'Reading the document',
  run: async (args, ctx) => {
    const fail = message => JSON.stringify({ error: clip(message, 500), document_type: 'other', currency: null, rows: [], notes: clip(message, 500) });
    if (!E.GEMINI_API_KEY) return fail('Document reading is not configured on the server: the document-reading API key is missing.');
    const inputs = (Array.isArray(ctx.images) ? ctx.images : []);
    const attachments = [];
    for (const value of inputs) {
      const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(value || ''));
      if (!match) continue;
      let mime = match[1].toLowerCase();
      if (mime === 'image/jpg') mime = 'image/jpeg';
      if (mime === 'application/x-pdf') mime = 'application/pdf';
      if (!['image/png','image/jpeg','image/webp','application/pdf'].includes(mime)) {
        return fail('Unsupported file type (' + mime + '). Please use a PDF, JPG, PNG, or WebP image.');
      }
      attachments.push({ inline_data: { mime_type: mime, data: match[2] } });
    }
    if (!attachments.length) return fail('The selected file did not reach the document reader. Please select the PDF or image again.');
    const extra = clip(args && args.prompt, 500);
    const parts = [{ text: INSTRUCTION + (extra ? '\\nAdditional context from the user: ' + extra : '') }, ...attachments];
    const timeout = ctx.withTimeout(120000);
    let response;
    try {
      response = await fetch(`${E.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta'}/models/${E.GEMINI_TEXT_MODEL || 'gemini-2.5-flash'}:generateContent`, {
        method: 'POST', signal: timeout.signal,
        headers: { 'x-goog-api-key': E.GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } })
      });
    } catch (error) {
      return fail('The document reader could not connect: ' + clip(error && error.message || error, 300));
    } finally { timeout.done(); }
    if (!response.ok) {
      const detail = clip((await response.text().catch(() => '')).replace(/\s+/g, ' '), 300);
      return fail('The document reader returned HTTP ' + response.status + (detail ? ': ' + detail : '') + '.');
    }
    const payload = await response.json().catch(() => null);
    const candidate = payload && payload.candidates && payload.candidates[0];
    const text = (((candidate || {}).content || {}).parts || []).map(part => part.text || '').join('').trim();
    const parsed = jsonFromModel(text);
    if (!parsed || !Array.isArray(parsed.rows)) {
      const reason = candidate && candidate.finishReason ? 'Model finish reason: ' + candidate.finishReason + '. ' : '';
      return fail(reason + 'The reader did not return structured transaction rows. Check that the PDF is not password-protected and that the image contains readable text.');
    }
    parsed.rows = parsed.rows.filter(row => row && Number.isFinite(Number(row.amount)) && row.amount !== '');
    parsed.document_type = String(parsed.document_type || 'other');
    parsed.currency = parsed.currency || null;
    parsed.notes = clip(parsed.notes || '', 1200);
    if (!parsed.rows.length && !parsed.notes) parsed.notes = 'No transaction rows were detected in the supplied document.';
    return JSON.stringify(parsed);
  }
};
