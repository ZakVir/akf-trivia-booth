/*
 * mascot-director.js -- decides what the 3D mascot does, from the game state and game events (no drawing here).
 *
 *   new question, hosts reading (first 5 s)   -> hosts_speaking
 *   question open, players thinking           -> thinking_ponder
 *   timer running                              -> timer_pocket_watch (hands turn, shakes near 0)
 *   answer revealed / between questions       -> idle_happy
 *   events (shown for a few seconds, then back to the above):
 *     hand raised        -> hand_raised_alert, looking towards that player
 *     point given        -> correct_answer;  3rd point in a row for a team -> grand_winner (crown)
 *     nobody got it / wrong answer (reopen) / time ran out -> wrong_answer
 *
 *   const d = new MascotDirector();  d.event('hand', now, { look: [nx, ny] });  d.decide(S, now)
 *     -> { state, timer: [secondsLeft, totalSeconds] | null, look: [nx, ny] }
 */
(function (root) {
  'use strict';
  var HOLD = { hand: 2600, correct: 3200, winner: 4800, wrong: 3000 };
  var STATE = { hand: 'hand_raised_alert', correct: 'correct_answer', winner: 'grand_winner', wrong: 'wrong_answer' };
  var READING_MS = 5000;

  function MascotDirector() { this.q = null; this.qAt = -1e12; this.ev = null; this.evQ = null; this.until = 0; this.look = [0, 0]; this.timerWasOn = false; this.serial = 0; }

  MascotDirector.prototype.event = function (kind, now, opt) {
    if (!STATE[kind]) return;
    // a stronger moment is not cut short by a weaker one (a hand going up during the point celebration)
    var rank = { hand: 1, wrong: 2, correct: 2, winner: 2 };                // a new point/verdict always shows; only a hand waits
    if (this.ev && now < this.until && rank[kind] < rank[this.ev]) return;
    this.ev = kind; this.until = now + HOLD[kind]; this.serial++;            // serial: every reaction restarts its animation
    this.evQ = (opt && 'q' in opt) ? opt.q : this.q;                          // a reaction belongs to the question it happened on
    this.look = (opt && opt.look) ? opt.look : [0, 0];
  };

  MascotDirector.prototype.decide = function (S, now) {
    if (!S) return { state: 'idle_happy', timer: null, look: [0, 0] };
    if (S.qId !== this.q) { this.q = S.qId; this.qAt = now; }
    if (this.ev && this.evQ !== S.qId) this.ev = null;                        // the host moved on: the old question's celebration ends
    var T = S.timer || {}, left = T.running ? Math.max(0, (T.endsAt || 0) - Date.now()) : (T.left || 0);
    var timerOn = !!T.running && left > 0;
    if (this.timerWasOn && !timerOn && T.running && left <= 0) this.event('wrong', now, { q: S.qId });      // time's up
    this.timerWasOn = timerOn;
    if (this.ev && now < this.until) return { state: STATE[this.ev], timer: null, look: this.look, serial: this.serial };
    this.ev = null;
    if (timerOn) return { state: 'timer_pocket_watch', timer: [left / 1000, (T.total || 1000) / 1000], look: [0, 0] };
    if (S.step === 0) return { state: now - this.qAt < READING_MS ? 'hosts_speaking' : 'thinking_ponder', timer: null, look: [0, 0] };
    return { state: 'idle_happy', timer: null, look: [0, 0] };
  };

  MascotDirector.HOLD = HOLD;
  root.MascotDirector = MascotDirector;
  if (typeof module !== 'undefined' && module.exports) module.exports = MascotDirector;
})(typeof window !== 'undefined' ? window : globalThis);
