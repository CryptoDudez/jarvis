/* Jarvis Video Lab — makes niche.co videos and studies videos, all on this laptop.
   Uses the niche.co folder (picked once): photos anywhere in it are the source material,
   finished videos go into niche.co/videos as "niche video N.mp4",
   videos to learn from go into niche.co/inspiration. */
(function () {
  const W = 1080, H = 1920, FPS = 30;
  const STYLES = {
    auto: "Auto (learned)",
    bwfull: "B&W full-screen moodboard",
    hardcut: "Hard cuts on white",
    bwmood: "B&W photo grid",
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
      brightness: median(wins.filter((a) => a.ver >= 3).map((a) => a.m.brightness)),
      ...richLearned(wins),
    };
  }
  const share = (arr, f) => (arr.length ? arr.filter(f).length / arr.length : null);
  const modeOf = (a) => { const c = {}; a.filter(Boolean).forEach((x) => (c[x] = (c[x] || 0) + 1)); const e = Object.entries(c).sort((x, y) => y[1] - x[1]); return e.length ? e[0][0] : null; };
  function richLearned(wins) {
    const tr = wins.flatMap((a) => a.m.transitions || []), tc = {};
    tr.forEach((t) => (tc[t] = (tc[t] || 0) + 1));
    const vis = wins.filter((a) => a.v && a.v.frames), withText = vis.filter((a) => a.v.text && a.v.text.length);
    const objs = {}; vis.forEach((a) => Object.keys(a.v.objects || {}).forEach((o) => (objs[o] = (objs[o] || 0) + 1)));
    const tags = {}; withText.forEach((a) => (a.v.hookTags || []).forEach((t) => (tags[t] = (tags[t] || 0) + 1)));
    const drops = wins.filter((a) => a.a && a.a.drop != null);
    return {
      transitions: tr.length ? Object.fromEntries(Object.entries(tc).map(([k, v]) => [k, v / tr.length])) : null,
      visN: vis.length,
      textShare: vis.length ? withText.length / vis.length : null,
      textTime: median(withText.map((a) => a.v.firstText)),
      textPos: modeOf(withText.map((a) => a.v.textPos)),
      textWhole: median(withText.map((a) => a.v.textShare)),
      hooks: withText.map((a) => a.v.hook).filter(Boolean).slice(0, 4),
      hookTags: Object.entries(tags).sort((x, y) => y[1] - x[1]).map((x) => x[0]),
      faceFirst: share(vis, (a) => a.v.faceFirst),
      personFirst: share(vis, (a) => a.v.personFirst),
      closeUp: share(vis, (a) => a.v.closeUps > 0),
      person: median(vis.map((a) => a.v.personFrames / a.v.frames)),
      objects: Object.entries(objs).sort((x, y) => y[1] - x[1]).slice(0, 4).map((x) => x[0]),
      drop: median(drops.map((a) => a.a.drop)),
      fasterAfterDrop: share(drops, (a) => a.a.fasterAfter),
      sound: modeOf(wins.map((a) => a.a && a.a.kind)),
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
    out.paths = [];
    for (const f of pick) {
      try {
        const file = await f.h.getFile();
        let bmp = await createImageBitmap(file);
        const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        if (s < 1) { const c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s)); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); bmp.close(); bmp = await createImageBitmap(c); }
        out.push(bmp); out.paths.push(f.path + "|" + file.size);
      } catch (e) { /* skip unreadable image */ }
    }
    return out;
  }
  async function personFirst(imgs) { // move a photo with a face (or a person) to the front
    if (!window.VideoSense) return false;
    const tags = store.get("vlabTags", {});
    let best = -1, bestScore = 0;
    for (let i = 0; i < imgs.length; i++) {
      const k = imgs.paths[i];
      if (!tags[k]) { const t = await VideoSense.tagPhoto(imgs[i]); if (!t) return false; tags[k] = t; }
      const sc = tags[k].face ? (tags[k].closeUp ? 3 : 2) : tags[k].person ? 1 : 0;
      if (sc > bestScore) { bestScore = sc; best = i; }
    }
    store.set("vlabTags", Object.fromEntries(Object.entries(tags).slice(-500)));
    if (best > 0) { [imgs[0], imgs[best]] = [imgs[best], imgs[0]]; [imgs.paths[0], imgs.paths[best]] = [imgs.paths[best], imgs.paths[0]]; }
    return best >= 0;
  }
  function chooseStyle(req, L) {
    if (req && req !== "auto") return req;
    let opts;
    if (L && L.bw != null && L.bw >= 0.5) opts = [["bwfull", 0.75], ["bw2colour", 0.15], ["bwmood", 0.1]]; // the winners are black and white
    else if (L) opts = [["fastcolour", 0.55], ["hardcut", 0.2], ["duo", 0.15], ["collage", 0.1]];
    else { const all = Object.keys(STYLES).filter((k) => k !== "auto" && k !== store.get("vlabLastStyle", "")); return all[Math.floor(Math.random() * all.length)]; }
    let r = Math.random(); for (const [k, w] of opts) { r -= w; if (r <= 0) return k; } return opts[0][0];
  }
  function plan(style, L, seconds) {
    const bpm = clamp(Math.round((L && L.bpm) || 120), 80, 170), beat = 60 / bpm;
    const base = { bwfull: 1, hardcut: 1, bwmood: 1, fastcolour: 0.5, collage: 1, bw2colour: 2, duo: 2 }[style];
    let shot = base * beat;
    if (L && L.shot) { // follow what works, snapped to the beat
      const beats = [0.5, 1, 2, 4].reduce((a, b) => (Math.abs(b * beat - L.shot) < Math.abs(a * beat - L.shot) ? b : a), 1);
      shot = (style === "fastcolour" ? Math.min(beats, 1) : style === "bw2colour" || style === "duo" ? Math.max(beats, 1) : beats) * beat;
    }
    const hook = clamp((L && L.hook) || shot, beat * 0.5, shot);
    // build-up then drop: slower cuts before the drop, full speed after (when that's what works)
    const cutsStyle = !["bwmood", "collage"].includes(style);
    const dropAt = cutsStyle && L && L.drop != null && L.fasterAfterDrop >= 0.5 ? clamp(Math.round(L.drop / beat) * beat, 2 * beat, seconds * 0.45) : null;
    const shots = [{ start: 0, dur: hook, tr: "hard cut" }];
    let t = hook;
    const pickTr = (i) => {
      if (!cutsStyle) return "hard cut";
      if (L && L.transitions) { let r = Math.random(); for (const [k, v] of Object.entries(L.transitions)) { r -= v; if (r <= 0) return k; } return "hard cut"; }
      return style === "fastcolour" && i % 4 === 0 ? "flash" : "hard cut";
    };
    while (true) {
      const sd = dropAt && t < dropAt - 1e-6 ? shot * 2 : shot;
      if (t + sd > seconds - 1.2 + 1e-6) break;
      shots.push({ start: t, dur: sd, tr: pickTr(shots.length) }); t += sd;
    }
    // look: overall brightness like the winners, and a few colour shots if they mix colour into B&W
    const bright = L && L.brightness != null ? (L.brightness < 0.3 ? 0.82 : L.brightness > 0.6 ? 1.08 : 1) : 1;
    const colour = new Set();
    if (style === "bwfull" && L && L.bw != null && L.bw < 0.92) {
      const want = Math.round((shots.length - 1) * (1 - L.bw)), idx = shots.map((_, i) => i).slice(1).sort(() => Math.random() - 0.5);
      idx.slice(0, want).forEach((i) => colour.add(i));
    }
    return { bpm, beat, shot, shots, end: t, total: t + 1.4, dropAt, bright, colour };
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
  function drawFrame(ctx, style, P, imgs, t, rnd, text) {
    const si = P.shots.findIndex((s) => t >= s.start && t < s.start + s.dur);
    ctx.filter = "none"; ctx.globalAlpha = 1;
    if (t >= P.end) { endCard(ctx, style, P, t); return; }
    const s = P.shots[si] || P.shots[0], tt = t - s.start, p = tt / s.dur, k = si > 0 ? si : 0;
    const tr = si > 0 ? s.tr : "hard cut";
    if (tr === "fade" && tt < 0.22) { content(ctx, style, P, imgs, k - 1, 1, rnd); ctx.globalAlpha = tt / 0.22; content(ctx, style, P, imgs, k, p, rnd); ctx.globalAlpha = 1; }
    else if (tr === "whip/zoom" && tt < 0.18) {
      const e = ease(tt / 0.18); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.filter = "blur(14px)"; ctx.translate(-e * W, 0); content(ctx, style, P, imgs, k - 1, 1, rnd); ctx.restore();
      ctx.save(); ctx.filter = "blur(" + Math.round(14 * (1 - e)) + "px)"; ctx.translate((1 - e) * W, 0); content(ctx, style, P, imgs, k, p, rnd); ctx.restore(); ctx.filter = "none";
    } else content(ctx, style, P, imgs, k, p, rnd);
    if (tr === "flash" && tt < 0.12) { ctx.fillStyle = `rgba(255,255,255,${0.85 * (1 - tt / 0.12)})`; ctx.fillRect(0, 0, W, H); }
    if (tr === "dip to black" && tt < 0.15) { ctx.fillStyle = `rgba(0,0,0,${1 - tt / 0.15})`; ctx.fillRect(0, 0, W, H); }
    if (text && t >= text.from && t < text.to) hookText(ctx, text, t);
  }
  function hookText(ctx, T, t) { // TikTok-style caption: bold white with a black outline
    const a = clamp((t - T.from) / 0.15, 0, 1); ctx.save(); ctx.globalAlpha = a;
    ctx.font = "800 68px Inter, 'Helvetica Neue', Arial, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    const words = T.text.split(/\s+/), lines = []; let cur = "";
    for (const w of words) { const test = cur ? cur + " " + w : w; if (ctx.measureText(test).width > W * 0.84 && cur) { lines.push(cur); cur = w; } else cur = test; }
    if (cur) lines.push(cur);
    const lh = 84, y0 = H * T.y - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) => { ctx.lineWidth = 12; ctx.strokeStyle = "rgba(0,0,0,.9)"; ctx.strokeText(l, W / 2, y0 + i * lh); ctx.fillStyle = "#fff"; ctx.fillText(l, W / 2, y0 + i * lh); });
    ctx.restore();
  }
  function endCard(ctx, style, P, t) {
      const k = ease((t - P.end) / 0.35);
      ctx.fillStyle = style === "hardcut" ? "#fff" : "#000"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = style === "hardcut" ? "#000" : "#fff"; ctx.globalAlpha = k;
      ctx.font = "800 120px Inter, 'Helvetica Neue', Arial, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("NICHE.CO", W / 2, H / 2 + (1 - k) * 40); ctx.globalAlpha = 1;
  }
  function content(ctx, style, P, imgs, si, p, rnd) { // one shot of the chosen style
    const n = imgs.length, img = imgs[si % n];
    if (style === "bwfull") { // full-screen moodboard edit: one photo at a time, strong B&W, grain and vignette
      const col = P.colour && P.colour.has(si), b = P.bright || 1;
      ctx.filter = col ? `contrast(1.08) saturate(0.9) brightness(${b})` : `grayscale(1) contrast(1.35) brightness(${b})`;
      cover(ctx, img, 0, 0, W, H, 1.08 - 0.08 * ease(p)); ctx.filter = "none";
      filmLook(ctx, si * 7 + Math.floor(p * 12));
    } else if (style === "hardcut") {
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
      contain(ctx, img, W / 2, H / 2, W * 0.86, H * 0.72, 1 + 0.05 * p);
    } else if (style === "fastcolour") {
      ctx.filter = "saturate(1.35) contrast(1.08)"; cover(ctx, img, 0, 0, W, H, 1.12 - 0.1 * ease(p)); ctx.filter = "none";
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
  let grainTile = null, vignette = null;
  function filmLook(ctx, seed) { // film grain + soft dark edges, like moodboard edits
    if (!grainTile) {
      grainTile = new OffscreenCanvas(360, 640); const g = grainTile.getContext("2d"), d = g.createImageData(360, 640);
      for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
      g.putImageData(d, 0, 0);
      vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.72); vignette.addColorStop(0, "rgba(0,0,0,0)"); vignette.addColorStop(1, "rgba(0,0,0,.55)");
    }
    ctx.save(); ctx.globalAlpha = 0.07; ctx.globalCompositeOperation = "overlay";
    const ox = (seed * 97) % 180, oy = (seed * 61) % 320; ctx.drawImage(grainTile, -ox, -oy, W + 360, H + 640); ctx.restore();
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, W, H);
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
      const lenSel = opts.seconds || $("#vlLen").value || "auto";
      const seconds = lenSel === "auto" ? (L && L.dur ? clamp(Math.round(L.dur), 6, 30) : 10) : +lenSel;
      const P = plan(style, L, seconds);
      const applied = [];
      if (L && L.shot) applied.push("cut every " + fmt(P.shot, 2) + "s at " + P.bpm + " BPM");
      if (lenSel === "auto" && L && L.dur) applied.push(seconds + "s long");
      if (P.dropAt) applied.push("slow build, drop at " + fmt(P.dropAt) + "s");
      const trUsed = [...new Set(P.shots.slice(1).map((x) => x.tr).filter((x) => x !== "hard cut"))]; if (L && L.transitions && trUsed.length) applied.push(trUsed.join(" + ") + " transitions");
      progress(0, "Picking photos…");
      const imgs = await loadImages(await listFiles(), style === "duo" ? P.shots.length * 2 : P.shots.length);
      if (!imgs.length) return { error: "I couldn't find any photos in the niche.co folder. Add some product photos to it." };
      if (L && L.faceFirst != null && Math.max(L.faceFirst, L.personFirst || 0) >= 0.5) { progress(0, "Finding a photo with a face to open on…"); if (await personFirst(imgs)) applied.push("opens on a person"); }
      const words = (opts.text != null ? opts.text : $("#vlText").value || "").trim();
      const text = words ? { text: words, from: clamp(L && L.textTime != null ? L.textTime : 0.2, 0, 1.5), to: 0, y: { top: 0.2, middle: 0.42, bottom: 0.74 }[(L && L.textPos) || "top"] } : null;
      if (text) { text.to = L && L.textWhole > 0.6 ? P.end : Math.min(P.end, text.from + 3); applied.push("hook text at the " + ((L && L.textPos) || "top")); }
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
        drawFrame(ctx, style, P, imgs, i / FPS, rnd, text);
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
      VL.last = { name, url: URL.createObjectURL(blob), style, secs: P.total, bpm: P.bpm, shot: P.shot, learned: !!L, applied, textTip: !text && L && L.textShare >= 0.5 ? (L.hooks[0] || "") : null };
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
    // 1) sample small frames through the whole video
    const frames = [], ftimes = [];
    for (let t = 0, i = 0; t < dur; t += step, i++) {
      if (VL.stop) { URL.revokeObjectURL(url); return null; }
      v.currentTime = Math.min(t, dur - 0.01); await once(v, "seeked");
      x.drawImage(v, 0, 0, cw, ch); frames.push(new Uint8ClampedArray(x.getImageData(0, 0, cw, ch).data)); ftimes.push(t);
      if (onProg && i % 10 === 0) onProg(t / dur * 0.4);
    }
    // 2) ignore parts of the screen that never change: app buttons, tabs, captions and borders of
    //    screen recordings (TikTok / Instagram / WhatsApp). Only the real video area is measured.
    const N = cw * ch, nF = frames.length, mean = new Float32Array(N), sq = new Float32Array(N);
    for (const f of frames) for (let j = 0, k = 0; j < N; j++, k += 4) { const l = (0.299 * f[k] + 0.587 * f[k + 1] + 0.114 * f[k + 2]) / 255; mean[j] += l; sq[j] += l * l; }
    let live = []; for (let j = 0; j < N; j++) { const m0 = mean[j] / nF, sd = Math.sqrt(Math.max(0, sq[j] / nF - m0 * m0)); if (sd > 0.03) live.push(j); }
    const uiShare = 1 - live.length / N;
    if (live.length < N * 0.25 || nF < 3) live = Array.from({ length: N }, (_, j) => j); // mostly still video: measure everything
    const bandStatic = (r0, r1) => { let st = 0, tot = 0; const set = new Set(live); for (let r = r0; r < r1; r++) for (let q = 0; q < cw; q++) { tot++; if (!set.has(r * cw + q)) st++; } return st / tot; };
    const screenRec = uiShare > 0.12 && (bandStatic(0, Math.round(ch * 0.1)) > 0.6 || bandStatic(Math.round(ch * 0.88), ch) > 0.6);
    const diffs = [], times = [], sats = [], lums = [], pal = new Map();
    frames.forEach((f, i) => {
      let ls = 0, ss = 0;
      for (const j of live) {
        const k = j * 4, r = f[k], g = f[k + 1], b = f[k + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        ls += (0.299 * r + 0.587 * g + 0.114 * b) / 255; ss += (mx - mn) / 255;
        if (i % 6 === 0 && j % 7 === 0) { const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5); pal.set(key, (pal.get(key) || 0) + 1); }
      }
      lums.push(ls / live.length); sats.push(ss / live.length);
      if (i) { const p = frames[i - 1]; let df = 0; for (const j of live) { const k = j * 4; df += Math.abs(f[k] - p[k]) + Math.abs(f[k + 1] - p[k + 1]) + Math.abs(f[k + 2] - p[k + 2]); } diffs.push(df / (live.length * 765)); times.push(ftimes[i] - step / 2); }
    });
    if (onProg) onProg(0.45);
    const md = median(diffs) || 0, thr = Math.max(0.09, md * 4);
    const cuts = []; diffs.forEach((df, k) => { if (df > thr && (!cuts.length || times[k] - cuts[cuts.length - 1] > 0.15)) cuts.push(times[k]); });
    // slow fades have no single big jump: look for a big change spread over about a third of a second
    const win = Math.max(3, Math.round(0.33 / step));
    for (let k = 0; k + win <= diffs.length; k++) {
      let sum = 0; for (let j = k; j < k + win; j++) sum += diffs[j];
      const mid = times[k + (win >> 1)];
      if (sum > thr * 1.6 && !cuts.some((c) => Math.abs(c - mid) < 0.45)) cuts.push(mid);
    }
    cuts.sort((a, b) => a - b);
    const calm = diffs.filter((df) => df <= thr);
    const palette = [...pal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => "#" + [(k >> 6) & 7, (k >> 3) & 7, k & 7].map((q) => ((q << 5) + 16).toString(16).padStart(2, "0")).join(""));
    let tr = null, vis = null;
    if (window.VideoSense) {
      try { if (onProg) onProg(0.5); tr = await VideoSense.transitions(v, cuts, () => VL.stop); } catch (e) {}
      if (VL.stop) { URL.revokeObjectURL(url); return null; }
      try { vis = await VideoSense.watch(v, dur, (q) => onProg && onProg(0.55 + q * 0.3), () => VL.stop); } catch (e) {}
      if (VL.stop) { URL.revokeObjectURL(url); return null; }
    }
    URL.revokeObjectURL(url);
    const m = { duration: dur, cuts: cuts.length, cutTimes: cuts, transitions: tr, uiShare, screenRec, shotAvg: dur / (cuts.length + 1), cutsPerSec: cuts.length / dur, firstCut: cuts.length ? cuts[0] : dur,
      bwShare: sats.filter((s) => s < 0.07).length / sats.length, brightness: lums.reduce((a, b) => a + b, 0) / lums.length, motion: calm.length ? calm.reduce((a, b) => a + b, 0) / calm.length : 0, palette, w: v.videoWidth, h: v.videoHeight };
    if (onProg) onProg(0.85);
    const a = await analyseAudio(file, cuts);
    if (onProg) onProg(1);
    return { m, a, v: vis, ver: 3 };
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
    // music hits = strong onset peaks; a cut is "on the beat" when it lands within 80 ms of one
    const mean = onset.reduce((x, y) => x + y, 0) / onset.length, sd = Math.sqrt(onset.reduce((x, y) => x + (y - mean) ** 2, 0) / onset.length);
    const hits = []; for (let i = 1; i < onset.length - 1; i++) if (onset[i] > mean + 2 * sd && onset[i] >= onset[i - 1] && onset[i] >= onset[i + 1]) hits.push(i / 100);
    const onBeat = cuts.length && hits.length ? cuts.filter((t) => hits.some((h) => Math.abs(h - t) < 0.08)).length / cuts.length : null;
    const first = env.findIndex((e) => e > rms * 0.5);
    // the drop: the biggest jump in loudness (one second after vs one second before)
    let drop = null, jump = 0;
    for (let i = 100; i < env.length - 100; i += 5) { let b = 0, f = 0; for (let k = i - 100; k < i; k++) b += env[k]; for (let k = i; k < i + 100; k++) f += env[k]; const j = (f - b) / 100; if (j > jump) { jump = j; drop = i / 100; } }
    if (jump < rms * 0.35) drop = null;
    const secs = env.length / 100;
    const fasterAfter = drop != null && cuts.length >= 2 ? cuts.filter((t) => t >= drop).length / Math.max(0.5, secs - drop) > 1.3 * (cuts.filter((t) => t < drop).length / Math.max(0.5, drop)) : null;
    // voice or music (an estimate): speech has gaps and a weak steady beat, music is continuous with a strong beat
    const live = env.slice(Math.max(0, first)), gaps = live.filter((e) => e < rms * 0.15).length / Math.max(1, live.length), ac0 = onset.reduce((x, y) => x + y * y, 0) / onset.length, beatStrength = ac0 ? best / ac0 : 0;
    const kind = gaps > 0.18 && beatStrength < 0.35 ? "voice" : gaps < 0.1 && beatStrength >= 0.2 ? "music" : "voice and music";
    return { bpm: Math.round(bpm), loudness: Math.round(20 * Math.log10(rms)), cutsOnBeat: onBeat, soundStart: first < 0 ? null : first / 100, drop, fasterAfter, kind };
  }
  function describe(r) {
    const m = r.m, a = r.a, out = [];
    out.push(m.cutsPerSec >= 1.5 ? "Very fast: a cut every " + fmt(m.shotAvg) + "s" : m.cutsPerSec >= 0.7 ? "Quick pace: a cut every " + fmt(m.shotAvg) + "s" : m.cuts ? "Slow pace: a cut every " + fmt(m.shotAvg) + "s" : "One continuous shot");
    if (m.cuts) out.push(m.firstCut <= 0.6 ? "Strong hook: first cut at " + fmt(m.firstCut) + "s" : "Slow start: first cut only at " + fmt(m.firstCut) + "s");
    out.push(m.bwShare > 0.6 ? "Mostly black and white" : m.bwShare > 0.2 ? "Mix of B&W and colour" : "Full colour");
    if (a && a.bpm) out.push(a.bpm + " BPM" + (a.cutsOnBeat != null ? ", " + Math.round(a.cutsOnBeat * 100) + "% of cuts on the beat" : "") + (a.soundStart > 0.5 ? ", sound starts late (" + fmt(a.soundStart) + "s)" : ""));
    else out.push(a && a.silent ? "No sound (silent video)" : "No audio track");
    if (a && a.kind) out.push("Sounds like " + a.kind + (a.drop != null ? ", drop at " + fmt(a.drop) + "s" + (a.fasterAfter ? " (cuts speed up after)" : "") : ""));
    if (m.transitions && m.transitions.length) { const c = {}; m.transitions.forEach((x) => (c[x] = (c[x] || 0) + 1)); out.push("Transitions: " + Object.entries(c).sort((x, y) => y[1] - x[1]).map(([k, v]) => k + (v > 1 ? " ×" + v : "")).join(", ")); }
    const v = r.v;
    if (v && v.ok && v.ok.text) out.push(v.text.length ? "Text (" + v.textPos + ", from " + fmt(v.firstText) + "s): “" + v.hook.slice(0, 60) + "”" : "No on-screen text");
    if (v && v.ok && v.ok.faces) {
      out.push(v.faceFirst ? "Face in the first second" + (v.closeUps ? ", close-ups" : "") : v.faceFrames ? "Faces later on" : "No faces");
      out.push(v.personFrames ? "Person on screen in " + Math.round((v.personFrames / v.frames) * 100) + "% of frames" : "Product only, no person");
      const ob = Object.keys(v.objects || {}); if (ob.length) out.push("Also spotted: " + ob.slice(0, 3).join(", "));
    }
    return out;
  }
  async function analyseNew(all) {
    if (VL.busy) return { error: "I'm already working on something." };
    if (!(await ensureReady())) return { error: "Connect the niche.co folder in the Video Lab panel first." };
    VL.busy = true; render();
    try {
      VL.stop = false;
      const vids = (await listFiles()).filter((f) => VID_RE.test(f.name) && /^inspiration\//i.test(f.path));
      const done = new Set(VL.analyses.filter((a) => a.ver >= 3).map((a) => a.path + "|" + a.size)); // older notes get re-studied with the new checks
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
    if (L.transitions) { const t = Object.entries(L.transitions).sort((x, y) => y[1] - x[1]); const pl = (x) => (x === "flash" ? "flashes" : x === "whip/zoom" ? "whip or zoom moves" : x === "dip to black" ? "dips to black" : x + "s");
      lines.push("Transitions: mostly " + pl(t[0][0]) + (t[1] ? ", then " + pl(t[1][0]) + " (" + Math.round(t[1][1] * 100) + " percent)" : "") + "."); }
    if (L.drop != null) lines.push("The beat drops around " + fmt(L.drop) + " seconds" + (L.fasterAfterDrop >= 0.5 ? ", and the cuts speed up after it." : "."));
    if (L.sound) lines.push(L.sound === "music" ? "They run on music, not talking." : L.sound === "voice" ? "Most are voice-led, someone talking." : "They mix voice and music.");
    if (L.textShare != null) lines.push(L.textShare >= 0.5 ? Math.round(L.textShare * 100) + " percent have on-screen text, usually at the " + L.textPos + ", in by " + fmt(L.textTime) + " seconds" + (L.hooks[0] ? ", like: " + L.hooks[0].slice(0, 50) : "") + "." : "Most don't use on-screen text.");
    if (L.faceFirst != null) lines.push(L.faceFirst >= 0.5 ? "Most show a face in the first second." : (L.personFirst >= 0.5 ? "Most open on a person wearing the clothes." : "Most open on the product, not a face."));
    if (L.person != null) lines.push(L.person > 0.05 ? "Clothes are on a person in about " + Math.round(L.person * 100) + " percent of shots." : "They show the product only, no people.");
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
    out.innerHTML = VL.last ? `<video src="${VL.last.url}" controls muted loop playsinline style="width:100%;max-height:420px;background:#000;margin-top:10px"></video><div class="mu" style="margin-top:6px">${esc(VL.last.name)} · ${esc(STYLES[VL.last.style])} · ${fmt(VL.last.secs)}s · cut every ${fmt(VL.last.shot, 2)}s at ${VL.last.bpm} BPM${VL.last.learned ? " (from what works)" : ""} · saved in videos${VL.last.applied && VL.last.applied.length ? "<br>Learned: " + esc(VL.last.applied.join(", ")) : ""}${VL.last.textTip != null ? "<br>Tip: videos that work use on-screen text" + (VL.last.textTip ? " (like “" + esc(VL.last.textTip.slice(0, 50)) + "”)" : "") + ". Type a hook line in the text box." : ""}</div>` : "";
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
    if (/grid/.test(t)) return "bwmood";
    if (/mood ?board|black and white|b ?& ?w/.test(t)) return "bwfull";
    if (/hard ?cut|white/.test(t)) return "hardcut";
    if (/fast|colou?r/.test(t)) return "fastcolour";
    if (/two|split|duo/.test(t)) return "duo";
    return "auto";
  }
  async function voiceMake(t) {
    if (!VL.ready && !(VL.dir && (await checkPerm(false)))) return say(VL.dir ? "Click Reconnect in the Video Lab panel, then ask me again." : "Connect your niche.co folder in the Video Lab panel first.");
    const st = styleFrom(t), m = t.match(/(\d{1,2})\s*(?:second|sec)/i), tx = t.match(/\b(?:with (?:the )?(?:text|words|caption)|saying|that says)\s+["“']?(.+?)["”']?\s*$/i);
    say("On it. Making a " + (st === "auto" ? "" : STYLES[st].toLowerCase() + " ") + "video for TikTok and Instagram.");
    $("#vlP").scrollIntoView({ behavior: "smooth", block: "center" });
    const r = await makeVideo({ style: st, seconds: m ? clamp(+m[1], 6, 30) : undefined, text: tx ? tx[1] : undefined });
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
