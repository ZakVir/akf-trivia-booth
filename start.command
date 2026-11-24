#!/bin/bash
# Double-click to start the booth: runs the local server and opens the host view in Search.
cd "$(dirname "$0")"
python3 server.py &
SERVER=$!
sleep 1
open -a Search "http://localhost:8787/host.html" 2>/dev/null || open "http://localhost:8787/host.html"
trap "kill $SERVER 2>/dev/null" EXIT
wait $SERVER
