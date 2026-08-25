const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DISCO_DIR = path.resolve(process.env.DISCO_DIR || path.join(__dirname, "..", "nubcat-disco"));

// Serve static frontend
app.use(express.static(path.join(__dirname, "public")));

// API: list tracks
app.get("/api/tracks", (req, res) => {
  const manifestPath = path.join(__dirname, "public", "tracks.json");
  if (fs.existsSync(manifestPath)) {
    res.sendFile(manifestPath);
  } else {
    res.json({ tracks: [], genres: [] });
  }
});

// API: stream a track by filename
app.get("/api/stream/:file", (req, res) => {
  const file = path.basename(req.params.file);
  if (!file.endsWith(".mp3")) return res.status(400).end("invalid");
  const p = path.join(DISCO_DIR, file);
  if (!fs.existsSync(p)) return res.status(404).end("not found");
  const stat = fs.statSync(p);
  res.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=86400",
  });
  fs.createReadStream(p).pipe(res);
});

app.listen(PORT, () => console.log(`nubcat radio on :${PORT}`));
