/* importer.js - offline question importer for the trivia booth.
 * Reads CSV / TSV / XLSX / DOCX / text / markdown / JSON into the booth's question schema.
 * Plain ES2020, no dependencies. Exposes window.Importer (browser) and module.exports (node).
 * AI (aiParse) is an optional fallback; everything else works offline.
 */
(function () {
  'use strict';

  var MAX_QUESTIONS = 500;
  var DEFAULT_MODEL = 'nvidia/nemotron-3.5-bolt-e4b';   // fast + accurate on messy trivia sheets (tested 2026-11); llama-3.1-8b was retired by NVIDIA
  var DEFAULT_ENDPOINT = '/api/parse';

  // ---------------------------------------------------------------- text helpers

  function clean(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/[\u200B\u200C\u2060\uFEFF\u00AD]/g, '')
      .replace(/[\u00A0\u2002\u2003\u2007\u2009\u200A\u202F]/g, ' ')
      .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
      .replace(/\r\n?/g, '\n')
      .trim();
  }
  function oneLine(s) { return clean(s).replace(/\s+/g, ' ').trim(); }
  function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|quot|amp|lt|gt|apos|nbsp);/gi, function (m, e) {
      var l = e.toLowerCase();
      if (l === 'quot') return '"';
      if (l === 'amp') return '&';
      if (l === 'lt') return '<';
      if (l === 'gt') return '>';
      if (l === 'apos') return "'";
      if (l === 'nbsp') return ' ';
      try {
        var n = l.charAt(1) === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
        return String.fromCodePoint(n);
      } catch (err) { return m; }
    });
  }
  function norm(s) {
    return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }
  function eq(a, b) { return norm(a) === norm(b); }
  function str(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return oneLine(decodeEntities(v));
    return '';
  }
  function stripNum(q) {
    return String(q).replace(/^\s*(?:(?:question|quest|q)\s*#?\s*\d+\s*[:.)\-\u2013\u2014]\s*|(?:question|q)\s*[:\uFF1A]\s*|\(?\d{1,3}[.)]\s+)/i, '').trim();
  }
  var EMOJI_RE = /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)$/u;
  function cleanEmoji(v) {
    var s = String(v === null || v === undefined ? '' : v).replace(/[\u200B\u200C\u2060\uFEFF]/g, '').trim();
    return s && EMOJI_RE.test(s) ? s : '';
  }

  function mapLevel(v) {
    var s = oneLine(v).toLowerCase();
    if (!s) return { level: 'everyone', known: true };
    if (s === 'kids' || s === 'everyone' || s === 'hard') return { level: s, known: true };
    if (/^[1-3]$/.test(s)) return { level: ['kids', 'everyone', 'hard'][+s - 1], known: true };
    var g = /\b(?:grade|gr|year|yr)\s*\.?\s*(\d{1,2})\b/.exec(s);
    if (g) return { level: +g[1] <= 5 ? 'kids' : 'everyone', known: true };
    var k = /\b(kid|kids|child|children|easy|easier|elementary|young|beginner|junior|little|simple|preschool|toddler)\b/.test(s) || /\bk\s*-?\s*[0-5]\b/.test(s);
    var h = /\b(hard|hardest|difficult|adult|adults|expert|advanced|challenging|tough|master)\b/.test(s);
    var e = /\b(everyone|medium|normal|general|all|mixed|moderate|intermediate|standard|regular|teen|teens|family|average|mid)\b/.test(s);
    if (k && h) return { level: 'everyone', known: true };
    if (k) return { level: 'kids', known: true };
    if (h) return { level: 'hard', known: true };
    return { level: 'everyone', known: e };
  }
  function typeOf(v) {
    var s = oneLine(v).toLowerCase();
    if (!s) return '';
    if (/\b(mc|mcq|multi|multiple|choice|abcd)\b/.test(s)) return 'mc';
    if (/\b(free|open|short|written|fill|response|essay|text)\b/.test(s)) return 'free';
    return '';
  }

  // Resolve "B", "2", "Geneva", "B) Geneva" against an array of choices (may contain '' gaps).
  function resolveAnswer(val, arr) {
    var v = oneLine(val).replace(/[.!]+$/, '').trim();
    if (!v) return -1;
    var i;
    for (i = 0; i < arr.length; i++) if (arr[i] && eq(arr[i], v)) return i;
    var m = /^(?:(?:option|choice|answer|ans)\s*)?\(?([A-Fa-f])\)?[.):]?$/.exec(v);
    if (m) { i = m[1].toLowerCase().charCodeAt(0) - 97; if (i < arr.length && arr[i]) return i; return -1; }
    m = /^\(?([A-Fa-f])[).:]\s+(.+)$/.exec(v);
    if (m) {
      i = m[1].toLowerCase().charCodeAt(0) - 97;
      if (i < arr.length && arr[i] && (eq(arr[i], m[2]) || norm(m[2]).indexOf(norm(arr[i])) === 0)) return i;
    }
    m = /^(?:(?:option|choice|#)\s*)?(\d)$/.exec(v);
    if (m) {
      var n = +m[1];
      if (n === 0) return 0;
      if (n >= 1 && n <= arr.length && arr[n - 1]) return n - 1;
    }
    var hit = -1, hits = 0, nv = norm(v);
    for (i = 0; i < arr.length; i++) {
      var nc = norm(arr[i]);
      if (nc.length >= 3 && nv.length >= 3 && (nv.indexOf(nc) >= 0 || nc.indexOf(nv) >= 0)) { hit = i; hits++; }
    }
    return hits === 1 ? hit : -1;
  }

  // ---------------------------------------------------------------- normalizer

  function compactKeys(raw) {
    var o = {};
    Object.keys(raw).forEach(function (k) { o[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = raw[k]; });
    return o;
  }
  function pickFrom(o, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = o[keys[i]];
      if (v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '')) return v;
    }
    return undefined;
  }
  function toList(v) {
    if (v === undefined || v === null) return [];
    if (Array.isArray(v)) {
      return v.map(function (x) {
        if (x && typeof x === 'object') return str(x.text !== undefined ? x.text : x.label !== undefined ? x.label : x.value !== undefined ? x.value : x.answer);
        return str(x);
      });
    }
    if (typeof v === 'object') return toList(Object.keys(v).map(function (k) { return v[k]; }));
    var s = clean(v);
    if (/\n|\s\|\s|\|/.test(s)) return s.split(/\n+|\s*\|\s*/).map(str);
    return [str(s)];
  }
  function stripLabels(list) {
    var nonBlank = list.filter(Boolean);
    if (nonBlank.length < 2) return list;
    var ok = true, k = 0;
    nonBlank.forEach(function (c) {
      var m = /^\(?([A-Fa-f])[).:]\s*\S/.exec(c);
      if (!m || m[1].toLowerCase().charCodeAt(0) - 97 !== k) ok = false;
      k++;
    });
    if (!ok) return list;
    return list.map(function (c) { return c.replace(/^\(?[A-Fa-f][).:]\s*/, ''); });
  }

  // Shared normaliser: enforces the output schema. Returns null when there is no question text.
  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var o = compactKeys(raw);
    var warnings = [];
    var q = stripNum(str(pickFrom(o, ['q', 'question', 'prompt', 'text', 'title', 'clue', 'questiontext'])));
    if (!q) return null;
    var type = typeOf(pickFrom(o, ['type', 'format', 'kind', 'questiontype']));

    var choices = toList(pickFrom(o, ['choices', 'options', 'answers', 'answeroptions', 'possibleanswers', 'alternatives', 'answerchoices']));
    var correctVal = pickFrom(o, ['correctanswer', 'correct', 'right', 'rightanswer', 'solution']);
    var wrongVal = pickFrom(o, ['incorrectanswers', 'wronganswers', 'wrongchoices', 'wrong', 'distractors', 'incorrect']);
    var idxVal = pickFrom(o, ['correctindex', 'answerindex', 'correctchoice', 'answernumber']);
    var ansVal = pickFrom(o, ['answer']);
    var answerTextVal = pickFrom(o, ['answertext']);
    var idx = -1;

    if (!choices.length && wrongVal !== undefined && correctVal !== undefined) {
      choices = [str(correctVal)].concat(toList(wrongVal));
      idx = 0;
    } else if (choices.length) {
      choices = stripLabels(choices);
      var cand = idxVal !== undefined ? idxVal : (ansVal !== undefined ? ansVal : correctVal);
      if (typeof cand === 'number') {
        idx = cand;
        if (idx === choices.length) idx = idx - 1;
        if (idx < 0 || idx >= choices.length || !choices[idx]) idx = -1;
      } else if (typeof cand === 'string') {
        idx = resolveAnswer(cand, choices);
      }
      if (idx < 0 && answerTextVal !== undefined) idx = resolveAnswer(str(answerTextVal), choices);
    }

    // clean up choices (drop blanks/duplicates, keep the correct index consistent)
    var out = [], newIdx = -1, dups = false;
    choices.forEach(function (c, i) {
      if (!c) return;
      var d = -1;
      for (var j = 0; j < out.length; j++) if (eq(out[j], c)) { d = j; break; }
      if (d >= 0) { dups = true; if (i === idx && newIdx < 0) newIdx = d; return; }
      out.push(c);
      if (i === idx) newIdx = out.length - 1;
    });
    if (dups) warnings.push('Duplicate choices were removed');
    if (out.length > 6) {
      if (newIdx >= 6) { out = out.slice(0, 5).concat([out[newIdx]]); newIdx = 5; } else out = out.slice(0, 6);
      warnings.push('More than 6 choices - extra choices were dropped');
    }

    var item = { type: 'free', q: q, choices: [], answer: -1, answerText: '', fact: '', kidFact: '', emoji: '', level: 'everyone', warnings: warnings };
    var explicitAns = answerTextVal !== undefined ? str(answerTextVal) : '';
    if (type !== 'free' && out.length >= 2) {
      item.type = 'mc';
      item.choices = out;
      item.answer = newIdx;
      if (newIdx < 0) warnings.push('No correct answer found');
    } else if (out.length >= 1) {
      item.type = 'free';
      if (type === 'free' && out.length >= 2) {
        item.answerText = newIdx >= 0 ? out[newIdx] : explicitAns;
      } else if (out.length === 1) {
        item.answerText = out[0];
        if (type !== 'free') warnings.push('Only one choice (turned into a free-response question)');
      }
    }
    if (item.type === 'free' && !item.answerText) {
      var at = explicitAns;
      if (!at) {
        var f = ansVal !== undefined ? ansVal : correctVal;
        if (f !== undefined && !Array.isArray(f) && typeof f !== 'object') at = str(f);
      }
      item.answerText = at || '';
    }
    if (item.type === 'free' && !item.answerText) warnings.push('No reference answer');

    item.fact = str(pickFrom(o, ['fact', 'explanation', 'didyouknow', 'note', 'notes', 'info', 'funfact']));
    item.kidFact = str(pickFrom(o, ['kidfact', 'kidsfact', 'kidfriendlyfact', 'kidversion', 'kidsversion', 'kids', 'kid', 'simple', 'simplefact', 'kidfriendly']));
    item.emoji = cleanEmoji(pickFrom(o, ['emoji', 'icon']));
    var lv = pickFrom(o, ['level', 'difficulty', 'grade']);
    if (lv !== undefined) {
      var ml = mapLevel(typeof lv === 'number' ? String(lv) : lv);
      item.level = ml.level;
      if (!ml.known) warnings.push('Unknown level "' + oneLine(lv) + '" - using everyone');
    }
    return item;
  }

  // ---------------------------------------------------------------- result helper

  function finish(source, questions, warnings, rawText, shuffle) {
    warnings = warnings || [];
    if (questions.length > MAX_QUESTIONS) {
      warnings.push('Only the first ' + MAX_QUESTIONS + ' questions were imported (' + questions.length + ' found).');
      questions = questions.slice(0, MAX_QUESTIONS);
    }
    var flagged = questions.filter(function (q) { return q.warnings && q.warnings.length; }).length;
    if (flagged) warnings.push(flagged + ' question' + (flagged === 1 ? '' : 's') + ' need a quick look (see the warnings on each).');
    if (!questions.length) warnings.push('No questions were found in this document.');
    return { questions: questions, warnings: warnings, source: source, needsAI: questions.length === 0, rawText: rawText || '', shuffleSuggested: !!shuffle };
  }
  function failure(source, msg, rawText) {
    return { questions: [], warnings: [msg], source: source, needsAI: true, rawText: rawText || '', shuffleSuggested: false };
  }

  // ---------------------------------------------------------------- CSV / table parsing

  function parseDelimited(text, delim) {
    var rows = [], row = [], cell = '', inQ = false, i = 0, n = text.length;
    if (text.charCodeAt(0) === 0xFEFF) i = 1;
    for (; i < n; i++) {
      var c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
        } else cell += c;
      } else if (c === '"' && cell === '') {
        inQ = true;
      } else if (c === delim) {
        row.push(cell); cell = '';
      } else if (c === '\r' || c === '\n') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = ''; rows.push(row); row = [];
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function detectDelimiter(text) {
    var sample = text.slice(0, 4000), truncated = text.length > 4000;
    var best = ',', bestScore = 0;
    [',', '\t', ';', '|'].forEach(function (d) {
      var rows = parseDelimited(sample, d);
      if (truncated) rows.pop();
      rows = rows.filter(function (r) { return r.some(function (c) { return c.trim() !== ''; }); }).slice(0, 15);
      if (!rows.length) return;
      var counts = {}, modal = 0, modalN = 0;
      rows.forEach(function (r) { counts[r.length] = (counts[r.length] || 0) + 1; });
      Object.keys(counts).forEach(function (k) { if (counts[k] > modalN) { modalN = counts[k]; modal = +k; } });
      if (modal < 2) return;
      var score = modalN * 1000 + modal;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }

  function headerRole(cell) {
    var s = String(cell).toLowerCase().replace(/[_\-./\\:()\[\]#*]+/g, ' ').replace(/([a-z])(\d)/g, '$1 $2').replace(/\s+/g, ' ').trim();
    if (!s || s.length > 40 || s.split(' ').length > 4) return null;
    var m;
    if (/^(no|num|number|id|index|nr|n)$/.test(s) || /^(q|question) (no|num|number|id|nr)$/.test(s)) return { role: 'skip' };
    if ((m = /^(?:choice|option|opt|alternative|alt|answer|ans)? ?([a-f])$/.exec(s))) return { role: 'opt', idx: m[1].charCodeAt(0) - 97 };
    if ((m = /^(?:choice|option|opt|alternative|answer|ans) ?([1-6])$/.exec(s))) return { role: 'opt', idx: +m[1] - 1 };
    if (/^(choice|choices|option|options|alternatives|answers|answer choices|answer options|possible answers)$/.test(s)) return { role: 'opt', idx: null };
    if (/\b(incorrect|wrong|distractor|distractors|decoy|false|other|bad)\b/.test(s)) return { role: 'wrong' };
    if (/\b(level|difficulty|grade|age|tier|audience|diff)\b/.test(s)) return { role: 'level' };
    if (/\b(type|format|kind)\b/.test(s)) return { role: 'type' };
    if (/\b(kid|kids|child|children|simple|simplified|junior)\b/.test(s)) return { role: 'kid' };
    if (/\b(fact|facts|explanation|explain|did you know|dyk|note|notes|details|info|why|comment|comments|extra|blurb)\b/.test(s)) return { role: 'fact' };
    if (/\b(emoji|icon|symbol|emoticon)\b/.test(s)) return { role: 'emoji' };
    if (/\b(correct|right|solution|answer|ans|key)\b/.test(s)) return { role: 'correct' };
    if (/\b(question|questions|q|prompt|text|clue|query|trivia)\b/.test(s)) return { role: 'q' };
    return null;
  }
  function detectHeader(row) {
    var roles = row.map(function (c) { return headerRole(c); });
    var recognized = roles.filter(function (r) { return r && r.role !== 'skip'; });
    var hasQ = roles.some(function (r) { return r && r.role === 'q'; });
    if (!hasQ || recognized.length < 2) return null;
    var seen = {};
    roles.forEach(function (r, i) { if (r && r.role === 'q') { if (seen.q) roles[i] = null; seen.q = true; } });
    // a lone option column named "A" (e.g. "Q","A") really means the answer
    var opts = roles.filter(function (r) { return r && r.role === 'opt'; });
    var hasCorrect = roles.some(function (r) { return r && (r.role === 'correct' || r.role === 'wrong'); });
    if (opts.length === 1 && !hasCorrect) opts[0].role = 'correct';
    return roles;
  }

  function splitChoiceCell(cell) {
    var parts = cell.split(/\n+|\s*\|\s*|\s*;\s*/).map(oneLine).filter(Boolean);
    return stripLabels(parts);
  }

  function parseRowsInternal(rows, source) {
    var warnings = [];
    rows = (Array.isArray(rows) ? rows : []).map(function (r) {
      r = Array.isArray(r) ? r : [r];
      r = r.map(function (c) { return clean(c).replace(/\t/g, ' '); });
      while (r.length && r[r.length - 1] === '') r.pop();
      return r;
    });
    var rawText = rows.map(function (r) { return r.map(function (c) { return c.replace(/\s*\n\s*/g, ' '); }).join('\t'); }).join('\n');
    var nonblank = rows.filter(function (r) { return r.length > 0; });
    if (!nonblank.length) return finish(source, [], ['The table is empty.'], rawText, false);

    // header detection among the first few rows
    var roles = null, hdrAt = -1;
    for (var h = 0; h < Math.min(3, nonblank.length); h++) {
      roles = detectHeader(nonblank[h]);
      if (roles) { hdrAt = h; break; }
    }
    var maxCols = nonblank.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    if (!roles && maxCols <= 1) {
      // a single column of text: treat as a document
      var res = parseTextInternal(rows.map(function (r) { return r[0] || ''; }).join('\n'), source);
      res.rawText = rawText;
      return res;
    }

    var questions = [], shuffle = false;
    var data = nonblank.slice(hdrAt + 1);

    function push(raw, extra, correctFirst) {
      var q = normalize(raw);
      if (!q) return;
      if (extra) extra.forEach(function (w) { q.warnings.push(w); });
      if (correctFirst && q.type === 'mc') shuffle = true;
      questions.push(q);
    }

    if (roles) {
      var col = { q: -1, correct: -1, wrong: [], opt: [], fact: -1, kid: -1, emoji: -1, level: -1, type: -1 };
      roles.forEach(function (r, i) {
        if (!r || r.role === 'skip') return;
        if (r.role === 'wrong') col.wrong.push(i);
        else if (r.role === 'opt') col.opt.push({ i: i, idx: r.idx });
        else if (col[r.role] === -1) col[r.role] = i;
      });
      var allIdx = col.opt.length > 0 && col.opt.every(function (o) { return o.idx !== null; });
      col.opt.sort(function (a, b) { return allIdx ? a.idx - b.idx : a.i - b.i; });
      data.forEach(function (row) {
        var get = function (i) { return i >= 0 && i < row.length ? row[i] : ''; };
        var q = stripNum(oneLine(get(col.q)));
        if (!q) {
          if (row.some(Boolean)) warnings.push('A row without a question was skipped.');
          return;
        }
        var correct = oneLine(get(col.correct));
        var extra = [];
        var raw = { q: q, fact: get(col.fact), kidFact: get(col.kid), emoji: get(col.emoji), level: get(col.level), type: get(col.type) };
        var typ = typeOf(raw.type);
        var arr = null, ans = -1, correctFirst = false;
        if (col.opt.length) {
          if (col.opt.length === 1 && col.opt[0].idx === null) {
            arr = splitChoiceCell(get(col.opt[0].i));
          } else {
            arr = [];
            col.opt.forEach(function (o, p) { var slot = allIdx ? o.idx : p; while (arr.length <= slot) arr.push(''); arr[slot] = oneLine(get(o.i)); });
          }
          arr = stripLabels(arr);
          if (arr.filter(Boolean).length < 2 && correct) { arr = null; }
          else if (correct) {
            ans = resolveAnswer(correct, arr);
            if (ans < 0) extra.push('Answer "' + correct + '" doesn\'t match any of the choices');
          }
        } else if (col.correct >= 0 && col.wrong.length) {
          var wrongs = col.wrong.map(function (i) { return oneLine(get(i)); }).filter(Boolean);
          if (correct && wrongs.length) { arr = [correct].concat(wrongs); ans = 0; correctFirst = true; }
        }
        if (arr) {
          raw.choices = arr; raw.answer = ans; raw.answerText = correct;
          if (typ === 'free') raw.type = 'free'; else delete raw.type;
        } else {
          raw.type = 'free'; raw.answerText = correct;
          if (/^[A-Fa-f]$/.test(correct)) extra.push('Answer "' + correct + '" looks like a letter but there are no choices');
        }
        push(raw, extra, correctFirst);
      });
    } else {
      // no header: col0 = question, col1 = correct, col2.. = wrong
      var numbered = data.length > 1 && data.every(function (r) { return r.length >= 3 && /^\d+[.)]?$/.test(r[0]); });
      data.forEach(function (row) {
        if (numbered) row = row.slice(1);
        var q = stripNum(oneLine(row[0] || ''));
        if (!q) return;
        var correct = oneLine(row[1] || '');
        var wrongs = row.slice(2).map(oneLine).filter(Boolean);
        if (correct && wrongs.length) push({ q: q, choices: [correct].concat(wrongs), answer: 0 }, null, true);
        else push({ type: 'free', q: q, answerText: correct }, null, false);
      });
    }
    return finish(source, questions, warnings, rawText, shuffle);
  }

  // ---------------------------------------------------------------- text parsing

  var R = {
    ignore: /^(?:category|topic|subject|theme|round|source|hint|points?|id)\s*[:\uFF1A]/i,
    fact: /^(?:fun\s+fact|fact|did\s*you\s*know\??|explanation|explain|note|notes|trivia|more\s+info|why)\s*[:\uFF1A]\s*(.*)$/i,
    factNoColon: /^did\s+you\s+know\??\s+(\S.*)$/i,
    kid: /^(?:kids?(?:[- ]friendly)?|child(?:ren)?|simple(?:r)?|for\s+kids)(?:'s)?(?:\s+(?:fact|version|explanation))?\s*[:\uFF1A]\s*(.*)$/i,
    level: /^(?:level|difficulty|grade|age(?:\s+group)?|tier)\s*[:\uFF1A]\s*(.*)$/i,
    type: /^(?:type|format)\s*[:\uFF1A]\s*(.*)$/i,
    emoji: /^(?:emoji|icon)\s*[:\uFF1A]\s*(.*)$/i,
    answer: [
      /^(?:the\s+)?(?:(?:correct|right)\s+answer|answer|ans|solution|correct|right|key)\s*(?:is\s*)?[:\uFF1A=]\s*(.*)$/i,
      /^(?:answer|ans)\s+[-\u2013\u2014]\s+(.*)$/i,
      /^the\s+(?:correct\s+)?answer\s+is\s*[:\-]?\s*(.*)$/i
    ],
    aColon: /^a\s*[:\uFF1A]\s*(.*)$/i,
    qNum: /^(?:question|quest|q)\s*(?:#|no\.?|number)?\s*(\d+)\s*[:.)\-\u2013\u2014]\s*(.*)$/i,
    qNumOnly: /^(?:question|q)\s*(?:#|no\.?)?\s*(\d+)\s*[:.)\-\u2013\u2014]?\s*$/i,
    qColon: /^(?:question|q)\s*[:\uFF1A]\s*(.*)$/i,
    numDot: /^\(?(\d{1,3})[.)]\s+(\S.*)$/,
    label: /^(?:\(([A-Fa-f])\)\s*|([A-Fa-f])\)\s*|([A-Fa-f])[.:]\s+|([A-Fa-f])[.:]$|([A-Fa-f])\s+[-\u2013\u2014]\s+)(.*)$/,
    free: /^\(?(?:free[- ]?(?:response|text|form)?|open(?:[- ]ended)?|short\s+answer)\)?\.?$/i
  };

  function stripMarkers(t) {
    var correct = false, weak = false, guard = 0, changed = true, m;
    t = t.trim();
    if (/^\*[^*\s](?:.*[^*\s])?\*$/.test(t) && t.length > 2) { t = t.slice(1, -1).trim(); weak = true; }
    while (changed && guard++ < 4) {
      changed = false;
      if ((m = /^(?:\[\s*[xX\u2713\u2714]\s*\]|\(\s*[xX\u2713\u2714]\s*\)|[\u2713\u2714\u2705\u2611]\uFE0F?)\s*/.exec(t))) { t = t.slice(m[0].length); correct = true; changed = true; continue; }
      if ((m = /^(?:\[\s*\]|\(\s*\)|\u2610|\u25A1)\s*/.exec(t))) { t = t.slice(m[0].length); changed = true; continue; }
      if (/^\*(?!\*)\S/.test(t)) { t = t.slice(1); correct = true; changed = true; continue; }
      if ((m = /\s*(?:\((?:correct(?: answer)?|answer|right|the answer)\s*!?\)|\[(?:correct(?: answer)?|answer|right)\]|[\u2713\u2714\u2705\u2611]\uFE0F?)\s*$/i.exec(t))) { t = t.slice(0, m.index); correct = true; changed = true; continue; }
      if (/[^*]\*\s*$/.test(t)) { t = t.replace(/\*\s*$/, ''); correct = true; changed = true; continue; }
    }
    return { text: t.trim(), correct: correct, weak: weak };
  }

  function splitInline(text) {
    var re = /(?:^|\s)\(?([A-F])[).]\s+/g, marks = [], m;
    while ((m = re.exec(text))) marks.push({ letter: m[1], start: m.index, end: re.lastIndex });
    for (var i = 0; i < marks.length; i++) {
      if (marks[i].letter !== 'A') continue;
      var seq = [marks[i]], next = 'B';
      for (var j = i + 1; j < marks.length && seq.length < 6; j++) {
        if (marks[j].letter === next) { seq.push(marks[j]); next = String.fromCharCode(next.charCodeAt(0) + 1); }
      }
      if (seq.length >= 2) {
        var items = seq.map(function (mk, k) { return text.slice(mk.end, k + 1 < seq.length ? seq[k + 1].start : text.length).trim(); });
        return { head: text.slice(0, seq[0].start).trim(), items: items };
      }
    }
    return null;
  }

  function parseTextInternal(text, source) {
    text = clean(text);
    var warnings = [];
    var lines = text.split('\n');
    var blocks = [], cur = null, lastMeta = null, blank = false;

    function flush() { if (cur) blocks.push(cur); cur = null; lastMeta = null; }
    function newBlock(q, o) {
      flush();
      o = o || {};
      cur = { q: q, qMarker: !!o.marker, numbered: !!o.numbered, qBold: !!o.bold, choices: [], ans: null, fact: '', kidFact: '', level: '', type: '', emoji: '', sawBlank: false, lastLetter: -1 };
      return cur;
    }
    function addChoice(c) {
      cur.choices.push(c);
    }
    function nextNonBlank(i) {
      for (var k = i + 1; k < lines.length; k++) if (lines[k].trim()) return lines[k].trim();
      return '';
    }
    function startQuestion(qtext, o) {
      var inlineAns = null, m;
      if ((m = /^(.*?\S)\s+(?:Answer|Ans)\s*[:\uFF1A]\s*(.+)$/i.exec(qtext))) { qtext = m[1]; inlineAns = m[2]; }
      else if ((m = /^(.*\?)\s+A\s*[:\uFF1A]\s*(.+)$/.exec(qtext))) { qtext = m[1]; inlineAns = m[2]; }
      var inl = splitInline(qtext);
      newBlock('', o);
      if (inl) {
        cur.q = inl.head;
        inl.items.forEach(function (it, k) {
          var mk = stripMarkers(it);
          addChoice({ text: mk.text, correct: mk.correct, bold: mk.weak });
          cur.lastLetter = k;
        });
      } else cur.q = qtext;
      if (inlineAns !== null) cur.ans = inlineAns;
    }

    for (var li = 0; li < lines.length; li++) {
      var raw = lines[li].replace(/\t/g, '  ');
      var s = raw.trim();
      if (!s) { blank = true; if (cur) cur.sawBlank = true; lastMeta = null; continue; }
      var hadBlank = blank; blank = false;
      if (/^[-=_*~\s]{3,}$/.test(s) && !/[A-Za-z0-9]/.test(s)) { if (cur) cur.sawBlank = true; blank = true; lastMeta = null; continue; }
      var isHeading = false, hm = /^#{1,6}\s+(.*)$/.exec(s);
      if (hm) { s = hm[1].trim(); isHeading = true; }
      var bullet = false, bm = /^([-*\u2022\u00B7\u25AA\u25E6\u2013])\s+(.*)$/.exec(s);
      if (bm) { bullet = true; s = bm[2].trim(); }
      var wholeBold = /^\*\*.+\*\*$/.test(s) && (s.match(/\*\*/g) || []).length === 2;
      var hasBold = /\*\*[^*]+\*\*/.test(s);
      s = s.replace(/\*\*/g, '').trim();
      if (!s) continue;
      var m;

      if (R.ignore.test(s)) continue;
      if (cur) {
        if ((m = R.fact.exec(s)) || (m = R.factNoColon.exec(s))) { cur.fact = m[1]; lastMeta = 'fact'; continue; }
        if ((m = R.kid.exec(s))) { cur.kidFact = m[1]; lastMeta = 'kidFact'; continue; }
        if ((m = R.level.exec(s))) { cur.level = m[1]; lastMeta = null; continue; }
        if ((m = R.type.exec(s))) { cur.type = m[1]; lastMeta = null; continue; }
        if ((m = R.emoji.exec(s))) { cur.emoji = m[1]; lastMeta = null; continue; }
        var am = null;
        for (var ai = 0; ai < R.answer.length && !am; ai++) am = R.answer[ai].exec(s);
        if (am) { cur.ans = am[1]; lastMeta = am[1] ? null : 'ans'; continue; }
        if ((m = R.aColon.exec(s)) && !/^b\s*[:\uFF1A)]/i.test(nextNonBlank(li)) && cur.choices.length === 0) {
          cur.ans = m[1]; lastMeta = m[1] ? null : 'ans'; continue;
        }
      }
      // explicit question starts
      var qm;
      if ((qm = R.qNum.exec(s))) {
        if (qm[2].trim()) startQuestion(qm[2].trim(), { numbered: true, marker: true, bold: wholeBold });
        else { newBlock('', { numbered: true, marker: true, bold: wholeBold }); }
        continue;
      }
      if (R.qNumOnly.test(s)) { newBlock('', { numbered: true, marker: true, bold: wholeBold }); continue; }
      if ((qm = R.qColon.exec(s))) { startQuestion(qm[1].trim(), { marker: true, bold: wholeBold }); continue; }
      if (!bullet && (qm = R.numDot.exec(s))) { startQuestion(qm[2].trim(), { numbered: true, bold: wholeBold }); continue; }
      if (bullet && (qm = R.numDot.exec(s)) && /\?\s*$/.test(qm[2])) { startQuestion(qm[2].trim(), { numbered: true, bold: wholeBold }); continue; }

      // choices
      if (cur && cur.q) {
        var allowAfterBlank = cur.choices.length > 0 || !cur.sawBlank || (cur.ans === null && !cur.fact);
        if (allowAfterBlank) {
          var t0 = s;
          // whole line holding several inline choices: "A) x  B) y  C) z"
          if (/^\(?A[).]/.test(t0)) {
            var inl2 = splitInline(t0);
            if (inl2 && inl2.head === '' && cur.choices.length === 0) {
              inl2.items.forEach(function (it, k) {
                var mk2 = stripMarkers(it);
                addChoice({ text: mk2.text, correct: mk2.correct, bold: mk2.weak || hasBold });
                cur.lastLetter = k;
              });
              lastMeta = null;
              continue;
            }
          }
          var mk = stripMarkers(t0);
          var lm = R.label.exec(mk.text), letterIdx = -1, rest = null;
          if (lm) {
            letterIdx = (lm[1] || lm[2] || lm[3] || lm[4] || lm[5]).toLowerCase().charCodeAt(0) - 97;
            var okLetter = cur.choices.length === 0 ? letterIdx === 0 : letterIdx > cur.lastLetter;
            if (okLetter && (cur.choices.length > 0 || !cur.sawBlank || letterIdx === 0)) rest = lm[6];
          }
          if (rest === null && bullet && !(/\?\s*$/.test(mk.text))) { rest = mk.text; letterIdx = cur.lastLetter + 1; }
          if (rest !== null) {
            var mk2b = stripMarkers(rest);
            if (mk2b.text) {
              addChoice({ text: mk2b.text, correct: mk.correct || mk2b.correct, bold: hasBold || mk.weak || mk2b.weak });
              cur.lastLetter = letterIdx;
              lastMeta = null;
              continue;
            }
          }
        }
      }

      // standalone "free response" marker
      if (cur && R.free.test(s)) { cur.type = 'free'; lastMeta = null; continue; }

      // plain line
      if (isHeading) { if (cur) cur.sawBlank = true; lastMeta = null; continue; }
      if (!cur) { newBlock(s, { bold: wholeBold }); continue; }
      if (cur.q === '') { cur.q = s; if (wholeBold) cur.qBold = true; continue; }
      var endsQ = /\?\s*$/.test(s);
      if (lastMeta && !hadBlank && !endsQ) {
        if (lastMeta === 'ans' && cur.ans === null) cur.ans = s;
        else cur[lastMeta] = (cur[lastMeta] ? cur[lastMeta] + ' ' : '') + s;
        if (lastMeta === 'ans') lastMeta = null;
        continue;
      }
      if (hadBlank || cur.sawBlank) { newBlock(s, { bold: wholeBold }); continue; }
      var started = cur.choices.length || cur.ans !== null || cur.fact || cur.kidFact || cur.level || cur.type || cur.emoji;
      if (started || /[?.!:]\s*$/.test(cur.q)) { startQuestion(s, { bold: wholeBold }); continue; }
      cur.q += ' ' + s;
    }
    flush();

    // blocks -> questions
    var nonBare = blocks.filter(function (b) { return !isBare(b); }).length;
    function isBare(b) {
      return !b.numbered && !b.marker && !b.choices.length && b.ans === null && !b.fact && !b.kidFact && !b.level && !b.type && !b.emoji && !/\?/.test(b.q);
    }
    var questions = [], shuffle = false;
    blocks.forEach(function (b) {
      if (!b.q) return;
      if (nonBare > 0 && isBare(b)) {
        if (warnings.length < 5) warnings.push('Skipped "' + b.q.slice(0, 40) + (b.q.length > 40 ? '...' : '') + '" (looks like a heading, not a question)');
        return;
      }
      var texts = b.choices.map(function (c) { return c.text; });
      var extra = [];
      var ansIdx = -1;
      if (b.ans !== null && texts.length) {
        ansIdx = resolveAnswer(b.ans, texts);
        if (ansIdx < 0 && b.ans) extra.push('Couldn\'t match the answer "' + b.ans + '" to a choice');
      }
      if (ansIdx < 0) {
        var marked = [];
        b.choices.forEach(function (c, i) { if (c.correct) marked.push(i); });
        if (marked.length) { ansIdx = marked[0]; if (marked.length > 1) extra.push('More than one choice was marked correct'); }
      }
      if (ansIdx < 0) {
        var bolds = [];
        b.choices.forEach(function (c, i) { if (c.bold) bolds.push(i); });
        if (bolds.length === 1 && !b.qBold) ansIdx = bolds[0];
      }
      var raw = { q: b.q, fact: b.fact, kidFact: b.kidFact, emoji: b.emoji, level: b.level, type: b.type };
      if (texts.length) {
        raw.choices = texts; raw.answer = ansIdx;
        if (typeOf(b.type) === 'free') { raw.type = 'free'; raw.answerText = ansIdx >= 0 ? texts[ansIdx] : (b.ans || ''); }
        else delete raw.type;
      } else {
        raw.type = 'free'; raw.answerText = b.ans || '';
        if (/^[A-Fa-f]$/.test(raw.answerText)) extra.push('Answer "' + raw.answerText + '" looks like a letter but there are no choices');
      }
      var q = normalize(raw);
      if (!q) return;
      extra.forEach(function (w) { q.warnings.push(w); });
      questions.push(q);
    });
    return finish(source || 'text', questions, warnings, text, shuffle);
  }

  // ---------------------------------------------------------------- JSON

  function removeTrailingCommas(t) {
    var out = '', inStr = false, esc = false;
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (inStr) { out += c; if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') { inStr = true; out += c; continue; }
      if (c === ',') {
        var j = i + 1;
        while (j < t.length && /\s/.test(t[j])) j++;
        if (t[j] === ']' || t[j] === '}') continue;
      }
      out += c;
    }
    return out;
  }
  function scanObjects(t) {
    var a = t.indexOf('['), o = t.indexOf('{'), start;
    if (o < 0) return [];
    if (a >= 0 && (a < o || /^\{\s*"[^"]*"\s*:\s*$/.test(t.slice(o, a)))) start = a;
    else start = o;
    var res = [], depth = 0, inStr = false, esc = false, objStart = -1;
    for (var i = start; i < t.length; i++) {
      var c = t[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') { if (depth === 0) objStart = i; depth++; }
      else if (c === '}') {
        depth--;
        if (depth === 0 && objStart >= 0) {
          try { res.push(JSON.parse(removeTrailingCommas(t.slice(objStart, i + 1)))); } catch (e) { /* skip bad object */ }
          objStart = -1;
        }
        if (depth < 0) depth = 0;
      }
    }
    return res;
  }
  function stripFences(t) {
    t = String(t).trim();
    var m = /```(?:json|JSON)?\s*\n?([\s\S]*?)(?:```|$)/.exec(t);
    return m ? m[1].trim() : t;
  }
  function tolerantJSON(text) {
    var t = stripFences(text), r;
    try { return JSON.parse(t); } catch (e) { /* next */ }
    try { return JSON.parse(removeTrailingCommas(t)); } catch (e2) { /* next */ }
    var a = t.indexOf('['), b = t.lastIndexOf(']');
    if (a >= 0 && b > a) { try { return JSON.parse(removeTrailingCommas(t.slice(a, b + 1))); } catch (e3) { /* next */ } }
    a = t.indexOf('{'); b = t.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(removeTrailingCommas(t.slice(a, b + 1))); } catch (e4) { /* next */ } }
    r = scanObjects(t);
    return r;
  }
  function rootToItems(v) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      var keys = ['questions', 'items', 'data', 'quiz', 'results', 'trivia', 'cards'];
      for (var i = 0; i < keys.length; i++) {
        var k = Object.keys(v).filter(function (x) { return x.toLowerCase() === keys[i]; })[0];
        if (k !== undefined) {
          var inner = rootToItems(v[k]);
          if (inner.length) return inner;
        }
      }
      var ck = compactKeys(v);
      if (ck.q !== undefined || ck.question !== undefined || ck.prompt !== undefined) return [v];
      var arrs = Object.keys(v).filter(function (k2) { return Array.isArray(v[k2]); });
      if (arrs.length === 1) return v[arrs[0]];
    }
    return [];
  }
  function itemsToQuestions(items) {
    var questions = [], shuffle = false, skipped = 0;
    items.forEach(function (it) {
      var q = normalize(it);
      if (!q) { skipped++; return; }
      var ck = compactKeys(it);
      if (ck.correctanswer !== undefined && (ck.incorrectanswers !== undefined || ck.wrong !== undefined) && q.type === 'mc' && !ck.choices && !ck.options) shuffle = true;
      questions.push(q);
    });
    return { questions: questions, shuffle: shuffle, skipped: skipped };
  }
  function parseJSONInternal(text) {
    var cleaned = clean(text);
    var val;
    try { val = tolerantJSON(cleaned); } catch (e) { return failure('json', "That JSON couldn't be read: " + (e && e.message), cleaned); }
    var items = rootToItems(val);
    var r = itemsToQuestions(items);
    var w = [];
    if (r.skipped) w.push(r.skipped + ' item' + (r.skipped === 1 ? '' : 's') + ' without a question were skipped.');
    return finish('json', r.questions, w, cleaned, r.shuffle);
  }

  // ---------------------------------------------------------------- public text entry

  function parseText(text) {
    try {
      var t = clean(String(text === null || text === undefined ? '' : text));
      if (!t) return failure('text', 'Nothing to import: the text is empty.', '');
      if (/^[\[{]/.test(t)) {
        var j = parseJSONInternal(t);
        if (j.questions.length) return j;
      }
      var all = t.split('\n').filter(function (l) { return l.trim(); });
      // markdown pipe table
      var pipe = all.filter(function (l) { return /^\s*\|/.test(l); });
      if (all.length >= 2 && pipe.length / all.length >= 0.7) {
        var prow = pipe.filter(function (l) { return !/^\s*\|?[\s:|-]+\|?\s*$/.test(l); }).map(function (l) {
          return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
        });
        var pr = parseRowsInternal(prow, 'csv');
        if (pr.questions.length) return pr;
      }
      // tab separated
      var tabbed = all.filter(function (l) { return l.indexOf('\t') >= 0; });
      var labelish = tabbed.filter(function (l) { return /^\(?[A-Fa-f][).:]?\t/.test(l.trim()); }).length;
      if (all.length >= 2 && tabbed.length / all.length >= 0.8 && labelish / tabbed.length < 0.2) {
        var tr = parseRowsInternal(parseDelimited(t, '\t'), 'tsv');
        if (tr.questions.length) return tr;
      }
      // comma / semicolon table with a recognisable header
      if (all.length >= 2) {
        var d = detectDelimiter(t);
        if (d !== '\t' && d !== '|') {
          var rows = parseDelimited(t, d);
          if (rows.length >= 2 && detectHeader(rows[0].map(clean))) {
            var cr = parseRowsInternal(rows, 'csv');
            if (cr.questions.length) return cr;
          }
        }
      }
      return parseTextInternal(t, 'text');
    } catch (e) {
      return failure('text', 'Something went wrong reading that text: ' + (e && e.message), String(text || ''));
    }
  }
  function parseRows(rows) {
    try { return parseRowsInternal(rows, 'csv'); }
    catch (e) { return failure('csv', 'Something went wrong reading that table: ' + (e && e.message), ''); }
  }

  // ---------------------------------------------------------------- ZIP reader

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function utf8(bytes) { return new TextDecoder('utf-8').decode(bytes); }

  function readZip(buf) {
    var n = buf.length, eocd = -1, i;
    for (i = n - 22; i >= Math.max(0, n - 22 - 65557); i--) {
      if (buf[i] === 0x50 && buf[i + 1] === 0x4B && buf[i + 2] === 5 && buf[i + 3] === 6) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip file');
    var count = u16(buf, eocd + 10), cdOff = u32(buf, eocd + 16);
    var entries = {}, p = cdOff;
    for (i = 0; i < count; i++) {
      if (p + 46 > n || u32(buf, p) !== 0x02014b50) break;
      var method = u16(buf, p + 10), csize = u32(buf, p + 20), usize = u32(buf, p + 24);
      var nl = u16(buf, p + 28), el = u16(buf, p + 30), cl = u16(buf, p + 32), lo = u32(buf, p + 42);
      var name = utf8(buf.subarray(p + 46, p + 46 + nl));
      entries[name] = { name: name, method: method, csize: csize, usize: usize, offset: lo };
      p += 46 + nl + el + cl;
    }
    return entries;
  }
  async function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') throw new Error("This browser can't unzip files (it needs Safari 16.4 or newer). Save the file as CSV or paste the text instead.");
    var ds = new DecompressionStream('deflate-raw');
    var writer = ds.writable.getWriter();
    var wp = writer.write(data).then(function () { return writer.close(); });
    wp.catch(function () { /* surfaced by reader */ });
    var reader = ds.readable.getReader(), chunks = [], total = 0;
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      chunks.push(r.value); total += r.value.length;
    }
    await wp;
    var out = new Uint8Array(total), off = 0;
    chunks.forEach(function (c) { out.set(c, off); off += c.length; });
    return out;
  }
  async function zipRead(buf, entries, name) {
    var e = entries[name];
    if (!e) return null;
    var o = e.offset;
    if (u32(buf, o) !== 0x04034b50) throw new Error('damaged zip entry ' + name);
    var start = o + 30 + u16(buf, o + 26) + u16(buf, o + 28);
    var data = buf.subarray(start, start + e.csize);
    if (e.method === 0) return data;
    if (e.method === 8) return inflateRaw(data);
    throw new Error('unsupported zip compression (' + e.method + ')');
  }
  async function zipText(buf, entries, name) {
    var d = await zipRead(buf, entries, name);
    return d ? utf8(d) : null;
  }

  // ---------------------------------------------------------------- XML helpers

  function xmlDecode(s) {
    return String(s)
      .replace(/_x([0-9A-Fa-f]{4})_/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|quot|apos|amp);/g, function (m, e) {
        if (e === 'lt') return '<';
        if (e === 'gt') return '>';
        if (e === 'quot') return '"';
        if (e === 'apos') return "'";
        if (e === 'amp') return '&';
        try { return String.fromCodePoint(e.charAt(1) === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)); } catch (err) { return m; }
      });
  }
  function attr(tag, name) {
    var re = new RegExp('(?:^|\\s)' + name.replace(/[:.]/g, '\\$&') + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')');
    var m = re.exec(tag);
    return m ? xmlDecode(m[1] !== undefined ? m[1] : m[2]) : null;
  }
  function textRuns(xml) {
    var out = '', re = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g, m;
    while ((m = re.exec(xml))) out += m[1] ? xmlDecode(m[1]) : '';
    return out;
  }
  function colIndex(ref) {
    var m = /^([A-Za-z]+)/.exec(ref || ''), n = 0;
    if (!m) return -1;
    for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].toUpperCase().charCodeAt(i) - 64);
    return n - 1;
  }

  // ---------------------------------------------------------------- XLSX

  function numStr(v) {
    if (/^-?\d+\.\d{10,}$/.test(v)) { var n = parseFloat(parseFloat(v).toPrecision(12)); return String(n); }
    return v;
  }
  function parseSheetXml(xml, shared) {
    var rows = [], rowRe = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g, rm;
    while ((rm = rowRe.exec(xml))) {
      var body = rm[1] || '', row = [], cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, cm, auto = 0;
      while ((cm = cellRe.exec(body))) {
        var attrs = cm[1], inner = cm[2] || '';
        var ref = attr(attrs, 'r'), ci = ref ? colIndex(ref) : auto;
        if (ci < 0) ci = auto;
        auto = ci + 1;
        var t = attr(attrs, 't'), val = '';
        var vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        if (t === 's') val = vm ? (shared[parseInt(vm[1], 10)] || '') : '';
        else if (t === 'inlineStr') val = textRuns(inner);
        else if (t === 'b') val = vm ? (vm[1].trim() === '1' ? 'TRUE' : 'FALSE') : '';
        else if (t === 'e') val = '';
        else if (t === 'str') val = vm ? xmlDecode(vm[1]) : '';
        else val = vm ? numStr(xmlDecode(vm[1]).trim()) : (inner.indexOf('<is') >= 0 ? textRuns(inner) : '');
        while (row.length < ci) row.push('');
        row[ci] = val;
      }
      rows.push(row);
    }
    return rows;
  }
  async function parseXlsxBuf(buf, entries) {
    var warnings = [];
    var shared = [];
    var ss = await zipText(buf, entries, 'xl/sharedStrings.xml');
    if (ss) {
      var siRe = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g, sm;
      while ((sm = siRe.exec(ss))) shared.push(sm[1] ? textRuns(sm[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')) : '');
    }
    var wb = await zipText(buf, entries, 'xl/workbook.xml');
    var rels = await zipText(buf, entries, 'xl/_rels/workbook.xml.rels');
    var relMap = {};
    if (rels) {
      var rr = /<Relationship\b[^>]*>/g, rmm;
      while ((rmm = rr.exec(rels))) {
        var id = attr(rmm[0], 'Id'), tg = attr(rmm[0], 'Target');
        if (id && tg) relMap[id] = tg.charAt(0) === '/' ? tg.slice(1) : 'xl/' + tg.replace(/^\.\//, '');
      }
    }
    var sheets = [];
    if (wb) {
      var shRe = /<sheet\b[^>]*>/g, shm;
      while ((shm = shRe.exec(wb))) {
        var rid = attr(shm[0], 'r:id');
        sheets.push({ name: attr(shm[0], 'name') || 'Sheet', path: rid ? relMap[rid] : null, hidden: /^(hidden|veryHidden)$/.test(attr(shm[0], 'state') || '') });
      }
    }
    if (!sheets.length || sheets.every(function (s) { return !s.path || !entries[s.path]; })) {
      sheets = Object.keys(entries).filter(function (k) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(k); })
        .sort(function (a, b) { return parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10); })
        .map(function (k) { return { name: k, path: k, hidden: false }; });
    }
    var visible = sheets.filter(function (s) { return !s.hidden && s.path && entries[s.path]; });
    if (!visible.length) visible = sheets.filter(function (s) { return s.path && entries[s.path]; });
    if (!visible.length) return { rows: [], warnings: ['No worksheets were found in this spreadsheet.'] };
    var chosen = null, rows = [];
    for (var i = 0; i < visible.length; i++) {
      var xml = await zipText(buf, entries, visible[i].path);
      var r = parseSheetXml(xml || '', shared);
      if (r.some(function (row) { return row.some(Boolean); })) { chosen = visible[i]; rows = r; break; }
    }
    if (!chosen) return { rows: [], warnings: ['The spreadsheet is empty.'] };
    if (visible.length > 1) warnings.push('Only the sheet "' + chosen.name + '" was imported (the others were ignored).');
    return { rows: rows, warnings: warnings };
  }

  // ---------------------------------------------------------------- DOCX

  function boldWrap(segs) {
    var out = '', i = 0;
    while (i < segs.length) {
      if (segs[i].b) {
        var j = i, chunk = '';
        while (j < segs.length && segs[j].b) { chunk += segs[j].t; j++; }
        var lead = /^\s*/.exec(chunk)[0], trail = /\s*$/.exec(chunk)[0];
        var core = chunk.trim();
        out += core ? lead + '**' + core + '**' + trail : chunk;
        i = j;
      } else { out += segs[i].t; i++; }
    }
    return out;
  }
  function parseParagraph(pxml, inTable) {
    var lines = [[]];
    var runRe = /<w:r\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:r>)/g, rm;
    while ((rm = runRe.exec(pxml))) {
      var rx = rm[1] || '';
      var rpr = /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(rx);
      var bold = false;
      if (rpr) {
        var bm = /<w:b\b([^>]*)\/?>/.exec(rpr[1]);
        if (bm && !/w:val\s*=\s*"(?:0|false|off)"/.test(bm[1])) bold = true;
      }
      var tokRe = /<w:t\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:t>)|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>/g, tm;
      while ((tm = tokRe.exec(rx))) {
        var tok = tm[0];
        if (/^<w:t\b/.test(tok)) lines[lines.length - 1].push({ t: tm[1] ? xmlDecode(tm[1]) : '', b: bold });
        else if (/^<w:tab\b/.test(tok)) lines[lines.length - 1].push({ t: '\t', b: false });
        else lines.push([]);
      }
    }
    var isList = /<w:numPr\b/.test(pxml);
    return lines.map(function (segs, k) {
      var s = inTable ? segs.map(function (x) { return x.t; }).join('') : boldWrap(segs);
      return (isList && k === 0 && s.trim() ? '- ' : '') + s;
    });
  }
  function parseDocXml(xml) {
    var bodyM = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(xml);
    var body = bodyM ? bodyM[1] : xml;
    var re = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*?(?:\/>|>[\s\S]*?<\/w:p>)/g, m;
    var lines = [], tableRows = [];
    while ((m = re.exec(body))) {
      var chunk = m[0];
      if (/^<w:tbl\b/.test(chunk)) {
        var trRe = /<w:tr\b[\s\S]*?<\/w:tr>/g, tr;
        while ((tr = trRe.exec(chunk))) {
          var cells = [], tcRe = /<w:tc\b[\s\S]*?<\/w:tc>/g, tc;
          while ((tc = tcRe.exec(tr[0]))) {
            var ps = [], pRe = /<w:p\b[^>]*?(?:\/>|>[\s\S]*?<\/w:p>)/g, pm;
            while ((pm = pRe.exec(tc[0]))) ps.push(parseParagraph(pm[0], true).join(' ').replace(/\s+/g, ' ').trim());
            cells.push(ps.filter(Boolean).join(' '));
          }
          if (cells.some(Boolean)) { tableRows.push(cells); lines.push({ kind: 't', text: cells.map(function (c) { return c.replace(/\t/g, ' '); }).join('\t') }); }
        }
      } else {
        parseParagraph(chunk, false).forEach(function (l) { lines.push({ kind: 'p', text: l }); });
      }
    }
    return { lines: lines, tableRows: tableRows };
  }
  async function parseDocxBuf(buf, entries) {
    var xml = await zipText(buf, entries, 'word/document.xml');
    var d = parseDocXml(xml || '');
    var rawText = d.lines.map(function (l) { return l.text; }).join('\n');
    var nonEmpty = d.lines.filter(function (l) { return l.text.trim(); });
    var tcount = nonEmpty.filter(function (l) { return l.kind === 't'; }).length;
    if (nonEmpty.length && tcount && tcount / nonEmpty.length >= 0.6) {
      var res = parseRowsInternal(d.tableRows, 'docx');
      res.rawText = rawText;
      if (res.questions.length) return res;
    }
    var tr = parseTextInternal(rawText, 'docx');
    tr.rawText = rawText;
    return tr;
  }

  // ---------------------------------------------------------------- files

  function decodeBytes(buf) {
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf.subarray(2));
    if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf.subarray(2));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { /* not utf-8 */ }
    try { return new TextDecoder('windows-1252').decode(buf); } catch (e2) { /* fall through */ }
    var s = '';
    for (var i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return s;
  }
  function htmlToText(h) {
    return decodeEntities(h
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<\/t[dh]>/gi, '\t')
      .replace(/<[^>]+>/g, ''))
      .replace(/\n{3,}/g, '\n\n');
  }
  function sniffKind(buf, ext) {
    var n = buf.length;
    if (n >= 4 && buf[0] === 0x50 && buf[1] === 0x4B && (buf[2] === 3 || buf[2] === 5)) return 'zip';
    if (n >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'pdf';
    if (n >= 4 && ((buf[0] === 0x89 && buf[1] === 0x50) || (buf[0] === 0xFF && buf[1] === 0xD8) || (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) || (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46))) return 'image';
    if (n >= 8 && buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0) return 'ole';
    if (/^(png|jpe?g|gif|heic|heif|webp|bmp|tiff?)$/.test(ext)) return 'image';
    var lim = Math.min(n, 4000), nul = 0;
    var utf16 = n >= 2 && ((buf[0] === 0xFF && buf[1] === 0xFE) || (buf[0] === 0xFE && buf[1] === 0xFF));
    if (!utf16) for (var i = 0; i < lim; i++) if (buf[i] === 0) nul++;
    if (nul > 0) return 'binary';
    return 'text';
  }
  var MSG = {
    pdf: "PDF files can't be read offline: copy the text and paste it instead, or export as .docx/.csv",
    image: "Pictures can't be read offline: type the questions in, or paste the text instead.",
    ole: "Old Word/Excel files (.doc/.xls/.ppt) can't be read: open the file and save it as .docx, .xlsx or .csv, then try again.",
    iwork: "Apple Pages/Numbers/Keynote files can't be read: use File > Export To > Word, Excel or CSV, then try again.",
    zip: "This kind of file can't be read offline: copy the text and paste it instead, or save it as .docx/.xlsx/.csv.",
    binary: "This file can't be read offline: copy the text and paste it instead, or save it as .docx/.xlsx/.csv."
  };

  async function readBuffer(file) {
    if (file && typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
    if (file && typeof file.text === 'function') return new TextEncoder().encode(await file.text());
    throw new Error('That is not a readable file.');
  }

  async function parseFile(file) {
    var name = (file && file.name) ? String(file.name) : '';
    var ext = (name.indexOf('.') >= 0 ? name.split('.').pop() : '').toLowerCase();
    try {
      var buf = await readBuffer(file);
      if (!buf.length) return failure('text', 'That file is empty.', '');
      var kind = sniffKind(buf, ext);
      if (kind === 'zip') {
        var entries;
        try { entries = readZip(buf); } catch (e) { return failure('text', MSG.zip, ''); }
        if (entries['xl/workbook.xml']) {
          var xr = await parseXlsxBuf(buf, entries);
          var res = parseRowsInternal(xr.rows, 'xlsx');
          res.warnings = xr.warnings.concat(res.warnings);
          return res;
        }
        if (entries['word/document.xml']) return await parseDocxBuf(buf, entries);
        var names = Object.keys(entries).join(' ');
        return failure('text', /(^|\s)(Index\/|index\.xml|Metadata\/)/.test(names) || /^(pages|numbers|key)$/.test(ext) ? MSG.iwork : MSG.zip, '');
      }
      if (kind === 'pdf') return failure('text', MSG.pdf, '');
      if (kind === 'image') return failure('text', MSG.image, '');
      if (kind === 'ole') return failure('text', MSG.ole, '');
      if (kind === 'binary') return failure('text', /^(pages|numbers|key)$/.test(ext) ? MSG.iwork : MSG.binary, '');
      if (/^(pages|numbers|key)$/.test(ext)) return failure('text', MSG.iwork, '');

      var text = decodeBytes(buf);
      if (/^(html?|xhtml)$/.test(ext) || /^\s*(<!doctype html|<html)/i.test(text.slice(0, 200))) text = htmlToText(text);
      if (ext === 'json') {
        var jr = parseJSONInternal(text);
        if (jr.questions.length) return jr;
        return jr;
      }
      if (ext === 'csv' || ext === 'tsv' || ext === 'tab') {
        var delim = ext === 'csv' ? detectDelimiter(text) : (text.indexOf('\t') >= 0 ? '\t' : detectDelimiter(text));
        var rows = parseDelimited(text, delim);
        var tres = parseRowsInternal(rows, delim === '\t' ? 'tsv' : 'csv');
        if (ext === 'tsv' && delim === '\t') tres.source = 'tsv';
        return tres;
      }
      return parseText(text);
    } catch (e) {
      return failure('text', "That file couldn't be read: " + (e && e.message ? e.message : 'unknown error') + '. Try copying the text and pasting it instead.', '');
    }
  }

  // ---------------------------------------------------------------- AI fallback

  var SYSTEM_PROMPT = [
    'You convert trivia questions found in a document into strict JSON.',
    'Reply with ONLY a JSON array (no prose, no markdown fences). Each element has exactly these keys:',
    '{"type":"mc"|"free","q":string,"choices":string[],"answer":number,"answerText":string,"fact":string,"kidFact":string,"emoji":string,"level":"kids"|"everyone"|"hard"}',
    'Rules:',
    '- Never invent questions. Only output questions that are actually in the document. If there are none, output [].',
    '- Never change the wording of the source: copy question and answer text exactly (you may drop numbering like "1." or "Q1:").',
    '- If a question has no answer choices, set type to "free", choices to [], answer to -1, and put the reference answer in answerText ("" if the document gives none).',
    '- If a question has choices, set type to "mc", keep the choices in their original order without the A)/B) labels, and set answer to the 0-based INDEX of the correct choice (-1 if the document does not say which is correct). answerText is "" for mc.',
    '- Copy any fact, explanation or "did you know" text into fact if the document has one, otherwise "". Copy a simpler kid-friendly version into kidFact if present, otherwise "".',
    '- emoji is one emoji only if the document gives one, otherwise "". level is "kids", "everyone" or "hard" (default "everyone").',
    '- Output valid JSON only.'
  ].join('\n');

  function isQStart(line) {
    return /^\s*(?:(?:question|q)\s*#?\s*\d+\b|\(?\d{1,3}[.)]\s|(?:question|q)\s*:)/i.test(line);
  }
  function hardSplit(line, limit) {
    var out = [];
    while (line.length > limit) {
      var cut = line.lastIndexOf(' ', limit);
      if (cut < limit * 0.5) cut = limit;
      out.push(line.slice(0, cut));
      line = line.slice(cut).replace(/^\s+/, '');
    }
    out.push(line);
    return out;
  }
  function chunkText(text, limit) {
    limit = limit || 5000;
    var lines = [];
    String(text).split('\n').forEach(function (l) { (l.length > limit ? hardSplit(l, limit) : [l]).forEach(function (x) { lines.push(x); }); });
    var chunks = [], start = 0;
    while (start < lines.length) {
      var len = 0, i = start;
      while (i < lines.length && (i === start || len + lines[i].length + 1 <= limit)) { len += lines[i].length + 1; i++; }
      if (i < lines.length) {
        var minCut = start + Math.max(1, Math.floor((i - start) * 0.4)), cut = -1, c;
        for (c = i; c >= minCut; c--) if (isQStart(lines[c])) { cut = c; break; }
        if (cut < 0) for (c = i; c >= minCut; c--) if (lines[c].trim() === '') { cut = c; break; }
        i = cut < 0 ? i : cut;
      }
      var piece = lines.slice(start, i).join('\n').trim();
      if (piece) chunks.push(piece);
      start = i;
    }
    return chunks;
  }

  async function readErrorDetail(resp) {
    try {
      var t = typeof resp.text === 'function' ? await resp.text() : '';
      try {
        var j = JSON.parse(t);
        var m = (j && j.error && (j.error.message || j.error)) || (j && (j.message || j.detail));
        if (m) return typeof m === 'string' ? m : JSON.stringify(m);
      } catch (e) { /* not json */ }
      return String(t || '').slice(0, 200);
    } catch (e2) { return ''; }
  }

  async function aiParse(text, opts) {
    opts = opts || {};
    var endpoint = opts.endpoint || DEFAULT_ENDPOINT;
    var model = opts.model || DEFAULT_MODEL;
    var fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch.bind(typeof globalThis !== 'undefined' ? globalThis : undefined) : null);
    if (!fetchImpl) throw new Error("This browser can't make network requests, so AI import isn't available.");
    var src = clean(text);
    if (!src) return { questions: [], warnings: ['There was no text to send to the AI.'] };
    var srcNorm = norm(src);
    var chunks = chunkText(src, 5000);
    var warnings = [], all = [], seen = {};

    for (var ci = 0; ci < chunks.length; ci++) {
      if (typeof opts.onProgress === 'function') { try { opts.onProgress(ci, chunks.length); } catch (e) { /* ignore */ } }
      var body = {
        key: opts.key, model: model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: 'Extract the trivia questions from this document' + (chunks.length > 1 ? ' (part ' + (ci + 1) + ' of ' + chunks.length + ')' : '') + '. Reply with ONLY the JSON array.\n\n-----\n' + chunks[ci] + '\n-----' }
        ],
        temperature: 0, max_tokens: 4096,
        chat_template_kwargs: { enable_thinking: false }   // answer directly (thinking models otherwise spend seconds reasoning first)
      };
      var resp;
      try {
        resp = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: opts.signal });
      } catch (e) {
        throw new Error("Couldn't reach the AI service (" + ((e && e.message) || 'network error') + '). Check the connection and try again.');
      }
      if (!resp || !resp.ok) {
        var st = resp ? resp.status : 0, err;
        if (st === 401 || st === 403) err = new Error('NVIDIA key rejected');
        else if (st === 429) err = new Error('Rate limited, try again in a minute');
        else {
          var detail = resp ? await readErrorDetail(resp) : '';
          if (st === 404) err = new Error('The AI endpoint was not found (' + endpoint + ')');
          else if (st >= 500) err = new Error('The AI service had a problem (HTTP ' + st + '). Try again in a minute.' + (detail ? ' ' + detail : ''));
          else err = new Error('The AI service refused the request (HTTP ' + st + ').' + (detail ? ' ' + detail : ''));
        }
        err.status = st;
        throw err;
      }
      var data;
      try {
        if (typeof resp.text === 'function') data = JSON.parse(await resp.text());
        else data = await resp.json();
      } catch (e) {
        throw new Error("The AI service sent back something that wasn't JSON.");
      }
      if (data && data.error) throw new Error('AI service error: ' + (typeof data.error === 'string' ? data.error : (data.error.message || 'unknown')));
      var ch = data && data.choices && data.choices[0];
      var content = ch && ch.message && ch.message.content;
      if (Array.isArray(content)) content = content.map(function (p) { return p && p.text ? p.text : ''; }).join('');
      if (typeof content !== 'string' || !content.trim()) {
        warnings.push('The AI returned nothing for part ' + (ci + 1) + '.');
        continue;
      }
      var val;
      try { val = tolerantJSON(content); } catch (e) { val = null; }
      var items = val === null ? [] : rootToItems(val);
      if (!items.length && !/\[\s*\]/.test(content)) warnings.push("Couldn't read the AI's answer for part " + (ci + 1) + '.');
      if (ch && ch.finish_reason === 'length') warnings.push('The AI ran out of room on part ' + (ci + 1) + '; some questions at the end of it may be missing.');
      items.forEach(function (it) {
        var q = normalize(it);
        if (!q) return;
        var key = norm(q.q);
        if (seen[key]) return;
        seen[key] = true;
        if (srcNorm.indexOf(key) < 0) q.warnings.push('Wording differs from your document - please check it');
        all.push(q);
      });
    }
    if (all.length > MAX_QUESTIONS) {
      warnings.push('Only the first ' + MAX_QUESTIONS + ' questions were kept.');
      all = all.slice(0, MAX_QUESTIONS);
    }
    return { questions: all, warnings: warnings };
  }

  // ---------------------------------------------------------------- samples

  var SAMPLE_TEXT = [
    '1. What is the capital of France?',
    'A) Berlin',
    'B) Paris',
    'C) Madrid',
    'D) Rome',
    'Answer: B',
    'Fact: Paris has been the capital of France for over a thousand years.',
    'Kid: Paris is the big city with the Eiffel Tower!',
    'Emoji: \uD83D\uDDFC',
    'Level: kids',
    '',
    '2. Which planet is known as the Red Planet?',
    'A) Venus',
    'B) Mars *',
    'C) Jupiter',
    '',
    '3. Who painted the Mona Lisa?',
    'Answer: Leonardo da Vinci',
    ''
  ].join('\n');

  var TEMPLATE_CSV = [
    'Type,Question,Correct answer,Wrong 1,Wrong 2,Wrong 3,Fact,Kid fact,Emoji,Level',
    'mc,What is the largest ocean on Earth?,Pacific,Atlantic,Indian,Arctic,,,\uD83C\uDF0A,everyone',
    'free,Who wrote Romeo and Juliet?,William Shakespeare,,,,,,,hard',
    'mc,How many legs does a spider have?,8,6,10,4,Spiders are arachnids not insects.,Spiders have 8 legs - two more than insects!,\uD83D\uDD77\uFE0F,kids'
  ].join('\r\n') + '\r\n';

  var api = {
    parseFile: parseFile,
    parseText: parseText,
    parseRows: parseRows,
    aiParse: aiParse,
    normalize: normalize,
    SAMPLE_TEXT: SAMPLE_TEXT,
    TEMPLATE_CSV: TEMPLATE_CSV,
    // exposed for tests / the UI
    chunkText: chunkText,
    parseCSV: function (text, delim) { return parseDelimited(String(text), delim || detectDelimiter(String(text))); },
    DEFAULT_MODEL: DEFAULT_MODEL,
    MAX_QUESTIONS: MAX_QUESTIONS
  };

  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Importer = api;
  else if (typeof self !== 'undefined') self.Importer = api;
})();
