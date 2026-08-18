/* Official Hide + Seek map tools */
(function (global) {
  const tools = {};
  let active = null;
  let clicks = [];
  let draft = {};
  let lastHere = null;
  let onNeedRender = () => {};

  function remember(ll) {
    if (!ll || ll.lat == null) return;
    lastHere = { lat: +ll.lat, lng: +ll.lng, at: Date.now() };
  }

  function gpsOk() {
    const host = location.hostname;
    const secure = window.isSecureContext || host === "localhost" || host === "127.0.0.1";
    return !!(navigator.geolocation && secure);
  }

  function locateHere(cb, opts) {
    opts = opts || {};
    if (lastHere && !opts.fresh) cb(lastHere);
    if (!gpsOk()) {
      if (!lastHere) toast("Using GPS needs HTTPS. Tap the map to set where you are.");
      return;
    }
    if (!lastHere || opts.fresh) toast("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        remember(ll);
        cb(ll);
      },
      () => {
        if (lastHere && opts.fresh) cb(lastHere);
        else if (!lastHere) toast("GPS blocked or failed — tap the map to set where you are.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: opts.fresh ? 0 : 20000 }
    );
  }

  function applyHere(ll) {
    remember(ll);
    if (!active || !tools[active] || !tools[active].click) return;
    tools[active].click(ll);
    const m = JLMap.getMap();
    if (m) m.setView([ll.lat, ll.lng], Math.max(m.getZoom(), 13));
  }

  function autoPin(id) {
    if (!["radar", "measuring", "matching", "tentacles", "thermometer"].includes(id)) return;
    let started = false;
    locateHere((ll) => {
      if (active !== id) return;
      if (id === "thermometer") {
        if (started) return;
        started = true;
      }
      applyHere(ll);
    });
  }

  function units() {
    return JLState.get().units === "km" ? "km" : "mi";
  }

  function milesLabel(mi) {
    return JLQuestions.formatMiles(mi, units());
  }

  function playable() {
    return JLState.get().playable;
  }

  function remaining() {
    return JLState.get().remaining;
  }

  function cancel() {
    active = null;
    clicks = [];
    draft = {};
    JLMap.clearPreview();
    JLMap.clearPins();
    JLMap.getMap()?.getContainer().classList.remove("is-picking");
    setInspector("");
    onNeedRender();
  }

  function activate(id) {
    if (active === id) {
      cancel();
      return;
    }
    cancel();
    active = id;
    JLMap.getMap()?.getContainer().classList.add("is-picking");
    renderActive();
    onNeedRender();
    autoPin(id);
  }

  function current() {
    return active;
  }

  function handleClick(latlng) {
    if (!active) return;
    if (["radar", "measuring", "matching", "tentacles", "thermometer"].includes(active)) {
      remember(latlng);
    }
    const fn = tools[active] && tools[active].click;
    if (fn) fn(latlng);
  }

  function applyShape(shape, keepInside, entry) {
    try {
      if (!remaining()) {
        toast("No playable map yet. Pick a country first.");
        return;
      }
      if (!shape) {
        JLState.applyClip(remaining(), Object.assign({ nullAnswer: true }, entry));
        cancel();
        return;
      }
      const next = keepInside ? JLGeo.clipKeep(remaining(), shape) : JLGeo.clipCut(remaining(), shape);
      if (!next) {
        toast("That would erase the whole remaining area. Adjust the answer or undo.");
        return;
      }
      JLState.applyClip(next, entry);
      const s = JLState.get();
      if (window.JLMap) {
        JLMap.paintMasks(s.playable, s.remaining);
        JLMap.clearPreview();
      }
      cancel();
      toast(keepInside ? "Kept that area." : "Cut that area.");
    } catch (err) {
      console.error(err);
      toast("Could not apply that cut. Try a smaller radar or undo.");
    }
  }

  function toast(msg) {
    const el = document.getElementById("jl-toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("is-on");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("is-on"), 3200);
  }

  /* ---------- Styled confirm dialog (replaces window.confirm) ---------- */
  let confirmResolve = null;
  let confirmReturnFocus = null;

  function ensureConfirmDom() {
    let host = document.getElementById("jl-confirm");
    if (host) return host;
    host = document.createElement("div");
    host.id = "jl-confirm";
    host.className = "modal";
    host.hidden = true;
    host.innerHTML = `
      <div class="modal__card modal__card--confirm" role="alertdialog" aria-modal="true" aria-labelledby="jl-confirm-title">
        <h2 id="jl-confirm-title"></h2>
        <p class="hint" id="jl-confirm-msg"></p>
        <div class="actions actions--end">
          <button type="button" class="btn btn-ghost" data-c="no">Cancel</button>
          <button type="button" class="btn btn-amber" data-c="yes">Confirm</button>
        </div>
      </div>`;
    const settle = (v) => {
      host.hidden = true;
      const r = confirmResolve;
      confirmResolve = null;
      if (confirmReturnFocus && confirmReturnFocus.focus) {
        try { confirmReturnFocus.focus(); } catch { /* ignore */ }
      }
      confirmReturnFocus = null;
      if (r) r(v);
    };
    host._settle = settle;
    host.addEventListener("click", (e) => {
      if (e.target === host) return settle(false);
      const b = e.target.closest("[data-c]");
      if (b) settle(b.getAttribute("data-c") === "yes");
    });
    document.addEventListener("keydown", (e) => {
      if (host.hidden) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        settle(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const no = host.querySelector('[data-c="no"]');
        settle(document.activeElement !== no);
      }
    }, true);
    document.body.appendChild(host);
    return host;
  }

  function confirmDialog(message, opts) {
    opts = opts || {};
    const host = ensureConfirmDom();
    if (confirmResolve) host._settle(false);
    return new Promise((resolve) => {
      confirmResolve = resolve;
      confirmReturnFocus = document.activeElement;
      host.querySelector("#jl-confirm-title").textContent = opts.title || "Are you sure?";
      const msgEl = host.querySelector("#jl-confirm-msg");
      msgEl.textContent = message || "";
      msgEl.hidden = !message;
      const yes = host.querySelector('[data-c="yes"]');
      yes.textContent = opts.confirmLabel || "Confirm";
      yes.className = "btn " + (opts.danger ? "btn-rose" : "btn-amber");
      host.hidden = false;
      yes.focus();
    });
  }

  function inspectorRoot() {
    return document.getElementById("jl-inspector");
  }

  function setInspector(html) {
    const root = inspectorRoot();
    if (!root) return;
    root.innerHTML = html
      ? `<button type="button" class="inspector-close" data-act="cancel" aria-label="Close">×</button>` + html
      : "";
    root.hidden = !html;
    if (window.L) {
      L.DomEvent.disableClickPropagation(root);
      L.DomEvent.disableScrollPropagation(root);
    }
    bindInspector();
  }

  function bindInspector() {
    const root = inspectorRoot();
    if (!root) return;
    root.querySelectorAll("[data-act]").forEach((btn) => {
      const fire = (ev) => {
        if (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
        }
        if (btn._jlLock) return;
        btn._jlLock = true;
        setTimeout(() => { btn._jlLock = false; }, 400);
        const act = btn.getAttribute("data-act");
        if (act === "cancel") cancel();
        else if (act === "ask") sendAsk(active);
        else if (act === "gps") {
          toast("Finding you…");
          locateHere((ll) => applyHere(ll), { fresh: true });
        } else if (tools[active] && tools[active].act) tools[active].act(act, btn);
        else toast("Waiting for GPS… or tap the map.");
      };
      btn.addEventListener("click", fire);
      btn.addEventListener("pointerup", fire);
    });
    root.querySelectorAll("[data-field]").forEach((el) => {
      el.addEventListener("change", () => {
        draft[el.getAttribute("data-field")] = el.value;
        if (tools[active] && tools[active].change) tools[active].change("change");
      });
      el.addEventListener("input", () => {
        draft[el.getAttribute("data-field")] = el.value;
        if (tools[active] && tools[active].change) tools[active].change("input");
      });
    });
  }

  function sel(name, options, value) {
    const opts = options.map((o) => {
      const v = String(o.value);
      const sel = String(value) === v ? " selected" : "";
      return `<option value="${v}"${sel}>${o.label}</option>`;
    }).join("");
    return `<label class="field"><span>${name}</span><select data-field="${name.toLowerCase().replace(/\s+/g, "-")}">${opts}</select></label>`;
  }

  function linked() {
    return !!(window.JLNet && JLNet.hasHider());
  }

  function askRow(options, opts) {
    opts = opts || {};
    const top = [];
    if (!opts.noGps) {
      top.push(`<button class="btn btn-ghost" data-act="gps" type="button">${opts.gpsLabel || "Use my location"}</button>`);
    }
    top.push(`<button class="btn btn-ghost" data-act="cancel" type="button">Cancel</button>`);
    if (linked()) {
      top.push(`<button class="btn btn-amber" data-act="ask" type="button">Ask the hider</button>`);
      return `<div class="actions">${top.join("")}</div>`;
    }
    const apply = (options || []).map((o) =>
      `<button class="btn ${o.cls || "btn-ghost"}" data-act="${o.act}" type="button">${o.label}</button>`
    ).join("");
    return `<div class="actions">${top.join("")}</div><div class="actions">${apply}</div>`;
  }

  function waitingInspector(title) {
    setInspector(`
      <header><div class="kicker">Waiting on the hider</div>
      <h3>${escapeHtml(title)}</h3></header>
      <p class="hint">This is on their phone. The map updates when they answer — or they veto / randomize.</p>`);
  }

  function sendAsk(kind) {
    if (window.JLNet && JLNet.room && JLNet.room.pendingQuestion) {
      return toast("A question is already waiting for an answer.");
    }
    const room = window.JLNet && JLNet.room;
    if (room && room.disabledCategory === kind) {
      return toast("Spotty Memory has " + kind + " questions disabled until the next ask.");
    }
    if (room && (room.bannedQuestions || []).some((b) => String(b).startsWith(kind + ":"))) {
      toast("Drained Brain banned some " + kind + " questions — don’t reuse a banned one.");
    }
    if (room && JLDeck && JLDeck.blockingActive(room.activeCurses || [])) {
      const block = (room.activeCurses || []).find((c) => c.blocksQuestions);
      if (block) toast(block.name + " is still blocking questions unless they have cleared it.");
    }
    const q = buildQuestion(kind);
    if (!q) return;
    if (!window.JLApp || !JLApp.askHider) return toast("Start a linked game from the home screen first.");
    JLApp.askHider(q);
    waitingInspector(q.title);
  }

  function buildQuestion(kind) {
    const cost = JLQuestions.COSTS[kind];
    if (!cost) return null;
    const extra = !!(window.JLNet && JLNet.room && JLNet.room.overflowingLeft > 0);
    const draw = cost.draw + (extra ? 1 : 0);
    const keep = cost.keep;
    const mins = kind === "photo" ? (JLQuestions.SIZES[JLState.get().size].photoSeconds / 60) : 5;
    const base = {
      kind,
      cost: `Draw ${draw}, keep ${keep}`,
      draw,
      keep,
      deadline: Date.now() + mins * 60 * 1000,
      apply: {
        tool: kind,
        draft: Object.assign({}, draft),
        clicks: clicks.map((c) => ({ lat: c.lat, lng: c.lng })),
      },
    };
    if (kind === "radar") {
      if (!clicks[0]) { toast("Pin your location first."); return null; }
      const miles = Number(draft.miles === "custom" ? draft.custom : draft.miles);
      if (!miles) { toast("Pick a radius."); return null; }
      return Object.assign(base, {
        title: JLQuestions.promptFor("radar", milesLabel(miles)),
        detail: milesLabel(miles),
        hint: "Radar is your current spot, not your hiding zone.",
        options: [
          { id: "yes", label: "Yes — I am inside", primary: true },
          { id: "no", label: "No — I am outside" },
        ],
      });
    }
    if (kind === "thermometer") {
      if (clicks.length < 2) { toast("Set a start and an end first."); return null; }
      const need = Number(draft.min || 0);
      const traveled = JLGeo.distMiles(clicks[0], clicks[1]);
      if (need && traveled + 0.02 < need) {
        toast(`This thermometer needs at least ${milesLabel(need)} (you’ve gone ${milesLabel(round1(traveled))}).`);
        return null;
      }
      return Object.assign(base, {
        title: JLQuestions.promptFor("thermometer", milesLabel(need || traveled)),
        detail: `${milesLabel(round1(traveled))} traveled`,
        hint: "Hotter means they moved closer to you.",
        options: [
          { id: "hotter", label: "Hotter", primary: true },
          { id: "colder", label: "Colder" },
        ],
      });
    }
    if (kind === "measuring") {
      if (!clicks[0]) { toast("Pin your location first."); return null; }
      const subject = draft.subject || "airport";
      return Object.assign(base, {
        title: JLQuestions.promptFor("measuring", labelOf(JLQuestions.MEASURING, subject)),
        detail: subject,
        hint: "Compared to the seekers, closer or further from that feature.",
        options: [
          { id: "closer", label: "Closer", primary: true },
          { id: "further", label: "Further" },
        ],
      });
    }
    if (kind === "matching") {
      if (!clicks[0]) { toast("Pin your location first."); return null; }
      const subject = draft.subject || "airport";
      return Object.assign(base, {
        title: JLQuestions.promptFor("matching", labelOf(JLQuestions.MATCHING, subject)),
        detail: subject,
        hint: "Is your nearest the same as theirs?",
        options: [
          { id: "yes", label: "Yes — same as you", primary: true },
          { id: "no", label: "No — different" },
        ],
      });
    }
    if (kind === "tentacles") {
      if (JLState.get().size === "S") { toast("Tentacles are not used in Small games."); return null; }
      if (!clicks[0]) { toast("Pin your location first."); return null; }
      const list = JLQuestions.tentaclesFor(JLState.get().size);
      const spec = list.find((t) => t.id === draft.tentacle) || list[0];
      if (!spec) return null;
      return Object.assign(base, {
        title: JLQuestions.promptFor("tentacles", { label: spec.label, miles: milesLabel(spec.miles) }),
        detail: spec.id,
        hint: "Name the nearest one if you are within reach, otherwise say you are not.",
        options: [{ id: "miss", label: "Not within reach" }],
      });
    }
    if (kind === "photo") {
      const list = JLQuestions.photosFor(JLState.get().size);
      const spec = list.find((p) => p.id === draft.photo) || list[0];
      if (!spec) return null;
      return Object.assign(base, {
        title: JLQuestions.promptFor("photo", spec.label),
        detail: spec.label,
        hint: spec.tip || "No Street View. Send the photo in your usual chat.",
        options: [{ id: "cannot", label: "I cannot answer" }],
      });
    }
    return null;
  }

  function showHiderPhoto(answer) {
    let host = document.getElementById("jl-photo");
    if (!host) {
      host = document.createElement("div");
      host.id = "jl-photo";
      host.className = "modal";
      host.hidden = true;
      host.innerHTML = `
        <div class="modal__card modal__card--photo">
          <div class="kicker" id="jl-photo-kicker">Photo</div>
          <h2 id="jl-photo-title"></h2>
          <img id="jl-photo-img" alt="Photo from the hider">
          <p class="hint" id="jl-photo-note"></p>
          <div class="actions actions--end">
            <button type="button" class="btn btn-amber" data-close>Close</button>
          </div>
        </div>`;
      host.addEventListener("click", (e) => {
        if (e.target === host || e.target.closest("[data-close]")) host.hidden = true;
      });
      document.addEventListener("keydown", (e) => {
        if (!host.hidden && e.key === "Escape") {
          e.stopPropagation();
          host.hidden = true;
        }
      }, true);
      document.body.appendChild(host);
    }
    const kicker = host.querySelector("#jl-photo-kicker");
    if (kicker) kicker.textContent = answer.kicker || (answer.kind === "photo" ? "Photo from the hider" : "Photo");
    host.querySelector("#jl-photo-title").textContent = answer.title || "Photo";
    host.querySelector("#jl-photo-img").src = answer.photo;
    const noteEl = host.querySelector("#jl-photo-note");
    noteEl.textContent = answer.note || "";
    noteEl.hidden = !answer.note;
    host.hidden = false;
  }

  function applyRemoteAnswer(answer) {
    if (!answer) return;
    if (answer.kind === "photo" && answer.photo) showHiderPhoto(answer);
    if (answer.via === "veto") {
      JLState.applyClip(remaining(), {
        kind: answer.kind,
        title: answer.title,
        answer: "Vetoed",
        cost: "No cards",
      });
      cancel();
      toast("Hider vetoed. No map change.");
      return;
    }
    if (answer.via === "randomize") {
      toast("Hider randomized. Ask a different " + (answer.kind || "") + " question — the original is not used.");
      if (answer.kind) activate(answer.kind);
      return;
    }
    const apply = answer.apply || {};
    const tool = apply.tool || answer.kind;
    draft = Object.assign({}, apply.draft || {});
    clicks = (apply.clicks || []).map((c) => ({ lat: c.lat, lng: c.lng }));
    if (clicks[0]) {
      JLMap.clearPins();
      clicks.forEach((c, i) => JLMap.addPin(c, i === 0 ? "Start" : "End"));
    }
    active = tool;
    const a = String(answer.answer || "").toLowerCase();
    let act = a;
    if (tool === "radar" || tool === "matching") act = a === "yes" ? "yes" : "no";
    else if (tool === "thermometer") act = a === "hotter" ? "hotter" : "colder";
    else if (tool === "measuring") act = a === "closer" ? "closer" : "further";
    else if (tool === "tentacles") {
      if (a === "miss") act = "miss";
      else {
        draft.which = answer.note || answer.answer;
        act = "named";
      }
    } else if (tool === "photo") act = a === "cannot" ? "cannot" : "sent";
    if (tools[tool] && tools[tool].act && act) tools[tool].act(act);
    else {
      JLState.applyClip(remaining(), {
        kind: answer.kind,
        title: answer.title,
        answer: [answer.answer, answer.note].filter(Boolean).join(" · "),
        cost: answer.cost,
      });
      cancel();
    }
  }

  /* ---------- RADAR ---------- */
  tools.radar = {
    click(latlng) {
      clicks = [latlng];
      JLMap.clearPins();
      JLMap.addPin(latlng, "Radar");
      draft.miles = draft.miles || "5";
      previewRadar();
      renderRadar();
    },
    change(why) { previewRadar(); if (why !== "input") renderRadar(); },
    act(act) {
      if (!clicks[0]) return toast("Waiting for GPS… or tap Use my location.");
      const miles = Number(draft.miles === "custom" ? draft.custom : draft.miles);
      if (!miles || miles <= 0) return toast("Pick a radius.");
      const shape = JLGeo.circleMiles(clicks[0], miles);
      const label = milesLabel(miles);
      applyShape(shape, act === "yes", {
        kind: "radar",
        title: JLQuestions.promptFor("radar", label),
        answer: act === "yes" ? "Yes" : "No",
        cost: JLQuestions.costLabel("radar"),
        detail: label,
      });
    },
  };

  function previewRadar() {
    if (!clicks[0]) return;
    const miles = Number(draft.miles === "custom" ? draft.custom : draft.miles);
    if (!miles) return;
    JLMap.showPreview(JLGeo.circleMiles(clicks[0], miles));
  }

  function renderRadar() {
    const opts = JLQuestions.RADAR_MILES.map((m) => ({ value: m, label: milesLabel(m) }));
    opts.push({ value: "custom", label: "Choose…" });
    const custom = draft.miles === "custom"
      ? `<label class="field"><span>Custom ${units()}</span><input data-field="custom" type="number" min="0.05" step="0.05" value="${draft.custom || ""}"></label>`
      : "";
    setInspector(`
      <header><div class="kicker">Radar · ${JLQuestions.costLabel("radar")}</div>
      <h3>Are you within ${draft.miles === "custom" ? "this radius" : milesLabel(Number(draft.miles || 5))} of me?</h3></header>
      <p class="hint">Centered on <em>you</em> (GPS). Radar is the hider’s current spot, not their zone.</p>
      ${sel("Miles", opts, draft.miles || "5")}
      ${custom}
      ${askRow([
        { act: "no", label: "No — cut inside", cls: "btn-rose" },
        { act: "yes", label: "Yes — keep inside", cls: "btn-amber" },
      ])}`);
    draft.miles = draft.miles || "5";
  }

  /* ---------- THERMOMETER ---------- */
  tools.thermometer = {
    click(latlng) {
      if (clicks.length >= 2) clicks = [];
      clicks.push(latlng);
      JLMap.clearPins();
      JLMap.addPin(clicks[0], "Start");
      if (clicks[1]) JLMap.addPin(clicks[1], "End");
      previewThermo();
      renderThermo();
    },
    change(why) { previewThermo(); if (why !== "input") renderThermo(); },
    act(act) {
      if (clicks.length < 2) return toast("Click a start and an end.");
      const traveled = JLGeo.distMiles(clicks[0], clicks[1]);
      const need = Number(draft.min || 0);
      if (need && traveled + 0.02 < need) {
        return toast(`This thermometer needs at least ${milesLabel(need)} (you’ve gone ${milesLabel(round1(traveled))}).`);
      }
      const hotter = act === "hotter";
      const shape = JLGeo.halfPlane(clicks[0], clicks[1], hotter, 2500);
      applyShape(shape, true, {
        kind: "thermometer",
        title: JLQuestions.promptFor("thermometer", milesLabel(need || traveled)),
        answer: hotter ? "Hotter" : "Colder",
        cost: JLQuestions.costLabel("thermometer"),
        detail: `${milesLabel(round1(traveled))} traveled`,
      });
    },
  };

  function previewThermo() {
    if (clicks.length < 2) {
      JLMap.clearPreview();
      return;
    }
    const hotter = draft.preview !== "colder";
    const shape = JLGeo.halfPlane(clicks[0], clicks[1], hotter, 2500);
    const clipped = JLGeo.safeIntersect(shape, remaining());
    JLMap.showPreview(clipped || shape);
  }

  function renderThermo() {
    const size = JLState.get().size;
    const allowed = JLQuestions.thermosFor(size);
    const opts = allowed.map((m) => ({ value: m, label: milesLabel(m) + " minimum" }));
    const traveled = clicks.length === 2 ? JLGeo.distMiles(clicks[0], clicks[1]) : 0;
    setInspector(`
      <header><div class="kicker">Thermometer · ${JLQuestions.costLabel("thermometer")}</div>
      <h3>After traveling ${milesLabel(Number(draft.min || allowed[0]))}, am I hotter or colder?</h3></header>
      <p class="hint">Starts on your GPS. Travel, then tap <em>End at my location</em>. Hotter = you moved closer.</p>
      ${sel("Min", opts, draft.min || allowed[0])}
      <div class="stat">${clicks.length < 2 ? (clicks.length === 1 ? "Start pinned. Travel, then use my location again." : "Finding you for the start…") : `Traveled ${milesLabel(round1(traveled))} as the crow flies.`}</div>
      ${askRow([
        { act: "colder", label: "Colder", cls: "btn-rose" },
        { act: "hotter", label: "Hotter", cls: "btn-amber" },
      ], { gpsLabel: clicks.length === 1 ? "End at my location" : "Start at my location" })}`);
    draft.min = draft.min || String(allowed[0]);
  }

  /* ---------- MEASURING ---------- */
  tools.measuring = {
    click(latlng) {
      clicks = [latlng];
      JLMap.clearPins();
      JLMap.addPin(latlng, "Seeker");
      renderMeasuring();
    },
    change(why) { if (why !== "input") renderMeasuring(); },
    async act(act) {
      if (!clicks[0]) return toast("Click your position first.");
      const subject = draft.subject || "airport";
      if (subject === "sea-level") {
        JLState.applyClip(remaining(), {
          kind: "measuring",
          title: JLQuestions.promptFor("measuring", "sea level"),
          answer: act === "closer" ? "Closer (logged — altitude is not mapped)" : "Further (logged — altitude is not mapped)",
          cost: JLQuestions.costLabel("measuring"),
          nullAnswer: true,
        });
        cancel();
        return;
      }
      toast("Looking up " + subject + "…");
      try {
        const shape = await measuringShape(clicks[0], subject);
        if (!shape) {
          JLState.applyClip(remaining(), {
            kind: "measuring",
            title: JLQuestions.promptFor("measuring", labelOf(JLQuestions.MEASURING, subject)),
            answer: "Null — none inside the map",
            cost: JLQuestions.costLabel("measuring"),
            nullAnswer: true,
          });
          toast("No such feature inside the map. Null answer — cards still count.");
          cancel();
          return;
        }
        applyShape(shape, act === "closer", {
          kind: "measuring",
          title: JLQuestions.promptFor("measuring", labelOf(JLQuestions.MEASURING, subject)),
          answer: act === "closer" ? "Closer" : "Further",
          cost: JLQuestions.costLabel("measuring"),
        });
      } catch (err) {
        toast(err.message || "Lookup failed");
      }
    },
  };

  async function measuringShape(origin, subject) {
    const bbox = tightBbox();
    if (["airport", "mountain", "park", "amusement", "zoo", "aquarium", "golf", "museum", "theater", "hospital", "library", "consulate", "rail-station"].includes(subject)) {
      const { points } = await JLOverpass.pois(subject, bbox);
      const inside = JLOverpass.filterIn(playable(), points);
      const near = JLGeo.nearestPoint(origin, inside);
      if (!near) return null;
      JLMap.addPin({ lat: near.point.lat, lng: near.point.lng }, near.point.name);
      const shape = JLGeo.circleMiles({ lat: near.point.lat, lng: near.point.lng }, near.miles);
      JLMap.showPreview(shape);
      return shape;
    }
    if (subject === "coastline" || subject === "hsr" || subject === "water") {
      const { points, lines } = await JLOverpass.pois(subject === "water" ? "water" : subject, bbox);
      const feats = [];
      lines.forEach((l) => {
        const f = JLGeo.lineFromCoords(l.coords);
        if (f) feats.push(f);
      });
      points.forEach((p) => feats.push(JLGeo.pointFeature(p.lat, p.lng, { name: p.name })));
      if (!feats.length) return null;
      const originPt = JLGeo.pt(origin);
      let bestD = Infinity;
      let bestF = null;
      feats.forEach((f) => {
        try {
          const d = turf.pointToLineDistance
            ? (f.geometry.type === "LineString" ? turf.pointToLineDistance(originPt, f, { units: "miles" }) : JLGeo.distMiles(origin, { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }))
            : JLGeo.distMiles(origin, { lat: f.geometry.coordinates[1] || 0, lng: f.geometry.coordinates[0] || 0 });
          if (d < bestD) { bestD = d; bestF = f; }
        } catch { /* skip */ }
      });
      if (!bestF || !isFinite(bestD)) return null;
      const buf = JLGeo.bufferMiles(bestF, Math.max(bestD, 0.05));
      JLMap.showPreview(buf);
      return buf;
    }
    if (subject === "intl-border" || subject === "admin1-border" || subject === "admin2-border") {
      const feats = await JLOverpass.adminBorders(subject, bbox);
      if (!feats.length) return null;
      const originPt = JLGeo.pt(origin);
      let bestD = Infinity;
      let bestF = null;
      feats.forEach((f) => {
        try {
          const snapped = turf.nearestPointOnLine
            ? turf.nearestPointOnLine(turf.polygonToLine(f), originPt, { units: "miles" })
            : null;
          const d = snapped ? snapped.properties.dist : 999;
          if (d < bestD) { bestD = d; bestF = f; }
        } catch { /* skip */ }
      });
      if (!bestF) return null;
      const buf = JLGeo.bufferMiles(bestF, Math.max(bestD, 0.1));
      JLMap.showPreview(buf);
      return buf;
    }
    return null;
  }

  function renderMeasuring() {
    const opts = JLQuestions.MEASURING.map((m) => ({ value: m.id, label: m.label }));
    const meta = JLQuestions.MEASURING.find((m) => m.id === (draft.subject || "airport"));
    setInspector(`
      <header><div class="kicker">Measuring · ${JLQuestions.costLabel("measuring")}</div>
      <h3>Compared to me, closer or further from ${meta ? meta.label.toLowerCase() : "…"}?</h3></header>
      <p class="hint">${meta?.tip || "Measure to the map icon. Features outside the map do not exist."}</p>
      ${sel("Subject", opts, draft.subject || "airport")}
      <div class="stat">${clicks[0] ? "Using your location. Apply when you have an answer." : "Finding you…"}</div>
      ${askRow([
        { act: "further", label: "Further", cls: "btn-rose" },
        { act: "closer", label: "Closer", cls: "btn-amber" },
      ])}`);
    draft.subject = draft.subject || "airport";
  }

  /* ---------- MATCHING ---------- */
  tools.matching = {
    click(latlng) {
      clicks = [latlng];
      JLMap.clearPins();
      JLMap.addPin(latlng, "Seeker");
      renderMatching();
    },
    change(why) { if (why !== "input") renderMatching(); },
    async act(act) {
      if (!clicks[0]) return toast("Click your position first.");
      const subject = draft.subject || "airport";
      if (subject === "landmass" || subject === "street" || subject === "station-length") {
        JLState.applyClip(remaining(), {
          kind: "matching",
          title: JLQuestions.promptFor("matching", labelOf(JLQuestions.MATCHING, subject)),
          answer: act === "yes" ? "Yes (manual / station filter)" : "No (manual / station filter)",
          cost: JLQuestions.costLabel("matching"),
        });
        if (subject === "station-length") toast("Use the station list to compare name lengths. The map is unchanged.");
        cancel();
        return;
      }
      toast("Building nearest-cell…");
      try {
        if (subject.startsWith("admin")) {
          const poly = await JLOverpass.adminAt(clicks[0], subject);
          if (!poly) {
            JLState.applyClip(remaining(), {
              kind: "matching",
              title: JLQuestions.promptFor("matching", labelOf(JLQuestions.MATCHING, subject)),
              answer: "Null — no division found",
              cost: JLQuestions.costLabel("matching"),
              nullAnswer: true,
            });
            toast("No administrative area found.");
            cancel();
            return;
          }
          JLMap.showPreview(poly);
          applyShape(poly, act === "yes", {
            kind: "matching",
            title: JLQuestions.promptFor("matching", labelOf(JLQuestions.MATCHING, subject)),
            answer: act === "yes" ? "Yes" : "No",
            cost: JLQuestions.costLabel("matching"),
          });
          return;
        }
        if (subject === "transit-line") {
          toast("Mark the line: apply Yes to keep a ½-mile corridor around your pin, or drop custom points.");
          const shape = JLGeo.circleMiles(clicks[0], 0.5);
          applyShape(shape, act === "yes", {
            kind: "matching",
            title: JLQuestions.promptFor("matching", "transit line"),
            answer: act === "yes" ? "Yes (½ mi around current ride — refine with stations)" : "No",
            cost: JLQuestions.costLabel("matching"),
          });
          return;
        }
        const bbox = tightBbox();
        const { points } = await JLOverpass.pois(subject, bbox);
        const inside = JLOverpass.filterIn(playable(), points);
        if (!inside.length) {
          JLState.applyClip(remaining(), {
            kind: "matching",
            title: JLQuestions.promptFor("matching", labelOf(JLQuestions.MATCHING, subject)),
            answer: "Null — none inside the map",
            cost: JLQuestions.costLabel("matching"),
            nullAnswer: true,
          });
          toast("No such feature inside the map.");
          cancel();
          return;
        }
        const cells = JLGeo.voronoiCells(inside, turf.bbox(playable()));
        const mine = JLGeo.cellContaining(cells, clicks[0]);
        if (!mine) {
          const near = JLGeo.nearestPoint(clicks[0], inside);
          const cell = near ? JLGeo.bufferMiles(JLGeo.pointFeature(near.point.lat, near.point.lng), 8) : null;
          applyShape(cell, act === "yes", {
            kind: "matching",
            title: JLQuestions.promptFor("matching", labelOf(JLQuestions.MATCHING, subject)),
            answer: (act === "yes" ? "Yes · " : "No · ") + (near?.point.name || ""),
            cost: JLQuestions.costLabel("matching"),
          });
          return;
        }
        JLMap.showPreviewMulti(cells);
        applyShape(mine, act === "yes", {
          kind: "matching",
          title: JLQuestions.promptFor("matching", labelOf(JLQuestions.MATCHING, subject)),
          answer: (act === "yes" ? "Yes · " : "No · ") + (mine.properties?.name || "same cell"),
          cost: JLQuestions.costLabel("matching"),
        });
      } catch (err) {
        toast(err.message || "Lookup failed");
      }
    },
  };

  function renderMatching() {
    const opts = JLQuestions.MATCHING.map((m) => ({ value: m.id, label: m.label }));
    const meta = JLQuestions.MATCHING.find((m) => m.id === (draft.subject || "airport"));
    setInspector(`
      <header><div class="kicker">Matching · ${JLQuestions.costLabel("matching")}</div>
      <h3>Is your nearest ${meta ? meta.label.toLowerCase() : "…"} the same as mine?</h3></header>
      <p class="hint">${meta?.tip || "Features outside the map do not exist. Null still awards cards."}</p>
      ${sel("Subject", opts, draft.subject || "airport")}
      ${askRow([
        { act: "no", label: "No — cut my cell", cls: "btn-rose" },
        { act: "yes", label: "Yes — keep my cell", cls: "btn-amber" },
      ])}`);
    draft.subject = draft.subject || "airport";
  }

  /* ---------- TENTACLES ---------- */
  tools.tentacles = {
    click(latlng) {
      clicks = [latlng];
      JLMap.clearPins();
      JLMap.addPin(latlng, "Seeker");
      renderTentacles();
    },
    change(why) { if (why !== "input") renderTentacles(); },
    async act(act) {
      if (JLState.get().size === "S") return toast("Tentacles are not used in Small games.");
      if (!clicks[0]) return toast("Click your position first.");
      const list = JLQuestions.tentaclesFor(JLState.get().size);
      const spec = list.find((t) => t.id === draft.tentacle) || list[0];
      if (!spec) return;
      toast("Reaching for " + spec.label.toLowerCase() + "…");
      try {
        const bbox = JLOverpass.bboxFromLatLngRadius(clicks[0], spec.miles);
        if (spec.poi === "metro") {
          const { lines } = await JLOverpass.pois("metro", bbox);
          if (act === "miss" || !lines.length) {
            applyShape(JLGeo.circleMiles(clicks[0], spec.miles), false, {
              kind: "tentacles",
              title: JLQuestions.promptFor("tentacles", { label: spec.label, miles: milesLabel(spec.miles) }),
              answer: lines.length ? "Not within reach" : "Null — no metro lines",
              cost: JLQuestions.costLabel("tentacles"),
            });
            return;
          }
          toast("Named a metro line — keep a ½-mile buffer around fetched lines inside the circle.");
          const feats = lines.map((l) => JLGeo.bufferMiles(JLGeo.lineFromCoords(l.coords), 0.4)).filter(Boolean);
          const union = JLGeo.unionAll(feats);
          const clipped = JLGeo.safeIntersect(union, JLGeo.circleMiles(clicks[0], spec.miles));
          applyShape(clipped || union, true, {
            kind: "tentacles",
            title: JLQuestions.promptFor("tentacles", { label: spec.label, miles: milesLabel(spec.miles) }),
            answer: "A metro line inside reach",
            cost: JLQuestions.costLabel("tentacles"),
          });
          return;
        }
        const { points } = await JLOverpass.pois(spec.poi, bbox);
        const circle = JLGeo.circleMiles(clicks[0], spec.miles);
        const inside = points.filter((p) => JLGeo.contains(circle, p) && JLGeo.contains(playable(), p));
        if (act === "miss" || !inside.length) {
          applyShape(circle, false, {
            kind: "tentacles",
            title: JLQuestions.promptFor("tentacles", { label: spec.label, miles: milesLabel(spec.miles) }),
            answer: inside.length ? "Not within reach" : "Null — none in reach",
            cost: JLQuestions.costLabel("tentacles"),
          });
          return;
        }
        const name = (draft.which || "").trim();
        let chosen = name
          ? inside.find((p) => p.name.toLowerCase() === name.toLowerCase()) ||
            inside.find((p) => p.name.toLowerCase().includes(name.toLowerCase()))
          : null;
        if (!chosen && act === "named") {
          fillTentacleChoices(inside, spec);
          return toast("Pick which one they named.");
        }
        if (act.startsWith("pick:")) {
          chosen = inside.find((p) => p.id === act.slice(5));
        }
        if (!chosen) chosen = inside[0];
        const cells = JLGeo.voronoiCells(inside, turf.bbox(circle));
        let cell = cells.find((c) => c.properties && (c.properties.id === chosen.id || c.properties.name === chosen.name));
        if (!cell) cell = JLGeo.cellContaining(cells, { lat: chosen.lat, lng: chosen.lng });
        const keep = cell ? JLGeo.safeIntersect(cell, circle) : JLGeo.circleMiles(chosen, 2);
        applyShape(keep || circle, true, {
          kind: "tentacles",
          title: JLQuestions.promptFor("tentacles", { label: spec.label, miles: milesLabel(spec.miles) }),
          answer: chosen.name,
          cost: JLQuestions.costLabel("tentacles"),
        });
      } catch (err) {
        toast(err.message || "Lookup failed");
      }
    },
  };

  function fillTentacleChoices(inside, spec) {
    const buttons = inside.slice(0, 16).map((p) =>
      `<button class="btn btn-ghost btn-block" data-act="pick:${p.id}">${escapeHtml(p.name)}</button>`
    ).join("");
    setInspector(`
      <header><div class="kicker">Tentacles · ${JLQuestions.costLabel("tentacles")}</div>
      <h3>Which ${spec.label.toLowerCase()}?</h3></header>
      <p class="hint">${inside.length} in reach. Choose the name the hider gave you.</p>
      <div class="stack">${buttons}</div>
      <div class="actions"><button class="btn btn-ghost" data-act="cancel">Cancel</button></div>`);
  }

  function renderTentacles() {
    const size = JLState.get().size;
    const list = JLQuestions.tentaclesFor(size);
    if (!list.length) {
      setInspector(`<header><h3>Tentacles</h3></header><p class="hint">Not used in Small games. Switch to Medium or Large in a new game.</p>
        <div class="actions"><button class="btn btn-ghost" data-act="cancel">Close</button></div>`);
      return;
    }
    const opts = list.map((t) => ({ value: t.id, label: `${t.label} · ${milesLabel(t.miles)}` }));
    const spec = list.find((t) => t.id === draft.tentacle) || list[0];
    setInspector(`
      <header><div class="kicker">Tentacles · ${JLQuestions.costLabel("tentacles")}</div>
      <h3>Within ${milesLabel(spec.miles)}, which ${spec.label.toLowerCase()} are you nearest to?</h3></header>
      <p class="hint">${spec.tip || "If they are not within reach, cut the whole circle. High cost, high density."}</p>
      ${sel("Tentacle", opts, spec.id)}
      <label class="field"><span>Named location</span><input data-field="which" placeholder="e.g. Louvre" value="${escapeHtml(draft.which || "")}"></label>
      ${askRow([
        { act: "miss", label: "Not in reach", cls: "btn-rose" },
        { act: "named", label: "They named one", cls: "btn-amber" },
      ])}`);
    draft.tentacle = spec.id;
  }

  /* ---------- HIDING ZONE ---------- */
  tools.zone = {
    click(latlng) {
      clicks = [latlng];
      JLMap.clearPins();
      JLMap.addPin(latlng, "Zone");
      const miles = JLQuestions.SIZES[JLState.get().size].zoneMiles;
      JLMap.showPreview(JLGeo.circleMiles(latlng, miles), { color: "#7dd3c0", fillColor: "#7dd3c0" });
      renderZone(latlng);
    },
    act(act) {
      if (act !== "drop" || !clicks[0]) return;
      const miles = JLQuestions.SIZES[JLState.get().size].zoneMiles;
      const zone = {
        id: "z-" + Date.now(),
        lat: clicks[0].lat,
        lng: clicks[0].lng,
        miles,
        name: draft.zname || "Hiding zone",
      };
      JLState.addZone(zone);
      JLState.applyClip(remaining(), {
        kind: "zone",
        title: `Hiding zone · ${zone.name}`,
        answer: milesLabel(miles) + " radius",
        cost: "—",
        zoneId: zone.id,
      });
      cancel();
    },
  };

  function renderZone(latlng) {
    const miles = JLQuestions.SIZES[JLState.get().size].zoneMiles;
    setInspector(`
      <header><div class="kicker">Hiding zone</div>
      <h3>${milesLabel(miles)} around a station</h3></header>
      <p class="hint">Center must be a station in play. Click a station marker or any point.</p>
      <label class="field"><span>Label</span><input data-field="zname" placeholder="Station name" value="${escapeHtml(draft.zname || "")}"></label>
      <div class="stat">${latlng ? `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}` : "Click the map"}</div>
      <div class="actions">
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
        <button class="btn btn-teal" data-act="drop">Drop zone</button>
      </div>`);
  }

  function placeZoneOnStation(station) {
    activate("zone");
    draft.zname = station.name;
    tools.zone.click({ lat: station.lat, lng: station.lng });
  }

  /* ---------- PHOTO ---------- */
  tools.photo = {
    click() { renderPhoto(); },
    act(act) {
      const list = JLQuestions.photosFor(JLState.get().size);
      const spec = list.find((p) => p.id === draft.photo) || list[0];
      if (!spec) return;
      JLState.applyClip(remaining(), {
        kind: "photo",
        title: JLQuestions.promptFor("photo", spec.label),
        answer: act === "cannot" ? "Cannot answer" : "Photo sent",
        cost: JLQuestions.costLabel("photo"),
      });
      cancel();
    },
  };

  function renderPhoto() {
    const size = JLState.get().size;
    const list = JLQuestions.photosFor(size);
    const opts = list.map((p) => ({ value: p.id, label: p.label }));
    const spec = list.find((p) => p.id === draft.photo) || list[0];
    const secs = JLQuestions.SIZES[size].photoSeconds;
    setInspector(`
      <header><div class="kicker">Photo · ${JLQuestions.costLabel("photo")} · ${secs / 60} min</div>
      <h3>Send me a photo of ${spec ? spec.label.toLowerCase() : "…"}</h3></header>
      <p class="hint">${spec?.tip || "No Street View. Normal aspect ratio."}</p>
      ${sel("Photo", opts, spec?.id)}
      ${askRow([
        { act: "cannot", label: "Cannot answer", cls: "btn-rose" },
        { act: "sent", label: "Logged as sent", cls: "btn-amber" },
      ], { noGps: true })}`);
    draft.photo = spec?.id;
    if (!clicks.length) {
      /* photo doesn't need a map click */
    }
  }

  /* ---------- DRAW BOUNDS ---------- */
  let drawPts = [];
  let drawMode = "poly";

  tools.draw = {
    click(latlng) {
      drawPts.push(latlng);
      redrawDraft();
      renderDraw();
    },
    act(act) {
      if (act === "undo-pt") {
        drawPts.pop();
        redrawDraft();
        renderDraw();
        return;
      }
      if (act === "rect") {
        drawMode = "rect";
        drawPts = [];
        startRect();
        renderDraw();
        return;
      }
      if (act === "close") {
        if (drawPts.length < 3) return toast("Need at least 3 points.");
        const ring = drawPts.map((p) => [p.lng, p.lat]);
        ring.push(ring[0]);
        const poly = turf.polygon([ring]);
        commitBounds(poly, "Custom polygon");
      }
    },
  };

  function startRect() {
    const m = JLMap.getMap();
    if (!m) return;
    m.dragging.disable();
    let start = null;
    let box = null;
    const onDown = (e) => {
      start = e.latlng;
    };
    const onMove = (e) => {
      if (!start) return;
      if (box) JLMap.drawGroup().removeLayer(box);
      box = L.rectangle([start, e.latlng], { color: "#f5c15c", weight: 1.5, dashArray: "5 4", fillOpacity: 0.08 });
      box.addTo(JLMap.drawGroup());
    };
    const onUp = (e) => {
      m.off("mousedown", onDown);
      m.off("mousemove", onMove);
      m.off("mouseup", onUp);
      m.dragging.enable();
      if (!start) return;
      const b = L.latLngBounds(start, e.latlng);
      const poly = JLPresets.bboxPolygon([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]);
      commitBounds(poly, "Custom rectangle");
    };
    m.on("mousedown", onDown);
    m.on("mousemove", onMove);
    m.on("mouseup", onUp);
  }

  function redrawDraft() {
    const g = JLMap.drawGroup();
    g.clearLayers();
    drawPts.forEach((p) => L.circleMarker(p, { radius: 4, color: "#f5c15c", fillOpacity: 1 }).addTo(g));
    if (drawPts.length >= 2) {
      L.polyline(drawPts, { color: "#f5c15c", dashArray: "5 4", weight: 2 }).addTo(g);
    }
  }

  function commitBounds(poly, name) {
    confirmDialog("Everything outside this shape stops existing, and the remaining area resets.", {
      title: "Replace the map borders?",
      confirmLabel: "Replace borders",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      JLState.patch({ presetId: "custom", presetName: name });
      JLState.setGeo(poly, poly);
      JLMap.paintMasks(poly, poly);
      JLMap.fitPlayable(poly);
      JLMap.drawGroup().clearLayers();
      drawPts = [];
      cancel();
      toast("New map borders set. Features outside no longer exist.");
    });
  }

  function renderDraw() {
    setInspector(`
      <header><div class="kicker">Map borders</div><h3>Draw the playable area</h3></header>
      <p class="hint">Everything outside is out of bounds — questions treat it as if it does not exist.</p>
      <div class="stat">${drawPts.length} points</div>
      <div class="actions">
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
        <button class="btn btn-ghost" data-act="undo-pt">Undo point</button>
        <button class="btn btn-ghost" data-act="rect">Drag rectangle</button>
        <button class="btn btn-amber" data-act="close">Close polygon</button>
      </div>`);
  }

  function tightBbox() {
    const src = remaining() || playable();
    if (!src) return JLOverpass.bboxFromMap(JLMap.getMap());
    try {
      const box = turf.bbox(JLGeo.asFeature(src));
      const span = Math.max(box[2] - box[0], box[3] - box[1]);
      if (span > 8) return JLOverpass.bboxFromMap(JLMap.getMap());
      return `${box[1]},${box[0]},${box[3]},${box[2]}`;
    } catch {
      return JLOverpass.bboxFromMap(JLMap.getMap());
    }
  }

  function labelOf(list, id) {
    return (list.find((x) => x.id === id) || { label: id }).label;
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderActive() {
    if (!active) {
      setInspector("");
      return;
    }
    if (active === "radar") renderRadar();
    else if (active === "thermometer") renderThermo();
    else if (active === "measuring") renderMeasuring();
    else if (active === "matching") renderMatching();
    else if (active === "tentacles") renderTentacles();
    else if (active === "zone") renderZone(clicks[0]);
    else if (active === "photo") renderPhoto();
    else if (active === "draw") renderDraw();
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const draw = (maxSide, quality) => {
            const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
            const cv = document.createElement("canvas");
            cv.width = Math.max(1, Math.round(img.width * scale));
            cv.height = Math.max(1, Math.round(img.height * scale));
            cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
            return cv.toDataURL("image/jpeg", quality);
          };
          let out = draw(900, 0.6);
          if (out.length > 380000) out = draw(640, 0.5);
          if (out.length > 380000) out = draw(480, 0.45);
          resolve(out);
        } catch {
          reject(new Error("Could not process that photo."));
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read that photo."));
      };
      img.src = url;
    });
  }

  global.JLTools = {
    activate,
    cancel,
    current,
    handleClick,
    placeZoneOnStation,
    renderActive,
    toast,
    confirm: confirmDialog,
    applyHere,
    remember,
    applyRemoteAnswer,
    waitingInspector,
    compressImage,
    showPhoto: showHiderPhoto,
    setOnRender(fn) { onNeedRender = fn; },
  };
})(window);
