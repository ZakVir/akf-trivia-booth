// Vercel functions (api/health.js, api/parse.js) with stand-in requests: guards, model allowlist, key from the environment.
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const mkRes = () => { const r = { code: 0, headers: {}, body: null, status(c) { this.code = c; return this; }, setHeader(k, v) { this.headers[k] = v; return this; }, json(o) { this.body = o; return this; }, send(s) { this.body = s; return this; } }; return r; };
const mkReq = (o = {}) => Object.assign({ method: 'POST', headers: { host: 'booth.vercel.app', origin: 'https://booth.vercel.app', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
  body: { model: 'nvidia/nemotron-3.5-bolt-e4b', messages: [{ role: 'user', content: 'hi' }], temperature: 0, max_tokens: 4096 } }, o);

(async () => {
  process.env.NVIDIA_API_KEY = 'nvapi-test';
  const health = require('../api/health.js'), parse = require('../api/parse.js');
  let res = mkRes(); health({}, res);
  ok(res.body.ok && res.body.envKey === true && res.body.db === false, 'health: key configured, no server database (browser keeps sets)');

  let sent = null;
  global.fetch = async (url, o) => { sent = { url, headers: o.headers, body: JSON.parse(o.body) }; return { status: 200, text: async () => '{"choices":[{"message":{"content":"[]"}}]}' }; };
  res = mkRes(); await parse(mkReq(), res);
  ok(res.code === 200 && sent.headers.Authorization === 'Bearer nvapi-test', 'same-origin request is forwarded with the key from the environment');
  ok(sent.body.chat_template_kwargs.enable_thinking === false && sent.body.max_tokens <= 4096, 'thinking off, answer length capped');

  res = mkRes(); await parse(mkReq({ body: { model: 'some/expensive-model', messages: [{ role: 'user', content: 'x' }], max_tokens: 99999 } }), res);
  ok(sent.body.model === 'nvidia/nemotron-3.5-bolt-e4b' && sent.body.max_tokens === 4096, 'other models and huge answers are not allowed');

  sent = null; res = mkRes(); await parse(mkReq({ headers: { host: 'booth.vercel.app', origin: 'https://evil.example', 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' } }), res);
  ok(res.code === 403 && !sent, 'another website cannot use the endpoint');
  res = mkRes(); await parse(mkReq({ headers: { host: 'booth.vercel.app', 'content-type': 'application/json' } }), res);
  ok(res.code === 403, 'a request without browser origin information is refused');
  res = mkRes(); await parse(mkReq({ method: 'GET' }), res);
  ok(res.code === 405, 'GET is refused');
  res = mkRes(); await parse(mkReq({ body: { messages: [{ role: 'user', content: 'x'.repeat(300000) }] } }), res);
  ok(res.code === 413, 'oversized text is refused');
  delete process.env.NVIDIA_API_KEY; res = mkRes(); await parse(mkReq(), res);
  ok(res.code === 401, 'no key configured: clear error');

  if (fails) { console.log(`FAIL: ${fails} vercel api check(s)`); process.exit(1); }
  console.log('vercel functions: all checks passed'); process.exit(0);
})();
