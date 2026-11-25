/* Question-set library: named sets of questions you can load any time.
   On the booth's own server (start.command) they live in questions.db on the Mac (server.py, SQLite).
   Without that server (e.g. the GitHub Pages link) they are kept in this browser instead.
   Library.list() -> [{id, name, count, updated}] newest first; get(id) -> {id, name, questions}; save(name, questions, id?) -> id;
   remove(id); where() -> 'mac' | 'browser' */
const Library = (() => {
  const LS = 'akf-sets-v1';
  let mode = null;
  async function detect() {
    if (mode) return mode;
    try { const r = await fetch('/api/health', { cache: 'no-store' }); const h = r.ok ? await r.json() : null; mode = h && h.db ? 'mac' : 'browser'; }
    catch (e) { mode = 'browser'; }
    return mode;
  }
  const lsAll = () => { try { const a = JSON.parse(localStorage.getItem(LS) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const lsPut = a => { try { localStorage.setItem(LS, JSON.stringify(a)); return true; } catch (e) { return false; } };
  const json = async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || ('HTTP ' + r.status)); return r.json(); };

  async function list() {
    if (await detect() === 'mac') return json(await fetch('/api/sets', { cache: 'no-store' }));
    return lsAll().map(s => ({ id: s.id, name: s.name, count: s.questions.length, updated: s.updated })).sort((a, b) => b.updated - a.updated);
  }
  async function get(id) {
    if (await detect() === 'mac') return json(await fetch('/api/sets/' + id, { cache: 'no-store' }));
    const s = lsAll().find(x => x.id === id); if (!s) throw new Error('no such set'); return s;
  }
  async function save(name, questions, id) {
    name = String(name || '').trim().slice(0, 120) || 'Untitled set';
    if (await detect() === 'mac') return (await json(await fetch('/api/sets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, questions, id }) }))).id;
    const all = lsAll(), now = Date.now() / 1000, old = id != null && all.find(x => x.id === id);
    if (old) Object.assign(old, { name, questions, updated: now });
    else { id = Date.now(); all.push({ id, name, questions, created: now, updated: now }); }
    if (!lsPut(all)) throw new Error('this browser would not store it (private window or storage full)');
    return id;
  }
  async function remove(id) {
    if (await detect() === 'mac') { await json(await fetch('/api/sets/' + id, { method: 'DELETE' })); return; }
    lsPut(lsAll().filter(x => x.id !== id));
  }
  return { list, get, save, remove, where: detect };
})();
