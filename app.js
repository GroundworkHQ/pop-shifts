(() => {
  const FN_URL = "https://kdgbivcufoarmvckworj.supabase.co/functions/v1/pop-shifts";
  const MOCK = new URLSearchParams(location.search).has("mock");
  const CODE_KEY = "pop-family-code";
  const DAY_START = 9 * 60, DAY_END = 21 * 60, SPAN = DAY_END - DAY_START;
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const $ = (id) => document.getElementById(id);

  const VIEW_KEY = "pop-view";
  let shifts = [], weekOffset = 0, monthOffset = 0, editing = null, confirmDel = false, loadSeq = 0;
  let view = (() => { try { return localStorage.getItem(VIEW_KEY) === "month" ? "month" : "week"; } catch { return "week"; } })();

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const fmt = (m) => { let h = Math.floor(m / 60); const mm = m % 60; const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return mm ? `${h}:${pad(mm)} ${ap}` : `${h} ${ap}`; };

  const store = {
    get() { try { return localStorage.getItem(CODE_KEY) || ""; } catch { return ""; } },
    set(v) { try { localStorage.setItem(CODE_KEY, v); } catch {} },
    clear() { try { localStorage.removeItem(CODE_KEY); } catch {} },
  };

  // ---- API (real or ?mock for local preview) ----
  const mockRows = [];
  const api = {
    async list(from, to) {
      if (MOCK) return mockRows.filter((s) => s.date >= from && s.date <= to);
      const r = await fetch(`${FN_URL}?from=${from}&to=${to}`);
      if (!r.ok) throw new Error("load");
      return (await r.json()).shifts;
    },
    async post(body, code) {
      if (MOCK) {
        if (code !== "pop") return { status: 401, data: { error: "wrong_code" } };
        if (window.PopMockHours && /^(hours_|helper_)/.test(body.action)) return window.PopMockHours(body);
        if (body.action === "save") {
          const s = { ...body.shift, id: body.shift.id || crypto.randomUUID() };
          const i = mockRows.findIndex((x) => x.id === s.id);
          i >= 0 ? (mockRows[i] = s) : mockRows.push(s);
        }
        if (body.action === "delete") mockRows.splice(mockRows.findIndex((x) => x.id === body.id), 1);
        return { status: 200, data: { ok: true } };
      }
      const r = await fetch(FN_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-family-code": code },
        body: JSON.stringify(body),
      });
      return { status: r.status, data: await r.json().catch(() => ({})) };
    },
  };
  if (MOCK) {
    const w = weekDates();
    [[1, "09:00", "15:00", "Carlos"], [1, "18:30", "21:00", "Danny"], [3, "09:00", "15:00", "Sylvia"], [3, "15:00", "21:00", "Angel"]]
      .forEach(([d, s, e, n]) => mockRows.push({ id: crypto.randomUUID(), date: iso(w[d]), start: s, end: e, name: n, note: "" }));
  }

  function weekDates() {
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d; });
  }

  function monthGrid() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1, 12);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12);
    const start = new Date(first); start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    const end = new Date(last); end.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));
    const days = [];
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d));
    return { first, last, days };
  }

  function currentRange() {
    if (view === "month") { const g = monthGrid(); return [iso(g.days[0]), iso(g.days[g.days.length - 1])]; }
    const d = weekDates(); return [iso(d[0]), iso(d[6])];
  }

  function weekOffsetFor(date) {
    const monday = (x) => { const m = new Date(x); m.setHours(12, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; };
    return Math.round((monday(date) - monday(new Date())) / (7 * 864e5));
  }

  function coverage(list) {
    const iv = list.map((s) => [Math.max(DAY_START, toMin(s.start)), Math.min(DAY_END, toMin(s.end))])
      .filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const [a, b] of iv) { const l = merged[merged.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else merged.push([a, b]); }
    const gaps = []; let cur = DAY_START;
    for (const [a, b] of merged) { if (a > cur) gaps.push([cur, a]); cur = Math.max(cur, b); }
    if (cur < DAY_END) gaps.push([cur, DAY_END]);
    // The day is two shifts (9-3 and 3-9): split open time at 3 PM so each shift counts on its own.
    const SPLIT = 15 * 60;
    const split = gaps.flatMap(([a, b]) => (a < SPLIT && b > SPLIT ? [[a, SPLIT], [SPLIT, b]] : [[a, b]]));
    gaps.length = 0; gaps.push(...split);
    return { merged, gaps, covered: merged.reduce((t, [a, b]) => t + (b - a), 0) };
  }

  // A slot has "passed" once its end time is behind us (viewer's local clock).
  function nowInfo() { const n = new Date(); return { today: iso(n), min: n.getHours() * 60 + n.getMinutes() }; }
  function isPassed(key, endMin, now) { return key < now.today || (key === now.today && endMin <= now.min); }

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  const weekHooks = [];
  function render() {
    const month = view === "month";
    $("days").hidden = month; $("month").hidden = !month; $("paid").hidden = month; $("legendNight").hidden = month;
    $("vWeek").setAttribute("aria-pressed", String(!month)); $("vMonth").setAttribute("aria-pressed", String(month));
    $("prev").setAttribute("aria-label", month ? "Previous month" : "Previous week");
    $("next").setAttribute("aria-label", month ? "Next month" : "Next week");
    $("forget").hidden = !store.get();
    if (month) renderMonth(); else renderBoard();
    weekHooks.forEach((f) => f());
  }

  function renderMonth() {
    const { first, last, days } = monthGrid(), todayIso = iso(new Date()), m = first.getMonth();
    const monthIsPast = iso(last) < todayIso, nowM = nowInfo();
    $("weekLabel").textContent = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const root = $("month"); root.replaceChildren();
    const grid = el("div", "mgrid");
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach((n) => grid.append(el("div", "mhead", n)));
    let covered = 0, inMonthDays = 0, open = 0;
    days.forEach((d) => {
      const key = iso(d), inMonth = d.getMonth() === m, past = key < todayIso;
      const { gaps: allGaps, covered: c } = coverage(shifts.filter((x) => x.date === key));
      const gaps = monthIsPast ? allGaps : allGaps.filter((g) => !isPassed(key, g[1], nowM));
      const cell = el("button", "mcell"); cell.type = "button";
      if (!inMonth) cell.classList.add("out");
      if (past) cell.classList.add("past");
      if (key === todayIso) cell.classList.add("today");
      cell.append(el("span", "mnum", String(d.getDate())));
      // Past days stay neutral (no alarm for days already gone); totals count today onward,
      // or the whole month when it's already over.
      const counts = inMonth && (!past || monthIsPast);
      if (counts) { covered += c; inMonthDays++; open += gaps.length; }
      if (inMonth && !past) {
        cell.classList.add(gaps.length >= 2 ? "open-2" : gaps.length === 1 ? "open-1" : "is-covered");
        cell.append(el("span", "mstat", gaps.length ? `${gaps.length} Open` : "Covered"));
      }
      const label = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
      cell.setAttribute("aria-label", past ? `${label}. Open this week.` : `${label}: ${gaps.length ? `${gaps.length} open` : "covered"}. Open this week.`);
      cell.onclick = () => openWeekOf(d);
      grid.append(cell);
    });
    root.append(grid, el("p", "mhint", "Tap a day to see its shifts and sign up."));
    $("hours").textContent = `${Math.round(covered / 6) / 10} / ${inMonthDays * 12} Hrs Covered${monthOffset === 0 ? " Ahead" : ""}`;
    const gp = $("gapPill");
    if (monthIsPast) { gp.className = "pill"; gp.textContent = "Past Month"; return; }
    gp.className = open ? "pill warn" : "pill ok";
    const scope = monthOffset === 0 ? "Left This Month" : "This Month";
    gp.textContent = open ? `${open} Open ${open === 1 ? "Slot" : "Slots"} ${scope}` : "Fully Covered";
  }

  function setView(v) {
    view = v; try { localStorage.setItem(VIEW_KEY, v); } catch {}
    render(); load();
  }

  function openWeekOf(d) {
    weekOffset = weekOffsetFor(d);
    setView("week");
    const key = iso(d);
    setTimeout(() => document.getElementById(`day-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }
  function renderBoard() {
    const dates = weekDates(), todayIso = iso(new Date());
    const opts = { month: "short", day: "numeric" };
    const range = `${dates[0].toLocaleDateString(undefined, opts)} – ${dates[6].toLocaleDateString(undefined, opts)}`;
    $("weekLabel").textContent = weekOffset === 0 ? `This Week · ${range}` : range;
    const root = $("days"); root.replaceChildren();
    const now = nowInfo();
    let totalCovered = 0, openSlots = 0;
    dates.forEach((d, i) => {
      const key = iso(d), pastDay = key < now.today;
      const list = shifts.filter((s) => s.date === key).sort((a, b) => toMin(a.start) - toMin(b.start));
      const { merged, gaps, covered } = coverage(list);
      const open = gaps.filter((g) => !isPassed(key, g[1], now)).length;
      totalCovered += covered; openSlots += open;
      const card = el("section", "day" + (key === todayIso ? " today" : "") + (pastDay ? " past" : "")); card.id = `day-${key}`;
      const head = el("div", "dayhead");
      const h = el("h3", null, DAYS[i]); h.append(el("span", "date", d.toLocaleDateString(undefined, opts)));
      head.append(h, pastDay ? el("span", "pill", "Past")
        : el("span", open >= 2 ? "pill two" : open === 1 ? "pill one" : "pill ok", open ? `${open} Open` : "Covered"));
      const strip = el("div", "strip"); strip.setAttribute("aria-hidden", "true");
      merged.forEach(([a, b]) => { const s = el("div", "seg"); s.style.left = ((a - DAY_START) / SPAN * 100) + "%"; s.style.width = ((b - a) / SPAN * 100) + "%"; strip.append(s); });
      // Shade time that's already behind us.
      const goneUntil = pastDay ? DAY_END : key === now.today ? Math.min(DAY_END, Math.max(DAY_START, now.min)) : DAY_START;
      if (goneUntil > DAY_START) { const g = el("div", "gone"); g.style.width = ((goneUntil - DAY_START) / SPAN * 100) + "%"; strip.append(g); }
      const ticks = el("div", "ticks"); ["9a", "12p", "3p", "6p", "9p"].forEach((t) => ticks.append(el("span", null, t)));
      const lst = el("div", "list");
      const rows = [...list.map((s) => ({ k: "s", at: toMin(s.start), s })), ...gaps.map((g) => ({ k: "g", at: g[0], g }))]
        .sort((a, b) => a.at - b.at || (a.k === "g" ? 1 : -1));
      rows.forEach((r) => {
        if (r.k === "s") {
          const b = el("button", "shift" + (isPassed(key, toMin(r.s.end), now) ? " passed" : "")); b.type = "button";
          b.append(el("span", "t", `${fmt(toMin(r.s.start))} – ${fmt(toMin(r.s.end))}`), el("span", "n", r.s.name));
          if (r.s.note) b.append(el("span", "note", r.s.note));
          b.setAttribute("aria-label", `Edit ${r.s.name}'s shift`);
          b.onclick = () => withCode(() => openForm(r.s));
          lst.append(b);
        } else {
          const gone = isPassed(key, r.g[1], now);
          const g = el("div", "gaprow" + (gone ? " passed" : "")); g.append(el("span", null, `${fmt(r.g[0])} – ${fmt(r.g[1])}`), el("span", null, gone ? "Passed" : "Open"));
          lst.append(g);
        }
      });
      const nt = el("div", "night"); nt.append(el("span", null, "9 PM – 9 AM"), el("span", null, "Memo, Overnight")); lst.append(nt);
      const add = el("button", "add", "+ Add Shift"); add.type = "button"; add.onclick = () => withCode(() => openForm(null, key));
      card.append(head, strip, ticks, lst, add);
      root.append(card);
    });
    $("hours").textContent = `${Math.round(totalCovered / 6) / 10} / 84 Hrs Covered`;
    const gp = $("gapPill");
    if (iso(dates[6]) < now.today) { gp.className = "pill"; gp.textContent = "Past Week"; return; }
    gp.className = openSlots ? "pill warn" : "pill ok";
    const scope = weekOffset === 0 ? "Left This Week" : "This Week";
    gp.textContent = openSlots ? `${openSlots} Open ${openSlots === 1 ? "Slot" : "Slots"} ${scope}` : "Fully Covered";
  }

  async function load() {
    // Newest request wins, so fast arrow taps never leave another week's shifts on screen.
    const seq = ++loadSeq;
    const [from, to] = currentRange();
    try {
      const rows = await api.list(from, to);
      if (seq !== loadSeq) return;
      shifts = rows;
      $("status").hidden = true;
    } catch {
      if (seq !== loadSeq) return;
      $("status").hidden = false;
      $("status").textContent = "Couldn't load the schedule. Check your connection and reload the page.";
    }
    render();
  }

  // ---- code gate: the shift form never opens without a working family code ----
  let afterCode = null;
  function withCode(fn) {
    if (store.get()) return fn();
    afterCode = fn;
    $("gCode").value = ""; $("gErr").hidden = true;
    $("gScrim").hidden = false;
    setTimeout(() => $("gCode").focus(), 30);
  }
  function closeGate() { $("gScrim").hidden = true; afterCode = null; }
  $("gCancel").onclick = closeGate;
  $("gScrim").addEventListener("click", (e) => { if (e.target === $("gScrim")) closeGate(); });
  $("gForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = $("gCode").value.trim(), err = $("gErr");
    if (!code) { err.textContent = "Enter the family code."; err.hidden = false; return; }
    $("gGo").disabled = true;
    try {
      const res = await api.post({ action: "check" }, code);
      if (res.status === 401) { err.textContent = "That code didn't work. Check it and try again."; err.hidden = false; return; }
      if (res.status !== 200) { err.textContent = "Couldn't check the code. Try again."; err.hidden = false; return; }
      store.set(code);
      const fn = afterCode; closeGate(); render();
      if (fn) fn();
    } catch { err.textContent = "Couldn't check the code. Check your connection."; err.hidden = false; }
    finally { $("gGo").disabled = false; }
  });

  // ---- form ----
  function knownNames() { return [...new Set(shifts.map((s) => s.name))].sort(); }
  function openForm(s, dateKey) {
    editing = s; confirmDel = false;
    $("formTitle").textContent = s ? "Edit Shift" : "Add a Shift";
    $("codeWrap").hidden = !!store.get();
    $("fCode").value = "";
    $("fName").value = s?.name || "";
    $("fDate").value = s?.date || dateKey;
    $("fStart").value = s?.start || "09:00";
    $("fEnd").value = s?.end || "15:00";
    $("fNote").value = s?.note || "";
    $("del").hidden = !s; $("del").textContent = "Remove Shift";
    $("fErr").hidden = true;
    const chips = $("nameChips"); chips.replaceChildren();
    knownNames().forEach((n) => { const c = el("button", null, n); c.type = "button"; c.onclick = () => { $("fName").value = n; }; chips.append(c); });
    $("scrim").hidden = false;
    setTimeout(() => ($("codeWrap").hidden ? $("fName") : $("fCode")).focus(), 30);
  }
  function closeForm() { $("scrim").hidden = true; editing = null; }
  function showErr(m) { const e = $("fErr"); e.textContent = m; e.hidden = false; }

  function currentCode() { return store.get() || $("fCode").value.trim(); }

  async function send(body) {
    const code = currentCode();
    if (!code) { $("codeWrap").hidden = false; showErr("Enter the family code to make changes."); return false; }
    const { status, data } = await api.post(body, code);
    if (status === 401) {
      store.clear(); $("codeWrap").hidden = false; $("fCode").value = "";
      showErr("That family code didn't work. Check it and try again.");
      return false;
    }
    if (status !== 200) { showErr(data?.error ? `Couldn't save: ${data.error}.` : "Couldn't save. Try again."); return false; }
    store.set(code);
    return true;
  }

  document.querySelectorAll(".presets button").forEach((b) => (b.onclick = () => { const [a, z] = b.dataset.p.split("-"); $("fStart").value = a; $("fEnd").value = z; }));
  $("cancel").onclick = closeForm;
  $("scrim").addEventListener("click", (e) => { if (e.target === $("scrim")) closeForm(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("gScrim").hidden) closeGate(); else if (!$("scrim").hidden) closeForm();
  });

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("fName").value.trim(), date = $("fDate").value, start = $("fStart").value, end = $("fEnd").value, note = $("fNote").value.trim();
    if (!name) return showErr("Add a name for who's watching Pop.");
    if (!date) return showErr("Pick a day.");
    if (!start || !end) return showErr("Set a start and end time.");
    if (toMin(end) <= toMin(start)) return showErr("End time has to be after the start time.");
    if (toMin(start) < DAY_START || toMin(end) > DAY_END) return showErr("Day shifts run between 9 AM and 9 PM. Memo covers overnight.");
    $("save").disabled = true;
    try {
      if (await send({ action: "save", shift: { id: editing?.id, name, date, start, end, note } })) { closeForm(); await load(); }
    } catch { showErr("Couldn't save. Check your connection and try again."); }
    finally { $("save").disabled = false; }
  });

  $("del").onclick = async () => {
    if (!editing) return;
    if (!confirmDel) { confirmDel = true; $("del").textContent = "Tap Again to Remove"; return; }
    try { if (await send({ action: "delete", id: editing.id })) { closeForm(); await load(); } }
    catch { showErr("Couldn't remove it. Try again."); }
  };

  $("forget").onclick = () => { store.clear(); render(); };
  const step = (n) => { if (view === "month") monthOffset += n; else weekOffset += n; render(); load(); };
  $("prev").onclick = () => step(-1);
  $("next").onclick = () => step(1);
  $("vWeek").onclick = () => { if (view !== "week") setView("week"); };
  $("vMonth").onclick = () => {
    if (view === "month") return;
    // Open the month that contains the week being viewed.
    const wk = weekDates()[0], now = new Date();
    monthOffset = (wk.getFullYear() - now.getFullYear()) * 12 + wk.getMonth() - now.getMonth();
    setView("month");
  };

  // Keep it fresh when people come back to the tab.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  setInterval(() => { if (!document.hidden && $("scrim").hidden && $("gScrim").hidden) load(); }, 60000);

  // Shared with hours.js
  window.PopBoard = {
    MOCK, api, store, el, fmt, toMin, iso, pad,
    weekDates: () => weekDates(),
    onRender: (f) => weekHooks.push(f),
    rerender: () => render(),
  };

  render();
  load();
})();
