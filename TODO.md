# AKF Trivia Booth: master to-do list

Rule for everything below: every function must work for real first. Looks come last. Defaults on, no extra switches.

## Done so far (needs your real-camera check in Search)
- [x] "Nothing recorded yet" alert removed; replay recorder runs on its own timer, with a fallback
- [x] Live view fills its box; Full screen button in its corner (`P` / `Esc`)
- [x] Server crash fix (it was dropping connections under load)
- [x] YOLO26n pose detector running in the app (WebGPU, about 85 ms, ~10 per second), MediaPipe kept as automatic fallback
- [x] Tracker predicts motion and matches clothing color (colors held in crossing tests)
- [x] Hands-up numbers (1, 2, 3...) and replay both work in Practice mode and on a test photo clip

## A. Replay rules (your newest message)
1. [x] Auto replay ONLY when 2 or more people raise a hand within 1.5 s of each other. One raised hand = number only, no replay. The manual Replay button (R) always works.
2. [x] Start the replay about 0.3 s after the second hand is seen (not after the full 1.5 s wait), cover the whole 1.5 s window, and keep a longer lead-in before the first hand starts moving.
3. [x] Replay shows who really moved first: a dot per player on the timeline at the moment their hand started rising (not when it was confirmed).

## B. Raise detection that sees the small details
4. [x] Track each wrist's height and speed per person: states "idle → rising → raised (held) → lowered".
5. [x] A hand that starts up and then drops (changed their mind) is a false start: no number, no replay trigger. A real raise must be held for about a quarter of a second.
6. [x] Raise start time = when the wrist began to climb (go back through the recorded samples), not when it crossed the line.
7. [x] Detection adapts its rate to the Mac's speed (12/s target, backs off if slow); pauses during replay; recovers or switches engine if it fails

## C. Recording at camera speed, smooth slow motion
8. [x] Ask the camera for 60 fps (try 75/90 if offered). Measure and show the real fps in Connectivity. If the camera only gives 30, say so.
9. [x] Record EVERY camera frame (use the video-frame callback, not a timer), compressed so memory stays small (6 to 8 s buffer, budget under about 150 MB).
10. [x] Store smoothed marker positions and hand points for every recorded frame.
11. [x] Playback driven by real time, drawn at the screen's refresh rate; blend neighboring frames so slow motion looks smooth even if the camera was 30 fps.
12. [x] Progress bar and timeline dots move continuously (no stepping).
13. [ ] Move detection into a worker (NOT done: could not be verified without a real browser; detection pauses during replay instead)

## D. Steady markers
14. [x] Dead-zone: a marker only moves when the person moved more than a fraction of their head width; tiny shakes are ignored.
15. [x] Smooth with a speed-adaptive filter (steady when still, quick when moving). Smooth size too.
16. [x] Pass: a person standing still keeps their marker still. Test with a measurable jitter number.

## E. Identity that doesn't switch (your first message's model stack)
17. [x] Tracker: motion prediction, clothing color, smoothing, dead-zone, hysteresis, spawn/merge guards, re-ID correction (scenario tests: 7 people in a row, leave/return, crossing, shoulder-to-shoulder)
18. [x] OSNet appearance re-ID wired in as a background identity correction (needs models/osnet*.onnx and reid.js; app works without them)
19. [removed] Face recognition: decided against by the host. Tracking is body-only (YOLO pose, motion, clothing color, OSNet body re-ID). No faces are identified or stored.
20. [ ] Optional bigger detector (YOLO26s, about 42 MB) as a setting if the small one misses people.
21. [x] Memory: YOLO26n 12 MB + re-ID about 9 MB + replay buffer about 10 to 20 MB + MediaPipe fallback 6 MB. Self-check page reports the recorder's memory estimate.

## F. Real-world testing (the part I can't do alone)
22. [ ] You test in Search with the Mac camera and then the iPhone: check WebGPU works in Search, fps, heat, RAM.
23. [ ] Record a few short test clips (one person; two people raising together; one person raising then dropping; two people crossing; 5+ people standing still).
24. [~] Automatic tests: `node tests/run_all.js` (tracker jitter, crossing, scenarios, gesture, re-ID correction, importer). Real-clip replay test needs your clips.

## G. Later, only after everything above is polished
25. [ ] Replace the diamonds with the AKF logo as a 3D spinning model (you send the link and file). Keep the "turns into a number when a hand goes up" behavior. Check AKF's logo-use rules for the event.

## Self-check page
Open http://localhost:8787/check.html in Search (also linked in Setup → Connectivity). Press 'Run all' and send me the report. It measures your real camera fps, WebGPU, model speed and whether the replay recorder keeps up.

## Needs from you
- Real-camera feedback from Search after the next round
- Short test clips (item 23)
- The link to the 3D logo model (later)

## Test status (automatic tests in tests/)
- tracker_jitter, tracker_cross, gesture: pass in Node
- fake-camera runs (test photo clip, 60 fps clip): detection, tracking, recorder and replay verified in the app
- Not yet verified: real camera in Search, true 60 fps (this test pane is throttled to 30), WebGPU in Search

## Code review round (all 25 findings fixed)
Replay key no longer depends on hands-up mode; recorder has a watchdog and uses one clock; test button works every time; failed detector no longer shows "running" or spins; player tiles fall back to manual if the detector is down; the 1.5 s window is measured from when hands ROSE; numbers follow rise time; "wrong answer" keeps hands still up; held keys no longer score repeatedly; Undo never reveals another question's answer; dropdowns no longer swallow hotkeys; replay cannot get stuck; non-16:9 cameras handled; engine fallback only for detector failures; stale replays cancelled; replay memory freed after use; re-ID swaps move the order with them; offline-files check covers every model; preview stays in view while scrolling. Tests: `node tests/run_all.js`.
