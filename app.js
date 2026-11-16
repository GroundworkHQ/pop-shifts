(() => {
  const FN_URL = "https://kdgbivcufoarmvckworj.supabase.co/functions/v1/pop-shifts";
  const MOCK = new URLSearchParams(location.search).has("mock");
  const CODE_KEY = "pop-family-code";
  const DAY_START = 9 * 60, DAY_END = 21 * 60, SPAN = DAY_END - DAY_START;
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const $ = (id) => document.getElementById(id);

  let shifts = [], weekOffset = 0, editing = null, confirmDel = false, loading = false;

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

  function coverage(list) {
    const iv = list.map((s) => [Math.max(DAY_START, toMin(s.start)), Math.min(DAY_END, toMin(s.end))])
      .filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const [a, b] of iv) { const l = merged[merged.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else merged.push([a, b]); }
    const gaps = []; let cur = DAY_START;
    for (const [a, b] of merged) { if (a > cur) gaps.push([cur, a]); cur = Math.max(cur, b); }
    if (cur < DAY_END) gaps.push([cur, DAY_END]);
    return { merged, gaps, covered: merged.reduce((t, [a, b]) => t + (b - a), 0) };
  }

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function render() {
    const dates = weekDates(), todayIso = iso(new Date());
    const opts = { month: "short", day: "numeric" };
    const range = `${dates[0].toLocaleDateString(undefined, opts)} – ${dates[6].toLocaleDateString(undefined, opts)}`;
    $("weekLabel").textContent = weekOffset === 0 ? `This week · ${range}` : range;
    $("forget").hidden = !store.get();
    const root = $("days"); root.replaceChildren();
    let totalCovered = 0, openSlots = 0;
    dates.forEach((d, i) => {
      const key = iso(d);
      const list = shifts.filter((s) => s.date === key).sort((a, b) => toMin(a.start) - toMin(b.start));
      const { merged, gaps, covered } = coverage(list);
      totalCovered += covered; openSlots += gaps.length;
      const card = el("section", "day" + (key === todayIso ? " today" : ""));
      const head = el("div", "dayhead");
      const h = el("h3", null, DAYS[i]); h.append(el("span", "date", d.toLocaleDateString(undefined, opts)));
      head.append(h, el("span", gaps.length ? "pill warn" : "pill ok", gaps.length ? `${gaps.length} open` : "Covered"));
      const strip = el("div", "strip"); strip.setAttribute("aria-hidden", "true");
      merged.forEach(([a, b]) => { const s = el("div", "seg"); s.style.left = ((a - DAY_START) / SPAN * 100) + "%"; s.style.width = ((b - a) / SPAN * 100) + "%"; strip.append(s); });
      const ticks = el("div", "ticks"); ["9a", "12p", "3p", "6p", "9p"].forEach((t) => ticks.append(el("span", null, t)));
      const lst = el("div", "list");
      const rows = [...list.map((s) => ({ k: "s", at: toMin(s.start), s })), ...gaps.map((g) => ({ k: "g", at: g[0], g }))]
        .sort((a, b) => a.at - b.at || (a.k === "g" ? 1 : -1));
      rows.forEach((r) => {
        if (r.k === "s") {
          const b = el("button", "shift"); b.type = "button";
          b.append(el("span", "t", `${fmt(toMin(r.s.start))} – ${fmt(toMin(r.s.end))}`), el("span", "n", r.s.name));
          if (r.s.note) b.append(el("span", "note", r.s.note));
          b.setAttribute("aria-label", `Edit ${r.s.name}'s shift`);
          b.onclick = () => openForm(r.s);
          lst.append(b);
        } else {
          const g = el("div", "gaprow"); g.append(el("span", null, `${fmt(r.g[0])} – ${fmt(r.g[1])}`), el("span", null, "Open"));
          lst.append(g);
        }
      });
      const nt = el("div", "night"); nt.append(el("span", null, "9 PM – 9 AM"), el("span", null, "Memo, overnight")); lst.append(nt);
      const add = el("button", "add", "+ Add shift"); add.type = "button"; add.onclick = () => openForm(null, key);
      card.append(head, strip, ticks, lst, add);
      root.append(card);
    });
    $("hours").textContent = `${Math.round(totalCovered / 6) / 10} / 84 hrs covered`;
    const gp = $("gapPill"); gp.className = openSlots ? "pill warn" : "pill ok";
    gp.textContent = openSlots ? `${openSlots} open ${openSlots === 1 ? "slot" : "slots"} this week` : "Fully covered";
  }

  async function load() {
    if (loading) return; loading = true;
    const dates = weekDates();
    try {
      shifts = await api.list(iso(dates[0]), iso(dates[6]));
      $("status").hidden = true;
    } catch {
      $("status").hidden = false;
      $("status").textContent = "Couldn't load the schedule. Check your connection and reload the page.";
    } finally { loading = false; render(); }
  }

  // ---- form ----
  function knownNames() { return [...new Set(shifts.map((s) => s.name))].sort(); }
  function openForm(s, dateKey) {
    editing = s; confirmDel = false;
    $("formTitle").textContent = s ? "Edit shift" : "Add a shift";
    $("codeWrap").hidden = !!store.get();
    $("fCode").value = "";
    $("fName").value = s?.name || "";
    $("fDate").value = s?.date || dateKey;
    $("fStart").value = s?.start || "09:00";
    $("fEnd").value = s?.end || "15:00";
    $("fNote").value = s?.note || "";
    $("del").hidden = !s; $("del").textContent = "Remove shift";
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
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("scrim").hidden) closeForm(); });

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
    if (!confirmDel) { confirmDel = true; $("del").textContent = "Tap again to remove"; return; }
    try { if (await send({ action: "delete", id: editing.id })) { closeForm(); await load(); } }
    catch { showErr("Couldn't remove it. Try again."); }
  };

  $("forget").onclick = () => { store.clear(); render(); };
  $("prev").onclick = () => { weekOffset--; render(); load(); };
  $("next").onclick = () => { weekOffset++; render(); load(); };

  // Keep it fresh when people come back to the tab.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  setInterval(() => { if (!document.hidden && $("scrim").hidden) load(); }, 60000);

  render();
  load();
})();
