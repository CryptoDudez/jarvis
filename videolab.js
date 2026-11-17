/* Jarvis Video Lab — makes niche.co videos and studies videos, all on this laptop.
   Uses the niche.co folder (picked once): photos anywhere in it are the source material,
   finished videos go into niche.co/videos as "niche video N.mp4",
   videos to learn from go into niche.co/inspiration. */
(function () {
  const W = 1080, H = 1920, FPS = 30;
  const STYLES = {
    auto: "Auto (learned)",
    hardcut: "Hard cuts on white",
    bwmood: "B&W moodboard",
    fastcolour: "Fast colour",
    collage: "Collage pop-in",
    bw2colour: "B&W to colour",
    duo: "Two at once",
  };
  const IMG_RE = /\.(jpe?g|png|webp|avif|gif)$/i, VID_RE = /\.(mp4|mov|webm|m4v)$/i;
  const VL = { dir: null, ready: false, busy: false, analyses: [], last: null };
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const median = (a) => { const s = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const fmt = (n, d = 1) => (n == null ? "—" : (+n).toFixed(d));

  /* ---------- folder access ---------- */
  async function loadFolder() {
    try { VL.dir = await idb.get("nicheDir"); } catch (e) { VL.dir = null; }
    try { VL.analyses = (await idb.get("vlabAnalyses")) || []; } catch (e) { VL.analyses = []; }
    await checkPerm(false);
    render();
  }
  async function checkPerm(ask) {
    VL.ready = false;
    if (!VL.dir) return false;
    try {
      let p = await VL.dir.queryPermission({ mode: "readwrite" });
      if (p !== "granted" && ask) p = await VL.dir.requestPermission({ mode: "readwrite" });
      VL.ready = p === "granted";
    } catch (e) { VL.ready = false; }
    return VL.ready;
  }
  async function pickFolder() {
    if (!window.showDirectoryPicker) { msg("Your browser can't open folders. Use Chrome or Edge on the laptop."); return; }
    try {
      VL.dir = await window.showDirectoryPicker({ id: "niche", mode: "readwrite" });
      await idb.put("nicheDir", VL.dir);
      await checkPerm(true);
      await VL.dir.getDirectoryHandle("videos", { create: true });
      await VL.dir.getDirectoryHandle("inspiration", { create: true });
      msg("Connected to the " + VL.dir.name + " folder. I made a videos and an inspiration folder inside it.");
    } catch (e) { if (e.name !== "AbortError") msg("Couldn't open that folder: " + e.message); }
    render();
  }
  async function ensureReady() {
    if (VL.ready) return true;
    if (VL.dir && (await checkPerm(true))) { render(); return true; }
    return false;
  }
  async function walk(dir, path, depth, out) {
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith(".")) continue;
      if (h.kind === "directory") { if (depth < 3) await walk(h, path + name + "/", depth + 1, out); }
      else out.push({ name, path: path + name, folder: path.split("/")[0] || "", h });
    }
    return out;
  }
  async function listFiles() { return VL.ready ? walk(VL.dir, "", 0, []) : []; }

  /* ---------- learnings from analysed videos ---------- */
  function isWinner(a) { return a.label === "win" || (a.label == null && /^inspiration/i.test(a.path)); }
  function learned() {
    const wins = VL.analyses.filter(isWinner);
    if (!wins.length) return null;
    return {
      n: wins.length,
      shot: median(wins.map((a) => a.m.shotAvg)),
      hook: median(wins.map((a) => a.m.firstCut)),
      bpm: median(wins.map((a) => a.a && a.a.bpm)),
      bw: median(wins.map((a) => a.m.bwShare)),
      onBeat: median(wins.map((a) => a.a && a.a.cutsOnBeat)),
      dur: median(wins.map((a) => a.m.duration)),
    };
  }

  /* ---------- video maker ---------- */
  async function loadImages(files, want) {
    const pool = files.filter((f) => IMG_RE.test(f.name) && !/^videos\//i.test(f.path));
    if (!pool.length) return [];
    const used = new Set(store.get("vlabUsed", []));
    const fresh = pool.filter((f) => !used.has(f.path)), rest = pool.filter((f) => used.has(f.path));
    const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    const pick = [...shuffle(fresh), ...shuffle(rest)].slice(0, Math.min(want, pool.length));
    store.set("vlabUsed", [...pick.map((f) => f.path), ...[...used]].slice(0, 300));
    const out = [];
    for (const f of pick) {
      try {
        const file = await f.h.getFile();
        let bmp = await createImageBitmap(file);
        const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        if (s < 1) { const c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s)); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); bmp.close(); bmp = await createImageBitmap(c); }
        out.push(bmp);
      } catch (e) { /* skip unreadable image */ }
    }
    return out;
  }
  function chooseStyle(req, L) {
    if (req && req !== "auto") return req;
    const last = store.get("vlabLastStyle", "");
    let opts = L && L.bw != null && L.bw > 0.5 ? ["bwmood", "bw2colour", "hardcut"] : ["fastcolour", "hardcut", "collage", "bw2colour", "duo", "bwmood"];
    opts = opts.filter((s) => s !== last);
    return opts[Math.floor(Math.random() * opts.length)];
  }
  function plan(style, L, seconds) {
    const bpm = clamp(Math.round((L && L.bpm) || 120), 80, 170), beat = 60 / bpm;
    const base = { hardcut: 1, bwmood: 1, fastcolour: 0.5, collage: 1, bw2colour: 2, duo: 2 }[style];
    let shot = base * beat;
    if (L && L.shot) { // follow what works, snapped to the beat
      const beats = [0.5, 1, 2, 4].reduce((a, b) => (Math.abs(b * beat - L.shot) < Math.abs(a * beat - L.shot) ? b : a), 1);
      shot = (style === "fastcolour" ? Math.min(beats, 1) : style === "bw2colour" || style === "duo" ? Math.max(beats, 1) : beats) * beat;
    }
    const hook = clamp((L && L.hook) || shot, beat * 0.5, shot);
    const shots = [{ start: 0, dur: hook }];
    let t = hook;
    while (t + shot <= seconds - 1.2 + 1e-6) { shots.push({ start: t, dur: shot }); t += shot; }
    return { bpm, beat, shot, shots, end: t, total: t + 1.4 };
  }
  // drawing helpers
  function cover(ctx, img, x, y, w, h, zoom = 1) {
    const s = Math.max(w / img.width, h / img.height) * zoom, iw = img.width * s, ih = img.height * s;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); ctx.restore();
  }
  function contain(ctx, img, cx, cy, maxW, maxH, zoom = 1) {
    const s = Math.min(maxW / img.width, maxH / img.height) * zoom, iw = img.width * s, ih = img.height * s;
    ctx.drawImage(img, cx - iw / 2, cy - ih / 2, iw, ih);
  }
  const ease = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const pop = (x) => { x = clamp(x, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  function drawFrame(ctx, style, P, imgs, t, rnd) {
    const n = imgs.length, si = P.shots.findIndex((s) => t >= s.start && t < s.start + s.dur);
    ctx.filter = "none"; ctx.globalAlpha = 1;
    if (t >= P.end) { // end card
      const k = ease((t - P.end) / 0.35);
      ctx.fillStyle = style === "hardcut" ? "#fff" : "#000"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = style === "hardcut" ? "#000" : "#fff"; ctx.globalAlpha = k;
      ctx.font = "800 120px Inter, 'Helvetica Neue', Arial, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("NICHE.CO", W / 2, H / 2 + (1 - k) * 40); ctx.globalAlpha = 1; return;
    }
    const s = P.shots[si] || P.shots[0], p = (t - s.start) / s.dur, img = imgs[si % n];
    if (style === "hardcut") {
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
      contain(ctx, img, W / 2, H / 2, W * 0.86, H * 0.72, 1 + 0.05 * p);
    } else if (style === "fastcolour") {
      ctx.filter = "saturate(1.35) contrast(1.08)"; cover(ctx, img, 0, 0, W, H, 1.12 - 0.1 * ease(p)); ctx.filter = "none";
      if (si % 4 === 0 && p < 0.12) { ctx.fillStyle = `rgba(255,255,255,${0.7 * (1 - p / 0.12)})`; ctx.fillRect(0, 0, W, H); }
    } else if (style === "bwmood") {
      ctx.fillStyle = "#0d0d0d"; ctx.fillRect(0, 0, W, H);
      const cols = 2, rows = 3, gw = (W - 60) / cols, gh = (H - 80) / rows;
      ctx.filter = "grayscale(1) contrast(1.15)";
      for (let k = 0; k <= si; k++) {
        const cell = k % (cols * rows), cx = 20 + (cell % cols) * (gw + 20), cy = 20 + Math.floor(cell / cols) * (gh + 20);
        const kp = k === si ? ease(p * 3) : 1;
        ctx.globalAlpha = kp; cover(ctx, imgs[k % n], cx, cy + (1 - kp) * 30, gw, gh, 1.04);
      }
      ctx.globalAlpha = 1; ctx.filter = "none";
    } else if (style === "collage") {
      ctx.fillStyle = "#111"; ctx.fillRect(0, 0, W, H);
      for (let k = 0; k <= si; k++) {
        const r = rnd[k % rnd.length], kp = k === si ? pop(p * 2.2) : 1;
        ctx.save(); ctx.translate(W * (0.3 + 0.4 * r[0]), H * (0.27 + 0.46 * r[1])); ctx.rotate((r[2] - 0.5) * 0.35); ctx.scale(kp, kp);
        ctx.fillStyle = "#fff"; const im = imgs[k % n], sc = Math.min(600 / im.width, 760 / im.height), iw = im.width * sc, ih = im.height * sc;
        ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 30; ctx.fillRect(-iw / 2 - 14, -ih / 2 - 14, iw + 28, ih + 28); ctx.shadowBlur = 0;
        ctx.drawImage(im, -iw / 2, -ih / 2, iw, ih); ctx.restore();
      }
    } else if (style === "bw2colour") {
      cover(ctx, img, 0, 0, W, H, 1.08 - 0.06 * p);
      const edge = H * (1 - ease((p - 0.25) / 0.6));
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, edge); ctx.clip(); ctx.filter = "grayscale(1) contrast(1.1)"; cover(ctx, img, 0, 0, W, H, 1.08 - 0.06 * p); ctx.restore(); ctx.filter = "none";
      if (edge > 2 && edge < H - 2) { ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillRect(0, edge - 3, W, 6); }
    } else if (style === "duo") {
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      const a = imgs[(si * 2) % n], b = imgs[(si * 2 + 1) % n], k = ease(p * 4);
      cover(ctx, a, -(1 - k) * W * 0.3, 0, W, H / 2 - 6, 1.05); cover(ctx, b, (1 - k) * W * 0.3, H / 2 + 6, W, H / 2 - 6, 1.05);
    }
  }
  async function pickCodec() {
    for (const codec of ["avc1.640032", "avc1.4d0032", "avc1.42003e"]) {
      try { const r = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate: 8e6, framerate: FPS }); if (r.supported) return codec; } catch (e) {}
    }
    return null;
  }
  async function nextName(videos) {
    let max = 0;
    for await (const [name] of videos.entries()) { const m = name.match(/^niche video (\d+)\.mp4$/i); if (m) max = Math.max(max, +m[1]); }
    return "niche video " + (max + 1) + ".mp4";
  }
  async function makeVideo(opts = {}) {
    if (VL.busy) return { error: "I'm already working on something." };
    if (!(await ensureReady())) return { error: "Connect the niche.co folder in the Video Lab panel first." };
    if (!window.VideoEncoder || !window.Mp4Muxer) return { error: "This browser can't make videos. Use Chrome or Edge." };
    VL.busy = true; VL.stop = false; render();
    try {
      const L = opts.useLearned === false ? null : learned();
      const style = chooseStyle(opts.style || $("#vlStyle").value, L);
      const seconds = +(opts.seconds || $("#vlLen").value || 10);
      const P = plan(style, L, seconds);
      progress(0, "Picking photos…");
      const imgs = await loadImages(await listFiles(), style === "duo" ? P.shots.length * 2 : P.shots.length);
      if (!imgs.length) return { error: "I couldn't find any photos in the niche.co folder. Add some product photos to it." };
      const codec = await pickCodec(); if (!codec) return { error: "This laptop's browser has no H.264 video encoder." };
      const target = new Mp4Muxer.ArrayBufferTarget();
      const muxer = new Mp4Muxer.Muxer({ target, video: { codec: "avc", width: W, height: H, frameRate: FPS }, fastStart: "in-memory" });
      let encErr = null;
      const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (encErr = e) });
      enc.configure({ codec, width: W, height: H, bitrate: 8e6, framerate: FPS, latencyMode: "quality" });
      const cv = new OffscreenCanvas(W, H), ctx = cv.getContext("2d");
      const rnd = Array.from({ length: 24 }, () => [Math.random(), Math.random(), Math.random()]);
      const frames = Math.round(P.total * FPS);
      for (let i = 0; i < frames; i++) {
        if (encErr) throw encErr;
        if (VL.stop) { try { enc.close(); } catch (e) {} imgs.forEach((b) => b.close && b.close()); return { error: "Stopped. No video was saved." }; }
        drawFrame(ctx, style, P, imgs, i / FPS, rnd);
        const vf = new VideoFrame(cv, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
        enc.encode(vf, { keyFrame: i % (FPS * 2) === 0 }); vf.close();
        while (enc.encodeQueueSize > 6) await sleep(4);
        if (i % 6 === 0) { progress(i / frames, "Rendering " + STYLES[style].toLowerCase() + "…"); await sleep(0); }
      }
      await enc.flush(); enc.close(); muxer.finalize(); imgs.forEach((b) => b.close && b.close());
      const blob = new Blob([target.buffer], { type: "video/mp4" });
      const videos = await VL.dir.getDirectoryHandle("videos", { create: true });
      const name = await nextName(videos);
      const fh = await videos.getFileHandle(name, { create: true }), w = await fh.createWritable(); await w.write(blob); await w.close();
      store.set("vlabLastStyle", style);
      VL.last = { name, url: URL.createObjectURL(blob), style, secs: P.total, bpm: P.bpm, shot: P.shot, learned: !!L };
      progress(1, "Saved " + name);
      return VL.last;
    } catch (e) { return { error: "The video failed: " + (e.message || e) }; }
    finally { VL.busy = false; render(); }
  }

  /* ---------- analyser ---------- */
  function once(el, ev) { return new Promise((res, rej) => { const ok = () => { cl(); res(); }, bad = () => { cl(); rej(new Error("can't read this video")); }; const cl = () => { el.removeEventListener(ev, ok); el.removeEventListener("error", bad); }; el.addEventListener(ev, ok); el.addEventListener("error", bad); }); }
  async function analyseVideo(file, onProg) {
    const url = URL.createObjectURL(file), v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.playsInline = true; v.src = url;
    await once(v, "loadedmetadata");
    const dur = v.duration, step = Math.max(1 / 15, dur / 450), cw = 48, ch = 86;
    const c = document.createElement("canvas"); c.width = cw; c.height = ch; const x = c.getContext("2d", { willReadFrequently: true });
    let prev = null; const diffs = [], times = [], sats = [], lums = [], pal = new Map();
    for (let t = 0, i = 0; t < dur; t += step, i++) {
      if (VL.stop) { URL.revokeObjectURL(url); return null; }
      v.currentTime = Math.min(t, dur - 0.01); await once(v, "seeked");
      x.drawImage(v, 0, 0, cw, ch); const d = x.getImageData(0, 0, cw, ch).data, lum = new Float32Array(cw * ch), rgb = new Uint8ClampedArray(d);
      let ls = 0, ss = 0;
      for (let k = 0, j = 0; k < d.length; k += 4, j++) {
        const r = d[k], g = d[k + 1], b = d[k + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        lum[j] = (0.299 * r + 0.587 * g + 0.114 * b) / 255; ls += lum[j]; ss += (mx - mn) / 255;
        if (i % 6 === 0 && j % 7 === 0) { const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5); pal.set(key, (pal.get(key) || 0) + 1); }
      }
      lums.push(ls / lum.length); sats.push(ss / lum.length);
      if (prev) { let df = 0; for (let k = 0; k < rgb.length; k += 4) df += Math.abs(rgb[k] - prev[k]) + Math.abs(rgb[k + 1] - prev[k + 1]) + Math.abs(rgb[k + 2] - prev[k + 2]); diffs.push(df / (lum.length * 765)); times.push(t - step / 2); }
      prev = rgb; if (onProg && i % 10 === 0) onProg(t / dur * 0.8);
    }
    URL.revokeObjectURL(url);
    const md = median(diffs) || 0, thr = Math.max(0.09, md * 4);
    const cuts = []; diffs.forEach((df, k) => { if (df > thr && (!cuts.length || times[k] - cuts[cuts.length - 1] > 0.15)) cuts.push(times[k]); });
    const calm = diffs.filter((df) => df <= thr);
    const palette = [...pal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => "#" + [(k >> 6) & 7, (k >> 3) & 7, k & 7].map((q) => ((q << 5) + 16).toString(16).padStart(2, "0")).join(""));
    const m = { duration: dur, cuts: cuts.length, cutTimes: cuts, shotAvg: dur / (cuts.length + 1), cutsPerSec: cuts.length / dur, firstCut: cuts.length ? cuts[0] : dur,
      bwShare: sats.filter((s) => s < 0.07).length / sats.length, brightness: lums.reduce((a, b) => a + b, 0) / lums.length, motion: calm.length ? calm.reduce((a, b) => a + b, 0) / calm.length : 0, palette, w: v.videoWidth, h: v.videoHeight };
    if (onProg) onProg(0.85);
    const a = await analyseAudio(file, cuts);
    if (onProg) onProg(1);
    return { m, a };
  }
  async function analyseAudio(file, cuts) {
    let buf;
    try { buf = await new OfflineAudioContext(1, 44100, 44100).decodeAudioData(await file.arrayBuffer()); } catch (e) { return null; }
    const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate, hop = Math.round(sr / 100), mono = new Float32Array(len);
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += d[i] / ch; }
    const env = []; let tot = 0;
    for (let i = 0; i + hop <= len; i += hop) { let s = 0; for (let j = i; j < i + hop; j++) s += mono[j] * mono[j]; tot += s; env.push(Math.sqrt(s / hop)); }
    const rms = Math.sqrt(tot / len); if (rms < 0.003) return { silent: true };
    const onset = env.map((e, i) => Math.max(0, e - (env[i - 1] || 0)));
    let best = 0, bestLag = 50;
    for (let bpm = 70; bpm <= 180; bpm++) {
      const lag = 6000 / bpm, L = Math.round(lag); let s = 0;
      for (let i = 0; i + L < onset.length; i++) s += onset[i] * onset[i + L];
      s /= onset.length - L; if (s > best) { best = s; bestLag = lag; }
    }
    let bpm = 6000 / bestLag; while (bpm < 85) bpm *= 2; while (bpm > 170) bpm /= 2;
    const lag = 6000 / bpm; let phase = 0, pb = -1;
    // music hits = strong onset peaks; a cut is "on the beat" when it lands within 80 ms of one
    const mean = onset.reduce((x, y) => x + y, 0) / onset.length, sd = Math.sqrt(onset.reduce((x, y) => x + (y - mean) ** 2, 0) / onset.length);
    const hits = []; for (let i = 1; i < onset.length - 1; i++) if (onset[i] > mean + 2 * sd && onset[i] >= onset[i - 1] && onset[i] >= onset[i + 1]) hits.push(i / 100);
    const onBeat = cuts.length && hits.length ? cuts.filter((t) => hits.some((h) => Math.abs(h - t) < 0.08)).length / cuts.length : null;
    const first = env.findIndex((e) => e > rms * 0.5);
    return { bpm: Math.round(bpm), loudness: Math.round(20 * Math.log10(rms)), cutsOnBeat: onBeat, soundStart: first < 0 ? null : first / 100 };
  }
  function describe(r) {
    const m = r.m, a = r.a, out = [];
    out.push(m.cutsPerSec >= 1.5 ? "Very fast: a cut every " + fmt(m.shotAvg) + "s" : m.cutsPerSec >= 0.7 ? "Quick pace: a cut every " + fmt(m.shotAvg) + "s" : m.cuts ? "Slow pace: a cut every " + fmt(m.shotAvg) + "s" : "One continuous shot");
    if (m.cuts) out.push(m.firstCut <= 0.6 ? "Strong hook: first cut at " + fmt(m.firstCut) + "s" : "Slow start: first cut only at " + fmt(m.firstCut) + "s");
    out.push(m.bwShare > 0.6 ? "Mostly black and white" : m.bwShare > 0.2 ? "Mix of B&W and colour" : "Full colour");
    if (a && a.bpm) out.push(a.bpm + " BPM" + (a.cutsOnBeat != null ? ", " + Math.round(a.cutsOnBeat * 100) + "% of cuts on the beat" : "") + (a.soundStart > 0.5 ? ", sound starts late (" + fmt(a.soundStart) + "s)" : ""));
    else out.push(a && a.silent ? "No sound (silent video)" : "No audio track");
    return out;
  }
  async function analyseNew(all) {
    if (VL.busy) return { error: "I'm already working on something." };
    if (!(await ensureReady())) return { error: "Connect the niche.co folder in the Video Lab panel first." };
    VL.busy = true; render();
    try {
      VL.stop = false;
      const vids = (await listFiles()).filter((f) => VID_RE.test(f.name) && /^inspiration\//i.test(f.path));
      const done = new Set(VL.analyses.map((a) => a.path + "|" + a.size));
      let n = 0;
      for (const f of vids) {
        if (VL.stop) break;
        const file = await f.h.getFile();
        if (!all && done.has(f.path + "|" + file.size)) continue;
        progress(0, "Studying " + f.name + "…");
        try {
          const r = await analyseVideo(file, (p) => progress(p, "Studying " + f.name + "…"));
          if (!r) break; // stopped part-way through
          VL.analyses = VL.analyses.filter((a) => a.path !== f.path);
          VL.analyses.push({ path: f.path, name: f.name, size: file.size, at: Date.now(), label: null, ...r });
          n++; await save(); render();
        } catch (e) { msg("Skipped " + f.name + ": " + e.message); }
      }
      progress(1, (VL.stop ? "Stopped. " : "") + (n ? "Studied " + n + " video" + (n > 1 ? "s" : "") : VL.stop ? "" : "No new videos in the inspiration folder"));
      return { count: n, total: vids.length, stopped: VL.stop };
    } finally { VL.busy = false; render(); }
  }
  async function save() {
    try { await idb.put("vlabAnalyses", VL.analyses); } catch (e) {}
    try { // a copy in the folder, so the notes live with the videos
      const fh = await VL.dir.getFileHandle("jarvis-video-notes.json", { create: true }), w = await fh.createWritable();
      await w.write(JSON.stringify({ updated: new Date().toISOString(), learned: learned(), videos: VL.analyses.map(({ path, name, label, m, a }) => ({ path, name, label, ...m, cutTimes: undefined, audio: a })) }, null, 2)); await w.close();
    } catch (e) {}
  }
  function insights() {
    const L = learned(); if (!L) return null;
    const ours = VL.analyses.filter((a) => /^videos\//i.test(a.path) || a.label === "flop");
    const oShot = median(ours.map((a) => a.m.shotAvg)), oHook = median(ours.map((a) => a.m.firstCut));
    const lines = [];
    lines.push("Videos that work cut every " + fmt(L.shot) + " seconds" + (oShot ? ", ours cut every " + fmt(oShot) : "") + ".");
    if (L.hook != null) lines.push("They hit the first cut by " + fmt(L.hook) + " seconds" + (oHook ? ", ours by " + fmt(oHook) : "") + ".");
    if (L.bpm) lines.push("Their music sits around " + Math.round(L.bpm) + " BPM" + (L.onBeat != null ? ", with " + Math.round(L.onBeat * 100) + " percent of cuts on the beat" : "") + ".");
    if (L.bw != null) lines.push(L.bw > 0.5 ? "Most of them are black and white." : L.bw > 0.2 ? "They mix black and white with colour." : "They're mostly full colour.");
    if (L.dur) lines.push("Typical length is " + Math.round(L.dur) + " seconds.");
    return { L, lines };
  }

  /* ---------- panel ---------- */
  function msg(t) { const e = $("#vlMsg"); if (e) e.textContent = t; }
  function progress(p, t) { const b = $("#vlBar"); if (b) b.style.width = Math.round(clamp(p, 0, 1) * 100) + "%"; if (t) msg(t); }
  function render() {
    const chip = $("#vlChip"); if (!chip) return;
    chip.textContent = VL.busy ? "Working" : VL.ready ? "Folder: " + VL.dir.name : VL.dir ? "Click to reconnect" : "No folder";
    chip.className = "chip " + (VL.busy ? "wait" : VL.ready ? "live" : "off");
    $("#vlPick").textContent = VL.dir ? (VL.ready ? "Change folder" : "Reconnect " + VL.dir.name + " folder") : "Connect niche.co folder";
    $("#vlMake").disabled = $("#vlStudy").disabled = VL.busy;
    $("#vlStop").hidden = !VL.busy;
    const out = $("#vlOut");
    out.innerHTML = VL.last ? `<video src="${VL.last.url}" controls muted loop playsinline style="width:100%;max-height:420px;background:#000;margin-top:10px"></video><div class="mu" style="margin-top:6px">${esc(VL.last.name)} · ${esc(STYLES[VL.last.style])} · ${fmt(VL.last.secs)}s · cut every ${fmt(VL.last.shot, 2)}s at ${VL.last.bpm} BPM${VL.last.learned ? " (from what works)" : ""} · saved in videos</div>` : "";
    const ins = insights();
    $("#vlLearn").innerHTML = ins ? ins.lines.map((l) => `<div class="rowx"><span>${esc(l)}</span></div>`).join("") + `<div class="mu" style="margin-top:4px">Based on ${ins.L.n} video${ins.L.n > 1 ? "s" : ""} marked as working (everything in the inspiration folder counts unless you mark it 👎).</div>`
      : '<div class="mu">Drop videos you like into niche.co/inspiration and hit Study. Jarvis learns their pacing, hook, colour and beat, and new videos follow it.</div>';
    $("#vlList").innerHTML = VL.analyses.slice().sort((a, b) => b.at - a.at).slice(0, 12).map((r, i) => `<div class="ev"><div class="what"><b style="font-weight:600">${esc(r.name)}</b> <span class="mu">· ${esc(r.path.split("/")[0])}</span><div class="mu">${describe(r).map(esc).join(" · ")}</div><div style="display:flex;gap:4px;margin-top:4px">${(r.m.palette || []).map((c) => `<i style="display:inline-block;width:14px;height:14px;background:${c};border:1px solid var(--line)"></i>`).join("")}</div></div><div class="acts"><button class="ghost" type="button" data-vlw="${esc(r.path)}" aria-label="Mark as working" style="${r.label === "win" ? "background:var(--ok);color:var(--bg)" : ""}">🔥</button><button class="ghost" type="button" data-vlf="${esc(r.path)}" aria-label="Mark as flop" style="${r.label === "flop" ? "background:var(--bad);color:var(--bg)" : ""}">👎</button></div></div>`).join("");
    document.querySelectorAll("[data-vlw],[data-vlf]").forEach((b) => (b.onclick = async () => {
      const p = b.dataset.vlw || b.dataset.vlf, a = VL.analyses.find((x) => x.path === p), lab = b.dataset.vlw ? "win" : "flop";
      if (a) { a.label = a.label === lab ? null : lab; await save(); render(); }
    }));
  }

  /* ---------- voice ---------- */
  function styleFrom(t) {
    t = t.toLowerCase();
    if (/collage|pop/.test(t)) return "collage";
    if (/(black and white|b ?& ?w|b and w).*(colou?r)/.test(t)) return "bw2colour";
    if (/mood ?board|black and white|b ?& ?w/.test(t)) return "bwmood";
    if (/hard ?cut|white/.test(t)) return "hardcut";
    if (/fast|colou?r/.test(t)) return "fastcolour";
    if (/two|split|duo/.test(t)) return "duo";
    return "auto";
  }
  async function voiceMake(t) {
    if (!VL.ready && !(VL.dir && (await checkPerm(false)))) return say(VL.dir ? "Click Reconnect in the Video Lab panel, then ask me again." : "Connect your niche.co folder in the Video Lab panel first.");
    const st = styleFrom(t), m = t.match(/(\d{1,2})\s*(?:second|sec)/i);
    say("On it. Making a " + (st === "auto" ? "" : STYLES[st].toLowerCase() + " ") + "video for TikTok and Instagram.");
    $("#vlP").scrollIntoView({ behavior: "smooth", block: "center" });
    const r = await makeVideo({ style: st, seconds: m ? clamp(+m[1], 6, 30) : undefined });
    return say(r.error ? r.error : "Your video is done. It's saved as " + r.name.replace(".mp4", "") + " in your niche.co videos folder.");
  }
  async function voiceStudy() {
    say("Studying the videos in your inspiration folder. Say stop studying to stop.");
    const r = await analyseNew(false);
    if (r.error) return say(r.error);
    const ins = insights();
    if (r.stopped) return say("Stopped. I studied " + r.count + " video" + (r.count === 1 ? "" : "s") + " before that.");
    return say((r.count ? "Done. I studied " + r.count + " new video" + (r.count > 1 ? "s. " : ". ") : "No new videos in the inspiration folder. ") + (ins ? ins.lines.slice(0, 3).join(" ") : "Put some videos you like in the inspiration folder so I can learn from them."));
  }
  function voiceLearn() { const ins = insights(); return say(ins ? ins.lines.join(" ") : "I haven't studied any videos yet. Put some in the inspiration folder and say: study my videos."); }

  /* ---------- wire up ---------- */
  function init() {
    const sel = $("#vlStyle"); sel.innerHTML = Object.entries(STYLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
    $("#vlPick").onclick = () => (VL.dir && !VL.ready ? checkPerm(true).then(render) : pickFolder());
    $("#vlMake").onclick = async () => { const r = await makeVideo({}); if (r.error) msg(r.error); else say("Your video is done. Saved as " + r.name.replace(".mp4", "") + "."); };
    $("#vlStop").onclick = () => { VL.stop = true; msg("Stopping…"); };
    $("#vlStudy").onclick = async () => { const r = await analyseNew(false); if (r.error) msg(r.error); };
    loadFolder();
  }
  init();
  function stop() { if (!VL.busy) return false; VL.stop = true; return true; }
  window.VideoLab = { init, stop, makeVideo, analyseNew, insights, voiceMake, voiceStudy, voiceLearn, _plan: plan, _analyseVideo: analyseVideo, _state: VL };
})();
