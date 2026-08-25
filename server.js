const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DISCO_DIR = path.resolve(process.env.DISCO_DIR || path.join(__dirname, "audio"));

// ---- listener counting (SSE + heartbeat GC) ----
const listeners = new Map(); // id -> lastSeen
setInterval(() => {
  const cutoff = Date.now() - 35000; // 35s without ping = gone
  for (const [id, seen] of listeners) if (seen < cutoff) listeners.delete(id);
}, 10000);

app.get("/api/listeners", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const id = Math.random().toString(36).slice(2);
  listeners.set(id, Date.now());
  const send = () => res.write(`data: ${listeners.size}\n\n`);
  send();
  const iv = setInterval(send, 15000);
  req.on("close", () => { clearInterval(iv); listeners.delete(id); });
});

app.use(express.static(path.join(__dirname, "public")));

// manifest generated at boot from the disco dir — always current
app.get("/tracks.json", (req, res) => {
  let files = [];
  try { files = fs.readdirSync(DISCO_DIR).filter(f => f.endsWith(".mp3")); } catch (e) {}
  const tracks = files.map((f, i) => {
    const m = f.match(/([a-z][a-z-]+)-(\d+)\.mp3/);
    return {
      file: f,
      genre: m ? m[1] : "nubcat",
      num: m ? parseInt(m[2]) : i + 1,
      size_kb: Math.floor(fs.statSync(path.join(DISCO_DIR, f)).size / 1024),
    };
  });
  const genres = [...new Set(tracks.map(t => t.genre))];
  res.json({ tracks, genres });
});

// stream mp3 with range support (needed for seeking)
app.get("/audio/:file", (req, res) => {
  const file = path.basename(req.params.file);
  if (!file.endsWith(".mp3")) return res.status(400).end();
  const p = path.join(DISCO_DIR, file);
  if (!fs.existsSync(p)) return res.status(404).end();
  const stat = fs.statSync(p);
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0]);
    const end = parts[1] ? parseInt(parts[1]) : stat.size - 1;
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

app.listen(PORT, () => console.log(`nubcat radio live on :${PORT}`));
