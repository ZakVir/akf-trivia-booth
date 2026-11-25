# MEGA LOG: AKF Winter Wonderland Trivia Booth

Written Mon 23 Nov 2026 about 10:40 PM (Mac clock) because the conversation's auto-summary loses detail. If you are a future Claude reading this: read this file FIRST, then `TODO.md`, `PLAN_v2.md`, `README.md`. Everything below was true when written.

Project folder: `/Users/zakirvirani/Library/Application Support/Claude/scratch-workspaces/61589d1d-62dc-4c43-b7dc-65c0daae542a/745615cf-803f-4309-900a-d6789ee21c53/scratch-2026-11-24-efb870/akf-trivia-booth`
(That is a scratch workspace the app made for the session; deleting the session deletes it. The user was told once that I can move the work to a folder they choose; they have not asked yet.)

---------------------------------------------------------------------------------------------------
## 0. RIGHT NOW (state at the moment of writing)

**In progress: permanently removing Sony "Imaging Edge Webcam" from the user's Mac** (see section 9). It is a macOS Camera System Extension that keeps showing up as a camera and was being auto-picked by our app. I was in System Settings, scrolled to General > Login Items & Extensions > "Extensions" section, about to switch the view to **By Category** and look for **Camera Extensions** to turn the Sony extension off. No setting has been intentionally changed. Full-screen control was released at the time of writing.

**In progress: fixes from the user's self-check report** (section 10): virtual-camera avoidance is DONE; ONNX "Session already started" lock + provider benchmark + check.js improvements are NOT yet done.

**The browser is "Search", not Orion.** `/Applications/Search.app` (bundle id `com.officecommun.search`, version 1.0.19, WebKit based, user agent says Safari 27.0.1). I wrongly assumed Orion for most of the project. start.command, README, TODO and PLAN were switched from "Orion" to "Search" with sed. Orion is still installed but is NOT what the user uses.

The user's last explicit instruction: "create a mega log file because your auto compact is not that great" (this file). Before that: "permanently remove imaging edge from this mac like why is it still there".

---------------------------------------------------------------------------------------------------
## 1. The user and the goal

- **User:** Zakir (booth lead; AJ handed the project to him). Busy, wants things to just work, dislikes lots of options/switches ("why do we have so many options, this should be defaulted to on"), dislikes being asked questions during long jobs, prefers function over looks ("forget how clean it looks, I need every function 1000% working").
- **Event:** AKF Winter Wonderland (Ismaili community event). Booth: trivia that teaches people what the Aga Khan Foundation (AKF) does. Audience: 1st graders to adults. 3 to 7 players at a time. About 2 to 3 minute rounds.
- **Hardware:** M2 MacBook Air, 8 GB RAM, no fan. iPhone on a tripod through Continuity Camera as the real camera (Pixel 9 Pro and Pixel 6a only as backups). The Mac screen is mirrored/projected to a TV (TV speakers are bad; aux or Bluetooth speaker optional). **No separate TV window**: the host page itself is projected; press **P** for full screen so answers/controls are not shown to the audience.
- **Browser:** Search (WebKit). WebGPU adapter present ("apple"). Cross-origin isolated works. Camera permission is asked in the page.
- **Money:** user does not want to pay for anything. Everything runs offline and free. Optional free NVIDIA NIM key only for the "Ask AI" question parser.
- **Taped play square:** originally planned (floor tape, auto-detect or drag corners). For now testing is "laptop on a table, person standing in front", so the square is IGNORED by default (`ignoreQuad: true`, `showQuad: false`). The real-event tape flow still exists under Setup > Camera > Advanced. User said they will explain the real plan later.

### The game idea (what the app does)
1. Question shown (multiple choice or free response). Host reads it aloud.
2. Everyone in view gets a slowly spinning 3D **diamond** ("kite") above their head in their own color (8 colors).
3. When someone raises a hand (held about a quarter second) their diamond **turns into a number** in the same color: **1 = first hand up, 2 = second**, etc.
4. If **2 or more hands go up within 1.5 s**, an **instant replay** plays automatically, full screen, slow motion (0.5x then 0.25x), with the numbers/rings/timeline so you can see who was really first. Single raised hand = number only, no replay. Host can press **R** any time to replay the last few seconds.
5. Host gives points by clicking the player's color tile (or keys 1 to 8). Scoreboard bars, mascot ("screen buddy" with a glowing face), confetti, fact cards.

---------------------------------------------------------------------------------------------------
## 2. HARD RULES / PREFERENCES from the user (obey these)

- **NO face recognition. Ever.** ("Don't want face recognition, just great person tracking.") Tracking is body-based only. Do not add YuNet/SFace/InsightFace.
- **Defaults ON, few visible options.** One collapsed "Advanced" section for the rest. Main screen stays minimal.
- **Replay only for close calls**: auto replay only when 2+ hands within 1.5 s. One hand = number only. R key always works.
- **Smoothness matters**: record at camera speed (ask 60 to 75 fps), slow motion must not stutter, progress bar continuous, markers must NOT shake when the person is still (dead-zone + smoothing).
- **Later (only after everything is polished):** replace the diamonds with the **AKF (Aga Khan Foundation) logo as a 3D spinning model** (the user made it with Google Antigravity and will send a link). Keep "turns into a number on raise". Check AKF brand rules for logo use at the event.
- Don't ask questions during long autonomous runs ("Don't ask me anything... keep working... I want you to be done"). That one-hour run finished. For normal turns a short question is OK but prefer deciding.
- During that autonomous run the user said no browser testing; tests were Node only. (No such restriction was stated for the current request.)
- Do not use the user's other port: **8765 belongs to another project's server** (a firetv-remote server). Our app uses **8787**.
- Do not paste passwords/credentials. Admin/Touch ID prompts must be handled by the user.
- After any file edits: call `mcp__ccd_turn__wrap_up` at the end of the turn; keep the task list via `update_plan`.

---------------------------------------------------------------------------------------------------
## 3. History of the build (what happened, in order)

1. User uploaded `AKF_Trivia_Booth.zip` (plan MD + 2 mascot reference images). First plan: hybrid (camera for show, human scoring).
2. Built v1 demo: `host.html`, `audience.html`, BroadcastChannel sync, scoring, timer, mascot (SVG), confetti, fact cards, light **cream** theme (user asked for "light cream look"), placeholder questions, Fredoka/Lilita/Nunito font stack with local fallbacks.
3. Big replan (`PLAN_v2.md`): connectivity checklist, camera + detection (MediaPipe Pose Lite at first), Sims-style rotating diamond, taped square (drag corners / pick tape color / auto-detect), 8 player colors with clickable tiles, free-response questions, local question importer (CSV/XLSX/DOCX/text/JSON) with optional NVIDIA NIM AI cleanup (`importer.js` built by a subagent, 28 Node tests), `server.py` (static + `/api/parse` proxy) and `start.command`.
4. Downloads approved by the user: MediaPipe tasks-vision 1.2.3 (npm) + `pose_landmarker_lite.task`.
5. Single-window mode (no TV window), full-screen button + `P`, ResizeObserver for the live view.
6. Kite became a number, then (user clarified) diamond that morphs into the **raise-order number**.
7. Hands-up buzzer + instant replay engine (`buzz.js`), numbers, close-call window, manual Replay (R), recorder of every camera frame (JPEG blobs + marker positions), blended slow-mo, replay full screen, steady markers (One-Euro filter + dead-zone), tracker upgrades (motion prediction, clothing-color histogram, spawn/merge guards, re-ID correction).
8. User pasted a Gemini-suggested model stack (YOLO26 pose, OSNet re-ID, face lock). Built: YOLO26n/s pose ONNX via onnxruntime-web (agent), OSNet ain x1.0 + x0.25 ONNX (agent), re-ID correction in tracker. Face lock REJECTED by the user.
9. A read-only code-review subagent found 25 issues; all were fixed (list in `TODO.md`).
10. `check.html` self-check page created. The user ran it in Search and pasted the report (section 10). It exposed the Sony virtual camera problem.
11. Current: camera ranking fix done; ONNX lock/benchmark + check.js improvements + Imaging Edge removal pending.

Subagents used (all finished): importer builder, YOLO exporter, OSNet exporter, code reviewer. None running now.

---------------------------------------------------------------------------------------------------
## 4. FILE MAP (project folder)

Pages
- `host.html` + `host.js` (+ `host-cal.js`, `host-conn.js`, `host-import.js`): host page. Owns ALL game state `S` (localStorage key `akf-booth-state-v3`; questions key `akf-questions-v1`). Embeds the live view in an `<iframe id="preview" src="audience.html" allow="camera; fullscreen">` (scaled 1920x1080 stage). Setup dialog tabs: Camera & play square, Connectivity, Questions import. Hotkeys: 1 to 8 give that color +1, Space reveal/fact, arrows prev/next, N nobody got it, T timer, U undo, K kid wording, P full screen, R replay, Esc exit full screen/skip replay, B hands-up mode (hidden in Advanced), C confetti test. `e.repeat` is ignored.
- `audience.html` + `audience.js` + `audience.css`: the live view (question panel, scoreboard, camera panel with `<video id="video">`, `<canvas id="kites">`, `<canvas id="replay">`, buzz hint/banner, mascot, snow, confetti). 1920x1080 stage scaled to fit.
- `check.html` + `check.js`: one-click self-check page (browser features, files, WebGPU, camera fps, YOLO speed, recorder speed). Linked from Setup > Connectivity.
- `base.css`: cream theme tokens, 8 team colors.

Core logic
- `cam.js` (`const Cam`, also `window.Cam`): camera start/stop with generation guard (`startSeq`), camera ranking, detection loop (YOLO or MediaPipe), `cocoToDet` / `poseToDet`, `cleanDets` (min size, duplicate merge), clothing-color `appearance()`, re-ID job (`reidTick`), failure recovery, sim/practice mode, calibration stills, `snapshot()` for the recorder, `report()` -> `cam-status` messages.
- `tracker.js` (`class Tracker`): stable color per person; motion prediction; clothing-color matching (`appDist`, 64-bin RGB histogram); spawn needs 3 hits and not inside another person's zone (`0.5*max(s)+0.02`); merge of tracks sitting on one spot (600 ms); lost-track color reuse (20 s); **One-Euro filter + dead-zone** (positions); **gesture state machine** (`_gesture`: HOLD_MS=250, false starts, interpolated crossing time, release-line hysteresis); `applyEmbeddings` (re-ID correction with swap queue `drainSwaps`).
- `buzz.js` (`const Buzz`, `window.Buzz`): hands-up order (`orderList`), contest window (CONTEST_MS 1500, QUIET_MS 300, HOLD_MS 250 mirror), recorder (rVFC per camera frame -> 480px JPEG blob + track snapshot; 9 s buffer; watchdog timer), replay engine (decode to ImageBitmaps, two passes 0.5x and 0.25x, blended frames, cover mapping, verdict "FIRST!", timeline dots, chips), `replayLast`, `reopen`, `swapColors`, hard 20 s cap, try/catch in tick.
- `kites.js`: draws the 3D diamond (octahedron) and the extruded number, with morph (spin faster, shrink, pop in with overshoot).
- `mascot.js`: SVG screen-buddy moods (idle, look, think, happy, cool, oops, fact).
- `shared.js`: BroadcastChannel `CH` ('akf-booth'), `PALETTE` (red, orange, gold, green, teal, blue, purple, pink), helpers `esc`, `qType`, `DEFAULT_QUAD`, `pointInQuad`, `quadPoint`, and NEW camera ranking: `VIRTUAL_CAM`, `isVirtualCam(label)`, `camRank(label, preferBuiltIn)`.
- `questions.js`: 11 PLACEHOLDER questions (real 30 still not received).
- `importer.js`: question importer (CSV/TSV/XLSX/DOCX/text/JSON, AI parse). `host-import.js`: review/edit UI.
- `yolo-pose.js`: YOLO26 pose via onnxruntime-web (agent-built). API `YoloPose.create({model:'n'|'s', ortBase, modelBase, providers, scoreThr, maxPeople})` -> `{provider, lastMs, providerErrors, detect(source, region), dispose}`. COCO-17 keypoints normalized 0..1.
- `reid.js`: OSNet re-ID (agent-built). `ReId.create({model:'ain'|'x025', ...})` -> `embed`, `embedMany`, `ReId.cosDist`. Body re-ID only.
- `server.py`: local server on 127.0.0.1:**8787**; sends COOP/COEP/CORP headers; `request_queue_size = 256` (the default 5 caused ERR_CONNECTION_RESET); `/api/health`, `/api/parse` (NVIDIA NIM proxy, key never stored).
- `start.command`: starts server and opens host page with `open -a Search`.

Data
- `models/`: `yolo26n-pose.onnx` (12 MB), `yolo26s-pose.onnx` (42 MB), `osnet_ain_x1_0.onnx` (8.7 MB), `osnet_x0_25.onnx` (0.9 MB), `pose_landmarker_lite.task` (5.5 MB).
- `vendor/ort/` (onnxruntime-web 1.31.1 jsep build, about 30 MB), `vendor/mediapipe/` (tasks-vision 1.2.3, 14 MB wasm).
- Project is about 117 MB total.

Docs / tests
- `README.md`, `PLAN_v2.md`, `TODO.md`, this `MEGA_LOG.md`.
- `tests/`: `run_all.js` (`node tests/run_all.js`, `--slow` adds model tests), `tracker_jitter`, `tracker_cross`, `gesture`, `scenarios` (7 people, leave/return, shoulder-to-shoulder, crossing, hover), `reid_correction`, `importer` (28 tests), `buzz_logic` (runs real buzz.js against a stand-in page), `yolo/yolo-pose.test.js`, `reid/reid.test.js`, media: `tests/yolo/bus.jpg`, `bus.mp4`, `test60.mp4`. All passed at the last full run (before the camera-ranking edit).

---------------------------------------------------------------------------------------------------
## 5. MESSAGE PROTOCOL (BroadcastChannel 'akf-booth')

Host -> live view: `state` {state, event}, `questions` {list}, `cam-snap` {on,preview}, `cam-list`, `buzz-clear`, `buzz-reopen`, `replay-again`, `replay-last`, `replay-skip`, `sim-raise` {colors, gaps}.
Live view -> host: `hello` {preview}, `hb`, `cam-status` {phase, err, label, devices[{id,label,virtual,rank}], det{state,ms,hz,err,engine,reid,reidMs,reidErr}, people, fps, vw, vh, buf, recFps, recSec, screen}, `tracks` {colors}, `order` {list[{color,rank,ms}]}, `buzz` {winner, list, contested, margin, tooClose}, `replay-play`, `replay-stop`, `cam-frame`, `kites` (only if a preview page exists).
Events inside `state`: `win` {team, streak}, `oops`, `test`.

---------------------------------------------------------------------------------------------------
## 6. KEY NUMBERS AND BEHAVIOUR (tuning)

- Detection target 12 per second (adaptive). YOLO26n default; `engine: 'auto'` falls back to MediaPipe if wasm and slower than 250 ms four times in a row (counter resets when fast); retries YOLO after 3 minutes; 3 consecutive detector errors => switch engine.
- Min person size filter (shoulder width, fraction of frame): strict 0.04, normal 0.022, loose 0.012. YOLO score thresholds: strict 0.5, normal 0.35, loose 0.25.
- Hand raise: wrist above shoulder line by `thr` nose-to-shoulder lengths (easy 0.6, normal 0.9, strict 1.4); release line lower by 0.5 (min 0.15); held 250 ms; event time interpolated at line crossing; false starts counted.
- Marker smoothing: One-Euro (min cutoff 0.6 Hz, beta 5) + dead-zone 12% of person width; size dead-zone 12%; render smoothing k = dt*8; bob amplitude 3% of size.
- Replay: buffer 9 s; JPEG 480 px wide quality 0.72; max 260 frames per replay (thinned); passes: [first-1.6 s to last+0.7 s at 0.5x], [first-0.4 s to last+0.4 s at 0.25x or 0.3x]; verdict held 7 s; manual replay 4.5 s at 0.55x; hard cap 20 s; clip bitmaps freed 10 s after replay.
- Camera request: 1920x1080, `frameRate {ideal 60, max 120}`. Camera auto-choice: see section 8.
- Server backlog 256; headers COOP same-origin, COEP require-corp, CORP same-origin (needed for multi-threaded wasm; getUserMedia unaffected).
- Settings in `S.cam` (defaults in `DEFAULT_CAM` in host.js): on true, detect true, kites true, mirror true, ignoreQuad true, showQuad false, engine 'auto', mode 'fast', sens 'normal', handSens 'normal', detHz 12, buzzer true, preferBuiltIn true, sim false, debug false, gpu false, simN 5, simDup false, quad default.

---------------------------------------------------------------------------------------------------
## 7. LESSONS / GOTCHAS (do not relearn these)

- The built-in "Claude Browser" pane is Chromium, throttled to 30 Hz when hidden, and blocks cameras. Use a fake camera: play `tests/yolo/bus.mp4` or `test60.mp4` in a `<video>` inside the audience iframe and override `iframe.contentWindow.navigator.mediaDevices.getUserMedia = async () => video.captureStream()`. That exercised the real YOLO/tracking/recorder/replay path.
- Do NOT call native `requestFullscreen` on the host page in that pane (iframe went blank). Full screen is in-page only (`#previewBox.fs`); the user can use Ctrl+Cmd+F for the browser's own.
- ERR_CONNECTION_RESET and "cross-origin frame" errors were the server's tiny listen backlog under parallel loads. Fixed (`request_queue_size`).
- `toBlob` + `createImageBitmap(blob)` work in the user's browser; encode about 23 ms, decode about 13 ms when idle (slower when the Mac is busy).
- Background `app_click` does not work on System Settings segmented controls; full-screen control was needed. Droppy's notch overlay can block clicks near the top of the screen. `cmd+f` focuses the System Settings search box.
- When running two live views at once (host iframe + a second tab) both respond to `sim-raise`; test with only one.
- `systemextensionsctl uninstall` refuses while SIP is enabled.
- Edit tool needs a Read first for existing files; for big rewrites a Bash heredoc was used.
- TDZ trap: a `bind(...)` call placed before `const bind` broke part of host-cal.js once. Keep order.

---------------------------------------------------------------------------------------------------
## 8. CAMERA SELECTION (new, implemented)

Problem: the browser's default camera was **Sony Camera (Imaging Edge)**, a virtual camera, running at 12.9 fps and sometimes 1.1 fps. Device list in the user's browser: Sony Camera (Imaging Edge) | FaceTime HD Camera | Yosei Camera (another virtual camera) | Zakir's iPhone Camera | Zakir's iPhone Desk View Camera.

Implemented (syntax-checked, NOT yet re-tested after the edit):
- `shared.js`: `isVirtualCam(label)` (imaging edge, sony camera, obs, virtual, ndi, snap, manycam, camo, epoccam, droidcam, splitcam, xsplit, streamlabs, mmhmm, ecamm, yosei, zoom, teams, blackmagic, screen) and `camRank(label, preferBuiltIn)`: virtual 9, Desk View 5, FaceTime/built-in 0 (when preferBuiltIn), iPhone 2, others 3.
- `cam.js start()`: after the first stream, if no explicit `deviceId`, picks the lowest-rank REAL camera and restarts with it (`autoDevice`); if the saved id is stale, finds the camera by saved `deviceLabel`. Virtual cameras are never auto-picked. `devices[]` now carry `virtual` and `rank`.
- `host-cal.js`: dropdown sorted by rank, "Automatic (best real camera)" first, virtual ones tagged "(virtual camera)"; choosing a camera saves `deviceId` and `deviceLabel`.
- `host-conn.js`: Camera row warns "This is a virtual camera" if the live camera is virtual.
- NOT done yet: `check.js` still uses the default camera; add a camera picker there too.

---------------------------------------------------------------------------------------------------
## 9. IMAGING EDGE (Sony) REMOVAL: findings and plan

What is on the Mac (found with shell):
- System extension: `com.sony.imagingedge.iew.CameraExt` (team ID `VH49J2FYHE`, version 1.2.0.02210/1), status **[activated enabled]** in `systemextensionsctl list`. Files: `/Library/SystemExtensions/2DCA1607-EEE8-494F-A967-E14E88B4DF16/com.sony.imagingedge.iew.CameraExt.systemextension`. A process runs from it (`_cmiodalassistants`, pid 576 at the time).
- The host app "Imaging Edge Webcam.app" is **not installed** anywhere (not in /Applications, ~/Applications, Downloads, Desktop, Documents; Spotlight finds nothing). So the extension is orphaned and the usual "delete the app" route does not apply.
- Package receipt `com.sony.pkg.PMHInstaller` v3.6.01 (PlayMemories Home, installed around 4 Dec 2025 by epoch 1764888636). `PMHMac.app` is not in /Applications.
- Old root-owned launch agents in `/Library/LaunchAgents/`: `com.sony.SonyAutoLauncher.agent.plist`, `com.sony.WirelessAutoImportLauncher.agent.plist` (both dated 2017, from PlayMemories). Background-items list shows "Sony Corporation" (off) and "WirelessImporterDaemon". These are older Sony helpers, not the camera.
- `/Library/CoreMediaIO/Plug-Ins/DAL/` only has `plugins-info.txt` (no legacy DAL plug-in).
- SIP is **enabled**: `systemextensionsctl uninstall VH49J2FYHE com.sony.imagingedge.iew.CameraExt` fails with "cannot be used if System Integrity Protection is enabled". Do not disable SIP.
- macOS 27.0.1.
- Another virtual camera exists: **Yosei Camera** (`app.yosei.mac.camera` v0.9.22, team M94T8JU529, from `Yosei.app`, activated enabled). User did not ask to remove it.

Supported ways to get rid of it (in order of preference):
1. **System Settings > General > Login Items & Extensions > scroll to "Extensions" > "By Category" > "Camera Extensions"**: switch the Sony Imaging Edge entry OFF (needs the user's admin password or Touch ID). This disables it; it disappears from every app's camera list. (I was at the "By App / By Category" selector when interrupted. A background click on that selector does nothing; full-screen control and a real click are needed. Searching System Settings for "Camera Extensions" returned no results in this macOS.)
2. Reinstall Sony's "Imaging Edge Webcam" from Sony's website, open it, use its Uninstall (or drag the app to Trash and restart), then delete the leftovers. Needs a download (ask first).
3. As a last resort: the extension is removed automatically after the owning app is deleted and the Mac restarts, but the owning app is already gone, so this will not trigger by itself.
Optional cleanup: `sudo pkgutil --forget com.sony.pkg.PMHInstaller` and removing the two old Sony LaunchAgents (root-owned; needs sudo; unrelated to the camera).
Our app no longer auto-selects it, so the booth is unaffected either way.

What I actually did in System Settings this session: opened the pane via `open "x-apple.systempreferences:com.apple.LoginItems-Settings.extension"`, scrolled, took screenshots. During one batch the pane jumped to "Lock Screen" and then "Users & Groups" (navigation, not toggles); I did not click any switch. A search for "Camera Extensions" was typed then cleared. I granted myself nothing else. (If anything looks different in System Settings the user should say so.)

---------------------------------------------------------------------------------------------------
## 10. THE USER'S SELF-CHECK REPORT (from Search, pasted by the user) AND ANALYSIS

Facts: Safari/WebKit 27.0.1 UA; cross-origin isolated true; getUserMedia, requestVideoFrameCallback, createImageBitmap, toBlob, BroadcastChannel, ResizeObserver, WebAssembly all OK; **WebGPU adapter found: apple**; all model/vendor files present (yolo26n 11.5 MB, yolo26s 39.9 MB, osnet ain 8.3 MB, osnet x0.25 0.9 MB, lite task 5.5 MB, ort 28.2 MB wasm, mediapipe 14.0 MB wasm). Replay image round trip OK (JPEG 3 KB; 23/13 ms idle, 136/123 ms while busy).
Camera: "Sony Camera (Imaging Edge) 1920x1080, asked 60 fps, setting says 60" but real frame rate **12.9 fps** (longest gap 1.78 s) and **1.1 fps** in the second run. => caused by the virtual Sony camera. Recorder speed then was 1/s; on a later run with a different camera: **156 frames in 4.3 s = 36 per second**, 2.5 MB per 9 s (healthy).
YOLO results: `YOLO26n provider wasm: 175 ms and 190 ms` in the first runs (busy), later `YOLO26n wasm 84 ms (about 12/s)`; `YOLO26s wasm 445 ms`; `YOLO26s webgpu 231 ms (4/s)`; one run `FAIL: YOLO error: Session already started`.
Interpretation / decisions:
- Multi-threaded **wasm for YOLO26n (84 ms) is as fast or faster than WebGPU** in this browser; WebGPU for the medium model was slow. So choosing the provider by measurement is better than assuming WebGPU wins. (The first create asks for ['webgpu','wasm']; in two runs n ended up on wasm, meaning WebGPU creation/warm-up failed or was skipped; `det.providerErrors` has the reason, not yet shown anywhere.)
- "Session already started" is an onnxruntime-web error when two `InferenceSession.create` calls overlap (check.js can be run twice at once; in the app YOLO is created first and re-ID after, but they can still overlap). Fix = one global create-lock shared by `yolo-pose.js` and `reid.js` and serialising check.js.
- The 12.9 and 1.1 fps results were the virtual camera, not our code.

---------------------------------------------------------------------------------------------------
## 11. OPEN WORK (ordered)

1. **Imaging Edge**: finish removal/disable (section 9). If the Camera Extensions toggle needs an admin password/Touch ID, hand that single step to the user. Then reload the app, run check.html again, confirm the camera list no longer contains "Sony Camera (Imaging Edge)" (or at least that the app picks FaceTime/iPhone).
2. **ONNX create lock** (`window.__ortCreateLock` promise chain) in BOTH `yolo-pose.js` `create` and `reid.js` `create` (rename inner function, wrap). Re-run `node tests/run_all.js --slow`.
3. **Provider benchmark in `cam.js ensureDetector`**: create with ['webgpu','wasm'], time 5 detections on the live video (or a blank canvas); if webgpu median > 90 ms also create wasm-only and keep the faster; cache the winner in `localStorage['akf-yolo-provider']`; show provider + reason (`providerErrors`) in the Connectivity "Person detection" row.
4. **check.js**: disable buttons while a test runs (no overlapping runs); camera picker (rank real cameras first, mark virtual); test YOLO n and s separately on webgpu and on wasm and print `providerErrors`; recommend the fastest.
5. Update docs (`README.md`, `TODO.md`, `PLAN_v2.md`) for the browser name Search, camera ranking, provider choice.
6. Re-run all Node tests (`node tests/run_all.js --slow`), syntax-check every .js, id/script cross-check.
7. User test in Search (real camera): run check.html, replay, raise hands. Need the user's recorded test clips (one person; two raising together; raise then drop; two crossing; 5+ standing still) for the real-clip regression harness (TODO item 24).
8. Real 30 questions still missing (placeholders in `questions.js`; import UI works).
9. Not done: detection in a Web Worker (could not verify without a browser; detection just pauses during replay).
10. Last: AKF 3D logo markers (user sends link; check AKF brand rules).
11. Sound effects (chime, drumroll, applause) not built. Host layout from the user's paper drawing not received.

---------------------------------------------------------------------------------------------------
## 12. LICENSES / PRIVACY

- YOLO26 pose weights (Ultralytics): AGPL-3.0 (fine for a community booth; note it). onnxruntime-web: MIT. OSNet/torchreid: MIT (MSMT17 training data is research oriented). MediaPipe: Apache-2.0.
- Nothing is recorded to disk or uploaded. Replay buffer is in memory only (9 s). Camera frames never leave the Mac. The only network call is the optional "Ask AI" import helper, which sends the text the user imports to NVIDIA's free API through the local server, only when the button is pressed.
- No face recognition (user decision).

---------------------------------------------------------------------------------------------------
## 13. HOW TO RESUME / RUN

- Run: double-click `start.command` (or `python3 server.py` then open http://localhost:8787/host.html in Search). Server may already be running on 8787 (check `lsof -nP -iTCP:8787 -sTCP:LISTEN`).
- Self-check: http://localhost:8787/check.html > Run all > Copy report.
- Tests: `node tests/run_all.js` (add `--slow`).
- Fake-camera testing in the Claude browser pane: see section 7.
- Always `node --check` every edited .js file. Cross-check element ids in host.html/audience.html/check.html against `$('...')` uses.

---------------------------------------------------------------------------------------------------
## 14. UPDATE: end of session, Mon 23 Nov 2026 night (user paused: "we will continue tomorrow")

All Node tests pass (`node tests/run_all.js` = 7 files; `--slow` also passed earlier today incl. YOLO + re-ID model tests, after the ONNX lock). Every .js passes `node --check`. Server was left running on 8787.

### Decisions made after section 9
- **Imaging Edge: system removal SKIPPED by the user.** Instead it is **hard-blocked inside the app** ("block it for this app"):
  - `shared.js`: `BLOCKED_CAM = /imaging edge|sony camera/i`, `isBlockedCam()`.
  - `cam.js`: blocked cameras are removed from the device list; if the browser's default stream is a blocked camera, the app stops it, reads the camera list, and restarts with the best real camera (rank: FaceTime 0, iPhone 2, others 3, Desk View 5, other virtual 9, e.g. Yosei). If the saved device id is gone/blocked it falls back to the best real camera (or finds it by saved `deviceLabel`). If the only camera is blocked: error shown "The only camera found is blocked".
  - VERIFIED in the Claude browser pane with a mocked camera list (default = Sony, plus FaceTime, Yosei, iPhone): the app requested the default, refused Sony, restarted with FaceTime, list showed FaceTime r0, Yosei r9 virtual, iPhone r2, no Sony.
  - `check.js` also hides/blocks Sony and ranks real cameras first.
  - The Sony system extension (`com.sony.imagingedge.iew.CameraExt`) is still installed on the Mac; leave it alone unless the user changes their mind (route in section 9).

### Done this session part (after the log was first written)
1. **ONNX create lock**: `yolo-pose.js` and `reid.js` `create()` now serialize through `root.__ortCreateLock` (fixes "Session already started"). Model tests still pass.
2. **Provider benchmark** in `cam.js ensureDetector`: first run creates YOLO with ['webgpu','wasm'], times 6 detections; if webgpu > 90 ms also tries wasm-only and keeps the faster; the winner is cached in `localStorage['akf-yolo-provider-n']` (or `-s`). Clear that key to re-benchmark. `det.bench`, `det.provErr` (why WebGPU was not used) and `det.yoloNote` are shown in Setup > Connectivity > Person detection. VERIFIED the benchmark ran in the browser pane ("webgpu 61 ms", cached webgpu).
3. **check.js rewritten**: tests never overlap (buttons disabled while busy), camera picker (hides Sony, marks virtual), skips a blocked/virtual default camera, tests YOLO26n and s on BOTH webgpu and wasm separately with thread counts and errors, recommends the fastest.
4. **Marker stutter fix** (user: "the shape above my head is very stuttery"): `tracker.js` soft dead-zone (follow every update while the person really moves, speed > 0.45 x person width per second; hold only when resting), `step(dt, now)` now glides toward where they are heading for up to 120 ms between detections, critically-damped smoothing (tau 85 ms), size glides (`t.rs`), bob smaller. Test: still person marker wiggle 0 px, walking lag 3 px. `cam.js` and `buzz.js` use `rs` (smoothed size). NOT yet seen by the user; the Sony virtual camera (1 to 13 fps) was probably also a big cause of the stutter in their report.
5. `Cam.debug()` added (engine, yolo, provider, landmarker, yoloFailed, loading, detGen, errN, slowN...). Use from the iframe window: `document.getElementById('preview').contentWindow.Cam.debug()`.

### OPEN QUESTION to chase first tomorrow
In one browser-pane run after the benchmark, `camStatus.det.engine` said **"MediaPipe Lite"** (44 ms, 10.7/s) even though `engine:'auto'`, the benchmark finished and the cache said webgpu. So YOLO may have been discarded or failed AFTER the benchmark and the app fell back to MediaPipe. Suspects: (a) `gen !== detGen` abort (a `dropDetector()` happening while YOLO was loading; the new `det.yoloNote` will now say so), (b) an exception right after the benchmark (the catch now records `det.yoloNote` and `console.error('[cam] YOLO failed')`), (c) my test sequence (engine 'mediapipe' then 'auto' with `detect` toggling). The pane was closed by the user before I could read `Cam.debug()`. Next step: reopen the page (preview_start), set the mocked camera as in section 7, set engine 'auto', wait ~15 s, read `Cam.debug()` and `camStatus.det.yoloNote`. IMPORTANT: keep each `javascript_exec` under about 30 s and keep the Browser pane VISIBLE (hidden panes throttle timers and calls time out); do not start two long waits in one call.
Also: make sure Search (the user's real browser) ends up on YOLO: Setup > Connectivity should show "YOLO26n (webgpu or wasm)" with the speed-test text.

### Other open items (unchanged)
- User test in Search with real camera after the camera blocking + smoothing: run `localhost:8787/check.html` > Run all, send report (now includes per-provider YOLO numbers).
- Their earlier report: YOLO26n wasm (multi-thread) about 84 ms is about as fast as WebGPU in Search; YOLO26s webgpu 231 ms. Expect the app to choose wasm or webgpu by measurement.
- Test clips from the user (TODO 24), real 30 questions, sound effects, host layout from paper drawing, AKF 3D logo markers (after polish; link to come; check AKF logo-use rules), detection-in-a-worker (not done).
- Memory notes saved in `~/.claude/projects/<this project>/memory/` (akf-booth-project.md, akf-booth-rules.md).

---------------------------------------------------------------------------------------------------
## 11. BUG-FIX ROUND (2026-11-24, branch fix/smooth-marker-yolo-fallback, PR #1)

Three code reviews (detection, buzzer/replay, host/server) + headless-browser end-to-end runs. Fixed:
- Marker stutter: tracker soft dead-zone (no hold-then-jump). Test `tracker_jitter` now also measures stop-and-go on slow drift.
- YOLO -> MediaPipe fallback: provider create timeout (20 s) + retry on ORT "Session already started"; slow-wasm rule 10 frames > 350 ms; 3-minute YOLO retry now actually runs; benchmark failures handled; every fallback writes `det.yoloNote`.
- Sessions: `dispose()` in yolo-pose/reid waits for the running job; stale re-ID sessions/results after a settings change are dropped.
- Camera: auto-picked camera unplugged -> picks another; saved camera found by name is used.
- Hands: hidden wrists no longer hold a hand "up"; no back-dated raise times across tracking gaps; hold needs 2 frames.
- Replay: progressive decode (plays after the first 8 frames), lead-in 0.9 s (was 1.6 s), only shown frames decoded, recorder pauses JPEG encoding and live kites stop drawing during a replay, "Replay again" works any time, verdict + banner never cut off, reopened old hands never replay stale footage, rVFC recorder re-hooks after a camera restart.
- Host: "Point to", New group, step back to 0 and same-question goto all reset the live buzzer (`buzz-clear` now unlocks); +10 s after time ran out; digit keys on a focused dropdown score; Exit full screen during a replay; -1 at 0 no empty undo, -1 lowers streak.
- Import: Restore built-in questions really restores questions.js; Ask AI uses what is on screen; same file can be re-picked; server key honoured; error numbering; storage-blocked safe.
- server.py: AI proxy only accepts JSON requests addressed to localhost. start.command: reuses a running server, reports a busy port, waits for the server before opening the page.
- check.js never hangs when the camera sends no frames. Fonts added in `fonts/` (OFL).
Still to verify on the Mac with the real camera: YOLO provider/fallback note in Setup > Connectivity, marker smoothness, replay start delay with real pictures.

---------------------------------------------------------------------------------------------------
## 12. ACCURACY ROUND (2026-11-25): measured on real video, not guessed

New: `pose-logic.js` (one body -> marker spot, raised hand, duplicate check; shared by cam.js and the tests) and an
offline harness `tests/eval/`:
- `node tests/eval/detect-clips.js <outDir> clip.mp4 ...` runs the REAL YOLO26n (ort wasm in node) at 12/s and caches people per frame.
- `node tests/eval/eval.js <outDir>/*.n.json` replays them through pose-logic + tracker exactly like the browser and scores:
  coverage, colour switches, merged people, ghost markers, shake, lag, raise events. `LEGACY=<dir>` scores an older version.
- Clips used (free Mixkit stock, kept OUT of the repo): friends walking side by side (8900), child on dad's shoulders (39767),
  group hug (4709), office high-five (9088), classroom raises (6672, 35968, 11553), conference audience from behind (13192),
  NEGATIVES hand over the face (46818) and palm to camera (40194).
Results vs the previous version (same clips): coverage 26-88% -> 92-100%; child-on-shoulders merged 16 -> 0; hug merged
31 -> 9; switches 9 -> 5; lag ~-20%; hand-over-face false raise gone.
Changes: head centre = confidence-blended nose/eyes/ears (no jumps); face not seen -> marker from the box top; duplicates
only when skeletons match point-by-point or boxes coincide (never "heads close"); tracker spawn/merge use the same rule;
stale markers are the last choice for a detection; raise = wrist above head, or bent raise with hand at forehead+ , elbow
up and forearm upright; from behind, a box reaching well above the head; held hand uses its own (lower) bar - the old
`release` field was never set (assignment ended up inside a comment). Smoothing tuned on the clips: One-Euro min cutoff
1.6 Hz, dead-zone 6% of body width. Detection default 15/s (old saved 12/s migrated), gentler slow-machine back-off.
Known limits: a raise must be held 0.25 s (quick high-fives can be missed); people cut by the picture edge or right up
against the lens can flicker; the model sometimes cannot see wrists of people at the very edge.
Hosting: vercel.json sends COOP/COEP/CORP (multi-threaded wasm) and redirects / to host.html.

---------------------------------------------------------------------------------------------------
## 13. TV SCREEN ROUND (2026-11-25): full live feed, podium leaderboard, 3D mascot

- Live feed fills the whole Live Feed panel (kites canvas 1148x617 = panel shape; cam.js reads W/H from it). Markers keep
  clear of the top-left corner under the mascot tab and label (KEEP_OUT in cam.js).
- Podium = live top-3 leaderboard (`leaderboard.js`, tests/leaderboard.test.js): middle 1st, left 2nd, right 3rd; team
  colour bars + spinning kites; a place change -> kite flies up, drops back with a bounce in the new colour. Design look
  (stars) until someone scores. Canvas has an aria-label with the standings.
- 3D mascot (`mascot3d.mjs`, models/mascot/*.glb, vendor/three r170 via an import map): 8 states from the model maker's
  guide. `mascot-director.js` (tests/mascot_director.test.js) picks the state: new question 5 s hosts_speaking ->
  thinking_ponder; timer -> pocket watch; hand raised -> alert looking at the player (buzz.js calls window.mascotHand);
  point -> correct_answer, 3rd in a row -> grand_winner; nobody / 'Wrong -> reopen' (message has wrong:true) / time up ->
  wrong_answer; answer shown -> idle_happy. No WebGL or models -> the flat SVG face stays.
- Devin Review only runs when a PR is opened, not on later pushes: follow-up commits get self-review only.

---------------------------------------------------------------------------------------------------
## 14. HOSTING ON VERCEL + AI IMPORT FIX (2026-11-25)

- NVIDIA retired meta/llama-3.1-8b-instruct (HTTP 410): AI import was broken. New default nvidia/nemotron-3.5-bolt-e4b with
  chat_template_kwargs.enable_thinking=false. Benchmarked on two messy sets (tests in scratch, not committed): Bolt 7/7 + 5/5 correct in
  3-5 s; nemotron-3.5-lightning faster (~2 s) but dropped spoken questions; glm-5.3-flash unreachable; minimax overloaded.
- Vercel: project akf-trivia-booth (prj_oScevJjeOVxP1KrJkvFPBXnhRf6I), git-linked, framework none, no build, output ".".
  NVIDIA_API_KEY = sensitive env var. Vercel Authentication only on previews. Live test: AI import 7/7 in 6 s, isolated page, 0 errors.
  api/parse.js guards: same-origin (Origin/Sec-Fetch-Site), JSON only, model allowlist, 200 KB / 4096-token caps.
- server.py: questions.db (SQLite) set library under /api/sets (localhost + JSON only), .env key loading. The import-panel UI for saved
  sets shipped in PR #16 (Setup > Questions import > Saved question sets). On Vercel the sets stay in the browser (db:false).
- Booth import code (PR #15, after Devin flagged quota drain): Origin headers can be faked, so the hosted /api/parse only spends the
  booth's key when the request has `X-Booth-Code` = BOOTH_IMPORT_CODE (sensitive Vercel env var, prod + preview; typed once in
  Setup > AI helper settings, stored in localStorage `akf-import-code`). A host's own `nvapi-` key in the body is used without the code.
  30 requests / 10 min per address (in-memory, per instance). /api/health reports needsCode. The local server ignores the code.
- Import fallbacks (PR #16 review): a chosen file keeps its own parse when the AI fails or for "Read without AI"; AI results drop a
  question as a repeat only when stem + choices + answer match; automatic AI needs /api/health to answer (static mirror = built-in).
- The NVIDIA key was pasted in chat: rotate it on build.nvidia.com and update the Vercel env var.


## 15. HANDOFF TO A LOCAL SESSION ON THE MAC (2026-11-25, evening): OPEN PROBLEMS, READ THIS FIRST

The owner is moving development to a local Claude Code session on the booth Mac (Arc browser, Chromium-based) because the cloud
sandbox cannot reproduce Mac GPU/camera behaviour. Run the app locally: `start.command` -> http://localhost:8787/host.html.

**What the owner sees on the Mac (live site, after PR #18):**
- The host page is "glitchy": buttons (Next, Setup, exit full screen) often do not respond; the page looks frozen.
- The Detection pill shows "Detection: error"; the camera picture does show now.
- The live view looked stuck half-way into full-screen: black bars, the TV stage cut off on the right, the questions list still visible.
- Before PR #18: the camera picture did not paint at all (kite visible, grey box).

**What was found in the cloud (Chromium headless, crowd video as fake camera, no WebGPU):**
- Cause #1 (fixed in PR #18): YOLO + re-ID ran on the CPU (wasm) on the MAIN thread, ~85% of the time. The live view is an
  iframe in host.html (SOLO mode, host.js line 4) and shares the main thread, so the whole host froze. Fix: without a WebGPU
  adapter, onnxruntime runs wasm in its proxy worker (`yolo-pose.js` wantProxy, `root.__ortProxy`; `reid.js` follows). Result
  here: 8-14 fps -> 54-60 fps. A saved CPU winner (`localStorage akf-yolo-provider-n = wasm`) also means the worker.
- NOT verified on the Mac: whether Arc gets a WebGPU adapter (then no worker; YOLO on WebGPU), whether the proxy worker starts
  in Arc, and what "Detection: error" says. Get `det.err` / `det.provErr` first (Setup > Connectivity, or in the iframe
  console: `Cam.debug()`, and the `cam-status` messages on BroadcastChannel).

**Suspects still open (check each on the Mac with Chrome DevTools > Performance, both frames):**
1. The fallback chain: YOLO error -> `yoloFailed` -> MediaPipe Lite with `delegate: cfg.gpu ? 'GPU' : 'CPU'` (default CPU) runs
   `detectForVideo` synchronously on the main thread: a second freeze source. Consider never running a CPU detector on the main
   thread (MediaPipe in a worker, or GPU delegate only).
2. The 3D mascot (`mascot3d.mjs`, three.js, own rAF loop, antialias) + logo sprite baking (`logo-sprites.mjs`, readPixels) +
   WebGPU inference + camera decode all share the GPU; "GPU stall due to ReadPixels" warnings appear even headless.
3. Full-screen state in host.js (`fsManual`/`fsReplay`, `fitPreview`) can be left half-applied if the page stalls mid-change.
4. `localStorage` remembers old choices (`akf-yolo-provider-*`, camera settings): test once with storage cleared.

**Idea that was started but not committed (do it properly locally):** a watchdog in cam.js: a `PerformanceObserver('longtask')`
measures how busy the page is each second; above ~35% busy, detection waits longer between frames (up to 2.5 s) and recovers
when calm, so the host controls can never freeze. Plus: clicking the Detection pill shows engine, error, GPU note, speed test,
page-busy %, and the browser string.

**Bigger options if the shared main thread stays a problem:**
- Run detection completely in a dedicated Worker (send frames with `createImageBitmap(video)` / `VideoFrame`, transfer them;
  run onnxruntime there; the main thread only draws).
- Turn SOLO off (`host.js` `const SOLO = true`): the TV runs in its own window (audience.html), and the host gets small preview
  stills over BroadcastChannel. Check that Chrome/Arc puts the window in a separate process (open it with `noopener`).
- A native app wrapper is NOT needed to fix this; the problem is main-thread work, which a desktop shell would share too.

**Other state:**
- Live: https://akf-trivia-booth.vercel.app (Vercel, auto-deploys main). Booth import code for hosted AI import is the Vercel
  env var BOOTH_IMPORT_CODE (the owner has it). The NVIDIA key was pasted in chat once: the owner should rotate it.
- Local AI import reads the key from a private `.env` (`NVIDIA_API_KEY=...`) next to server.py; question sets live in `questions.db`.
- Tests: `node tests/run_all.js`. Clip harness: `tests/eval` (section 12). Real-camera checks happen on this Mac.
