/* Minimal Jarvis: the home screen is just the core. Screens are pulled up on request
   ("Hey Jarvis, pull up my calendar", the dock, or when Jarvis answers something) and slide in
   beside the core. "Close" / "go home" clears them. "Full view" switches back to the whole dashboard. */
(function () {
  const $ = (s) => document.querySelector(s);
  const SCREENS = {
    today: { title: "Today", panels: ["schP", "wxP", "calP"], words: /\b(today|my day|schedule|agenda|what'?s on)\b/ },
    calendar: { title: "Calendar & lessons", panels: ["calP", "schP"], words: /\b(calendar|lessons?|appointments?|events?|diary)\b/ },
    weather: { title: "Weather & wind", panels: ["wxP"], words: /\b(weather|wind|kite|forecast|surf)\b/ },
    inbox: { title: "Inbox", panels: ["mailP"], words: /\b(inbox|e-?mails?|mail|gmail)\b/ },
    money: { title: "Money", panels: ["incP", "nwP", "kiteP"], words: /\b(money|income|finances?|net worth|assets|earnings|cash|eft|payments?)\b/ },
    shop: { title: "niche.co", panels: ["shopP", "soP"], words: /\b(shop(ify)?|store|niche|sales|orders)\b/ },
    social: { title: "Social", panels: ["soP"], words: /\b(social|tik ?tok|instagram|insta|followers|socials)\b/ },
    videos: { title: "Video lab", panels: ["vlP"], words: /\b(videos?|video lab|edits?|content|clips)\b/ },
    bookings: { title: "Sleek Auto", panels: ["bookP", "schP", "saP"], words: /\b(sleek( auto)?|bookings?|washes|book a wash|car wash)\b/ },
    alarm: { title: "Wake-up", panels: ["pWake"], words: /\b(alarm|wake ?up)\b/ },
    settings: { title: "Settings", panels: ["aiP", "pSet", "saP"], words: /\b(settings?|brain|voice|keys?|connections?|setup)\b/ },
    whatsapp: { title: "WhatsApp", panels: ["waP"], words: /\b(whats ?app)\b/ },
  };
  const DOCK = [["today", "Today"], ["calendar", "Calendar"], ["inbox", "Inbox"], ["money", "Money"], ["shop", "niche.co"], ["videos", "Videos"], ["settings", "Settings"]];
  const slots = new Map(); // panel id -> placeholder where it lives in the full dashboard
  let current = null;

  function init() {
    for (const k in SCREENS) for (const id of SCREENS[k].panels) {
      const el = document.getElementById(id);
      if (el && !slots.has(id)) { const m = document.createComment("slot " + id); el.parentNode.insertBefore(m, el); slots.set(id, m); }
    }
    $("#dock").innerHTML = DOCK.map(([k, l]) => `<button type="button" data-s="${k}">${l}</button>`).join("");
    document.querySelectorAll("#dock button").forEach((b) => (b.onclick = () => (current === b.dataset.s ? close() : show(b.dataset.s))));
    $("#stageX").onclick = close;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && current) close(); });
    $("#viewBtn").onclick = () => setMin(!document.body.classList.contains("min"));
    let min = true; try { const v = localStorage.getItem("jv_minimal"); if (v != null) min = JSON.parse(v); } catch (e) {}
    setMin(min);
    glance(); setInterval(glance, 30000);
  }
  function setMin(on) {
    if (!on) close();
    document.body.classList.toggle("min", on);
    $("#viewBtn").textContent = on ? "Full view" : "Minimal";
    try { localStorage.setItem("jv_minimal", JSON.stringify(on)); } catch (e) {}
    setTimeout(() => dispatchEvent(new Event("resize")), 50);
  }
  function putBack() {
    for (const [id, m] of slots) { const el = document.getElementById(id); if (el && el.previousSibling !== m) m.parentNode.insertBefore(el, m.nextSibling); }
  }
  function show(name) {
    const S = SCREENS[name]; if (!S) return false;
    if (!document.body.classList.contains("min")) { // full dashboard: just bring the panel into view
      const el = document.getElementById(S.panels[0]); el && el.scrollIntoView({ behavior: "smooth", block: "center" }); return true;
    }
    putBack();
    const body = $("#stageBody"); body.innerHTML = "";
    for (const id of S.panels) { const el = document.getElementById(id); if (el) body.appendChild(el); }
    $("#stageT").textContent = S.title; $("#stage").hidden = false; body.scrollTop = 0;
    document.body.classList.add("open"); current = name;
    document.querySelectorAll("#dock button").forEach((b) => b.classList.toggle("on", b.dataset.s === name));
    setTimeout(() => dispatchEvent(new Event("resize")), 260);
    return true;
  }
  function close() {
    if (!current) return; putBack();
    $("#stage").hidden = true; document.body.classList.remove("open"); current = null;
    document.querySelectorAll("#dock button").forEach((b) => b.classList.remove("on"));
    setTimeout(() => dispatchEvent(new Event("resize")), 260);
  }
  // "pull up my calendar" -> "calendar"; "close" / "go home" -> null; anything else -> undefined
  function fromVoice(t) {
    // tidy what the speech engine heard: lower case, no punctuation, no "hey Jarvis", no polite filler
    t = " " + t.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
    t = t.replace(/^ (?:(?:hey|ok|okay|yo|hi) )?jarvis /, " ").replace(/^ (?:(?:please|can you|could you|would you|just|yo|ok|okay|now) )+/, " ")
      .replace(/ (?:(?:please|now|thanks|thank you|for me|right now|quickly|again) )+$/, " ").trim();
    const isScreen = (w) => /^(it|that|this|them|everything|all|screen|the screen|this screen|that screen)$/.test(w) || Object.values(SCREENS).some((S) => S.words.test(w) && w.split(" ").length <= 4);
    // "take it away", "take the calendar away", "take it take the calendar away", "put that away"
    if (/^(?:(?:take|put|get) .{0,30}? ?)+away$/.test(t) && /^(take|put|get)\b/.test(t)) return null;
    if (/\b(take|put|get) (it|that|this|them|everything) away\b/.test(t)) return null;
    // "close the calendar", "hide my inbox", "get rid of it", "minimise it"
    const cm = t.match(/^(?:close|hide|clear|dismiss|remove|minimi[sz]e|get rid of|shut|kill|lose)(?: down| off| out)? (?:the |my |our |of )?(.+?)(?: screen| panel| page| tab)?$/);
    if (cm && isScreen(cm[1])) return null;
    if (/^(close|hide|clear|dismiss|minimi[sz]e|go home|home|go back|back|that's all|thats all|done|all good|i'm done|im done|enough|that's enough)$/.test(t)) return null;
    // "pull up my calendar", "show me the money screen", "open video lab"
    const m = t.match(/^(?:pull up|show(?: me)?|open(?: up)?|bring up|go to|display|let me see|take me to|put up|throw up)\s+(?:my |the |our )?(.+?)(?:\s+(?:screen|panel|page|tab|section))?$/);
    if (!m) return undefined;
    for (const k in SCREENS) if (SCREENS[k].words.test(m[1])) return k;
    return undefined;
  }
  // one quiet line under the core: weather, wind and what's next
  function glance() {
    const parts = [];
    try { if (typeof wx !== "undefined" && wx) parts.push(Math.round(wx.current.temperature_2m) + "°", Math.round(wx.current.wind_speed_10m) + " kn " + compass(wx.current.wind_direction_10m)); } catch (e) {}
    try {
      const now = Date.now(), items = [];
      if (typeof allCal === "function" && typeof gOk === "function" && gOk()) allCal().forEach((x) => { if (x.ts > now && x.day === ld()) items.push([x.ts, x.time + " " + x.title]); });
      if (typeof saOn !== "undefined" && saOn) washes.forEach((w) => { if (w.date === ld() && !w.done) { const ts = new Date(w.date + "T" + (w.time || "00:00") + ":00+02:00").getTime(); if (ts > now) items.push([ts, w.time + " wash · " + (w.client || "client")]); } });
      items.sort((a, b) => a[0] - b[0]);
      parts.push(items.length ? "Next " + items[0][1] : "Nothing else today");
    } catch (e) {}
    const g = $("#glance"); if (g) g.textContent = parts.join("  ·  ");
  }

  init();
  window.Screens = { show, close, fromVoice, glance, names: Object.keys(SCREENS) };
})();
