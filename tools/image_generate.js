'use strict';
// Pelex image generation: Cloudflare Workers AI first, Hugging Face Inference as fallback.
// Pollinations has been removed because of intermittent 503 failures and unwanted branding/watermark concerns.
// Secrets are stored only in Render environment variables.
const E = process.env;
const CF = () => E.CF_API_BASE || 'https://api.cloudflare.com/client/v4';
const HF = () => E.HF_API_BASE || 'https://router.huggingface.co/hf-inference/models';
const clip = (v,n) => String(v || '').slice(0,n);

async function viaCloudflare(prompt, ctx, seed) {
  const token = E.CF_API_TOKEN || '';
  const account = E.CF_ACCOUNT_ID || '';
  if (!token || !account) throw new Error('Cloudflare is not configured: add CF_ACCOUNT_ID and CF_API_TOKEN.');
  const t=ctx.withTimeout(65000); let r;
  try {
    r=await fetch(`${CF()}/accounts/${account}/ai/run/@cf/black-forest-labs/flux-1-schnell`,{
      method:'POST',signal:t.signal,
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({prompt,steps:6,...(Number.isInteger(seed)?{seed}: {})})
    });
  } finally { t.done(); }
  const type=(r.headers.get('content-type')||'').toLowerCase();
  if(!r.ok){
    const body=await r.text().catch(()=> '');
    let detail=body;
    try { const j=JSON.parse(body); detail=(j.errors||[]).map(x=>x.message||x.code).join('; ')||body; } catch(e){}
    if(r.status===401) throw new Error('Cloudflare HTTP 401: token rejected. Create a Workers AI API token with Workers AI Read and Workers AI Edit permissions, and verify the account ID.');
    if(r.status===403) throw new Error('Cloudflare HTTP 403: token lacks permission or the account is not entitled to this model. Check Workers AI permissions and account credits.');
    throw new Error('Cloudflare HTTP '+r.status+': '+clip(detail,240));
  }
  if(type.includes('application/json')){
    const j=await r.json().catch(()=>null);
    if(j && j.result && j.result.image) return {bytes:Buffer.from(j.result.image,'base64'),mime:'image/png',via:'Cloudflare FLUX'};
    throw new Error('Cloudflare returned JSON without image bytes.');
  }
  if(!type.startsWith('image/')) throw new Error('Cloudflare returned an unexpected content type: '+type);
  return {bytes:Buffer.from(await r.arrayBuffer()),mime:type.split(';')[0],via:'Cloudflare FLUX'};
}

async function viaHuggingFace(prompt,ctx,seed){
  const token=E.HF_TOKEN||E.HUGGINGFACE_API_KEY||'';
  if(!token) throw new Error('Hugging Face is not configured: add HF_TOKEN in Render.');
  const model=E.HF_IMAGE_MODEL||'black-forest-labs/FLUX.1-schnell';
  const url=`${HF()}/${model}`;
  const t=ctx.withTimeout(90000); let r;
  try {
    r=await fetch(url,{method:'POST',signal:t.signal,
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'image/*'},
      body:JSON.stringify({inputs:prompt,parameters:{width:1024,height:1024,...(Number.isInteger(seed)?{seed}: {})}})
    });
  } finally { t.done(); }
  const type=(r.headers.get('content-type')||'').toLowerCase();
  if(!r.ok){
    const body=await r.text().catch(()=> '');
    if(r.status===401||r.status===403) throw new Error('Hugging Face HTTP '+r.status+': token invalid or missing permission. Use a token with Inference Providers access.');
    if(r.status===503) throw new Error('Hugging Face model is loading or temporarily unavailable. Retry shortly.');
    throw new Error('Hugging Face HTTP '+r.status+': '+clip(body,220));
  }
  if(!type.startsWith('image/')) throw new Error('Hugging Face returned '+type+' instead of an image.');
  return {bytes:Buffer.from(await r.arrayBuffer()),mime:type.split(';')[0],via:'Hugging Face FLUX'};
}

module.exports={
 name:'image_generate',
 description:'Create photorealistic images, flyers, product adverts and campaign images using low-cost FLUX Schnell. Default to realistic commercial photography, not cartoon or illustration. For a multi-image campaign, reuse the same seed and repeat exact character/product details in every prompt. Seed improves repeatability but does not guarantee identical identity or product details.',
 parameters:{type:'object',properties:{prompt:{type:'string',description:'Detailed image description. Include exact subject, product, composition, text, lighting and setting.'},style:{type:'string',enum:['photorealistic','illustration','cartoon','3d'],description:'Requested visual style; default photorealistic.'},seed:{type:'integer',description:'Optional integer seed. Reuse the same seed across campaign images for best-effort consistency.'}},required:['prompt']},
 label:a=>'Creating an image: '+String(a.prompt||'').slice(0,40),
 run:async({prompt,style,seed},ctx)=>{
  let p=ctx.clip(String(prompt||'').trim(),1200);
  if(p.length<3) throw new Error('Describe the picture you want.');
  const visualStyle=style||'photorealistic';
  if(visualStyle==='photorealistic' && !/photoreal|realistic photograph|commercial photography/i.test(p)) p += ', photorealistic commercial photography, lifelike human appearance, natural skin texture, realistic anatomy, physically accurate materials, professional camera lighting, sharp focus, high detail; not an illustration, not 3D, not anime, not cartoon';
  if(visualStyle==='illustration') p += ', high-quality editorial illustration';
  if(visualStyle==='cartoon') p += ', polished cartoon art style';
  if(visualStyle==='3d') p += ', high-quality realistic 3D render';
  const errors=[]; let img=null;
  try{img=await viaCloudflare(p,ctx,seed);ctx.log('image: generated with Cloudflare FLUX');}
  catch(e){errors.push('Cloudflare: '+e.message);ctx.log('image: cloudflare failed:',e.message);}
  if(!img){
   try{img=await viaHuggingFace(p,ctx,seed);ctx.log('image: generated with Hugging Face FLUX');}
   catch(e){errors.push('Hugging Face: '+e.message);ctx.log('image: huggingface failed:',e.message);}
  }
  if(!img) throw new Error('Image generation is unavailable. '+errors.join(' | '));
  const ext=img.mime==='image/png'?'png':img.mime==='image/webp'?'webp':'jpg';
  const file=await ctx.saveFile({name:'pelex-image.'+ext,mime:img.mime,bytes:img.bytes,folder:'images'});
  return {text:`Image created with ${img.via} in ${visualStyle} style and saved for 2 days. ${Number.isInteger(seed)?'Campaign seed: '+seed+'. Reuse this seed for best-effort consistency; exact character/product matching is not guaranteed. ':''}The image is ready to view and download.`,markdown:`![Generated image](${file.url})\n\n[Download generated image](${file.downloadUrl})`};
 }
};
