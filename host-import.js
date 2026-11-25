/* Questions import: read a document (or pasted text), review/edit what was understood, then load it. */
(() => {
  let parsed = null, rawText = '';
  const status = t => { $('impStatus').textContent = t; };
  const ready = () => { if (typeof Importer === 'undefined') { status('Importer module is missing (importer.js).'); return false; } return true; };

  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };     // storage can be blocked (private window)
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  $('nimKey').value = lsGet('akf-nim-key') || '';
  const savedModel = lsGet('akf-nim-model');
  $('nimModel').value = (!savedModel || /llama-3\.1-8b/.test(savedModel)) ? Importer.DEFAULT_MODEL : savedModel;   // the old default was retired by NVIDIA
  $('nimKey').onchange = e => { lsSet('akf-nim-key', e.target.value.trim()); aiHealth = null; showAiState(); };
  $('nimCode').value = lsGet('akf-import-code') || '';
  $('nimCode').onchange = e => { lsSet('akf-import-code', e.target.value.trim()); aiHealth = null; showAiState(); };
  $('nimModel').onchange = e => lsSet('akf-nim-model', e.target.value.trim());
  let readText = '', sourceName = '';                                     // the paste-box text that was last read; where the current import came from

  /* ---------- saved question sets (questions.db on the Mac, or this browser) ---------- */
  const when = s => new Date(s * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  async function renderLibrary() {
    const where = await Library.where();
    $('libWhere').textContent = where === 'mac' ? 'stored on this Mac (questions.db)' : 'stored in this browser';
    let sets = [];
    try { sets = await Library.list(); } catch (e) { $('libList').innerHTML = `<div class="hint">Could not read the saved sets: ${esc(e.message)}</div>`; return; }
    $('libList').innerHTML = sets.length ? sets.map(s => `<div class="lib" data-id="${s.id}"><span class="n">${esc(s.name)}</span><span class="c">${s.count} question${s.count === 1 ? '' : 's'}</span>` +
      `<span class="c">${when(s.updated)}</span><span><button class="use" data-act="use">Use</button> <button class="del" data-act="del">Delete</button></span></div>`).join('')
      : '<div class="hint">No saved sets yet. Every set you import is saved here automatically.</div>';
  }
  $('libList').onclick = async e => {
    const b = e.target.closest('button'), row = e.target.closest('.lib'); if (!b || !row) return;
    const id = Number(row.dataset.id);
    try {
      if (b.dataset.act === 'use') { const s = await Library.get(id); saveQuestions(s.questions); status(`Now using “${s.name}” (${s.questions.length} questions).`); }
      else if (b.dataset.act === 'del' && confirm('Delete this saved set? (The questions on screen stay.)')) { await Library.remove(id); renderLibrary(); }
    } catch (err) { status('Saved sets: ' + err.message); }
  };
  $('libSaveCur').onclick = async () => {
    const name = $('libName').value.trim() || 'Questions ' + new Date().toLocaleDateString();
    try { await Library.save(name, QUESTIONS); $('libName').value = ''; status(`Saved the current ${QUESTIONS.length} questions as “${name}”.`); renderLibrary(); }
    catch (e) { status('Could not save: ' + e.message); }
  };
  document.querySelector('.tab[data-tab="import"]').addEventListener('click', renderLibrary);
  $('openImport').addEventListener('click', renderLibrary);

  /* ---------- AI first: every import is read by the AI when a key is available, the built-in reader otherwise ---------- */
  let aiHealth = null;
  async function aiReady() {
    if (!aiHealth) { try { const r = await fetch('/api/health', { cache: 'no-store' }); aiHealth = r.ok ? await r.json() : { ok: false }; } catch (e) { aiHealth = { ok: false }; } }
    if (!aiHealth.ok) return false;                                         // no AI service here (opened as a file, or the static mirror): built-in reader
    if ($('nimKey').value.trim()) return true;
    return !!aiHealth.envKey && (!aiHealth.needsCode || !!$('nimCode').value.trim());   // the web version also needs the booth import code
  }
  async function showAiState() {
    const on = await aiReady(), wantsCode = aiHealth && aiHealth.envKey && aiHealth.needsCode;
    $('aiState').innerHTML = on ? '<b style="color:#248A3D">AI reading on</b> (NVIDIA Nemotron)' : `<span>AI reading off: ${wantsCode ? 'enter the booth import code' : 'add a key'} in AI helper settings</span>`;
  }
  document.querySelector('.tab[data-tab="import"]').addEventListener('click', showAiState);
  $('openImport').addEventListener('click', showAiState);
  // fallback: what the built-in reader makes of it (a file's own parse is better than re-reading its flattened text)
  const offline = (text, fallback) => (fallback && fallback.rawText === text) ? Object.assign({}, fallback, { warnings: (fallback.warnings || []).slice() }) : Importer.parseText(text);
  let fileParsed = null;                                                    // the chosen file, as the built-in reader parsed it
  async function smartRead(text, label, fallback) {
    if (!(await aiReady())) return handleResult(offline(text, fallback), label);
    status('Reading with AI… (the text goes to NVIDIA\'s API)');
    $('impRead').disabled = $('impAI').disabled = true;
    const t0 = performance.now();
    try {
      const key = $('nimKey').value.trim();
      const r = await Importer.aiParse(text, { key: key || undefined, code: $('nimCode').value.trim() || undefined, model: $('nimModel').value.trim() || undefined });
      if (r.questions.length) await handleResult({ questions: r.questions, warnings: r.warnings || [], rawText: text }, `${label}, read by AI in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
      else { const f = offline(text, fallback); f.warnings = ['The AI found nothing, so the built-in reader was used.'].concat(f.warnings || []); await handleResult(f, label); }
    } catch (e) {
      const f = offline(text, fallback); f.warnings = ['AI unavailable (' + e.message + '), so the built-in reader was used.'].concat(f.warnings || []); await handleResult(f, label);
    } finally { $('impRead').disabled = $('impAI').disabled = false; }
  }

  async function handleResult(r, label) {
    parsed = r; rawText = r.rawText || '';                                // never keep an older document's text around
    status(`${label}: found ${r.questions.length} question${r.questions.length === 1 ? '' : 's'}.` + ((r.warnings && r.warnings.length) ? ' ' + r.warnings.join(' ') : '') + (r.needsAI ? ' Nothing usable was found. Add an NVIDIA key (AI helper settings) so the AI can read it, or paste the text.' : ''));
    renderReview();
  }

  async function readFile(f) {
    if (!ready()) return;
    status('Reading ' + f.name + '…');
    readText = $('paste').value.trim();                                     // text already in the paste box is older than this file: only new edits override it
    sourceName = f.name.replace(/\.[a-z0-9]+$/i, '');
    try {
      const r = await Importer.parseFile(f); fileParsed = r;
      if (r.rawText && (await aiReady())) await smartRead(r.rawText, f.name, r);   // the AI reads the file's text in whatever layout it has
      else await handleResult(r, f.name);
    } catch (e) { status('Could not read that file: ' + e.message); }
  }
  $('file').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) readFile(f); };   // cleared so the same file can be picked again after editing it
  const drop = $('drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });

  $('impRead').onclick = async () => {
    if (!ready()) return;
    const t = $('paste').value.trim();
    if (!t) return status('Paste some text first, or choose a file.');
    rawText = t; readText = t; sourceName = ''; fileParsed = null;
    try { await smartRead(t, 'Pasted text'); } catch (e) { status('Could not read that: ' + e.message); }
  };
  $('impSample').onclick = () => { if (ready()) { $('paste').value = Importer.SAMPLE_TEXT; $('impRead').click(); } };
  $('impTemplate').onclick = () => {
    if (!ready()) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([Importer.TEMPLATE_CSV], { type: 'text/csv' }));
    a.download = 'trivia-template.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('impResetQ').onclick = () => {
    if (!confirm('Go back to the built-in questions?')) return;
    saveQuestions(SAMPLE_QUESTIONS.slice());
    try { localStorage.removeItem(QKEY); } catch (e) {}                   // nothing saved: questions.js is used from now on, including after edits to it
    status('Built-in questions restored.');
  };

  $('impAI').onclick = async () => {                                        // 'Read without AI': the built-in reader only
    if (!ready()) return;
    const pasted = $('paste').value.trim();
    const text = (pasted && pasted !== readText) ? pasted : (rawText || pasted);   // what is on screen now wins over an earlier document
    if (!text) return status('Choose a file or paste text first.');
    try { await handleResult(offline(text, fileParsed), 'Read without AI'); } catch (e) { status('Could not read that: ' + e.message); }
  };

  /* ---------- review ---------- */
  function renderReview() {
    const box = $('impReview');
    if (!parsed || !parsed.questions.length) { box.innerHTML = ''; return; }
    box.innerHTML =
      `<div class="row" style="margin:6px 0"><button class="main" id="impReplace">Replace all questions (${parsed.questions.length})</button>` +
      `<button id="impAdd">Add to existing</button>` +
      `<input type="text" id="impSetName" placeholder="Name this set" value="${esc(sourceName || ('Imported ' + new Date().toLocaleDateString()))}" style="width:200px">` +
      `<label><input type="checkbox" id="impShuffle" ${parsed.shuffleSuggested ? 'checked' : ''}> shuffle answer positions</label></div>` +
      parsed.questions.map((q, i) => rowHtml(q, i)).join('');
  }
  function rowHtml(q, i) {
    const free = q.type === 'free';
    return `<div class="qrow" data-i="${i}">` +
      `<div class="row"><b>${i + 1}.</b> <select data-f="type"><option value="mc" ${free ? '' : 'selected'}>Multiple choice</option><option value="free" ${free ? 'selected' : ''}>Free response</option></select>` +
      `<select data-f="level">${Object.keys(LEVELS).map(l => `<option value="${l}" ${q.level === l ? 'selected' : ''}>${LEVELS[l]}</option>`).join('')}</select>` +
      `<input type="text" data-f="emoji" value="${esc(q.emoji || '')}" style="width:56px" placeholder="🙂">` +
      `<span style="flex:1"></span><button data-act="del">Remove</button></div>` +
      `<textarea data-f="q" rows="2" style="margin-top:6px">${esc(q.q)}</textarea>` +
      (free
        ? `<input type="text" data-f="answerText" value="${esc(q.answerText || '')}" placeholder="Reference answer (optional)" style="margin-top:6px">`
        : `<div class="cs">${(q.choices || []).map((c, k) => `<div class="c"><input type="radio" name="ans${i}" data-f="answer" value="${k}" ${q.answer === k ? 'checked' : ''}><input type="text" data-f="choice" data-k="${k}" value="${esc(c)}"></div>`).join('')}</div>`) +
      `<input type="text" data-f="fact" value="${esc(q.fact || '')}" placeholder="Fact the host says out loud (optional)" style="margin-top:6px">` +
      ((q.warnings || []).length ? `<div class="warn">${q.warnings.map(esc).join(' · ')}</div>` : '') +
      `</div>`;
  }
  $('impReview').addEventListener('input', e => edit(e));
  $('impReview').addEventListener('change', e => edit(e, true));
  $('impReview').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'del') { parsed.questions.splice(+b.closest('.qrow').dataset.i, 1); renderReview(); }
    else if (b.id === 'impReplace') finish(false);
    else if (b.id === 'impAdd') finish(true);
  });
  function edit(e, committed) {
    const row = e.target.closest('.qrow'); if (!row) return;
    const q = parsed.questions[+row.dataset.i], f = e.target.dataset.f; if (!f) return;
    if (f === 'choice') q.choices[+e.target.dataset.k] = e.target.value;
    else if (f === 'answer') q.answer = +e.target.value;
    else q[f] = e.target.value;
    if (f === 'type' && committed) {
      if (q.type === 'free') { q.answerText = q.answerText || (q.choices && q.choices[q.answer]) || ''; }
      else if (!q.choices || q.choices.length < 2) { q.choices = [q.answerText || 'Correct answer', 'Wrong answer', 'Wrong answer', 'Wrong answer']; q.answer = 0; }
      renderReview();
    }
  }

  function shuffleMc(q) {
    if (q.type !== 'mc' || !q.choices || q.choices.length < 2) return q;
    const idx = q.choices.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    return Object.assign({}, q, { choices: idx.map(i => q.choices[i]), answer: idx.indexOf(q.answer) });
  }
  function finish(add) {
    const sh = $('impShuffle') && $('impShuffle').checked;
    const badAt = parsed.questions.findIndex(q => q.q && q.q.trim() && q.type === 'mc' && !(q.answer >= 0 && q.choices && q.answer < q.choices.length));
    if (badAt >= 0) return status(`Question ${badAt + 1} has no correct answer marked. Tick the round button next to the right choice (or switch it to Free response).`);   // numbered as in the list above
    const clean = parsed.questions
      .filter(q => q.q && q.q.trim())
      .map(q => { const { warnings, ...rest } = q; return Object.assign({ fact: '', kidFact: '', emoji: '', level: 'everyone' }, rest); })
      .map(q => sh ? shuffleMc(q) : q);
    if (!clean.length) return status('Nothing to import.');
    const list = add ? QUESTIONS.concat(clean) : clean;
    saveQuestions(list);
    const setName = ($('impSetName') && $('impSetName').value.trim()) || sourceName || 'Imported set';
    status(`Loaded ${clean.length} question${clean.length === 1 ? '' : 's'}${add ? ' (added)' : ''}. ${list.length} total.`);
    Library.save(setName, clean).then(() => { status(`Loaded ${clean.length} question${clean.length === 1 ? '' : 's'}${add ? ' (added)' : ''}. ${list.length} total. Saved as “${setName}”.`); renderLibrary(); })
      .catch(e => status(`Loaded, but could not save it as a set: ${e.message}`));
    parsed = null; rawText = ''; readText = ''; sourceName = ''; $('impReview').innerHTML = '';
  }
})();
