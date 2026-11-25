// server.py question-set library: save / list / load / update / delete, and the guards (localhost + JSON only).
// Starts the real server on a spare port with a throwaway database file.
const { spawn } = require('child_process'), path = require('path'), os = require('os'), fs = require('fs');
const PORT = 18000 + Math.floor(Math.random() * 1000), DB = path.join(os.tmpdir(), `akf-sets-${process.pid}.db`);
const srv = spawn('python3', [path.join(__dirname, '..', 'server.py')], { env: { ...process.env, PORT: String(PORT), AKF_DB: DB, NVIDIA_API_KEY: '' }, stdio: 'ignore' });
const U = `http://127.0.0.1:${PORT}/api/sets`, J = { 'Content-Type': 'application/json' };
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const done = code => { srv.kill(); try { fs.unlinkSync(DB); } catch (e) {} process.exit(code); };

(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/api/health`); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
  const health = await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json();
  ok(health.db === true, 'health reports the database');
  const a = await (await fetch(U, { method: 'POST', headers: J, body: JSON.stringify({ name: 'Round 1', questions: [{ q: 'A?', type: 'free', answerText: 'a' }] }) })).json();
  const b = await (await fetch(U, { method: 'POST', headers: J, body: JSON.stringify({ name: 'Round 2', questions: [{ q: 'B?' }, { q: 'C?' }] }) })).json();
  let list = await (await fetch(U)).json();
  ok(list.length === 2 && list[0].name === 'Round 2' && list[0].count === 2, 'two sets saved, newest first, with question counts');
  const one = await (await fetch(`${U}/${a.id}`)).json();
  ok(one.questions[0].answerText === 'a', 'a set loads with its questions');
  await fetch(U, { method: 'POST', headers: J, body: JSON.stringify({ id: a.id, name: 'Round 1 v2', questions: [{ q: 'A2?' }] }) });
  ok((await (await fetch(`${U}/${a.id}`)).json()).name === 'Round 1 v2', 'saving with an id updates that set');
  await fetch(`${U}/${b.id}`, { method: 'DELETE' });
  list = await (await fetch(U)).json();
  ok(list.length === 1 && list[0].id === a.id, 'a set can be deleted');
  ok((await fetch(U, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"name":"x","questions":[]}' })).status === 403, 'non-JSON writes are refused (other websites cannot write)');
  ok((await fetch(U, { method: 'POST', headers: J, body: JSON.stringify({ name: '', questions: [] }) })).status === 400, 'a set needs a name');
  ok((await fetch(`${U}/999`)).status === 404, 'unknown set: 404');
  // ids are never reused: delete the newest set, create another, then an edit for the deleted id must fail (not overwrite)
  const c = await (await fetch(U, { method: 'POST', headers: J, body: JSON.stringify({ name: 'Round C', questions: [{ q: 'C?' }] }) })).json();
  await fetch(`${U}/${c.id}`, { method: 'DELETE' });
  const d = await (await fetch(U, { method: 'POST', headers: J, body: JSON.stringify({ name: 'Round D', questions: [{ q: 'D?' }] }) })).json();
  ok(d.id !== c.id, 'a deleted set\'s number is never given to a new set');
  ok((await fetch(U, { method: 'POST', headers: J, body: JSON.stringify({ id: c.id, name: 'stale edit', questions: [{ q: 'X?' }] }) })).status === 404, 'saving an edit of a deleted set fails instead of overwriting another set');
  ok((await (await fetch(`${U}/${d.id}`)).json()).name === 'Round D', '...and the new set is untouched');
  // private files are never served as static content
  fs.writeFileSync(path.join(__dirname, '..', '.env.testprobe'), 'NVIDIA_API_KEY=secret');
  const probes = ['/.env', '/.env.testprobe', '/%2Eenv', '/questions.db', '/server.py', '/__pycache__/server.cpython-313.pyc', '/.git/config', '/models/../server.py'];
  const codes = await Promise.all(probes.map(async u => (await fetch(`http://127.0.0.1:${PORT}${u}`)).status));
  fs.unlinkSync(path.join(__dirname, '..', '.env.testprobe'));
  ok(codes.every(c => c === 404), 'private files (.env, database, server code, .git) are not served: ' + codes.join(','));
  ok((await fetch(`http://127.0.0.1:${PORT}/host.html`)).status === 200, 'normal pages are still served');
  if (fails) { console.log(`FAIL: ${fails} server library check(s)`); done(1); }
  console.log('server question-set library: all checks passed'); done(0);
})().catch(e => { console.log('FAIL: ' + e.message); done(1); });
