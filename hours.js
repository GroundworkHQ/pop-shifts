// Caregiver Hours: hours log + pay owed for paid helpers (Martha). Behind the family code.
(() => {
  const P = window.PopBoard;
  const $ = (id) => document.getElementById(id);
  const { el, fmt, toMin, iso } = P;
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  let helpers = [], hours = [], loadedKey = "", loading = false;
  let editing = null, editingHelper = null, confirmDel = false, rateEditFor = null;

  // ---- mock backend for ?mock local preview ----
  if (P.MOCK) {
    const mh = [{ id: "00000000-0000-4000-8000-000000000001", name: "Martha", rate: 20 }];
    const rows = [];
    const w = P.weekDates();
    rows.push({ id: crypto.randomUUID(), helperId: mh[0].id, date: iso(w[0]), start: "09:00", end: "15:00", minutes: 360, note: "", paid: false });
    rows.push({ id: crypto.randomUUID(), helperId: mh[0].id, date: iso(w[2]), start: "15:00", end: "21:00", minutes: 360, note: "Took Pop to his appointment", paid: false });
    window.PopMockHours = (b) => {
      const ok = (data = { ok: true }) => ({ status: 200, data });
      if (b.action === "hours_list") return ok({ helpers: mh, hours: rows.filter((r) => r.date >= b.from && r.date <= b.to) });
      if (b.action === "hours_save") {
        const e = b.entry, minutes = ((toMin(e.end) - toMin(e.start)) + 1440) % 1440;
        const r = { ...e, id: e.id || crypto.randomUUID(), minutes, paid: false };
        const i = rows.findIndex((x) => x.id === r.id); i >= 0 ? (rows[i] = { ...rows[i], ...r, paid: rows[i].paid }) : rows.push(r);
        return ok();
      }
      if (b.action === "hours_delete") { const i = rows.findIndex((x) => x.id === b.id); if (i >= 0) rows.splice(i, 1); return ok(); }
      if (b.action === "hours_mark_paid") { rows.forEach((r) => { if (r.helperId === b.helperId && r.date >= b.from && r.date <= b.to) r.paid = b.paid; }); return ok(); }
      if (b.action === "helper_rate") { mh.find((h) => h.id === b.helperId).rate = Number(b.rate); return ok(); }
      return { status: 400, data: { error: "Unknown action" } };
    };
  }

  const range = () => { const d = P.weekDates(); return { from: iso(d[0]), to: iso(d[6]) }; };
  const money = (n) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
  const hrs = (min) => { const h = Math.round(min / 6) / 10; return `${h} ${h === 1 ? "hr" : "hrs"}`; };
  const minutesOf = (start, end) => ((toMin(end) - toMin(start)) + 1440) % 1440;

  async function call(body) {
    const code = P.store.get();
    if (!code) { lock(); return null; }
    const res = await P.api.post(body, code);
    if (res.status === 401) { P.store.clear(); lock("That family code didn't work anymore. Enter it again."); P.rerender(); return null; }
    if (res.status !== 200) throw new Error(res.data?.error || "Request failed");
    return res.data;
  }

  function lock(msg) {
    $("unlock").hidden = false; $("helpers").hidden = true; loadedKey = "";
    const e = $("uErr"); if (msg) { e.textContent = msg; e.hidden = false; } else e.hidden = true;
  }

  async function load(force) {
    if (!P.store.get()) return lock();
    const { from, to } = range(), key = from;
    if (!force && key === loadedKey) return rateEditFor ? undefined : render();
    if (loading) return; loading = true;
    try {
      const data = await call({ action: "hours_list", from, to });
      if (!data) return;
      helpers = data.helpers; hours = data.hours; loadedKey = key;
      $("unlock").hidden = true; $("helpers").hidden = false;
      render();
    } catch {
      $("helpers").hidden = false;
      $("helpers").replaceChildren(el("p", "status", "Couldn't load paid hours. Reload the page to try again."));
    } finally { loading = false; }
  }

  function render() {
    const root = $("helpers"); root.replaceChildren();
    const { from, to } = range();
    helpers.forEach((h) => {
      const mine = hours.filter((r) => r.helperId === h.id).sort((a, b) => a.date.localeCompare(b.date) || toMin(a.start) - toMin(b.start));
      const total = mine.reduce((t, r) => t + r.minutes, 0);
      const unpaid = mine.filter((r) => !r.paid).reduce((t, r) => t + r.minutes, 0);
      const allPaid = mine.length > 0 && unpaid === 0;

      const card = el("section", "day helper");
      const head = el("div", "dayhead");
      head.append(el("h3", null, `${h.name}'s Hours`),
        el("span", mine.length === 0 ? "pill" : allPaid ? "pill ok" : "pill warn",
          mine.length === 0 ? "No Hours Yet" : allPaid ? "Paid" : `${money(unpaid / 60 * h.rate)} Owed`));

      const stats = el("div", "stats");
      const stat = (label, value) => { const s = el("div", "stat"); s.append(el("span", "stat-label", label), el("span", "stat-value", value)); return s; };
      const rateStat = stat("Rate", h.rate ? `${money(h.rate)}/hr` : "Not Set");
      const rateBtn = el("button", "linkish", h.rate ? "Change" : "Set Rate"); rateBtn.type = "button";
      rateBtn.onclick = () => { rateEditFor = h.id; render(); };
      rateStat.append(rateBtn);
      stats.append(stat("This Week", hrs(total)), rateStat, stat("Owed", money(unpaid / 60 * h.rate)));

      card.append(head, stats);

      if (rateEditFor === h.id) {
        const f = el("form", "rate-row"); f.noValidate = true;
        const inp = el("input"); inp.type = "number"; inp.min = "0"; inp.step = "0.5"; inp.inputMode = "decimal";
        inp.id = `rate-${h.id}`; inp.value = h.rate || ""; inp.placeholder = "Hourly rate"; inp.setAttribute("aria-label", `${h.name}'s hourly rate in dollars`);
        const save = el("button", "primary", "Save Rate"); save.type = "submit";
        const cancel = el("button", null, "Cancel"); cancel.type = "button"; cancel.onclick = () => { rateEditFor = null; render(); };
        const err = el("p", "err"); err.hidden = true;
        f.append(el("span", "dollar", "$"), inp, save, cancel);
        f.onsubmit = async (e) => {
          e.preventDefault();
          const v = Number(inp.value);
          if (!inp.value || !Number.isFinite(v) || v < 0) { err.textContent = "Enter a dollar amount, like 20."; err.hidden = false; return; }
          save.disabled = true;
          try { if (await call({ action: "helper_rate", helperId: h.id, rate: v })) { h.rate = Math.round(v * 100) / 100; rateEditFor = null; render(); } }
          catch { err.textContent = "Couldn't save the rate. Try again."; err.hidden = false; }
          finally { save.disabled = false; }
        };
        card.append(f, err);
        setTimeout(() => inp.focus(), 30);
      }

      const list = el("div", "list");
      if (!mine.length) list.append(el("p", "empty", `No hours logged this week. ${h.name} can tap "+ Log Hours" after each visit.`));
      mine.forEach((r) => {
        const d = new Date(r.date + "T12:00:00");
        const b = el("button", "shift entry" + (r.paid ? " is-paid" : "")); b.type = "button";
        const overnight = toMin(r.end) <= toMin(r.start);
        b.append(
          el("span", "t", `${DOW[(d.getDay() + 6) % 7]} ${d.getMonth() + 1}/${d.getDate()}`),
          el("span", "n", `${fmt(toMin(r.start))} – ${fmt(toMin(r.end))}${overnight ? " (Next Day)" : ""}`),
          el("span", "note", r.note ? `${hrs(r.minutes)} · ${r.note}` : hrs(r.minutes)),
        );
        b.setAttribute("aria-label", `Edit hours on ${r.date}`);
        b.onclick = () => openForm(h, r);
        list.append(b);
      });

      const actions = el("div", "helper-actions");
      const add = el("button", "add", "+ Log Hours"); add.type = "button"; add.onclick = () => openForm(h, null);
      actions.append(add);
      if (mine.length) {
        const pay = el("button", allPaid ? "linkish" : "primary", allPaid ? "Mark Week Unpaid" : "Mark Week Paid"); pay.type = "button";
        pay.onclick = async () => {
          pay.disabled = true;
          try { if (await call({ action: "hours_mark_paid", helperId: h.id, from, to, paid: !allPaid })) await load(true); }
          catch { pay.disabled = false; }
        };
        actions.append(pay);
      }
      card.append(list, actions);
      root.append(card);
    });
  }

  // ---- log hours sheet ----
  function updateCalc() {
    const s = $("hStart").value, e = $("hEnd").value;
    if (!s || !e || s === e) { $("hCalc").textContent = "Set a start and end time."; return; }
    const m = minutesOf(s, e);
    $("hCalc").textContent = toMin(e) < toMin(s) ? `${hrs(m)}, ending the next morning` : hrs(m);
  }

  function openForm(h, r) {
    editingHelper = h; editing = r; confirmDel = false;
    $("hTitle").textContent = r ? `Edit ${h.name}'s Hours` : `Log ${h.name}'s Hours`;
    const today = iso(new Date()), { from, to } = range();
    $("hDate").value = r?.date || (today >= from && today <= to ? today : from);
    $("hStart").value = r?.start || "09:00";
    $("hEnd").value = r?.end || "15:00";
    $("hNote").value = r?.note || "";
    $("hDel").hidden = !r; $("hDel").textContent = "Remove Entry";
    $("hErr").hidden = true;
    updateCalc();
    $("hScrim").hidden = false;
    setTimeout(() => $("hDate").focus(), 30);
  }
  function closeForm() { $("hScrim").hidden = true; editing = null; editingHelper = null; }
  function showErr(m) { const e = $("hErr"); e.textContent = m; e.hidden = false; }

  $("hStart").addEventListener("input", updateCalc);
  $("hEnd").addEventListener("input", updateCalc);
  $("hCancel").onclick = closeForm;
  $("hScrim").addEventListener("click", (e) => { if (e.target === $("hScrim")) closeForm(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("hScrim").hidden) closeForm(); });

  $("hForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const date = $("hDate").value, start = $("hStart").value, end = $("hEnd").value, note = $("hNote").value.trim();
    if (!date) return showErr("Pick the day worked.");
    if (!start || !end) return showErr("Set a start and end time.");
    if (start === end) return showErr("Start and end can't be the same time.");
    $("hSave").disabled = true;
    try {
      const ok = await call({ action: "hours_save", entry: { id: editing?.id, helperId: editingHelper.id, date, start, end, note } });
      if (ok) { closeForm(); await load(true); }
    } catch { showErr("Couldn't save. Check your connection and try again."); }
    finally { $("hSave").disabled = false; }
  });

  $("hDel").onclick = async () => {
    if (!editing) return;
    if (!confirmDel) { confirmDel = true; $("hDel").textContent = "Tap Again to Remove"; return; }
    try { if (await call({ action: "hours_delete", id: editing.id })) { closeForm(); await load(true); } }
    catch { showErr("Couldn't remove it. Try again."); }
  };

  // ---- unlock ----
  $("unlock").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = $("uCode").value.trim();
    if (!code) return lock("Enter the family code.");
    try {
      const res = await P.api.post({ action: "check" }, code);
      if (res.status === 401) return lock("That family code didn't work. Check it and try again.");
      if (res.status !== 200) return lock("Couldn't check the code. Try again.");
      P.store.set(code); $("uCode").value = "";
      P.rerender();
    } catch { lock("Couldn't check the code. Check your connection."); }
  });

  P.onRender(() => load(false));
  load(false);
})();
