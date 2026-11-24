# AKF Winter Wonderland Trivia Booth

## Start
Double-click `start.command` (starts the local server and opens the host page in Search), or run `python3 server.py` and open http://localhost:8787/host.html.

## First time on the booth Mac
1. Open http://localhost:8787/check.html, press **Run all**, copy the report. It shows your real camera fps, WebGPU, model speed and replay-recorder speed.
2. Back on the host page, click **Allow** for the camera.
3. Press **P** for full screen when projecting to the TV (Esc exits). Use Ctrl+Cmd+F for the browser's own full screen.

## Hotkeys (host page)
`1`–`8` give that color +1 · `Space` reveal answer, then fact · `←` `→` previous / next · `N` nobody got it · `R` replay the last few seconds · `T` timer · `U` undo · `K` kid wording · `P` full screen · `Esc` exit full screen / skip replay.

## How the game works
People stand in front of the camera and each gets a spinning diamond in their own color. When someone raises a hand (held about a quarter second) their diamond turns into a number: 1 for the first hand up, 2 for the second. If two or more hands go up within 1.5 s an instant replay plays by itself, slow motion, so you can see who really was first. You give points by clicking the player's color tile (or pressing the number key).

## Questions
Setup → Questions import takes CSV, Excel, Word, text, Markdown, JSON or pasted text. Free-response questions are supported; the host decides who earned the point.

## Tests (no browser needed)
`node tests/run_all.js` (add `--slow` to include the YOLO and re-ID model tests).

## Files
`PLAN_v2.md` design and decisions · `TODO.md` what is done and what is left · `tests/` automatic tests · `models/` and `vendor/` the offline models and runtimes (YOLO26 pose weights are AGPL-3.0; OSNet is MIT).
