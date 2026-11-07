// Pelex payment webhooks (Paystack and Flutterwave). Add to the Cloudflare Worker router:
//   if (url.pathname.startsWith('/hooks/')) return handlePaymentWebhook(request, env);
// Worker secrets: PAYSTACK_SECRET_KEY, FLW_SECRET_HASH, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// A payment is saved only after its signature is verified. Each workspace has its own URL token.

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

async function hmacSha512Hex(secret, body) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
}
function sameText(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Maps a provider event to one payment, or null if it is not a successful payment.
function fromPaystack(evt) {
  if (evt.event !== 'charge.success' || !evt.data) return null;
  const d = evt.data, cust = d.customer || {};
  return { event_id: String(d.id || d.reference), event_type: evt.event, amount: Number(d.amount) / 100, currency: d.currency || null,
    customer: [cust.first_name, cust.last_name].filter(Boolean).join(' ') || cust.email || null, paid_at: d.paid_at || d.created_at || null };
}
function fromFlutterwave(evt) {
  if (evt.event !== 'charge.completed' || !evt.data || evt.data.status !== 'successful') return null;
  const d = evt.data, cust = d.customer || {};
  return { event_id: String(d.id || d.tx_ref), event_type: evt.event, amount: Number(d.amount), currency: d.currency || null,
    customer: cust.name || cust.email || null, paid_at: d.created_at || null };
}

async function saveToLedger(env, token, provider, p, raw) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/ingest_payment`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token, p_provider: provider, p_event_id: p.event_id, p_event_type: p.event_type, p_amount: p.amount,
      p_currency: p.currency, p_customer: p.customer, p_paid_at: p.paid_at, p_raw: raw })
  });
  if (!r.ok) throw new Error('ingest failed: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

export async function handlePaymentWebhook(request, env) {
  const url = new URL(request.url);
  const [, , provider, token] = url.pathname.split('/');            // /hooks/<provider>/<token>
  if (request.method !== 'POST' || !token || !['paystack', 'flutterwave'].includes(provider)) return new Response('not found', { status: 404 });
  const body = await request.text();
  let evt; try { evt = JSON.parse(body); } catch (e) { return new Response('bad json', { status: 400 }); }

  if (provider === 'paystack') {
    const sig = request.headers.get('x-paystack-signature') || '';
    const want = await hmacSha512Hex(env.PAYSTACK_SECRET_KEY || '', body);
    if (!sameText(sig, want)) return new Response('bad signature', { status: 401 });
    const p = fromPaystack(evt);
    if (!p) return new Response('ignored', { status: 200 });
    const res = await saveToLedger(env, token, 'paystack', p, evt);
    return new Response(res, { status: 200 });
  }

  // Flutterwave: the verif-hash header must equal the secret hash set in the dashboard.
  if (!sameText(request.headers.get('verif-hash') || '', env.FLW_SECRET_HASH || '')) return new Response('bad signature', { status: 401 });
  const p = fromFlutterwave(evt);
  if (!p) return new Response('ignored', { status: 200 });
  const res = await saveToLedger(env, token, 'flutterwave', p, evt);
  return new Response(res, { status: 200 });
}
