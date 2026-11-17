/* Jarvis video "eyes" — free, on-laptop understanding of videos and photos:
   on-screen text (Tesseract.js), faces and people/objects (Google MediaPipe), and transition types.
   Libraries and models are bundled in lib/ and only load the first time they're needed. */
(function () {
  const abs = (p) => new URL(p, location.href).href;
  const S = { ocr: null, ocrP: null, face: null, obj: null, mpP: null, errs: [] };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- loaders ---------- */
  function loadScript(src) {
    return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("couldn't load " + src)); document.head.appendChild(s); });
  }
  async function ocr() {
    if (S.ocr) return S.ocr;
    if (!S.ocrP) S.ocrP = (async () => {
      await loadScript("lib/tesseract/tesseract.min.js");
      S.ocr = await Tesseract.createWorker("eng", 1, { workerPath: abs("lib/tesseract/worker.min.js"), corePath: abs("lib/tesseract/core"), langPath: abs("lib/tesseract/lang"), gzip: true });
      return S.ocr;
    })().catch((e) => { S.errs.push("text reader: " + e.message); S.ocrP = null; return null; });
    return S.ocrP;
  }
  async function mp() {
    if (S.face) return S;
    if (!S.mpP) S.mpP = (async () => {
      const { FilesetResolver, FaceDetector, ObjectDetector } = await import(abs("lib/mediapipe/vision_bundle.mjs"));
      const files = await FilesetResolver.forVisionTasks(abs("lib/mediapipe/wasm"));
      S.face = await FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: abs("lib/mediapipe/models/blaze_face_short_range.tflite"), delegate: "CPU" }, runningMode: "IMAGE", minDetectionConfidence: 0.55 });
      S.obj = await ObjectDetector.createFromOptions(files, { baseOptions: { modelAssetPath: abs("lib/mediapipe/models/efficientdet_lite0.tflite"), delegate: "CPU" }, runningMode: "IMAGE", scoreThreshold: 0.45, maxResults: 6 });
      return S;
    })().catch((e) => { S.errs.push("face/object detector: " + e.message); S.mpP = null; return null; });
    return S.mpP;
  }

  /* ---------- what's in one picture ---------- */
  function look(canvas) { // faces + people + objects in one frame or photo
    const W = canvas.width, H = canvas.height, out = { faces: 0, faceBig: 0, person: false, personBig: false, objects: [] };
    if (!S.face) return out;
    try {
      for (const d of S.face.detect(canvas).detections || []) { const b = d.boundingBox; if (!b) continue; out.faces++; out.faceBig = Math.max(out.faceBig, b.height / H); }
      for (const d of S.obj.detect(canvas).detections || []) {
        const c = d.categories && d.categories[0], b = d.boundingBox; if (!c) continue;
        if (c.categoryName === "person") { out.person = true; if (b && b.height / H > 0.5) out.personBig = true; }
        else out.objects.push(c.categoryName);
      }
    } catch (e) {}
    return out;
  }
  function whiteMask(canvas) { // TikTok captions are usually white with an outline: turn white text into black-on-white
    const c = document.createElement("canvas"); c.width = canvas.width; c.height = canvas.height; const x = c.getContext("2d");
    x.drawImage(canvas, 0, 0); const d = x.getImageData(0, 0, c.width, c.height), a = d.data;
    for (let i = 0; i < a.length; i += 4) { const mx = Math.max(a[i], a[i + 1], a[i + 2]), mn = Math.min(a[i], a[i + 1], a[i + 2]); const v = mx > 200 && mx - mn < 40 ? 0 : 255; a[i] = a[i + 1] = a[i + 2] = v; }
    x.putImageData(d, 0, 0); return c;
  }
  async function read(canvas) { // on-screen text lines with position (white captions and dark text)
    const w = await ocr(); if (!w) return [];
    const lines = [], seen = new Set();
    for (const img of [whiteMask(canvas), canvas]) try {
      const { data } = await w.recognize(img, {}, { blocks: true });
      for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
        const t = (l.text || "").replace(/\s+/g, " ").trim();
        if (l.confidence < 70 || t.replace(/[^A-Za-z0-9]/g, "").length < 3) continue;
        const words = t.split(" ").filter((x) => /[A-Za-z]{2,}|\d/.test(x));
        if (!words.length) continue;
        const key = t.toLowerCase().replace(/[^a-z0-9]/g, ""); if (seen.has(key)) continue; seen.add(key);
        const cy = (l.bbox.y0 + l.bbox.y1) / 2 / canvas.height;
        lines.push({ text: t, y: cy, pos: cy < 0.33 ? "top" : cy < 0.66 ? "middle" : "bottom", h: (l.bbox.y1 - l.bbox.y0) / canvas.height });
      }
    } catch (e) {}
    return lines.sort((a, b) => a.y - b.y);
  }

  /* ---------- whole video ---------- */
  function once(el, ev) { return new Promise((res, rej) => { const ok = () => { cl(); res(); }, bad = () => { cl(); rej(new Error("seek failed")); }; const cl = () => { el.removeEventListener(ev, ok); el.removeEventListener("error", bad); }; el.addEventListener(ev, ok); el.addEventListener("error", bad); }); }
  async function grab(v, t, canvas) { v.currentTime = Math.max(0, Math.min(t, v.duration - 0.02)); await once(v, "seeked"); canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height); }
  const hookTags = (s) => {
    const t = s.toLowerCase(), tags = [];
    if (/^pov\b|\bpov:/.test(t)) tags.push("POV");
    if (/^(when|me when|that feeling)/.test(t)) tags.push("relatable");
    if (/^(how to|how i|ways to|\d+ (ways|tips|things))/.test(t)) tags.push("how-to");
    if (/\?\s*$/.test(t)) tags.push("question");
    if (/\b(r\s?\d+|\$\d+|sale|off|drop|new|restock|limited|link in bio|shop now)\b/.test(t)) tags.push("offer/drop");
    return tags;
  };
  // vision pass over a video: text, faces, people, objects. onProg(0..1)
  async function watch(v, dur, onProg, stop) {
    const res = { text: [], textFrames: 0, frames: 0, faceFrames: 0, faceFirst: false, closeUps: 0, personFrames: 0, personFirst: false, objects: {}, ok: { text: false, faces: false } };
    const big = document.createElement("canvas"), small = document.createElement("canvas");
    const ar = v.videoWidth && v.videoHeight ? v.videoHeight / v.videoWidth : 16 / 9;
    big.width = 720; big.height = Math.round(720 * ar); small.width = 360; small.height = Math.round(360 * ar);
    const m = await mp(); res.ok.faces = !!m;
    const n = Math.min(12, Math.max(4, Math.round(dur * 1.2)));
    const times = [0.25, 0.75, ...Array.from({ length: n - 2 }, (_, i) => 1 + (i + 0.5) * (Math.max(0.5, dur - 1) / (n - 2)))].filter((t) => t < dur);
    const ocrAt = new Set([0, 1, Math.floor(times.length / 2), times.length - 1]);
    const seen = new Map();
    for (let i = 0; i < times.length; i++) {
      if (stop && stop()) return null;
      await grab(v, times[i], big);
      small.getContext("2d").drawImage(big, 0, 0, small.width, small.height);
      res.frames++;
      if (m) {
        const l = look(small);
        if (l.faces) { res.faceFrames++; if (times[i] < 1) res.faceFirst = true; if (l.faceBig > 0.18) res.closeUps++; }
        if (l.person) { res.personFrames++; if (times[i] < 1) res.personFirst = true; }
        l.objects.forEach((o) => (res.objects[o] = (res.objects[o] || 0) + 1));
      }
      if (ocrAt.has(i)) {
        const lines = await read(big); if (S.ocr) res.ok.text = true;
        if (lines.length) res.textFrames++;
        for (const ln of lines) { const k = ln.text.toLowerCase(); if (!seen.has(k)) { seen.set(k, 1); res.text.push({ ...ln, t: +times[i].toFixed(2) }); } }
      }
      if (onProg) onProg((i + 1) / times.length);
      await sleep(0);
    }
    res.textShare = res.ok.text ? res.textFrames / ocrAt.size : null;
    res.firstText = res.text.length ? res.text[0].t : null;
    res.textPos = res.text.length ? mode(res.text.map((x) => x.pos)) : null;
    res.hook = res.text.length ? res.text.filter((x) => x.t < 1.5).map((x) => x.text).join(" ") || res.text[0].text : "";
    res.hookTags = res.hook ? hookTags(res.hook) : [];
    return res;
  }
  const mode = (a) => { const c = {}; a.forEach((x) => (c[x] = (c[x] || 0) + 1)); return Object.entries(c).sort((x, y) => y[1] - x[1])[0][0]; };

  // transitions: look closely (30 fps) around each cut
  async function transitions(v, cuts, stop) {
    const c = document.createElement("canvas"); c.width = 48; c.height = 86; const x = c.getContext("2d", { willReadFrequently: true });
    const stats = async (t) => {
      v.currentTime = Math.max(0, Math.min(t, v.duration - 0.02)); await once(v, "seeked"); x.drawImage(v, 0, 0, 48, 86);
      const d = x.getImageData(0, 0, 48, 86).data, lum = new Float32Array(48 * 86); let s = 0;
      for (let i = 0, j = 0; i < d.length; i += 4, j++) { lum[j] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255; s += lum[j]; }
      let edge = 0; for (let yy = 1; yy < 85; yy++) for (let xx = 1; xx < 47; xx++) { const k = yy * 48 + xx; edge += Math.abs(4 * lum[k] - lum[k - 1] - lum[k + 1] - lum[k - 48] - lum[k + 48]); }
      return { lum, bright: s / lum.length, sharp: edge / (46 * 84) };
    };
    const types = [];
    for (const cut of cuts.slice(0, 12)) {
      if (stop && stop()) return null;
      const fr = []; for (let k = -6; k <= 6; k++) fr.push(await stats(cut + k / 30));
      const diffs = []; for (let k = 1; k < fr.length; k++) { let df = 0; for (let j = 0; j < fr[k].lum.length; j++) df += Math.abs(fr[k].lum[j] - fr[k - 1].lum[j]); diffs.push(df / fr[k].lum.length); }
      const total = diffs.reduce((a, b) => a + b, 0), peak = Math.max(...diffs), ends = Math.min(fr[0].bright, fr[12].bright), mid = fr.slice(3, 10);
      const maxB = Math.max(...mid.map((f) => f.bright)), minB = Math.min(...mid.map((f) => f.bright));
      const sharpMed = fr.map((f) => f.sharp).sort((a, b) => a - b)[6], sharpMin = Math.min(...mid.map((f) => f.sharp));
      let type = "hard cut";
      if (maxB > 0.85 && maxB > ends + 0.25) type = "flash";
      else if (minB < 0.07 && ends > 0.15) type = "dip to black";
      else if (total > 0.08 && peak < total * 0.45) type = sharpMin < sharpMed * 0.5 ? "whip/zoom" : "fade";
      else if (sharpMin < sharpMed * 0.45) type = "whip/zoom";
      types.push(type);
    }
    return types;
  }

  // photo tags for the video maker (cached per file)
  async function tagPhoto(bitmap) {
    const m = await mp(); if (!m) return null;
    const c = document.createElement("canvas"), s = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    c.width = Math.round(bitmap.width * s); c.height = Math.round(bitmap.height * s); c.getContext("2d").drawImage(bitmap, 0, 0, c.width, c.height);
    const l = look(c); return { face: l.faces > 0, closeUp: l.faceBig > 0.18, person: l.person };
  }

  window.VideoSense = { watch, transitions, tagPhoto, loadAll: () => Promise.all([ocr(), mp()]), errors: () => S.errs.slice(), hookTags };
})();
