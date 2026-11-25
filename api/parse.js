// Vercel function: POST /api/parse -> forwards the question importer's request to NVIDIA's API (browsers can't call it
// directly). The key comes from the NVIDIA_API_KEY environment variable set in Vercel (never sent to the browser).
// This endpoint is on the public internet, so it only serves the booth's own pages and only the parsing job:
//   same-origin JSON requests, allowed models only, capped size and answer length.
const NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MODELS = new Set(['nvidia/nemotron-3.5-bolt-e4b', 'nvidia/nemotron-3.5-lightning-30b-a3b']);
const MAX_BODY = 200 * 1024;

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
  const key = process.env.NVIDIA_API_KEY;
  if (!key) return res.status(401).json({ error: 'no key' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch (e) { return null; } })() : req.body;
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'bad json' });
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
