# AKF Winter Wonderland Trivia Booth: Plan v2

Replaces the first plan. Same booth, same hybrid idea (camera for the magic, a human for the scoring), now with the full app, the connectivity chain, the question importer and the player-color scoring you described.

## 1. How it runs

| Piece | Choice | Why |
|---|---|---|
| Computer | M2 MacBook Air, 8 GB, no fan | Everything is light: plain HTML/JS, one small pose model, no video recording |
| Browser | Search (WebKit), installed on this Mac | Same engine as Safari: Continuity Camera, BroadcastChannel, WASM all supported |
| Camera | iPhone through Continuity Camera, on the tripod | Appears as a normal webcam. Pixel 9 Pro stays a backup (parked) |
| Server | `server.py`, localhost only | Needed so the camera is allowed and the two windows can talk. Also the optional AI parser relay |
| Start | Double-click `start.command` | Starts the server and opens the host view in Search |

Everything works with **no internet** (library, model, fonts-with-fallback are local). Only "Ask AI" needs internet, and only when you press it.

## 2. Connectivity chain (and where each link is checked)

```
iPhone --(Wi-Fi + Bluetooth, same Apple ID)--> Mac camera
   --> TV window (getUserMedia, pose model, kites) --BroadcastChannel--> Host window
   --> Mac "Extend" display --HDMI/USB-C--> TV
```

The host window's **Setup → Connectivity** tab shows a green/yellow/red row for each link with a plain-language fix:

1. App server (http, not a file) 2. TV window connected + fullscreen 3. TV on a separate display (Extend, not Mirror)
4. Camera permission and state (asking, blocked, lost, live) 5. iPhone/Continuity camera listed, with the usual causes if it is missing
6. Picture size 7. Person detection (ms per frame, per second) 8. People in view / in the square
9. Offline files present 10. AI helper ready 11. Sound tips 12. Heat/power tips 13. Scores saved.

Auto-recovery: if the camera drops, the TV window retries every 3 seconds and the top bar says so. If the TV window is closed, the host shows "TV: not open".
Header pills (TV / Camera / Detection) are always visible so you never have to open Setup mid-game.

## 3. Screens

**TV window (audience view):** live camera with floating kites and the dashed play square, question panel, scoreboard bars, the screen-buddy mascot, snow, confetti. No cursor, no buttons. Click once for fullscreen.

**Host window (presenter view):** small "what viewers see" preview in the corner, the question with its choices (correct one marked) or the reference answer for free response, what to say out loud, a big color tile for every player to click for a point, timer, navigation, question list, and a Setup dialog (camera + square, connectivity, import). Hotkeys for everything.

Your paper drawing will replace the host layout later: all the pieces already exist as separate blocks, so it is a re-arrangement, not a rewrite.

## 4. Kites over heads

- A small pose model (MediaPipe Pose Landmarker "lite", CPU, runs in the TV window only) finds up to 8 people ~10 times a second.
- A tracker gives each person a stable color while they stay in the square. A new person must be seen for 3 rounds before getting a color (no ghosts); a person who leaves frees their color, which is not reused for 4 seconds.
- Each marker is a slowly turning 3D diamond in the player's color that bobs and sparkles above the head; it turns into a raise-order number when the player raises a hand (section 11). It is smoothed at 60 fps between detections, so it glides.
- If the detection ever misbehaves: turn Find people off, or use the host color tiles directly. The game never depends on the camera.

## 5. Play square (the taped floor)

Two ways, in **Setup → Camera**:
1. **Manual:** drag four corner handles over the tape in a live picture.
2. **Auto:** click "Pick tape color", click a piece of tape in the picture, press "Auto-detect tape". The pink overlay shows what it thought was tape and the corners snap to it. Drag to fine-tune. Sensitivity slider for tricky lighting.

Only people whose feet (or hips, if feet are cut off) are inside the square get kites and score tiles. The outline can be shown or hidden on the TV.

## 6. Players and scoring

- Eight colors: red, orange, gold, green, teal, blue, purple, pink. Each person in the square gets one.
- The host's player tiles show exactly the colors currently in the square. Click a tile (or press 1-8) for +1, confetti, mascot celebration. Three in a row makes the mascot put on sunglasses.
- No camera? Pick 1-8 players in the host window and use the same tiles.
- Scores belong to colors and persist until **New group** or **Reset scores**. Undo is always available.

## 7. Questions: importer

Any human-readable document: CSV, TSV, Excel (.xlsx), Word (.docx), text, Markdown, JSON, or pasted text. Handled offline by a local parser, no AI needed:

- Tables: header names are guessed (question, correct, wrong 1-3, A-D, answer letter, fact, level, emoji, type).
- Text: numbered questions, `A)` / `B.` choices, `*` or `Answer: B` or bold marks the correct one, `Fact:` lines.
- No choices means **free response**: the TV just shows the question and the host decides who earned the point (reference answer shown only on the host screen).
- Everything is shown in a review screen where you can fix any question, switch its type, pick the correct choice, and shuffle answer positions before loading.
- Optional **Ask AI to clean up**: uses NVIDIA's free NIM API (a small model, default meta/llama-3.1-8b-instruct) through the local server. Needs a free key from build.nvidia.com pasted into the AI settings. The key stays in this browser only.
- Not readable offline: PDF, Pages, Numbers, images. Copy the text and paste it, or export to .docx/.csv.

## 8. Performance budget (8 GB, fanless)

- One camera stream, one small model at 6-15 detections/second (adaptive: if a detection takes longer than its time slot, it slows down on its own).
- The host window does no video work; the preview is a 3 fps still plus drawn kites.
- Nothing recorded, nothing uploaded. Fonts and library are local.
- Watch "ms per frame" in Connectivity; over ~140 ms switch to Gentle, close other tabs, keep the Mac on a hard surface, plugged in.

## 9. Status

| Item | State |
|---|---|
| Presenter view, scoring, timer, mascot, confetti, fact cards | Built and tested |
| Connectivity checklist | Built and tested (camera rows tested for errors only) |
| Kites, tracker, practice mode | Built and tested with fake players |
| Real camera + real people detection | Built, **not yet tested on a real iPhone in Search**: first job at rehearsal |
| Tape auto-detect and drag corners | Built, **needs a real tape photo to tune** |
| Importer (local parser) + review screen | See importer notes |
| AI parser | Built, **untested without a key** |
| Sound effects, drumroll, applause | Not built |
| Host layout from your paper drawing | Waiting for the drawing |
| Final 30 questions | Waiting (placeholders in place) |

## 10. Rehearsal checklist

- [ ] `start.command`, open the TV window, drag it to the TV, click it once for fullscreen
- [ ] Allow the camera for localhost in the TV window; pick the iPhone under "Which camera"
- [ ] Tape the square, place the tripod 8-10 ft back, auto-detect or drag the corners
- [ ] Stand 7 friends in the square: 7 kites, 7 different colors, nobody extra outside
- [ ] Kids and adults, crouching and moving: if tracking flickers, lower speed or use the tiles
- [ ] Import the real questions, fix any flagged rows, check free-response ones
- [ ] Unplug the camera mid-game: it must say reconnecting and recover
- [ ] Leave it running 30 minutes: check ms per frame and Mac temperature

## 11. Added later: hand-raise buzzer, instant replay, tougher detection

- **Kite turns into the raise-order number:** each player has a turning 3D diamond in their color. When they raise a hand it spins, shrinks and pops into a chunky number in the same color: 1 for the first hand up, 2 for the second, and so on. Numbers stay until the next question (or the host reopens the buzzer).
- **Hand-raise buzzer** (host: "Hand-raise buzzer", key B): a raised hand is a wrist clearly above the shoulder for two detections in a row. First hand up wins. Anyone else within 0.65 s makes it a contested call.
- **Instant replay:** the live view keeps the last 8 seconds in memory only (small pictures plus marker positions, nothing saved). A contested call plays a slow-motion replay (0.45x, then 0.22x) with raised-hand rings, a timeline with each player's marker, chips showing who was first and by how much, then a "FIRST!" verdict. Under about 0.2 s the camera can't judge (it checks ~10x per second), so the verdict says "host decides" and the host card gives a point button per contender, Replay again, Skip, and Reopen.
- **Tougher detection:** one person is now one marker. Overlapping or ghost poses from the model are merged each frame, new players are not allowed to spawn inside someone's zone, two markers stuck on one person are merged, and a player who flickers out gets their own number back. Tuning in Setup → Camera: Crowd mode (Fast / Accurate: also scans zoomed left and right halves), Sensitivity (Strict / Normal / Sensitive), Debug dots with boxes, and a Ghost test in Practice mode.
- **Test without people:** Practice mode plus "Test 2 raises" fakes a contested buzz so you can see the whole replay flow.
- **Not verified with real people yet:** hand-raise accuracy, and how many people Crowd mode finds in a real 7-person group.

## 12. One window, projected (replaces the separate TV window)

There is no TV window any more. The live view (camera, kites, scoreboard, question) runs inside the host page, and the Mac screen is what gets projected to the TV. Press **P** (or the Full screen button) to make the live view fill the screen so the audience does not see host controls or answers; press **Esc** to come back. When an instant replay starts, the page goes full screen on its own and returns when the replay ends. Run the game with hotkeys while full screen.

## 13. Accuracy and smoothness round (latest)

- **Detector:** YOLO26 pose (small by default, medium as an option) through onnxruntime-web on WebGPU, with MediaPipe as automatic fallback if WebGPU is missing, too slow, or fails mid-run.
- **Tracker:** predicts motion, matches by clothing color, smooths with a speed-adaptive filter plus a dead-zone (a still person keeps a still marker), keeps neighbours shoulder-to-shoulder as separate people, and fixes identity swaps with a background body re-ID model (OSNet) when present.
- **Hands up:** a raise must be held about 0.25 s; a hand that goes up and drops is a false start; the raise time is the moment the wrist crossed the line (interpolated); a hand hovering at the line does not flap.
- **Replay:** every camera frame is recorded (60 fps if the camera gives it) for the last 9 s; replay only plays when 2+ hands go up within 1.5 s (R plays the last few seconds on demand); slow motion blends neighbouring frames and moves continuously.
- **Decision:** no face recognition, ever. Person tracking only (body-based).
- **Self-check:** check.html measures the real camera fps, WebGPU, model speed and recorder speed on the booth Mac.
