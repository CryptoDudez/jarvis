/* Jarvis brain — lets Hayden talk to Jarvis normally. Claude answers, and uses Jarvis's own
   features as tools (weather, schedule, email, money, bookings, calendar, videos) plus web search.
   The Anthropic API key is stored only in this browser on this laptop, never in the code. */
(function () {
  const $ = (s) => document.querySelector(s);
  const MODELS = {
    "claude-opus-5-5": "Claude Opus 5.5 · smartest · about R0.40 a chat",
    "claude-sonnet-5-5": "Claude Sonnet 5.5 · fast and smart · about R0.20 a chat",
    "claude-haiku-5-5": "Claude Haiku 5.5 · quickest · about R0.01 a chat",
  };
  const B = { key: store.get("aiKey", ""), model: store.get("aiModel", "claude-opus-5-5"), msgs: [], lastAt: 0, client: null, busy: false };
  let via = "text"; // how the last request came in: "voice" or "text"

  const SYSTEM = `You are Jarvis, Hayden's personal assistant. You run on his laptop as a voice assistant with a dashboard, so everything you write is read aloud.

About Hayden (South Africa, lives in Langebaan, timezone Africa/Johannesburg, currency rand):
- Owns Sleek Auto, a mobile car wash. Crew: Festus and Mateo. Hayden keeps 50% of wash revenue.
- Kitesurf instructor with Cape Sports; lesson bookings come by email, and he gets paid by EFT.
- Owns niche.co, a clothing brand on Shopify, posting on TikTok (@niche.co) and Instagram (@nicheco.offcial).

How to talk:
- Speak like a sharp, warm, slightly dry-witted assistant. Call him Hayden, occasionally "sir".
- Keep replies short: one to three sentences unless he asks for more. No markdown, lists, emojis, links or symbols, since this is spoken. Say amounts like "four hundred and fifty rand" only when natural; "R450" is fine too.
- Have normal conversations: chat, give advice, brainstorm, answer general questions. Use web search for current facts, news, prices or anything you are unsure of.
- For anything about his day, business or money, call the tools and use their numbers. Never invent figures, bookings or emails.
- If something isn't connected or a tool fails, say so in one sentence and say what he can do about it.
- If you can't do something, say so briefly and offer the closest thing you can do.

Actions:
- Before book_wash, add_calendar_event or log_kite_payment, read the details back in one sentence and ask "Shall I go ahead?". Only call the tool after he clearly says yes in his next message.
- make_video, study_videos and lookups need no confirmation. For make_video, if videos that work use on-screen text and Hayden gave no hook line, you may suggest one first.
- Each user message starts with the current date and time in square brackets; use it to work out "today", "tomorrow", weekdays and so on. Dates for tools are YYYY-MM-DD, times are 24-hour HH:MM.`;

  const obj = (props, req) => ({ type: "object", properties: props, required: req || [], additionalProperties: false });
  const TOOLS = [
    { name: "get_overview", description: "Snapshot of Hayden's day and business right now: weather and wind, today's and tomorrow's Sleek Auto washes, calendar and kite lessons for the next 7 days, email summary, income this month, niche.co sales and social stats, video lab learnings, alarm time. Call this first for most questions about his day, schedule, money or business.", strict: true, input_schema: obj({}) },
    { name: "get_schedule", description: "Sleek Auto washes plus calendar events and kite lessons for a date range (up to 14 days ahead).", strict: true, input_schema: obj({ start_date: { type: "string", description: "YYYY-MM-DD" }, days: { type: "integer", description: "Number of days, 1-14" } }, ["start_date", "days"]) },
    { name: "get_emails", description: "Unread Gmail from the last 7 days, sorted into pay, answer and ignore, with sender, subject and preview.", strict: true, input_schema: obj({}) },
    { name: "book_wash", description: "Book a Sleek Auto wash into the Sleek Auto calendar. Only after Hayden confirmed the details.", strict: true, input_schema: obj({
      client_name: { type: "string" }, phone: { type: "string", description: "Client phone, or empty string if unknown" }, address: { type: "string" },
      date: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string", description: "HH:MM 24-hour" },
      service: { type: "string", enum: ["Exterior + Interior", "Exterior", "Interior", "Exterior + Chain clean & lube"] },
      car_type: { type: "string", enum: ["", "2-Door Sedan", "4-Door Sedan", "4-Door SUV", "Single-Cab Bakkie", "Double-Cab Bakkie", "Minivan", "Van", "Motorbike"], description: "Empty string if unknown; the crew can set it later" },
      crew: { type: "string", enum: ["festus", "mateo", "festus,mateo"] },
    }, ["client_name", "phone", "address", "date", "time", "service", "car_type", "crew"]) },
    { name: "add_calendar_event", description: "Add an event to Hayden's Google Calendar. Only after he confirmed.", strict: true, input_schema: obj({
      title: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string", description: "HH:MM 24-hour" },
      minutes: { type: "integer", description: "Length in minutes; kite lessons are usually 120" }, location: { type: "string", description: "Empty string if none" },
    }, ["title", "date", "time", "minutes", "location"]) },
    { name: "log_kite_payment", description: "Record a kitesurfing EFT payment in the income panel. Only after he confirmed.", strict: true, input_schema: obj({ amount: { type: "number", description: "Rand" }, date: { type: "string", description: "YYYY-MM-DD" }, note: { type: "string" } }, ["amount", "date", "note"]) },
    { name: "set_alarm_time", description: "Change the wake-up alarm time. Hayden still has to click Arm on the laptop before bed.", strict: true, input_schema: obj({ time: { type: "string", description: "HH:MM 24-hour" } }, ["time"]) },
    { name: "make_video", description: "Make a vertical niche.co video for TikTok and Instagram from the photos in the niche.co folder and save it in niche.co/videos. Takes about 15 seconds.", strict: true, input_schema: obj({
      style: { type: "string", enum: ["auto", "vintage", "bwfull", "hardcut", "bwmood", "fastcolour", "collage", "bw2colour", "duo"], description: "auto follows what the video lab learned; vintage = old-money vintage collage, niche.co's main look; bwfull = full-screen black and white moodboard edit; bwmood = B&W photo grid" },
      seconds: { type: "integer", description: "Length, 6-30; 0 means use the learned length" },
      text: { type: "string", description: "Hook text to show on screen, or empty string for none" },
    }, ["style", "seconds", "text"]) },
    { name: "study_videos", description: "Study new videos in the niche.co/inspiration folder and return what makes them work.", strict: true, input_schema: obj({}) },
  ];
  const webSearch = () => (B.model === "claude-haiku-5-5" ? { type: "web_search_20250305", name: "web_search", max_uses: 3 } : { type: "web_search_20260209", name: "web_search", max_uses: 3 });

  /* ---------- tool implementations (use Jarvis's existing features) ---------- */
  const safe = (f, fallback) => { try { return f(); } catch (e) { return fallback; } };
  function washRows(from, days) {
    if (!saOn) return "Sleek Auto not connected (Hayden needs to sign in on the Sleek Auto panel)";
    const end = new Date(new Date(from + "T12:00:00+02:00").getTime() + (days - 1) * 864e5), to = ld(end);
    return washes.filter((w) => w.date >= from && w.date <= to).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
      .map((w) => ({ date: w.date, time: w.time, client: w.client || "", address: w.address, crew: (w.crew || []).join(" + "), car: w.car || "", service: w.svc || "", price: w.price || 0, done: !!w.done }));
  }
  function calRows(from, days) {
    if (!gOk()) return "Google not connected (or sign-in expired: Hayden clicks anywhere on Jarvis to renew)";
    const end = new Date(new Date(from + "T12:00:00+02:00").getTime() + (days - 1) * 864e5), to = ld(end);
    return allCal().filter((x) => x.day >= from && x.day <= to).map((x) => ({ date: x.day, time: x.time, title: x.title, kite_lesson: !!x.lesson, where: x.where || "" }));
  }
  async function runTool(name, input) {
    switch (name) {
      case "get_overview": {
        try { if (gOk()) await gLoad(); } catch (e) {}
        const ins = window.VideoLab && VideoLab.insights();
        return {
          now: new Date().toLocaleString("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ }),
          weather: safe(wxSpeech, "unavailable"),
          washes_today_and_tomorrow: washRows(ld(), 2),
          calendar_next_7_days: calRows(ld(), 7),
          email: gOk() ? safe(() => ({ pay: G.mail.filter((m) => m.pile === "pay").length, answer: G.mail.filter((m) => m.pile === "answer").length, ignore: G.mail.filter((m) => m.pile === "ignore").length }), "unavailable") : "Google not connected",
          income: safe(incomeSpeech, "unavailable"),
          niche_shop: safe(shopSpeech, "unavailable"),
          niche_social: safe(() => socialSpeech(""), "unavailable"),
          video_lab: ins ? ins.lines.join(" ") : "No videos studied yet",
          alarm: $("#alarmT").value + (safe(() => armed, false) ? " (armed)" : " (not armed)"),
        };
      }
      case "get_schedule": {
        try { if (gOk()) await gLoad(); } catch (e) {}
        const d = Math.max(1, Math.min(14, input.days | 0));
        return { washes: washRows(input.start_date, d), calendar: calRows(input.start_date, d) };
      }
      case "get_emails": {
        if (!gOk()) return "Google not connected (or sign-in expired: Hayden clicks anywhere on Jarvis to renew)";
        try { await gLoad(); } catch (e) {}
        return G.mail.slice(0, 25).map((m) => ({ pile: m.pile, from: m.from, subject: m.sub, preview: (m.snip || "").slice(0, 160), important: m.imp }));
      }
      case "book_wash": {
        if (!saOn) return { error: "Sleek Auto isn't connected. Hayden needs to sign in on the Sleek Auto panel." };
        const car = CARS[input.car_type] ? input.car_type : "", svc = SVC.includes(input.service) ? input.service : SVC[0];
        if (car && !okCar(car, svc)) return { error: "That service doesn't fit that vehicle." };
        const row = { client: input.client_name, phone: input.phone, address: input.address, date: input.date, time: input.time, crew: input.crew.split(","), car, svc, price: car ? P(car, svc) : 0 };
        const { error } = await sb.from("washes").insert(row);
        if (error) return { error: error.message };
        saLoad(); toast("Booked " + input.client_name + " in Sleek Auto");
        return { booked: true, price: row.price || "set when the car type is known" };
      }
      case "add_calendar_event": {
        if (!canWrite()) return { error: gOk() ? "Jarvis isn't allowed to change the calendar yet. Hayden clicks Allow calendar changes in the Calendar panel." : "Google not connected." };
        const ok = await saveEv({ title: input.title, day: input.date, time: input.time, mins: input.minutes || 60, where: input.location }, null);
        return ok ? { added: true } : { error: $("#evMsg").textContent };
      }
      case "log_kite_payment": {
        kite.push({ id: Date.now().toString(36), a: +input.amount, d: input.date || ld(), n: input.note || "" }); store.set("kite", kite); renderIncome();
        return { logged: true, month_total: kiteSum(ld().slice(0, 7)) };
      }
      case "set_alarm_time": {
        if (!/^\d{2}:\d{2}$/.test(input.time)) return { error: "Use HH:MM" };
        $("#alarmT").value = input.time; store.set("alarm", input.time); store.set("fired", ""); safe(updArm);
        return { alarm: input.time, note: "Hayden must click Arm alarm for tonight on the laptop before bed." };
      }
      case "make_video": {
        if (!window.VideoLab) return { error: "Video lab not loaded" };
        say("On it. Making the video now.");
        const r = await VideoLab.makeVideo({ style: input.style, seconds: input.seconds ? Math.max(6, Math.min(30, input.seconds)) : "auto", text: input.text || "" });
        return r.error ? { error: r.error } : { saved_as: r.name, folder: "niche.co/videos", style: r.style, seconds: Math.round(r.secs), learned_and_applied: r.applied || [], tip: r.textTip != null ? "Videos that work use on-screen hook text" : null };
      }
      case "study_videos": {
        if (!window.VideoLab) return { error: "Video lab not loaded" };
        const r = await VideoLab.analyseNew(false);
        if (r.error) return { error: r.error };
        const ins = VideoLab.insights();
        return { studied_now: r.count, stopped: !!r.stopped, learnings: ins ? ins.lines : [] };
      }
    }
    return { error: "Unknown tool " + name };
  }

  /* ---------- conversation ---------- */
  function client() {
    if (!B.client || B.client.apiKey !== B.key) B.client = new Anthropic({ apiKey: B.key, dangerouslyAllowBrowser: true });
    return B.client;
  }
  function stamp() { return "[" + new Date().toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ }) + "] "; }
  async function chat(text) {
    if (!B.key || !window.Anthropic) return null;
    // a fresh conversation after 15 quiet minutes or a long thread (history is only ever appended to)
    if (Date.now() - B.lastAt > 15 * 6e4 || B.msgs.length > 40) B.msgs = [];
    B.lastAt = Date.now(); B.busy = true; setMode("thinking"); status("Thinking…");
    const start = B.msgs.length;
    B.msgs.push({ role: "user", content: stamp() + text });
    try {
      for (let step = 0; step < 10; step++) {
        const params = {
          model: B.model, max_tokens: 16000, system: SYSTEM, tools: [...TOOLS, webSearch()], messages: B.msgs,
          output_config: { effort: "low" }, cache_control: { type: "ephemeral" },
        };
        if (B.model !== "claude-haiku-5-5") { params.betas = ["server-side-fallback-2026-07-01"]; params.fallbacks = "default"; }
        const res = await client().beta.messages.create(params);
        if (res.stop_reason === "refusal") { B.msgs = []; status(""); return "I can't help with that one, Hayden."; }
        B.msgs.push({ role: "assistant", content: res.content });
        if (res.stop_reason === "pause_turn") continue; // web search still going
        const uses = res.content.filter((b) => b.type === "tool_use");
        if (res.stop_reason === "tool_use" && uses.length) {
          const results = [];
          for (const u of uses) {
            status("Checking " + u.name.replace(/_/g, " ") + "…");
            let out; try { out = await runTool(u.name, u.input || {}); } catch (e) { out = { error: e.message || String(e) }; }
            results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out), ...(out && out.error ? { is_error: true } : {}) });
          }
          B.msgs.push({ role: "user", content: results });
          setMode("thinking"); continue;
        }
        const reply = res.content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
        status(""); return reply || "Done.";
      }
      status(""); return "That took too many steps. Try asking in a simpler way.";
    } catch (e) {
      B.msgs.length = start; // drop the unanswered turn so the history stays valid
      setMode("idle");
      let m = "Jarvis's brain couldn't be reached, so I used the basic commands.";
      if (e instanceof Anthropic.AuthenticationError) m = "Claude rejected the API key. Paste it again in the Brain panel.";
      else if (e instanceof Anthropic.PermissionDeniedError) m = "This API key isn't allowed to use that model.";
      else if (e instanceof Anthropic.RateLimitError) m = "Claude is busy right now (rate limit). Try again in a minute.";
      else if (e instanceof Anthropic.BadRequestError && /credit/i.test(e.message || "")) m = "Your Claude account is out of credit. Top up at console.anthropic.com.";
      else if (e instanceof Anthropic.APIError) m = "Claude error " + (e.status || "") + ". I used the basic commands instead.";
      status(m, true); return null;
    } finally { B.busy = false; }
  }
  // Runs a request through the brain and speaks the reply; returns false if the brain is off or failed.
  async function handleText(raw) {
    const reply = await chat(raw);
    if (reply == null) return false;
    await say(reply);
    if (via === "voice" && /\?\s*$/.test(reply)) { // he was asked something: listen for the answer
      await new Promise((res) => listenOnce(async (c) => { if (c) { via = "voice"; await handle(c); } res(); }, 8000));
    }
    return true;
  }

  /* ---------- Brain panel ---------- */
  function status(t, bad) { const e = $("#aiMsg"); if (e && t) e.innerHTML = (bad ? '<span style="color:var(--bad)">●</span> ' : "") + esc(t); else if (e && !t) render(); }
  function render() {
    const on = !!B.key && !!window.Anthropic;
    $("#aiChip").textContent = on ? "On" : "Off"; $("#aiChip").className = "chip " + (on ? "live" : "off");
    $("#aiKey").placeholder = B.key ? "Key saved · paste a new one to replace" : "Paste your Anthropic API key (sk-ant-…)";
    $("#aiModel").value = B.model;
    $("#aiMsg").textContent = on ? "Talk to Jarvis about anything. It checks your schedule, emails and money itself, and can book washes, add events, log payments and make videos." : "Add an Anthropic API key to give Jarvis a real brain. Until then it only understands set commands.";
    $("#aiForget").hidden = !B.key;
  }
  function init() {
    $("#aiModel").innerHTML = Object.entries(MODELS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
    $("#aiModel").onchange = () => { B.model = $("#aiModel").value; store.set("aiModel", B.model); B.msgs = []; render(); };
    $("#aiF").onsubmit = (e) => { e.preventDefault(); const k = $("#aiKey").value.trim(); if (!k) return; B.key = k; store.set("aiKey", k); $("#aiKey").value = ""; B.msgs = []; render(); handle("Say hello to Hayden in one short sentence and tell him your brain is online."); };
    $("#aiForget").onclick = () => { B.key = ""; store.set("aiKey", ""); B.msgs = []; render(); };
    render();
  }
  init();
  window.Brain = { on: () => !!B.key && !!window.Anthropic, handleText, setVia: (v) => (via = v), reset: () => (B.msgs = []), _B: B, _runTool: runTool };
})();
