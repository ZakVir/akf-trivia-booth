#!/bin/bash
# Double-click to start the booth: runs the local server and opens the host view in Search.
cd "$(dirname "$0")" || exit 1
PORT=8787
URL="http://localhost:$PORT/host.html"
open_page() { open -a Search "$URL" 2>/dev/null || open "$URL"; }

# Already running (an earlier double-click)? Just open the page again.
if curl -fs "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
  echo "The booth server is already running. Opening the host view."
  open_page
  exit 0
fi
# Something else holds the port: say so instead of opening the wrong page.
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is used by another program:"
  lsof -nP -iTCP:$PORT -sTCP:LISTEN
  echo "Quit that program (or restart the Mac), then double-click start.command again."
  read -r -p "Press Return to close." _
  exit 1
fi

python3 server.py &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
# wait until the server really answers (up to 15 s) before opening the page
for _ in $(seq 1 75); do
  curl -fs "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break
  kill -0 $SERVER 2>/dev/null || { echo "The server could not start (see the message above)."; read -r -p "Press Return to close." _; exit 1; }
  sleep 0.2
done
open_page
wait $SERVER
