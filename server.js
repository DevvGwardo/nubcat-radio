const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DISCO_DIR = path.resolve(process.env.DISCO_DIR || path.join(__dirname, "audio"));
const SLOT_SEC = 180; // 3-min station slot — all listeners share same slot

// ---- helpers: tracks + station queue ----
function readTracks() {
  let files = [];
  try { files = fs.readdirSync(DISCO_DIR).filter(f => f.endsWith(".mp3")).sort(); } catch (e) {}
  const tracks = files.map((f, i) => {
    const m = f.match(/([a-z][a-z-]+)-(\d+)\.mp3/);
    let size_kb = 0;
    try { size_kb = Math.floor(fs.statSync(path.join(DISCO_DIR, f)).size / 1024); } catch (e) {}
    return { file: f, genre: m ? m[1] : "nubcat", num: m ? parseInt(m[2]) : i + 1, size_kb };
  });
  const genres = [...new Set(tracks.map(t => t.genre))].sort();
  return { tracks, genres };
}

// station queue — shuffled once at boot, stable for all listeners
let stationQueue = [];
function buildStationQueue() {
  const { tracks } = readTracks();
  const q = [...tracks];
  for (let i = q.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [q[i], q[j]] = [q[j], q[i]];
  }
  stationQueue = q;
}
buildStationQueue();
// rebuild periodically to pick up new files from volume uploads without restart
setInterval(buildStationQueue, 60000);

function getStation() {
  if (!stationQueue.length) return null;
  const nowSec = Date.now() / 1000;
  const slot = Math.floor(nowSec / SLOT_SEC) % stationQueue.length;
  const offset = nowSec % SLOT_SEC;
  const track = stationQueue[slot];
  return { slot, offset: Math.floor(offset), track, queueLength: stationQueue.length };
}

// ---- listener counting (SSE + heartbeat GC) ----
const listeners = new Map(); // id -> lastSeen
setInterval(() => {
  const cutoff = Date.now() - 35000;
  for (const [id, seen] of listeners) if (seen < cutoff) listeners.delete(id);
}, 10000);

// SSE: sends both count and station so all clients stay in sync — HTTP/2 forbids Connection header
app.get("/api/listeners", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",
  });
  const id = Math.random().toString(36).slice(2);
  listeners.set(id, Date.now());
  const send = () => {
    const station = getStation();
    const payload = JSON.stringify({ listeners: listeners.size, station, t: Date.now() });
    res.write(`data: ${payload}\n\n`);
  };
  // send initial comment to establish stream (helps proxies)
  res.write(":ok\n\n");
  send();
  const iv = setInterval(send, 3000);
  req.on("close", () => { clearInterval(iv); listeners.delete(id); });
});

// handle favicon without 404 noise
app.get("/favicon.ico", (req, res) => res.status(204).end());

// REST: current station for initial fetch and for clients that don't want SSE
app.get("/api/station", (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  const station = getStation();
  res.json({ listeners: listeners.size, station, slotSec: SLOT_SEC });
});

app.use(express.static(path.join(__dirname, "public")));

// manifest generated from disco dir — always current
app.get("/tracks.json", (req, res) => {
  const { tracks, genres } = readTracks();
  res.json({ tracks, genres });
});

// stream mp3 with range support (needed for seeking and for station offset jumps)
app.get("/audio/:file", (req, res) => {
  const file = path.basename(req.params.file);
  if (!file.endsWith(".mp3")) return res.status(400).end();
  const p = path.join(DISCO_DIR, file);
  if (!fs.existsSync(p)) return res.status(404).end();
  const stat = fs.statSync(p);
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    if (isNaN(start) || start >= stat.size) return res.status(416).end();
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": "audio/mpeg",
    });
    fs.createReadStream(p, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400",
    });
    fs.createReadStream(p).pipe(res);
  }
});

app.listen(PORT, () => console.log(`nubcat radio live on :${PORT} — ${stationQueue.length} tracks, slot ${SLOT_SEC}s`));
