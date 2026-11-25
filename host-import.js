/* Questions import: read a document (or pasted text), review/edit what was understood, then load it. */
(() => {
  let parsed = null, rawText = '';
  const status = t => { $('impStatus').textContent = t; };
  const ready = () => { if (typeof Importer === 'undefined') { status('Importer module is missing (importer.js).'); return false; } return true; };

  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };     // storage can be blocked (private window)
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  $('nimKey').value = lsGet('akf-nim-key') || '';
  $('nimModel').value = lsGet('akf-nim-model') || 'meta/llama-3.1-8b-instruct';
  $('nimKey').onchange = e => lsSet('akf-nim-key', e.target.value.trim());
  $('nimModel').onchange = e => lsSet('akf-nim-model', e.target.value.trim());
  let readText = '';                                                      // the paste-box text that was last read

  async function handleResult(r, label) {
    parsed = r; rawText = r.rawText || '';                                // never keep an older document's text around
    status(`${label}: found ${r.questions.length} question${r.questions.length === 1 ? '' : 's'}.` + ((r.warnings && r.warnings.length) ? ' ' + r.warnings.join(' ') : '') + (r.needsAI ? ' Nothing usable was found. Try “Ask AI to clean up”, or paste the text.' : ''));
    renderReview();
  }

  async function readFile(f) {
    if (!ready()) return;
    status('Reading ' + f.name + '…');
    readText = $('paste').value.trim();                                     // text already in the paste box is older than this file: only new edits override it
    try { await handleResult(await Importer.parseFile(f), f.name); } catch (e) { status('Could not read that file: ' + e.message); }
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
    rawText = t; readText = t;
    try { await handleResult(Importer.parseText(t), 'Pasted text'); } catch (e) { status('Could not read that: ' + e.message); }
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

  $('impAI').onclick = async () => {
    if (!ready()) return;
    const pasted = $('paste').value.trim();
    const text = (pasted && pasted !== readText) ? pasted : (rawText || pasted);   // what is on screen now wins over an earlier document
    if (!text) return status('Choose a file or paste text first (AI cleans up what you give it).');
    const key = $('nimKey').value.trim();
    let serverKey = false;
    if (!key) { try { const h = await (await fetch('/api/health', { cache: 'no-store' })).json(); serverKey = !!h.envKey; } catch (e) {} }
    if (!key && !serverKey) { status('Add a free NVIDIA key under “AI helper settings” first, or skip AI: most documents work without it.'); return; }
    status('Asking the AI… (this sends the text to NVIDIA\'s free API)');
    $('impAI').disabled = true;
    try {
      const r = await Importer.aiParse(text, { key: key || undefined, model: $('nimModel').value.trim() || undefined });
      await handleResult({ questions: r.questions, warnings: r.warnings || [], rawText: text }, 'AI');
    } catch (e) { status('AI helper: ' + e.message); }
    $('impAI').disabled = false;
  };

  /* ---------- review ---------- */
  function renderReview() {
    const box = $('impReview');
    if (!parsed || !parsed.questions.length) { box.innerHTML = ''; return; }
    box.innerHTML =
      `<div class="row" style="margin:6px 0"><button class="main" id="impReplace">Replace all questions (${parsed.questions.length})</button>` +
      `<button id="impAdd">Add to existing</button>` +
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
    status(`Loaded ${clean.length} question${clean.length === 1 ? '' : 's'}${add ? ' (added)' : ''}. ${list.length} total.`);
    parsed = null; rawText = ''; readText = ''; $('impReview').innerHTML = '';
  }
})();
