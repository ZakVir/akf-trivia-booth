#!/usr/bin/env node
/* Run: node tests/importer.test.js   (plain assert, no frameworks) */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Importer = require('../importer.js');

const FIX = path.join(__dirname, 'fixtures');
const fileShim = (name, bytesOrText) => {
  const buf = Buffer.isBuffer(bytesOrText) ? bytesOrText : Buffer.from(bytesOrText, 'utf8');
  return {
    name,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    text: async () => buf.toString('utf8')
  };
};
const fixture = (name) => fileShim(name, fs.readFileSync(path.join(FIX, name)));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------------------------------------------------------------- local parsers

test('csv with header: correct + wrong columns', async () => {
  const r = await Importer.parseFile(fixture('header_wrong.csv'));
  assert.strictEqual(r.source, 'csv');
  assert.strictEqual(r.questions.length, 3);
  const [a, b, c] = r.questions;
  assert.strictEqual(a.q, 'What is the capital of France?'); // numbering stripped
  assert.deepStrictEqual(a.choices, ['Paris', 'Berlin', 'Madrid', 'Rome']);
  assert.strictEqual(a.answer, 0);
  assert.strictEqual(a.type, 'mc');
  assert.strictEqual(a.fact, 'Paris is on the Seine.');
  assert.strictEqual(a.level, 'kids');
  assert.strictEqual(b.q, 'Which planet is red?');
  assert.deepStrictEqual(b.choices, ['Mars', 'Venus', 'Jupiter']);
  assert.strictEqual(b.level, 'everyone');
  assert.strictEqual(c.fact, 'Math, basic');
  assert.strictEqual(c.level, 'hard');
  assert.strictEqual(r.shuffleSuggested, true);
  assert.strictEqual(r.needsAI, false);
});

test('csv with quoted newlines, escaped quotes, BOM, CRLF, letter/text/number answers', async () => {
  const r = await Importer.parseFile(fixture('quoted_bom.csv'));
  assert.strictEqual(r.questions.length, 3);
  const [a, b, c] = r.questions;
  assert.strictEqual(a.q, 'Which line breaks in a question?');
  assert.deepStrictEqual(a.choices, ['He said "hi"', 'Two', 'Three', 'Four']);
  assert.strictEqual(a.answer, 0); // letter A
  assert.strictEqual(a.fact, 'A multi-line fact, with comma');
  assert.strictEqual(b.answer, 1); // answer equals choice text
  assert.deepStrictEqual(c.choices, ['x', 'y', 'z']); // blank D dropped
  assert.strictEqual(c.answer, 2); // number 3 (1-based)
  assert.strictEqual(r.shuffleSuggested, false); // options layout keeps author order
});

test('csv semicolon delimiter autodetect', async () => {
  const r = await Importer.parseFile(fileShim('x.csv', 'Question;Answer;Wrong 1\nWhat, exactly?;Yes;No\n'));
  assert.strictEqual(r.questions.length, 1);
  assert.strictEqual(r.questions[0].q, 'What, exactly?');
  assert.deepStrictEqual(r.questions[0].choices, ['Yes', 'No']);
});

test('tsv without header (2 cols => free, 3+ => correct first)', async () => {
  const r = await Importer.parseFile(fixture('noheader.tsv'));
  assert.strictEqual(r.source, 'tsv');
  assert.strictEqual(r.questions.length, 3);
  assert.deepStrictEqual(r.questions[0].choices, ['Paris', 'Berlin', 'Madrid']);
  assert.strictEqual(r.questions[0].answer, 0);
  assert.strictEqual(r.questions[1].type, 'free');
  assert.strictEqual(r.questions[1].answerText, 'Red');
  assert.strictEqual(r.questions[2].type, 'mc');
  assert.strictEqual(r.shuffleSuggested, true);
});

test('free-response csv', async () => {
  const r = await Importer.parseFile(fixture('free.csv'));
  assert.strictEqual(r.questions.length, 3);
  assert.ok(r.questions.every((q) => q.type === 'free' && q.choices.length === 0));
  assert.strictEqual(r.questions[0].answerText, 'Leonardo da Vinci');
  assert.strictEqual(r.questions[0].fact, 'Painted around 1503.');
  assert.strictEqual(r.questions[1].answerText, '1945');
  assert.strictEqual(r.questions[2].answerText, '');
  assert.ok(r.questions[2].warnings.some((w) => /No reference answer/.test(w)));
  assert.strictEqual(r.shuffleSuggested, false);
});

test('markdown-style text: A)/a. choices, bullets, Answer lines, meta', async () => {
  const r = await Importer.parseFile(fixture('markdown.md'));
  assert.strictEqual(r.source, 'text');
  assert.strictEqual(r.questions.length, 4, JSON.stringify(r.questions.map((q) => q.q)));
  const [a, b, c, d] = r.questions;
  assert.strictEqual(a.q, 'What is the capital of Switzerland?');
  assert.deepStrictEqual(a.choices, ['Zurich', 'Geneva', 'Bern', 'Basel']);
  assert.strictEqual(a.answer, 2);
  assert.strictEqual(a.fact, 'Bern is called the federal city.');
  assert.strictEqual(a.kidFact, 'Bern is a small city with bears!');
  assert.deepStrictEqual(b.choices, ['Oxygen', 'Carbon dioxide', 'Helium']);
  assert.strictEqual(b.answer, 1);
  assert.strictEqual(b.level, 'kids');
  assert.strictEqual(b.emoji, '\u{1F331}');
  assert.deepStrictEqual(c.choices, ['Marie Curie', 'Alexander Fleming', 'Louis Pasteur']);
  assert.strictEqual(c.answer, 1);
  assert.strictEqual(d.type, 'free');
  assert.strictEqual(d.answerText, 'Blue whale');
});

test('text with * / (correct) / check markers', async () => {
  const r = await Importer.parseFile(fixture('star_marker.txt'));
  assert.strictEqual(r.questions.length, 4);
  assert.deepStrictEqual(r.questions.map((q) => q.answer), [1, 1, 0, 1]);
  assert.deepStrictEqual(r.questions[0].choices, ['Shark', 'Dolphin', 'Trout']);
  assert.deepStrictEqual(r.questions[1].choices, ['Milan', 'Rome', 'Turin']);
});

test('Q:/A: pairs and inline Question ... Answer ...', async () => {
  const r = await Importer.parseFile(fixture('qa_pairs.txt'));
  assert.strictEqual(r.questions.length, 3, JSON.stringify(r.questions));
  assert.ok(r.questions.every((q) => q.type === 'free'));
  assert.strictEqual(r.questions[0].answerText, 'Mount Everest');
  assert.strictEqual(r.questions[1].answerText, 'Jane Austen');
  assert.strictEqual(r.questions[1].fact, 'Published in 1813.');
  assert.strictEqual(r.questions[2].q, 'What is H2O?');
  assert.strictEqual(r.questions[2].answerText, 'Water');
});

test('text: question with nothing else => free + warning; docx-ish one-line-per-paragraph', async () => {
  const r = Importer.parseText('What is your favourite colour?\nWhy is the sky blue?\nAnswer: Rayleigh scattering');
  assert.strictEqual(r.questions.length, 2);
  assert.strictEqual(r.questions[0].answerText, '');
  assert.ok(r.questions[0].warnings.some((w) => /No reference answer/.test(w)));
  assert.strictEqual(r.questions[1].answerText, 'Rayleigh scattering');
});

test('text: no blank lines, unnumbered questions ending in ?, inline choices, "Answer: Geneva"', async () => {
  const t = [
    'Which city hosts the UN in Europe?', 'A) Geneva', 'B) Oslo', 'C) Rome', 'Ans: a',
    'Pick the odd one out? A) Dog B) Cat C) Car D) Cow', 'Correct: C',
    'Largest bird?', 'Answer: Ostrich'
  ].join('\n');
  const r = Importer.parseText(t);
  assert.strictEqual(r.questions.length, 3, JSON.stringify(r.questions.map((q) => q.q)));
  assert.strictEqual(r.questions[0].answer, 0);
  assert.deepStrictEqual(r.questions[1].choices, ['Dog', 'Cat', 'Car', 'Cow']);
  assert.strictEqual(r.questions[1].answer, 2);
});

test('text: Answer by text and **bold** markup rules', async () => {
  let r = Importer.parseText('1. Capital of Spain?\nA) Madrid\nB) Lisbon\nAnswer: Madrid');
  assert.strictEqual(r.questions[0].answer, 0);
  r = Importer.parseText('1. Capital of Spain?\nA) Madrid\nB) **Lisbon**\nC) Rome');
  assert.strictEqual(r.questions[0].answer, 1);
  r = Importer.parseText('**1. Capital of Spain?**\nA) **Madrid**\nB) Lisbon');
  assert.strictEqual(r.questions[0].answer, -1); // wholly bold question => bold ignored
  assert.ok(r.questions[0].warnings.some((w) => /No correct answer/.test(w)));
  r = Importer.parseText('1. Capital of Spain?\nA) **Madrid**\nB) **Lisbon**');
  assert.strictEqual(r.questions[0].answer, -1); // two bold => ignored
});

test('json: array of schema objects', async () => {
  const r = await Importer.parseFile(fixture('questions_a.json'));
  assert.strictEqual(r.source, 'json');
  assert.strictEqual(r.questions.length, 3);
  assert.strictEqual(r.questions[0].answer, 1);
  assert.strictEqual(r.questions[0].emoji, '\u2795');
  assert.strictEqual(r.questions[0].level, 'kids');
  assert.strictEqual(r.questions[1].type, 'free');
  assert.strictEqual(r.questions[1].answerText, 'Red');
  assert.strictEqual(r.questions[2].type, 'free'); // lone choice => free
  assert.strictEqual(r.questions[2].answerText, 'Lonely');
});

test('json: {questions:[...]} with alternates and trailing commas', async () => {
  const r = await Importer.parseFile(fixture('questions_b.json'));
  assert.strictEqual(r.questions.length, 3);
  assert.deepStrictEqual(r.questions[0].choices, ['Tokyo', 'Kyoto', 'Osaka', 'Nagoya']);
  assert.strictEqual(r.questions[0].answer, 0);
  assert.strictEqual(r.questions[0].level, 'kids');
  assert.strictEqual(r.questions[1].answer, 1);
  assert.strictEqual(r.questions[1].fact, 'Apples grow on trees.');
  assert.strictEqual(r.questions[2].answer, 1);
  assert.strictEqual(r.questions[2].level, 'hard');
  assert.strictEqual(r.shuffleSuggested, true);
});

test('pasted text sniffing: json / tsv / csv-with-header / pipe table', async () => {
  assert.strictEqual(Importer.parseText('[{"q":"Hi?","answerText":"Yes"}]').source, 'json');
  assert.strictEqual(Importer.parseText('Q one?\tA\tB\nQ two?\tC\tD').source, 'tsv');
  const c = Importer.parseText('Question,Answer,Wrong 1\n"Hi, there?",Yes,No\nBye?,Ok,Nope');
  assert.strictEqual(c.source, 'csv');
  assert.strictEqual(c.questions.length, 2);
  const p = Importer.parseText('| Question | Answer |\n|---|---|\n| Who? | Me |\n| Where? | Here |');
  assert.strictEqual(p.questions.length, 2);
});

test('parseRows, shape, SAMPLE_TEXT and TEMPLATE_CSV', async () => {
  const r = Importer.parseRows([['Question', 'A', 'B', 'C', 'Answer'], ['Pick?', 'x', 'y', 'z', 'C']]);
  assert.deepStrictEqual(r.questions[0].choices, ['x', 'y', 'z']);
  assert.strictEqual(r.questions[0].answer, 2);
  const s = Importer.parseText(Importer.SAMPLE_TEXT);
  assert.strictEqual(s.questions.length, 3);
  assert.strictEqual(s.questions[0].answer, 1);
  assert.strictEqual(s.questions[0].level, 'kids');
  assert.strictEqual(s.questions[1].answer, 1);
  assert.strictEqual(s.questions[2].type, 'free');
  const t = await Importer.parseFile(fileShim('template.csv', Importer.TEMPLATE_CSV));
  assert.strictEqual(t.questions.length, 3);
  assert.strictEqual(t.questions[0].type, 'mc');
  assert.strictEqual(t.questions[1].type, 'free');
  assert.strictEqual(t.questions[1].answerText, 'William Shakespeare');
  assert.strictEqual(t.questions[2].fact, 'Spiders are arachnids not insects.');
  assert.strictEqual(t.questions[2].level, 'kids');
  for (const q of t.questions) {
    assert.deepStrictEqual(Object.keys(q).sort(), ['answer', 'answerText', 'choices', 'emoji', 'fact', 'kidFact', 'level', 'q', 'type', 'warnings']);
  }
});

test('normalize: schema enforcement', async () => {
  const n = Importer.normalize({ q: ' 3. Pick \u201Cone\u201D\u200B ', choices: ['A) a', 'B) b', '', 'C) c'], answer: 'C', emoji: 'xx', level: 'Difficult' });
  assert.strictEqual(n.q, 'Pick "one"');
  assert.deepStrictEqual(n.choices, ['a', 'b', 'c']);
  assert.strictEqual(n.answer, 2);
  assert.strictEqual(n.emoji, '');
  const dd = Importer.normalize({ q: 'x', choices: ['a', 'b', 'B', 'c'], answer: 'B' });
  assert.deepStrictEqual(dd.choices, ['a', 'b', 'c']);
  assert.strictEqual(dd.answer, 1);
  assert.strictEqual(n.level, 'hard');
  assert.strictEqual(Importer.normalize({ q: 'x', choices: ['1', '2'], answer: 0, emoji: '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}' }).emoji, '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}');
  const lone = Importer.normalize({ q: 'x', type: 'mc', choices: ['only'] });
  assert.strictEqual(lone.type, 'free');
  assert.strictEqual(lone.answerText, 'only');
  assert.ok(lone.warnings.some((w) => /Only one choice/.test(w)));
  const many = Importer.normalize({ q: 'x', choices: ['1', '2', '3', '4', '5', '6', '7', '8'], answer: 7 });
  assert.strictEqual(many.choices.length, 6);
  assert.strictEqual(many.choices[many.answer], '8');
  assert.strictEqual(Importer.normalize({ q: '' }), null);
  assert.strictEqual(Importer.normalize({ q: 'x', choices: ['a', 'b'] }).answer, -1);
});

test('cap at 500 questions', async () => {
  const lines = [];
  for (let i = 0; i < 520; i++) lines.push('Question ' + i + ' text,Answer ' + i);
  const r = await Importer.parseFile(fileShim('big.csv', lines.join('\n')));
  assert.strictEqual(r.questions.length, 500);
  assert.ok(r.warnings.some((w) => /500/.test(w)));
});

test('never throws on junk', async () => {
  for (const f of [fileShim('a.docx', 'not a zip'), fileShim('a.xlsx', Buffer.from([0x50, 0x4b, 3, 4, 1, 2, 3])), fileShim('a.csv', '"unterminated,\n'), fileShim('a.json', '{{{'), fileShim('empty.txt', '')]) {
    const r = await Importer.parseFile(f);
    assert.ok(Array.isArray(r.questions) && Array.isArray(r.warnings));
  }
  assert.doesNotThrow(() => Importer.parseText(null));
  assert.doesNotThrow(() => Importer.parseRows(null));
});

test('binary formats: pdf / image / unknown => needsAI with clear warning', async () => {
  const pdf = await Importer.parseFile(fileShim('quiz.pdf', Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj', 'latin1')));
  assert.strictEqual(pdf.needsAI, true);
  assert.strictEqual(pdf.questions.length, 0);
  assert.ok(/PDF files can't be read offline/.test(pdf.warnings[0]));
  const png = await Importer.parseFile(fileShim('q.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0])));
  assert.strictEqual(png.needsAI, true);
  const blob = await Importer.parseFile(fileShim('q.dat', Buffer.from([1, 2, 0, 0, 5, 6, 7, 0])));
  assert.strictEqual(blob.needsAI, true);
  const none = await Importer.parseFile(fileShim('notes.txt', 'Just some thoughts without anything.'));
  assert.ok(none.rawText.length > 0);
});

test('utf-16 and windows-1252 text files', async () => {
  const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Who? , Me\nWhat? , It', 'utf16le')]);
  const r = await Importer.parseFile(fileShim('u.txt', u16));
  assert.ok(r.rawText.includes('Who?'));
  const w = await Importer.parseFile(fileShim('w.txt', Buffer.from('1. Caf\xe9 is what?\nAnswer: a drink', 'latin1')));
  assert.strictEqual(w.questions[0].q, 'Caf\u00e9 is what?');
});

// ---------------------------------------------------------------- xlsx / docx

test('xlsx: stored+deflate entries, shared/inline/rich strings, gaps, numbers, entities', async () => {
  const r = await Importer.parseFile(fixture('sample.xlsx'));
  assert.strictEqual(r.source, 'xlsx');
  assert.strictEqual(r.questions.length, 4, JSON.stringify(r.questions));
  const [a, b, c, d] = r.questions;
  assert.strictEqual(a.q, 'Capital of France?');
  assert.deepStrictEqual(a.choices, ['Paris', 'Berlin', 'Madrid']);
  // row 3: Wrong 1 cell missing -> alignment kept: Wrong 2 = Mars, no fact shift
  assert.deepStrictEqual(b.choices, ['Jupiter', 'Mars']);
  assert.strictEqual(b.fact, 'Gas giant');
  assert.strictEqual(c.q, 'Rich text?');
  assert.deepStrictEqual(c.choices, ['42', 'TRUE']);
  assert.strictEqual(d.q, 'Tom & Jerry?');
  assert.strictEqual(d.choices[0], 'Cat & mouse');
  assert.ok(r.rawText.split('\n')[0] === 'Question\tCorrect\tWrong 1\tWrong 2\tFact');
  assert.ok(r.warnings.some((w) => /without a question/.test(w)));
});

test('docx: bold run marks the correct choice; bold question ignored; list bullets', async () => {
  const r = await Importer.parseFile(fixture('sample.docx'));
  assert.strictEqual(r.source, 'docx');
  assert.ok(r.rawText.includes('B) Bern'.replace('Bern', '**Bern**')), r.rawText);
  assert.ok(r.rawText.includes('- Atlantic'));
  assert.strictEqual(r.questions.length, 4, JSON.stringify(r.questions.map((q) => q.q)));
  const [a, b, c, d] = r.questions;
  assert.strictEqual(a.q, 'What is the capital of Switzerland?');
  assert.deepStrictEqual(a.choices, ['Zurich', 'Bern', 'Geneva']);
  assert.strictEqual(a.answer, 1);
  assert.strictEqual(a.fact, 'Bern is called the federal city.');
  assert.strictEqual(b.answer, 0); // from "Answer: A"
  assert.deepStrictEqual(c.choices, ['Atlantic', 'Pacific', 'Indian']);
  assert.strictEqual(c.answer, 1); // bold list item
  assert.strictEqual(d.type, 'free');
  assert.strictEqual(d.answerText, 'Blue');
  assert.ok(r.warnings.some((w) => /Family Trivia/.test(w)), 'title skipped with a note');
});

test('docx: mostly-table document uses table mode', async () => {
  const r = await Importer.parseFile(fixture('table.docx'));
  assert.strictEqual(r.source, 'docx');
  assert.strictEqual(r.questions.length, 2);
  assert.deepStrictEqual(r.questions[0].choices, ['Blue', 'Green', 'Red']);
  assert.ok(r.rawText.includes('Question\tCorrect\tWrong 1\tWrong 2'));
});

// ---------------------------------------------------------------- aiParse

const AI_ITEMS = [
  { type: 'mc', q: 'What is the capital of France?', choices: ['Berlin', 'Paris', 'Rome'], answer: 1, answerText: '', fact: '', kidFact: '', emoji: '', level: 'everyone' },
  { type: 'free', q: 'Who wrote Hamlet?', choices: [], answer: -1, answerText: 'Shakespeare', fact: 'Around 1600.', kidFact: '', emoji: '', level: 'hard' }
];
const SRC = 'What is the capital of France?\nA) Berlin\nB) Paris\nC) Rome\n\nWho wrote Hamlet?\nShakespeare';
const fakeFetch = (contentFn, status = 200, calls = []) => async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push({ url, body, init });
  const content = typeof contentFn === 'function' ? contentFn(body, calls.length) : contentFn;
  const payload = JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] });
  return { ok: status >= 200 && status < 300, status, text: async () => payload, json: async () => JSON.parse(payload) };
};

test('aiParse: clean JSON, request shape', async () => {
  const calls = [];
  const r = await Importer.aiParse(SRC, { key: 'nvapi-test', fetchImpl: fakeFetch(JSON.stringify(AI_ITEMS), 200, calls) });
  assert.strictEqual(r.questions.length, 2);
  assert.strictEqual(r.questions[0].answer, 1);
  assert.strictEqual(r.questions[1].answerText, 'Shakespeare');
  assert.strictEqual(r.questions[1].level, 'hard');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, '/api/parse');
  const b = calls[0].body;
  assert.strictEqual(b.key, 'nvapi-test');
  assert.strictEqual(b.model, 'nvidia/nemotron-3.5-bolt-e4b'); assert.deepStrictEqual(b.chat_template_kwargs, { enable_thinking: false });
  assert.strictEqual(b.temperature, 0);
  assert.strictEqual(b.max_tokens, 4096);
  assert.strictEqual(b.messages[0].role, 'system');
  assert.strictEqual(b.messages[1].role, 'user');
  assert.ok(/never invent/i.test(b.messages[0].content) && /free/.test(b.messages[0].content) && /INDEX/.test(b.messages[0].content));
  assert.ok(b.messages[1].content.includes('Who wrote Hamlet?'));
});

test('aiParse: fenced JSON with prose and trailing commas', async () => {
  const text = 'Sure! Here are the questions:\n```json\n' + JSON.stringify(AI_ITEMS, null, 1).replace(/\n\s*\}\n\]/, '},\n]').replace(/"level": "hard"\n/, '"level": "hard",\n') + '\n```\nHope that helps!';
  const r = await Importer.aiParse(SRC, { fetchImpl: fakeFetch(text) });
  assert.strictEqual(r.questions.length, 2, JSON.stringify(r));
  assert.strictEqual(r.questions[0].choices[1], 'Paris');
});

test('aiParse: truncated array keeps the complete prefix', async () => {
  const full = JSON.stringify(AI_ITEMS);
  const truncated = full.slice(0, full.indexOf('"Who wrote') + 15); // cut inside 2nd object
  const r = await Importer.aiParse(SRC, { fetchImpl: fakeFetch(truncated) });
  assert.strictEqual(r.questions.length, 1);
  assert.strictEqual(r.questions[0].q, 'What is the capital of France?');
});

test('aiParse: HTTP errors become readable Errors', async () => {
  const mk = (status) => ({ fetchImpl: async () => ({ ok: false, status, text: async () => '{"error":{"message":"nope"}}', json: async () => ({}) }) });
  await assert.rejects(Importer.aiParse(SRC, mk(401)), /NVIDIA key rejected/);
  await assert.rejects(Importer.aiParse(SRC, mk(429)), /Rate limited, try again in a minute/);
  await assert.rejects(Importer.aiParse(SRC, mk(500)), /AI service had a problem.*nope/);
  await assert.rejects(Importer.aiParse(SRC, { fetchImpl: async () => { throw new Error('offline'); } }), /Couldn't reach the AI service/);
  await assert.rejects(Importer.aiParse(SRC, { fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html>', json: async () => { throw new Error('x'); } }) }), /wasn't JSON/);
});

test('aiParse: chunking, sequential calls, dedupe, never mid-question', async () => {
  const qs = [];
  for (let i = 1; i <= 120; i++) qs.push(i + '. Question number ' + i + ' about something fairly long to pad things out?\nA) one\nB) two\nC) three\nAnswer: B\nFact: ' + 'x'.repeat(40));
  const big = qs.join('\n\n');
  const chunks = Importer.chunkText(big, 5000);
  assert.ok(chunks.length > 1 && chunks.every((c) => c.length <= 5000));
  assert.ok(chunks.every((c) => /^1?\d*\. Question number/.test(c) && /Fact: x+$/.test(c)), 'chunks start and end on question boundaries');
  const calls = [];
  let inFlight = 0, maxInFlight = 0;
  const fetchImpl = async (url, init) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    const body = JSON.parse(init.body);
    calls.push(body);
    const nums = [...body.messages[1].content.matchAll(/(\d+)\. (Question number \d+ about)/g)];
    // model repeats the first question of each chunk twice, and the last question of the previous chunk "overlaps"
    const items = nums.map((m) => ({ q: m[2] + ' something fairly long to pad things out?', choices: ['one', 'two', 'three'], answer: 1 }));
    items.push(items[0]);
    const payload = JSON.stringify({ choices: [{ message: { content: JSON.stringify(items) } }] });
    return { ok: true, status: 200, text: async () => payload };
  };
  const r = await Importer.aiParse(big, { fetchImpl });
  assert.strictEqual(calls.length, chunks.length);
  assert.strictEqual(maxInFlight, 1, 'sequential');
  assert.strictEqual(r.questions.length, 120);
  assert.ok(calls[1].messages[1].content.includes('part 2 of ' + chunks.length));
});

test('aiParse: questions sharing a stem but with different choices are both kept', async () => {
  const items = [{ question: 'Which number is prime?', choices: ['7', '8', '9'], answer: 'A' }, { question: 'Which number is prime?', choices: ['11', '12', '15'], answer: 'A' },
                 { question: 'Which number is prime?', choices: ['7', '8', '9'], answer: 'A' }];
  const r = await Importer.aiParse('Which number is prime? 7 8 9\nWhich number is prime? 11 12 15', { fetchImpl: fakeFetch(JSON.stringify(items)) });
  assert.strictEqual(r.questions.length, 2, JSON.stringify(r.questions.map(q => q.choices)));
  assert.deepStrictEqual(r.questions[1].choices, ['11', '12', '15']);
});

// ---------------------------------------------------------------- runner

(async () => {
  let pass = 0;
  const failed = [];
  for (const t of tests) {
    try { await t.fn(); pass++; } catch (e) { failed.push({ name: t.name, e }); }
  }
  failed.forEach((f) => { console.error('FAIL: ' + f.name + '\n  ' + String(f.e && f.e.stack || f.e).split('\n').slice(0, 6).join('\n  ')); });
  console.log('importer tests: ' + pass + '/' + tests.length + ' passed' + (failed.length ? ', ' + failed.length + ' FAILED' : ''));
  process.exit(failed.length ? 1 : 0);
})();
