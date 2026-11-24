// Runs every automatic test and prints one summary line. Usage:  node tests/run_all.js   (add --slow to include the model tests)
const { spawnSync } = require('child_process'), path = require('path'), fs = require('fs');
const fast = ['tracker_jitter', 'tracker_cross', 'gesture', 'scenarios', 'reid_correction', 'importer', 'buzz_logic'];
const slow = ['yolo/yolo-pose', 'reid/reid'];
const list = fast.concat(process.argv.includes('--slow') ? slow : []);
let bad = 0;
for (const name of list) {
  const file = path.join(__dirname, name + '.test.js');
  if (!fs.existsSync(file)) { console.log('skip  ' + name + ' (no such test)'); continue; }
  const r = spawnSync('node', [file], { encoding: 'utf8', timeout: 300000 });
  const out = (r.stdout || '') + (r.stderr || ''), last = out.trim().split('\n').pop();
  console.log((r.status === 0 ? 'pass  ' : 'FAIL  ') + name + '   ' + last.slice(0, 90));
  if (r.status !== 0) { bad++; console.log(out.split('\n').filter(l => /FAIL|Error/.test(l)).slice(0, 5).join('\n')); }
}
console.log(bad ? `\n${bad} test file(s) FAILED` : '\nall tests passed');
process.exit(bad ? 1 : 0);
