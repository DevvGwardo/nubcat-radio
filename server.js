const express = require("express");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
let ffmpegPath = null;
try { ffmpegPath = require("ffmpeg-static"); } catch(e) {}
if (!ffmpegPath) ffmpegPath = "ffmpeg";

const app = express();
const PORT = process.env.PORT || 3000;
const DISCO_DIR = path.resolve(process.env.DISCO_DIR || path.join(__dirname, "audio"));
const SLOT_SEC = 180;

// ---- tracks + station queue (for /tracks.json + nowplaying fallback) ----
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
let stationQueue = [];
function buildStationQueue() {
  const { tracks } = readTracks();
  if (!stationQueue.length) {
    const q = [...tracks];
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [q[i], q[j]] = [q[j], q[i]];
    }
    stationQueue = q;
    return;
  }
  const existing = new Set(stationQueue.map(t => t.file));
  const stillExists = new Set(tracks.map(t => t.file));
  stationQueue = stationQueue.filter(t => stillExists.has(t.file));
  const newTracks = tracks.filter(t => !existing.has(t.file));
  if (newTracks.length) {
    for (let i = newTracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newTracks[i], newTracks[j]] = [newTracks[j], newTracks[i]];
    }
    stationQueue.push(...newTracks);
    console.log(`station queue: +${newTracks.length} new tracks → ${stationQueue.length} total`);
  }
}
let slotCount = 0;
buildStationQueue();
slotCount = stationQueue.length;
setInterval(buildStationQueue, 60000);

function getStation() {
  if (!stationQueue.length) return null;
  const nowSec = Date.now() / 1000;
  const len = slotCount || stationQueue.length;
  const slot = Math.floor(nowSec / SLOT_SEC) % len;
  const offset = nowSec % SLOT_SEC;
  const track = stationQueue[slot];
  return { slot, offset: Math.floor(offset), track, queueLength: stationQueue.length, slotCount: len };
}

// ---- listener counting (SSE) ----
const listeners = new Map();
setInterval(() => {
  const cutoff = Date.now() - 35000;
  for (const [id, seen] of listeners) if (seen < cutoff) listeners.delete(id);
}, 10000);

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
    listeners.set(id, Date.now());
    const station = getStation();
    const payload = JSON.stringify({ listeners: listeners.size, station, t: Date.now(), broadcast: nowPlaying });
    res.write(`data: ${payload}\n\n`);
  };
  res.write(":ok\n\n");
  send();
  const iv = setInterval(send, 3000);
  const keepalive = setInterval(()=> res.write(":keepalive\n\n"), 15000);
  req.on("close", () => { clearInterval(iv); clearInterval(keepalive); listeners.delete(id); });
});

app.get("/favicon.ico", (req, res) => res.status(204).end());

app.get("/api/station", (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  const peek = parseInt(req.query.peek, 10);
  let station = broadcastNowPlaying() || getStation();
  if (!isNaN(peek) && peek>0 && station) {
    const nowSec = Date.now() / 1000 + peek;
    const len = slotCount || stationQueue.length;
    const slot = Math.floor(nowSec / SLOT_SEC) % len;
    const offset = nowSec % SLOT_SEC;
    const track = stationQueue[slot];
    station = { slot, offset: Math.floor(offset), track, queueLength: stationQueue.length, slotCount: len };
  }
  res.json({ listeners: listeners.size, streamListeners: broadcastClients.size, station, broadcast: nowPlaying, slotSec: SLOT_SEC });
});

app.get("/api/nowplaying", (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.json({ listeners: listeners.size, streamListeners: broadcastClients.size, broadcast: nowPlaying, station: getStation() });
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/tracks.json", (req, res) => {
  const { tracks, genres } = readTracks();
  res.json({ tracks, genres });
});

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

// ---- TRUE STREAM: /stream ----
const broadcastClients = new Set();
let nowPlaying = null; // { track, start, idx }
let broadcastIdx = 0;
let currentFfmpeg = null;

function broadcastNowPlaying(){
  if(!nowPlaying) return null;
  const elapsed = Math.floor((Date.now() - nowPlaying.start)/1000);
  return { slot: nowPlaying.idx, offset: elapsed, track: nowPlaying.track, queueLength: stationQueue.length, slotCount, isBroadcast: true };
}

app.get("/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "no-cache, no-store",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });
  // send ID3-ish preread? just join mid-stream
  broadcastClients.add(res);
  console.log(`stream client connected → ${broadcastClients.size} listeners`);
  // update SSE listeners count via broadcastClients size
  req.on("close", () => {
    broadcastClients.delete(res);
    console.log(`stream client disconnected → ${broadcastClients.size} listeners`);
  });
});

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function streamTrack(track){
  return new Promise((resolve)=>{
    const filePath = path.join(DISCO_DIR, track.file);
    if(!fs.existsSync(filePath)){ console.log(`missing ${track.file}`); return resolve(); }
    nowPlaying = { track, start: Date.now(), idx: broadcastIdx % stationQueue.length };
    console.log(`[broadcast] now playing ${track.file} idx ${broadcastIdx}`);
    // use ffmpeg -re for realtime pacing, copy codec (no transcode) for low cpu
    // fallback to raw fs stream if ffmpeg missing
    let proc = null;
    let stream = null;
    if(ffmpegPath && fs.existsSync(ffmpegPath) || ffmpegPath==="ffmpeg"){
      try{
        proc = spawn(ffmpegPath, ["-re","-i", filePath, "-c:a","copy","-f","mp3","pipe:1"], { stdio: ["ignore","pipe","pipe"] });
        currentFfmpeg = proc;
        stream = proc.stdout;
        proc.stderr.on("data", ()=>{}); // mute
        proc.on("error", (e)=>{ console.log("ffmpeg error", e.message); resolve(); });
        proc.on("close", (code)=>{ resolve(); });
      }catch(e){ console.log("ffmpeg spawn fail", e.message); proc=null; }
    }
    if(!proc){
      // fallback: raw read with throttled pacing (~256kbit = 32KB/s)
      stream = fs.createReadStream(filePath, { highWaterMark: 32*1024 });
      let throttled = false;
      stream.on("data", chunk=>{
        // crude throttle: pause 1s per 32KB
        for(const c of broadcastClients){ try{ c.write(chunk); }catch(e){} }
        stream.pause();
        setTimeout(()=> stream.resume(), 1000);
      });
      stream.on("end", resolve);
      stream.on("error", resolve);
      return;
    }
    stream.on("data", chunk=>{
      for(const c of broadcastClients){
        try{ if(!c.writableEnded) c.write(chunk); }catch(e){}
      }
    });
    stream.on("end", ()=> resolve());
    stream.on("error", ()=> resolve());
    // if no clients, still need to consume stream to keep realtime
    proc.stdout.on("error", ()=>{});
  });
}

// crossfade variant: pairwise acrossfade for gapless 5s
async function streamWithCrossfade(){
  // build pairwise crossfaded stream for entire queue in one ffmpeg process
  // for 177 tracks this is heavy, so chunk into batches of 10 with loop
  const BATCH = 20;
  let batchStart = broadcastIdx % stationQueue.length;
  while(true){
    if(!stationQueue.length){ await sleep(1000); continue; }
    const batch = [];
    for(let i=0;i<BATCH;i++) batch.push(stationQueue[(batchStart+i)%stationQueue.length]);
    // check ffmpeg exists
    if(!ffmpegPath || (!fs.existsSync(ffmpegPath) && ffmpegPath!=="ffmpeg")){
      // fallback to per-track streaming
      for(const t of batch){
        await streamTrack(t);
        broadcastIdx++;
        batchStart = broadcastIdx % stationQueue.length;
      }
      continue;
    }
    // build ffmpeg args for this batch with acrossfade
    const inputs = [];
    batch.forEach(t=> { inputs.push("-re","-i", path.join(DISCO_DIR, t.file)); });
    let filter = "";
    let last = "[0:a]";
    for(let i=1;i<batch.length;i++){
      const out = i===batch.length-1 ? "[aout]" : `[a${i}]`;
      filter += `${last}[${i}:a]acrossfade=d=5:c1=tri:c2=tri${out};`;
      last = out;
    }
    const args = [...inputs, "-filter_complex", filter, "-map", "[aout]", "-c:a","libmp3lame","-b:a","128k","-f","mp3","pipe:1"];
    console.log(`[broadcast] starting batch ${batchStart} len ${batch.length} with xfade`);
    // update nowPlaying for first track of batch
    nowPlaying = { track: batch[0], start: Date.now(), idx: batchStart };
    await new Promise((resolve)=>{
      const proc = spawn(ffmpegPath, args, { stdio: ["ignore","pipe","pipe"] });
      currentFfmpeg = proc;
      let trackIdx = 0;
      let nextTrackTime = Date.now();
      // estimate track durations for nowPlaying updates — use 120s avg, update every track length minus 5s xfade
      const updateNowPlaying = ()=>{
        if(trackIdx < batch.length){
          nowPlaying = { track: batch[trackIdx], start: Date.now(), idx: (batchStart+trackIdx)%stationQueue.length };
          trackIdx++;
        }
      };
      updateNowPlaying();
      const interval = setInterval(()=>{
        // crude: advance track every ~130s (avg) minus xfade, not precise but keeps display moving
        if(Date.now() - nextTrackTime > 125000){
          nextTrackTime = Date.now();
          updateNowPlaying();
        }
      }, 5000);
      proc.stdout.on("data", chunk=>{
        for(const c of broadcastClients){ try{ if(!c.writableEnded) c.write(chunk); }catch(e){} }
      });
      proc.stderr.on("data", ()=>{});
      proc.on("close", (code)=>{
        clearInterval(interval);
        console.log(`[broadcast] batch finished code ${code}`);
        resolve();
      });
      proc.on("error", (e)=>{ clearInterval(interval); console.log("batch ffmpeg error", e.message); resolve(); });
    });
    broadcastIdx += batch.length;
    batchStart = broadcastIdx % stationQueue.length;
    // loop continues
  }
}

let useCrossfade = false;
async function broadcastLoop(){
  console.log(`broadcast loop starting — ${stationQueue.length} tracks, ffmpeg ${ffmpegPath}`);
  if(useCrossfade){
    await streamWithCrossfade();
  } else {
    while(true){
      if(!stationQueue.length){ await sleep(1000); continue; }
      const track = stationQueue[broadcastIdx % stationQueue.length];
      await streamTrack(track);
      broadcastIdx++;
    }
  }
}
// start broadcast loop after server listen
setTimeout(()=>{ broadcastLoop().catch(e=> console.log("broadcast loop crash", e)); }, 1000);

app.listen(PORT, () => console.log(`nubcat radio live on :${PORT} — ${stationQueue.length} tracks, slot ${SLOT_SEC}s — /stream true broadcast`));
