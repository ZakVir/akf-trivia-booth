// Vercel function: POST /api/parse -> forwards the question importer's request to NVIDIA's API (browsers can't call it
// directly). The key comes from the NVIDIA_API_KEY environment variable set in Vercel (never sent to the browser).
// This endpoint is on the public internet. Headers can be faked by scripts, so spending the booth's key needs the booth
// import code (BOOTH_IMPORT_CODE, a second Vercel secret; the host types it once in Setup). Someone who sends their OWN
// NVIDIA key pays with it and needs no code. Also: same-origin JSON only, allowed models only, capped size and answer
// length, and a per-address rate limit.
const NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MODELS = new Set(['nvidia/nemotron-3.5-bolt-e4b', 'nvidia/nemotron-3.5-lightning-30b-a3b']);
const MAX_BODY = 200 * 1024;
const crypto = require('crypto');
const hits = new Map();                                                    // per-address request times (kept while this instance lives)
function limited(ip, now) {
  const recent = (hits.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  recent.push(now); hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 30;                                               // > 30 requests in 10 minutes from one address
}
function codeOk(given) {
  const want = process.env.BOOTH_IMPORT_CODE;
  if (!want) return true;
  const a = Buffer.from(String(given || '')), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sameOrigin(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  const origin = String(req.headers.origin || '').toLowerCase();
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (site && site !== 'same-origin') return false;                       // browsers always say where a request comes from
  if (!origin) return !!site;                                              // no Origin and no Fetch metadata: not a browser page of ours
  try { return new URL(origin).host === host; } catch (e) { return false; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (ctype !== 'application/json' || !sameOrigin(req)) return res.status(403).json({ error: 'forbidden' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip, Date.now())) return res.status(429).json({ error: 'too many requests, try again in a few minutes' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch (e) { return null; } })() : req.body;
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'bad json' });
  const own = typeof body.key === 'string' && /^nvapi-[\w-]{20,}$/.test(body.key);   // the host's own key (Setup): they pay with it
  if (!own && !codeOk(req.headers['x-booth-code'])) return res.status(401).json({ error: 'booth import code needed' });
  const key = own ? body.key : process.env.NVIDIA_API_KEY;
  if (!key) return res.status(401).json({ error: 'no key' });
  if (JSON.stringify(body).length > MAX_BODY) return res.status(413).json({ error: 'too big' });
  const model = MODELS.has(body.model) ? body.model : 'nvidia/nemotron-3.5-bolt-e4b';
  if (!Array.isArray(body.messages) || !body.messages.length) return res.status(400).json({ error: 'no messages' });
  const payload = {
    model, messages: body.messages, temperature: Number(body.temperature) || 0,
    max_tokens: Math.min(4096, Number(body.max_tokens) || 4096),
    chat_template_kwargs: { enable_thinking: false }
  };
  try {
    const r = await fetch(NIM_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(payload) });
    const text = await r.text();
    res.status(r.status).setHeader('Content-Type', 'application/json');
    return res.send(text || '{}');
  } catch (e) {
    return res.status(502).json({ error: 'could not reach NVIDIA: ' + ((e && e.name) || 'error') });
  }
};
