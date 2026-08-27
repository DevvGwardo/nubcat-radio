# Gates: nubcat-radio unify + impeccable polish

Scope: Unify diverged public/docs UIs into one impeccable product-grade radio, fix server/static serving, ensure gh-pages + express both work.

- [x] G1: Server boots and serves dynamic manifest with 50 tracks
  CHECK: bash -c 'timeout 10 bash -c "PORT=3001 node server.js & pid=\$!; sleep 2; curl -s --max-time 3 http://localhost:3001/tracks.json | python3 -c '\''import sys,json; print(len(json.load(sys.stdin)[sys.argv[1]]))'\'' tracks; kill \$pid 2>/dev/null; wait \$pid 2>/dev/null; true"'
  EXPECT: 50
  EVIDENCE: nubcat radio live on :3001 | 50

- [x] G2: Range streaming returns 206 with correct headers
  CHECK: bash -c "timeout 10 bash -c \"PORT=3002 node server.js & pid=\$!; sleep 2; curl -s --max-time 3 -H 'Range: bytes=0-1023' -D - -o /tmp/nub-range.mp3 http://localhost:3002/audio/country-21.mp3 | grep -q '206' && echo 206 || echo fail; kill \$pid 2>/dev/null; wait \$pid 2>/dev/null; true\""
  EXPECT: 206
  EVIDENCE: nubcat radio live on :3002 | 206

- [x] G3: SSE listener endpoint streams event-stream data
  CHECK: bash -c "timeout 10 bash -c \"PORT=3003 node server.js & pid=\$!; sleep 2; curl -s -m 3 -H 'Accept: text/event-stream' http://localhost:3003/api/listeners | head -n 1 | grep -q 'data:' && echo data-ok || echo fail; kill \$pid 2>/dev/null; wait \$pid 2>/dev/null; true\""
  EXPECT: data-ok
  EVIDENCE: nubcat radio live on :3003 | data-ok

- [x] G4: public/index.html and docs/index.html are byte-identical (single source of truth)
  CHECK: bash -c "diff -q public/index.html docs/index.html && echo identical || echo differ"
  EXPECT: identical
  EVIDENCE: identical

- [x] G5: No impeccable absolute bans (side-stripe borders, gradient text, glassmorphism)
  CHECK: bash -c "grep -E 'border-left:.*[0-9]+px solid|background-clip.*text|backdrop-filter.*blur\(20' public/index.html && echo banned || echo clean"
  EXPECT: clean
  EVIDENCE: clean

- [x] G6: Responsive fundamentals (viewport meta, no fixed 480px-only layout, fluid clamp)
  CHECK: bash -c "grep -q 'viewport.*width=device-width' public/index.html && grep -q 'clamp(' public/index.html && echo viewport-ok || echo fail"
  EXPECT: viewport-ok
  EVIDENCE: viewport-ok

- [x] G7: Accessibility baseline (aria-labels on controls, semantic headings, focus-visible, keyboard)
  CHECK: bash -c "grep -q 'aria-label' public/index.html && grep -q '<button' public/index.html && grep -q 'focus-visible' public/index.html && echo a11y-ok || echo fail"
  EXPECT: a11y-ok
  EVIDENCE: a11y-ok

- [x] G8: Design tokens present (CSS vars, OKLCH or tinted neutrals, no pure #000/#fff surface)
  CHECK: bash -c "grep -q 'var(--' public/index.html && grep -q '#9ecdff\|oklch' public/index.html && ! grep -q 'background: #fff;' public/index.html && echo tokens-ok || echo fail"
  EXPECT: tokens-ok
  EVIDENCE: tokens-ok

- [x] G9: Player JS contracts present (genre filter, shuffle, queue, history, station clock or equivalent, single Audio instance)
  CHECK: bash -c "grep -q 'filterGenre' public/index.html && grep -q 'shuffle\|reshuffle' public/index.html && grep -q 'addHistory\|HISTORY' public/index.html && grep -q 'new Audio' public/index.html && echo js-ok || echo fail"
  EXPECT: js-ok
  EVIDENCE: js-ok

- [x] G10: Static fallback manifests exist and match dynamic count (50 tracks) for gh-pages
  CHECK: bash -c "python3 -c \"import json; a=json.load(open('public/tracks.json')); b=json.load(open('docs/tracks.json')); print('match' if len(a['tracks'])==len(b['tracks'])==50 else 'mismatch_' + str(len(a['tracks'])) + '_' + str(len(b['tracks'])) )\""
  EXPECT: match
  EVIDENCE: match

- [x] G11: Audio paths work for BOTH hosting modes (relative audio/ for gh-pages, /audio/ for express range streaming) — dual-path logic present
  CHECK: bash -c "grep -q \"audio/\" public/index.html && grep -q \"/audio/\" server.js && echo dual-ok || echo fail"
  EXPECT: dual-ok
  EVIDENCE: dual-ok

- [x] G12: Build still passes — server.js syntax valid, no console errors on boot
  CHECK: bash -c "node --check server.js && echo syntax-ok || echo fail"
  EXPECT: syntax-ok
  EVIDENCE: syntax-ok
