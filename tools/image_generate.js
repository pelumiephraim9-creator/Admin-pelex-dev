'use strict';
// Makes a picture from a text description, saves it for 2 days, and returns it so the chat can show it.
// Cloudflare FLUX is tried first (set CF_ACCOUNT_ID and CF_API_TOKEN in Render). If that is missing or fails,
// the free Pollinations service is used as backup (slower, may be throttled).
const E = process.env;
const CF = () => E.CF_API_BASE || 'https://api.cloudflare.com/client/v4';
const POLL = () => E.POLLINATIONS_BASE || 'https://image.pollinations.ai';

async function viaCloudflare(prompt, ctx) {
  const t = ctx.withTimeout(60000);
  let r;
  try {
    r = await fetch(`${CF()}/accounts/${E.CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`, { method: 'POST', signal: t.signal, headers: { Authorization: 'Bearer ' + E.CF_API_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, steps: 6 }) });
  } finally { t.done(); }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.result || !j.result.image) throw new Error('Cloudflare answered ' + r.status + (j && j.errors && j.errors[0] ? ': ' + ctx.clip(j.errors[0].message, 100) : ''));
  return { bytes: Buffer.from(j.result.image, 'base64'), mime: 'image/jpeg', via: 'Cloudflare FLUX' };
}
async function viaPollinations(prompt, ctx) {
  const t = ctx.withTimeout(70000);
  let r;
  try { r = await fetch(`${POLL()}/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`, { signal: t.signal }); }
  finally { t.done(); }
  const mime = (r.headers.get('content-type') || '').split(';')[0];
  if (!r.ok || !/^image\//.test(mime)) throw new Error('Pollinations answered ' + r.status);
  return { bytes: Buffer.from(await r.arrayBuffer()), mime, via: 'Pollinations' };
}

module.exports = {
  name: 'image_generate',
  description: 'Create a picture from a text description. Use when the person asks to draw, design, generate or make an image, logo, poster or illustration. Write the prompt in English with clear detail: subject, style, colours, mood.',
  parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Detailed English description of the image' } }, required: ['prompt'] },
  label: a => 'Creating an image: ' + String(a.prompt || '').slice(0, 40),
  run: async ({ prompt }, ctx) => {
    const p = ctx.clip(String(prompt || '').trim(), 600);
    if (p.length < 3) throw new Error('Describe the image you want.');
    const errors = []; let img = null;
    if (E.CF_ACCOUNT_ID && E.CF_API_TOKEN) { try { img = await viaCloudflare(p, ctx); } catch (e) { errors.push(e.message); ctx.log('image: cloudflare failed:', e.message); } }
    else errors.push('Cloudflare is not set up (CF_ACCOUNT_ID or CF_API_TOKEN missing)');
    if (!img) { try { img = await viaPollinations(p, ctx); } catch (e) { errors.push(e.message); ctx.log('image: pollinations failed:', e.message); } }
    if (!img) throw new Error('Both image services failed right now. Reasons: ' + errors.join(' | ') + '.');
    const ext = img.mime === 'image/png' ? 'png' : img.mime === 'image/webp' ? 'webp' : 'jpg';
    const f = await ctx.saveFile({ name: 'pelex-image.' + ext, mime: img.mime, bytes: img.bytes, folder: 'images' });
    const md = `![Generated image](${f.url})`;
    return { text: `Image created (${img.via}) and kept for 2 days. It will be shown to the person automatically. Do not describe a link; just say it is ready.`, markdown: md };
  },
};
