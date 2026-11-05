'use strict';
// Pelex image tool.
// create: Cloudflare Workers AI (FLUX) first, Hugging Face Inference as fallback.
// edit / consistent set: Gemini image model, which accepts the picture the person attached or an earlier picture as a reference.
// Secrets are read only from Render environment variables.
const E = process.env;
const CF = () => E.CF_API_BASE || 'https://api.cloudflare.com/client/v4';
const HF = () => E.HF_API_BASE || 'https://router.huggingface.co/hf-inference/models';
const clip = (v, n) => String(v || '').slice(0, n);
const MAGIC = b => b.length > 12 && ((b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ? 'image/png' : (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ? 'image/jpeg' : (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') ? 'image/webp' : null);

// A short, readable caption from the request, without the "generate an image of" prefix.
function imageCaption(raw) {
  let title = String(raw || '').trim()
    .replace(/^(?:please\s+)?(?:can you\s+)?(?:generate|create|make|draw|design|produce)\s+(?:an?\s+)?(?:image|picture|photo|photograph|visual|render)\s*(?:(?:of|for|showing)\s+|[:\u2014-]\s*)?/i, '')
    .split(/[\n,;.!?]/)[0]
    .replace(/\s+/g, ' ')
    .replace(/^(?:of|for)\s+/i, '')
    .trim();
  if (!title) title = 'Pelex Image';
  return title.slice(0, 64).replace(/\b[a-z]/g, c => c.toUpperCase());
}

async function viaCloudflare(prompt, ctx) {
  const token = E.CF_API_TOKEN || '';
  const account = E.CF_ACCOUNT_ID || '';
  if (!token || !account) throw new Error('Cloudflare is not configured: add CF_ACCOUNT_ID and CF_API_TOKEN.');
  const t = ctx.withTimeout(65000); let r;
  try {
    r = await fetch(`${CF()}/accounts/${account}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
      method: 'POST', signal: t.signal,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, steps: 6 })
    });
  } finally { t.done(); }
  const type = (r.headers.get('content-type') || '').toLowerCase();
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    let detail = body;
    try { const j = JSON.parse(body); detail = (j.errors || []).map(x => x.message || x.code).join('; ') || body; } catch (e) {}
    if (r.status === 401) throw new Error('Cloudflare HTTP 401: token rejected. Create a Workers AI API token with Workers AI Read and Workers AI Edit permissions, and verify the account ID.');
    if (r.status === 403) throw new Error('Cloudflare HTTP 403: token lacks permission or the account is not entitled to this model. Check Workers AI permissions and account credits.');
    throw new Error('Cloudflare HTTP ' + r.status + ': ' + clip(detail, 240));
  }
  if (type.includes('application/json')) {
    const j = await r.json().catch(() => null);
    if (j && j.result && j.result.image) return { bytes: Buffer.from(j.result.image, 'base64'), mime: 'image/png', via: 'Cloudflare FLUX' };
    throw new Error('Cloudflare returned JSON without image bytes.');
  }
  if (!type.startsWith('image/')) throw new Error('Cloudflare returned an unexpected content type: ' + type);
  return { bytes: Buffer.from(await r.arrayBuffer()), mime: type.split(';')[0], via: 'Cloudflare FLUX' };
}

async function viaHuggingFace(prompt, ctx) {
  const token = E.HF_TOKEN || E.HUGGINGFACE_API_KEY || '';
  if (!token) throw new Error('Hugging Face is not configured: add HF_TOKEN in Render.');
  const model = E.HF_IMAGE_MODEL || 'black-forest-labs/FLUX.1-schnell';
  const url = `${HF()}/${model}`;
  const t = ctx.withTimeout(90000); let r;
  try {
    r = await fetch(url, {
      method: 'POST', signal: t.signal,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'image/*' },
      body: JSON.stringify({ inputs: prompt, parameters: { width: 1024, height: 1024 } })
    });
  } finally { t.done(); }
  const type = (r.headers.get('content-type') || '').toLowerCase();
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    if (r.status === 401 || r.status === 403) throw new Error('Hugging Face HTTP ' + r.status + ': token invalid or missing permission. Use a token with Inference Providers access.');
    if (r.status === 503) throw new Error('Hugging Face model is loading or temporarily unavailable. Retry shortly.');
    throw new Error('Hugging Face HTTP ' + r.status + ': ' + clip(body, 220));
  }
  if (!type.startsWith('image/')) throw new Error('Hugging Face returned ' + type + ' instead of an image.');
  return { bytes: Buffer.from(await r.arrayBuffer()), mime: type.split(';')[0], via: 'Hugging Face FLUX' };
}

// Gemini image model: takes the reference picture(s) plus the instruction, returns a picture.
async function viaGemini(p, refs, ctx) {
  if (!E.GEMINI_API_KEY) throw new Error('Editing needs GEMINI_API_KEY in Render. Add it and redeploy.');
  const parts = [{ text: p }, ...refs.map(r => ({ inline_data: { mime_type: r.mime, data: r.b64 } }))];
  const t = ctx.withTimeout(90000); let r;
  try {
    r = await fetch(`${E.GEMINI_IMAGE_BASE || 'https://generativelanguage.googleapis.com/v1beta'}/models/${E.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'}:generateContent`, {
      method: 'POST', signal: t.signal,
      headers: { 'x-goog-api-key': E.GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'] } })
    });
  } finally { t.done(); }
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error('Gemini HTTP ' + r.status + ': ' + clip(body.replace(/\s+/g, ' '), 200));
  }
  const j = await r.json().catch(() => null);
  const cand = (((j || {}).candidates || [])[0] || {}).content || {};
  const d = (cand.parts || []).map(x => x.inlineData || x.inline_data).find(Boolean);
  if (!d || !d.data) throw new Error('Gemini returned no picture for this request.');
  const bytes = Buffer.from(d.data, 'base64'), mime = MAGIC(bytes);
  if (!mime) throw new Error('Gemini returned something that is not a picture.');
  return { bytes, mime, via: 'Gemini' };
}

// Pictures sent with the message arrive as data URLs.
const dataUrlParts = u => { const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(u || '')); return m ? { mime: m[1], b64: m[2] } : null; };
const refsOf = list => (Array.isArray(list) ? list : []).map(dataUrlParts).filter(Boolean);

// An earlier picture from this chat, given as an https link.
async function readUrl(url, ctx) {
  if (!/^https:\/\//i.test(url)) throw new Error('The reference must be an https link to an earlier picture.');
  const t = ctx.withTimeout(30000); let r;
  try { r = await fetch(url, { signal: t.signal }); } finally { t.done(); }
  if (!r.ok) throw new Error('The reference picture could not be opened.');
  const bytes = Buffer.from(await r.arrayBuffer()), mime = MAGIC(bytes);
  if (!mime) throw new Error('The reference is not a picture.');
  return { mime, b64: bytes.toString('base64') };
}

async function save(img, ctx, note) {
  const ext = img.mime === 'image/png' ? 'png' : img.mime === 'image/webp' ? 'webp' : 'jpg';
  const file = await ctx.saveFile({ name: 'pelex-image.' + ext, mime: img.mime, bytes: img.bytes, folder: 'images' });
  const caption = imageCaption(img.caption);
  return { text: caption + ' \u2014 ' + (note || 'image generated.'), markdown: `![${caption}](${file.url})` };
}

module.exports = {
  name: 'image_generate',
  description: 'Create or edit a picture for Pelex. mode "create" (default): a new photorealistic picture from a text description. mode "edit": change the picture the person attached (sent automatically): enhance, brighten, sharpen, remove, recolour, background, retouch, keeping everything else the same. For a set with one person or product, pass the same sheet every time and pass reference_url of an earlier picture from this chat. Write prompts in English. If it fails, give the short reason and offer to try again; never substitute a text answer.',
  parameters: { type: 'object', properties: {
    mode: { type: 'string', enum: ['create', 'edit'], description: 'create (default) or edit' },
    prompt: { type: 'string', description: 'Detailed English description, or the change to make. Include exact subject, product, composition, text, lighting and setting.' },
    style: { type: 'string', enum: ['photorealistic', 'illustration', 'cartoon', '3d'], description: 'Visual style for create; default photorealistic.' },
    sheet: { type: 'string', description: 'Character and product sheet (face, hair, age, outfit, product with its colour and shape). Repeat it exactly for every picture in a set.' },
    reference_url: { type: 'string', description: 'https link of an earlier picture from this chat, used to keep the same character or product.' },
  }, required: ['prompt'] },
  label: a => (a.mode === 'edit' ? 'Editing the picture: ' : 'Creating an image: ') + String(a.prompt || '').slice(0, 40),
  run: async (args, ctx) => {
    let p = ctx.clip(String(args.prompt || '').trim(), 1200);
    if (p.length < 3) throw new Error('Describe the change or the picture you want.');
    const caption = p;

    // Edit: the attached picture is changed, everything else stays the same.
    if (args.mode === 'edit') {
      const attached = refsOf(ctx.images);
      if (!attached.length) throw new Error('Attach the picture you want changed, then ask again.');
      const img = await viaGemini('Edit the attached image. Apply exactly this change and keep everything else the same (people, faces, objects, composition, colours unless the change says otherwise): ' + p, attached, ctx);
      return save({ ...img, caption }, ctx, 'the rest of the picture was kept as it was.');
    }

    // Create: photorealistic by default, unless another style is asked for.
    const visualStyle = args.style || 'photorealistic';
    if (visualStyle === 'photorealistic' && !/photoreal|realistic photograph|commercial photography/i.test(p)) p += ', photorealistic commercial photography, lifelike human appearance, natural skin texture, realistic anatomy, physically accurate materials, professional camera lighting, sharp focus, high detail; not an illustration, not 3D, not anime, not cartoon';
    if (visualStyle === 'illustration') p += ', high-quality editorial illustration';
    if (visualStyle === 'cartoon') p += ', polished cartoon art style';
    if (visualStyle === '3d') p += ', high-quality realistic 3D render';
    if (args.sheet) p = ctx.clip(String(args.sheet), 900) + '\n\nPicture: ' + p + '. Keep the same character and product exactly as in the sheet.';

    // Consistency: an earlier picture is the reference.
    if (args.reference_url) {
      const ref = await readUrl(String(args.reference_url), ctx);
      if (E.GEMINI_API_KEY) {
        const img = await viaGemini(p + '\nUse the attached picture as the reference for the same character and product.', [ref], ctx);
        return save({ ...img, caption }, ctx, 'it uses the earlier picture as its reference.');
      }
      ctx.log('image: reference given but GEMINI_API_KEY is not set; consistency is reduced');
    }

    const errors = []; let img = null;
    try { img = await viaCloudflare(p, ctx); ctx.log('image: generated successfully'); }
    catch (e) { errors.push('Cloudflare: ' + e.message); ctx.log('image: cloudflare failed:', e.message); }
    if (!img) {
      try { img = await viaHuggingFace(p, ctx); ctx.log('image: generated successfully'); }
      catch (e) { errors.push('Hugging Face: ' + e.message); ctx.log('image: huggingface failed:', e.message); }
    }
    if (!img) throw new Error('Image generation is unavailable. ' + errors.join(' | '));
    return save({ ...img, caption }, ctx, 'image generated.');
  }
};
