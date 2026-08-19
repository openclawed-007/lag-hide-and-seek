/* Hider phone UI — questions, deck, curses, powerups */
(function (global) {
  const $ = (id) => document.getElementById(id);
  const KEY = "lag-hider-table-v1";

  let table = null;
  let pendingDraw = null;
  let sheetMode = null;
  let lastAnswerId = null;
  let deadlineTimer = null;

  function size() {
    return (JLNet.room && JLNet.room.meta && JLNet.room.meta.size) || (table && table.size) || "L";
  }

  function persist() {
    try {
      localStorage.setItem(KEY + ":" + (JLNet.code || "solo"), JSON.stringify(table));
    } catch { /* ignore */ }
  }

  function restore() {
    try {
      const raw = localStorage.getItem(KEY + ":" + (JLNet.code || "solo"));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function ensureTable() {
    if (table) {
      table.size = size();
      return table;
    }
    table = restore() || JLDeck.emptyTable(size());
    table.size = size();
    persist();
    return table;
  }

  function toast(msg) {
    if (window.JLTools) JLTools.toast(msg);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function formatLogTime(at) {
    if (!at) return "";
    const d = typeof at === "number" ? new Date(at) : new Date(at);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function syncCards() {
    if (!JLNet.code) return Promise.resolve();
    return JLNet.send("cards.sync", {
      handCount: table.hand.length,
      deckLeft: table.drawPile.length,
      maxHand: table.maxHand,
      overflowingLeft: table.overflowingLeft || 0,
    }).catch(() => {});
  }

  function tableSnapshot() {
    return JSON.stringify(table);
  }

  function restoreTable(snapshot) {
    table = JSON.parse(snapshot);
    persist();
  }

  function start() {
    ensureTable();
    $("hider").hidden = false;
    $("start").hidden = true;
    $("setup").hidden = true;
    $("join").hidden = true;
    $("play").hidden = true;
    bindOnce();
    render();
    JLNet.onChange(render);
    setTimeout(ensureSeekerMap, 60);
  }

  /* ---------- Live seeker map (hider's own position never leaves this phone) ---------- */
  let hMap = null;
  let hSeekerLayer = null;
  let hMeLayer = null;
  let hMyPos = null;
  let hUserMoved = false;
  let hGeoWatch = null;
  let hMapSig = null;

  function ensureSeekerMap() {
    if (hMap) {
      setTimeout(() => { try { hMap.invalidateSize(); } catch { /* ignore */ } }, 120);
      return;
    }
    if (!window.L || !$("hider-map")) return;
    hMap = L.map($("hider-map"), {
      zoomControl: false,
      attributionControl: false,
      minZoom: 2,
      maxZoom: 18,
    }).setView([30, 10], 2);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 20,
    }).addTo(hMap);
    L.control.zoom({ position: "bottomright" }).addTo(hMap);
    hSeekerLayer = L.layerGroup().addTo(hMap);
    hMeLayer = L.layerGroup().addTo(hMap);
    hMap.on("dragstart zoomstart", () => { hUserMoved = true; });
    hMap.on("dblclick", () => { hUserMoved = false; renderSeekerMap(true); });
    setTimeout(() => hMap.invalidateSize(), 120);
    if (navigator.geolocation && window.isSecureContext && hGeoWatch == null) {
      try {
        hGeoWatch = navigator.geolocation.watchPosition(
          (pos) => { hMyPos = { lat: pos.coords.latitude, lng: pos.coords.longitude }; },
          () => { /* fine — seekers still show */ },
          { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
        );
      } catch { /* ignore */ }
    }
  }

  function seekerPin(label, cls) {
    return L.divIcon({
      className: "jl-pin",
      html: `<span class="jl-pin__dot ${cls || ""}"></span><span class="jl-pin__label">${label}</span>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
  }

  function renderSeekerMap(forceFit) {
    if (!hMap) return;
    const locs = (JLNet.room && JLNet.room.seekerLocs) || [];
    const sig = JSON.stringify([
      locs.map((l) => [Math.round(l.lat * 1e5), Math.round(l.lng * 1e5)]),
      hMyPos && [Math.round(hMyPos.lat * 1e5), Math.round(hMyPos.lng * 1e5)],
    ]);
    const meta = $("hider-seeker-meta");
    if (sig === hMapSig && !forceFit) {
      if (meta && locs.length) meta.textContent = seekerMetaText(locs);
      return;
    }
    hMapSig = sig;
    hSeekerLayer.clearLayers();
    hMeLayer.clearLayers();
    locs.forEach((l, i) => {
      L.marker([l.lat, l.lng], { icon: seekerPin(locs.length > 1 ? "Seeker " + (i + 1) : "Seekers"), zIndexOffset: 500 }).addTo(hSeekerLayer);
      if (l.acc && l.acc < 500) {
        L.circle([l.lat, l.lng], { radius: l.acc, color: "#e8b04a", weight: 1, opacity: 0.3, fillOpacity: 0.06, interactive: false }).addTo(hSeekerLayer);
      }
    });
    if (hMyPos) {
      L.marker([hMyPos.lat, hMyPos.lng], { icon: seekerPin("You", "jl-pin__dot--me"), zIndexOffset: 600 }).addTo(hMeLayer);
    }
    if (meta) meta.textContent = locs.length ? seekerMetaText(locs) : "Waiting for their location…";
    if ((forceFit || !hUserMoved) && (locs.length || hMyPos)) {
      const pts = locs.map((l) => [l.lat, l.lng]).concat(hMyPos ? [[hMyPos.lat, hMyPos.lng]] : []);
      try {
        if (pts.length === 1) hMap.setView(pts[0], Math.max(hMap.getZoom(), 12));
        else hMap.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 14 });
      } catch { /* ignore */ }
    }
  }

  function seekerMetaText(locs) {
    const newest = locs.reduce((a, b) => ((a.at || 0) > (b.at || 0) ? a : b));
    const age = newest.at ? Math.max(0, Math.round((Date.now() - newest.at) / 1000)) : null;
    let dist = "";
    if (hMyPos && window.JLGeo) {
      const miles = Math.min(...locs.map((l) => JLGeo.distMiles(hMyPos, l)));
      dist = JLQuestions.formatMiles(Math.round(miles * 10) / 10, JLState.get().units) + " away · ";
    }
    return dist + (age == null ? "live" : age < 15 ? "live" : "updated " + age + "s ago");
  }

  let bound = false;
  function bindOnce() {
    if (bound) return;
    bound = true;
    $("hider").addEventListener("click", onClick);
    $("hider").addEventListener("change", (e) => {
      if (e.target && e.target.id === "hider-photo-input") handlePhotoPick(e.target);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && sheetMode && !$("hider").hidden) closeSheet();
    });
    $("hider-pause").addEventListener("click", requestTimerVote);
    $("hider-link").addEventListener("click", async () => {
      if (!JLNet.code) return;
      try {
        await navigator.clipboard.writeText(JLNet.code);
        toast("Code copied · " + JLNet.code);
      } catch {
        toast(JLNet.code);
      }
    });
    $("hider-recenter").addEventListener("click", () => {
      const locs = (JLNet.room && JLNet.room.seekerLocs) || [];
      if (!locs.length && !hMyPos) {
        toast("No pins yet — waiting for GPS.");
        return;
      }
      hUserMoved = false;
      renderSeekerMap(true);
    });
    $("hider-leave").addEventListener("click", async () => {
      const ok = await JLTools.confirm("If the seekers have also left, this game is deleted and the code will not work again.", {
        title: "Leave this game?",
        confirmLabel: "Leave",
        danger: true,
      });
      if (!ok) return;
      await JLNet.leave();
      reset();
      if (window.JLApp && JLApp.showStart) JLApp.showStart();
      else location.href = location.pathname;
    });
    $("hider-roll").addEventListener("click", () => {
      const n = 1 + Math.floor(Math.random() * 6);
      $("hider-die").textContent = String(n);
      toast("Rolled " + n);
    });
    $("hider-roll2").addEventListener("click", () => {
      const a = 1 + Math.floor(Math.random() * 6);
      const b = 1 + Math.floor(Math.random() * 6);
      $("hider-die").textContent = a + " + " + b + " = " + (a + b);
      toast("Rolled " + a + " and " + b);
    });
  }

  function onClick(ev) {
    if (ev.target && ev.target.id === "hider-sheet") {
      closeSheet();
      return;
    }
    const btn = ev.target.closest("[data-h]");
    if (!btn) return;
    ev.preventDefault();
    const act = btn.getAttribute("data-h");
    if (act === "answer") answerQuestion(btn.getAttribute("data-answer"), "");
    if (act === "answer-note") {
      const note = ($("hider-note") && $("hider-note").value) || "";
      answerQuestion(btn.getAttribute("data-answer"), note);
    }
    if (act === "answer-photo") sendPhotoAnswer();
    if (act === "veto") playResponsePowerup("veto");
    if (act === "randomize") playResponsePowerup("randomize");
    if (act === "open-card") openCard(btn.getAttribute("data-uid"));
    if (act === "close-sheet") closeSheet();
    if (act === "keep-toggle") toggleKeep(btn.getAttribute("data-uid"));
    if (act === "keep-confirm") confirmKeep();
    if (act === "play-curse") confirmCurse();
    if (act === "play-power") confirmPower();
    if (act === "discard-only") discardSelected();
    if (act === "clear-curse") clearCurse(btn.getAttribute("data-id"), btn.getAttribute("data-name"));
    if (act === "reject-proof") rejectProof(btn.getAttribute("data-id"), btn.getAttribute("data-name"));
    if (act === "view-proof") viewProof(btn.getAttribute("data-id"));
    if (act === "bonus") awardBonus(Number(btn.getAttribute("data-min")) || 0, btn.getAttribute("data-why") || "Curse bonus");
  }

  async function answerQuestion(answer, note, photo) {
    const q = JLNet.room && JLNet.room.pendingQuestion;
    if (!q) return;
    try {
      await JLNet.send("question.answer", { id: q.id, answer, note, photo: photo || null });
      const free = table.nextQuestionFree;
      table.nextQuestionFree = false;
      if (!free) beginDraw(q.kind, q.draw, q.keep);
      else toast("That question was free — no cards.");
      persist();
      render();
    } catch (err) {
      toast(err.message || "Could not send the answer.");
    }
  }

  async function playResponsePowerup(kind) {
    const card = table.hand.find((c) => c.type === "powerup" && c.defId === kind);
    if (!card) return toast("You don't have a " + kind + " in hand.");
    const q = JLNet.room && JLNet.room.pendingQuestion;
    if (!q) return toast("No question to respond to.");
    JLDeck.playFromHand(table, card.uid);
    persist();
    try {
      await JLNet.send(kind === "veto" ? "question.veto" : "question.randomize", { id: q.id });
      await JLNet.send("powerup.play", { name: card.name, detail: kind === "veto" ? "Question vetoed" : "Question randomized" });
      syncCards();
      toast(kind === "veto" ? "Vetoed. No cards." : "Randomized. Wait for the new question.");
      render();
    } catch (err) {
      table.hand.push(card);
      table.discard = table.discard.filter((c) => c.uid !== card.uid);
      persist();
      toast(err.message || "Could not play that.");
    }
  }

  function beginDraw(kind, drawN, keepN) {
    const room = JLNet.room || {};
    const extra = (room.overflowingLeft || table.overflowingLeft || 0) > 0;
    const cost = JLDeck.drawCost(kind, extra);
    const draw = drawN || cost.draw;
    const keep = keepN || cost.keep;
    if (extra) {
      table.overflowingLeft = Math.max(0, (room.overflowingLeft || table.overflowingLeft || 0) - 1);
      JLNet.send("cards.sync", { overflowingLeft: table.overflowingLeft }).catch(() => {});
    }
    const cards = JLDeck.draw(table, draw);
    if (!cards.length) {
      toast("The deck is empty.");
      persist();
      return;
    }
    pendingDraw = {
      cards,
      keep,
      selected: cards.length <= keep ? cards.map((c) => c.uid) : [],
    };
    persist();
  }

  function toggleKeep(uid) {
    if (!pendingDraw) return;
    const i = pendingDraw.selected.indexOf(uid);
    if (i >= 0) pendingDraw.selected.splice(i, 1);
    else {
      if (pendingDraw.selected.length >= pendingDraw.keep) {
        pendingDraw.selected.shift();
      }
      pendingDraw.selected.push(uid);
    }
    renderDraw();
  }

  function confirmKeep() {
    if (!pendingDraw) return;
    // The deck can run low — never demand more keeps than were actually drawn
    const required = Math.min(pendingDraw.keep, pendingDraw.cards.length);
    if (pendingDraw.selected.length !== required) {
      return toast("Pick " + required + " card" + (required > 1 ? "s" : "") + " to keep.");
    }
    JLDeck.keepFromDrawn(table, pendingDraw.cards, pendingDraw.selected);
    pendingDraw = null;
    enforceHand();
    persist();
    syncCards();
    render();
  }

  function enforceHand() {
    if (table.hand.length <= table.maxHand) return;
    toast("Hand is over " + table.maxHand + ". Discard or play down.");
    sheetMode = { type: "over" };
  }

  function openCard(uid) {
    const card = table.hand.find((c) => c.uid === uid);
    if (!card) return;
    sheetMode = { type: "card", uid };
    renderSheet();
  }

  function closeSheet() {
    if (sheetMode && sheetMode.type === "over" && table && table.hand.length > table.maxHand) return;
    sheetMode = null;
    if (table && table.hand.length > table.maxHand) sheetMode = { type: "over" };
    renderSheet();
  }

  function selectedSheetCards() {
    return [...document.querySelectorAll("[data-pick]:checked")].map((el) => el.getAttribute("data-pick"));
  }

  async function confirmCurse() {
    const card = table.hand.find((c) => c.uid === sheetMode.uid);
    if (!card) return;
    const beforePlay = tableSnapshot();
    const room = JLNet.room || {};
    const check = JLDeck.canPlayCurse(card, table, room.activeCurses || [], { endgame: room.phase === "endgame" });
    if (!check.ok) return toast(check.why);

    if (card.coinFlip === "even-fail") {
      const n = 1 + Math.floor(Math.random() * 6);
      if (n % 2 === 0) {
        JLDeck.playFromHand(table, card.uid);
        persist();
        syncCards();
        closeSheet();
        toast("Rolled " + n + " — even. The curse has no effect.");
        render();
        return;
      }
      toast("Rolled " + n + " — odd. The curse lands.");
    }
    if (card.coinFlip === "high-fail") {
      const n = 1 + Math.floor(Math.random() * 6);
      if (n >= 5) {
        JLDeck.playFromHand(table, card.uid);
        persist();
        syncCards();
        closeSheet();
        toast("Rolled " + n + " — curse has no effect.");
        render();
        return;
      }
      toast("Rolled " + n + " — the curse lands.");
    }

    const picks = selectedSheetCards();
    if (card.discard && picks.length !== card.discard) {
      return toast("Discard " + card.discard + " other card" + (card.discard > 1 ? "s" : "") + " first.");
    }
    if (card.discardType === "time" && (picks.length !== 1 || !table.hand.find((c) => c.uid === picks[0] && c.type === "time"))) {
      return toast("Discard one time bonus.");
    }
    if (card.discardType === "powerup" && (picks.length !== 1 || !table.hand.find((c) => c.uid === picks[0] && c.type === "powerup"))) {
      return toast("Discard one powerup.");
    }
    if (card.defId === "drained-brain") {
      const bans = [...document.querySelectorAll("[data-ban]:checked")].map((el) => el.value);
      if (bans.length !== 3) return toast("Pick three questions from different categories.");
      const cats = new Set(bans.map((v) => v.split(":")[0]));
      if (cats.size !== 3) return toast("Those three must be different categories.");
    }

    let played;
    if (card.defId === "drained-brain") {
      played = JLDeck.playFromHand(table, card.uid);
      table.hand.slice().forEach((c) => JLDeck.playFromHand(table, c.uid));
    } else {
      JLDeck.discardUids(table, picks);
      played = JLDeck.playFromHand(table, card.uid);
    }
    if (played.overflowing) table.overflowingLeft = played.overflowing;
    if (played.nextQuestionFree) table.nextQuestionFree = true;

    const payload = {
      id: "c-" + Date.now().toString(36),
      cardId: played.defId,
      name: played.name,
      effect: played.effect,
      blocksQuestions: played.blocksQuestions,
      blocksTransit: played.blocksTransit,
      overflowingLeft: table.overflowingLeft,
    };
    if (played.defId === "drained-brain") {
      payload.bannedQuestions = [...document.querySelectorAll("[data-ban]:checked")].map((el) => el.value);
    }
    if (played.defId === "spotty-memory") {
      const cats = ["radar", "thermometer", "measuring", "matching", "photo"].concat(size() === "S" ? [] : ["tentacles"]);
      payload.disabledCategory = cats[Math.floor(Math.random() * cats.length)];
    }
    try {
      await JLNet.send("curse.play", payload);
      persist();
      syncCards();
      closeSheet();
      toast("Played " + played.name);
      render();
    } catch (err) {
      restoreTable(beforePlay);
      toast(err.message || "Could not play that curse.");
      render();
    }
  }

  async function confirmPower() {
    const card = table.hand.find((c) => c.uid === sheetMode.uid);
    if (!card) return;
    const beforePlay = tableSnapshot();
    const room = JLNet.room || {};
    const check = JLDeck.canPlayPowerup(card, table, { pending: room.pendingQuestion, endgame: room.phase === "endgame" });
    if (!check.ok) return toast(check.why);
    const picks = selectedSheetCards();

    if (card.defId === "veto" || card.defId === "randomize") {
      return playResponsePowerup(card.defId);
    }
    if (card.defId === "discard1draw2") {
      if (picks.length !== 1) return toast("Pick 1 card to discard.");
      JLDeck.playFromHand(table, card.uid);
      JLDeck.discardUids(table, picks);
      const extra = JLDeck.draw(table, 2);
      extra.forEach((c) => table.hand.push(c));
    } else if (card.defId === "discard2draw3") {
      if (picks.length !== 2) return toast("Pick 2 cards to discard.");
      JLDeck.playFromHand(table, card.uid);
      JLDeck.discardUids(table, picks);
      JLDeck.draw(table, 3).forEach((c) => table.hand.push(c));
    } else if (card.defId === "expand") {
      JLDeck.playFromHand(table, card.uid);
      table.maxHand = Math.min(8, table.maxHand + 1);
      const extra = JLDeck.draw(table, 1);
      extra.forEach((c) => table.hand.push(c));
    } else if (card.defId === "duplicate") {
      if (picks.length !== 1) return toast("Pick a card to copy.");
      const src = table.hand.find((c) => c.uid === picks[0]);
      if (!src) return;
      JLDeck.playFromHand(table, card.uid);
      const copy = Object.assign({}, src, { uid: src.uid + "-dup-" + Date.now().toString(36), copied: true });
      table.hand.push(copy);
    } else if (card.defId === "move") {
      const okMove = await JLTools.confirm("Move discards your whole hand, and you must tell the seekers your original station.", {
        title: "Play Move?",
        confirmLabel: "Play Move",
        danger: true,
      });
      if (!okMove) return;
      const mins = (card.minutes && card.minutes[size()]) || 30;
      JLDeck.playFromHand(table, card.uid);
      table.hand.slice().forEach((c) => JLDeck.playFromHand(table, c.uid));
      try {
        await JLNet.send("powerup.play", {
          name: "Move",
          detail: "Hider is relocating for " + mins + " minutes. Stay put. They will tell you their original station.",
          move: { minutes: mins, startedAt: Date.now() },
        });
      } catch (err) {
        restoreTable(beforePlay);
        toast(err.message || "Could not play Move.");
        render();
        return;
      }
    } else {
      JLDeck.playFromHand(table, card.uid);
    }

    try {
      if (card.defId !== "move") {
        await JLNet.send("powerup.play", { name: card.name, detail: card.effect, maxHand: table.maxHand });
      }
    } catch (err) {
      restoreTable(beforePlay);
      toast(err.message || "Could not play that powerup.");
      render();
      return;
    }
    persist();
    syncCards();
    closeSheet();
    toast("Played " + card.name);
    render();
  }

  function discardSelected() {
    const card = table.hand.find((c) => c.uid === (sheetMode && sheetMode.uid));
    if (!card) return;
    JLDeck.playFromHand(table, card.uid);
    persist();
    syncCards();
    closeSheet();
    toast("Discarded " + card.name);
    render();
  }

  async function clearCurse(id, name) {
    const curse = ((JLNet.room && JLNet.room.activeCurses) || []).find((c) => c.id === id);
    const hasProof = !!(curse && curse.proof && curse.proof.photo);
    const ok = await JLTools.confirm(
      hasProof
        ? "Confirm the seekers completed this curse? It will come off the board."
        : "They have not sent photo proof. Only confirm if you saw them complete it.",
      {
        title: hasProof ? "Clear this curse?" : "Clear without proof?",
        confirmLabel: "They cleared it",
        danger: !hasProof,
      }
    );
    if (!ok) return;
    try {
      await JLNet.send("curse.clear", { id, name });
      render();
    } catch (err) {
      toast(err.message);
    }
  }

  async function rejectProof(id, name) {
    try {
      await JLNet.send("curse.reject", { id, name });
      toast("Rejected — they need to send new proof.");
      render();
    } catch (err) {
      toast(err.message);
    }
  }

  function viewProof(id) {
    const curse = ((JLNet.room && JLNet.room.activeCurses) || []).find((c) => c.id === id);
    if (curse && curse.proof && window.JLTools) {
      JLTools.showPhoto({
        title: curse.name + " — seeker proof",
        photo: curse.proof.photo,
        note: curse.proof.note || "",
      });
    }
  }

  function reset() {
    table = null;
    pendingDraw = null;
    sheetMode = null;
    lastAnswerId = null;
    lastTimerPhase = null;
    lastBuzzedQuestion = null;
    photoDraft = null;
    photoDraftQ = null;
    hMapSig = null;
    Object.keys(renderSigs).forEach((k) => { delete renderSigs[k]; });
  }

  async function awardBonus(min, why) {
    table.timeAwarded = (table.timeAwarded || 0) + min;
    persist();
    try {
      await JLNet.send("note", { title: "Time bonus", detail: "+" + min + " min · " + why });
    } catch { /* ignore */ }
    toast("+" + min + " minutes added.");
    render();
  }

  function render() {
    if ($("hider").hidden) return;
    ensureTable();
    const room = JLNet.room || {};
    const meta = room.meta || {};
    $("hider-region").textContent = meta.presetName || "Linked game";
    $("hider-size").textContent = (JLQuestions.SIZES[size()] || {}).label || size();
    const pill = $("hider-link");
    if (!JLNet.code) {
      pill.textContent = "Not linked";
      pill.className = "link-pill";
    } else if (room.seekerOnline) {
      pill.textContent = "Seekers live · " + JLNet.code;
      pill.className = "link-pill is-on";
    } else {
      pill.textContent = "Waiting for seekers · " + JLNet.code;
      pill.className = "link-pill is-wait";
    }
    renderTimer();
    renderQuestion();
    renderDraw();
    renderHand();
    renderCurses();
    renderStats();
    renderLog();
    if (!sheetMode && table.hand.length > table.maxHand) sheetMode = { type: "over" };
    renderSheet();
    renderSeekerMap();
  }

  async function requestTimerVote() {
    const t = (JLNet.room && JLNet.room.timer) || {};
    if (!t.phase || t.phase === "idle") return toast("The clock has not started yet.");
    const action = t.running ? "pause" : "resume";
    const ok = await JLTools.confirm(
      t.running
        ? "The clock only stops after both you and the seekers confirm."
        : "The clock only starts again after both sides confirm.",
      {
        title: t.running ? "Pause the clock?" : "Resume the clock?",
        confirmLabel: t.running ? "Pause" : "Resume",
      }
    );
    if (!ok) return;
    try {
      await JLNet.send("timer.vote", { action });
    } catch (err) {
      toast(err.message || "Could not send that.");
    }
  }

  function renderTimer() {
    const t = (JLNet.room && JLNet.room.timer) || {};
    const el = $("hider-timer");
    const btn = $("hider-pause");
    if (!t.phase || t.phase === "idle") {
      el.textContent = "Timer off";
      if (btn) {
        btn.textContent = "Pause";
        btn.hidden = true;
      }
      lastTimerPhase = t.phase || "idle";
      return;
    }
    if (btn) btn.hidden = false;
    if (t.phase === "hiding") {
      let elapsed = t.hideElapsedMs || 0;
      if (t.running && t.hideStartedAt) elapsed = Date.now() - t.hideStartedAt;
      const left = Math.max(0, (t.hideDurationMs || 0) - elapsed);
      el.textContent = "Hide " + JLState.formatDuration(left);
    } else if (t.phase === "moving" && JLNet.room && JLNet.room.move) {
      el.textContent = "Moving · " + (JLNet.room.move.minutes || "?") + " min";
    } else {
      let elapsed = t.seekElapsedMs || 0;
      if (t.running && t.seekStartedAt) elapsed = Date.now() - t.seekStartedAt;
      el.textContent = JLState.formatDuration(elapsed);
    }
    const votes = t.running ? (t.pauseVotes || {}) : (t.resumeVotes || {});
    if (btn) btn.textContent = t.running
      ? (votes.hider ? "Waiting…" : "Pause")
      : (votes.hider ? "Waiting…" : "Resume");
    if (lastTimerPhase === "hiding" && t.phase === "seeking") toast("Seek has begun.");
    lastTimerPhase = t.phase || "idle";
  }

  let lastTimerPhase = null;

  /* Only rebuild a section when its data changes — a 500ms interval calls render(),
     and unconditional innerHTML rebuilds wipe input text and checkbox state. */
  const renderSigs = {};
  function sigChanged(key, sig) {
    if (renderSigs[key] === sig) return false;
    renderSigs[key] = sig;
    return true;
  }

  function pulseIn(el) {
    el.classList.remove("is-new");
    void el.offsetWidth;
    el.classList.add("is-new");
  }

  let lastBuzzedQuestion = null;

  /* ---------- Photo answers ---------- */
  let photoDraft = null;
  let photoDraftQ = null;

  async function handlePhotoPick(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    toast("Preparing photo…");
    try {
      photoDraft = await JLTools.compressImage(file);
      photoDraftQ = (JLNet.room && JLNet.room.pendingQuestion && JLNet.room.pendingQuestion.id) || null;
      applyPhotoPreview();
      toast("Photo ready — hit Send.");
    } catch (err) {
      toast(err.message || "Could not read that photo.");
    }
  }

  function applyPhotoPreview() {
    const img = $("hider-photo-preview");
    const send = $("hider-photo-send");
    if (!img || !send) return;
    if (photoDraft) {
      img.src = photoDraft;
      img.hidden = false;
      send.disabled = false;
    } else {
      img.hidden = true;
      send.disabled = true;
    }
  }

  async function sendPhotoAnswer() {
    if (!photoDraft) return toast("Take or choose a photo first.");
    const note = ($("hider-note") && $("hider-note").value) || "";
    await answerQuestion("sent", note, photoDraft);
    photoDraft = null;
    photoDraftQ = null;
  }

  function renderQuestion() {
    const root = $("hider-question");
    const q = JLNet.room && JLNet.room.pendingQuestion;
    const hasVeto = table.hand.some((c) => c.defId === "veto");
    const hasRand = table.hand.some((c) => c.defId === "randomize");
    const sig = q ? [q.id, hasVeto, hasRand].join("|") : "";
    if (!sigChanged("question", sig)) return;
    clearInterval(deadlineTimer);
    if (!q) {
      root.hidden = true;
      root.innerHTML = "";
      return;
    }
    root.hidden = false;
    const opts = (q.options || []).map((o) =>
      `<button type="button" class="btn ${o.primary ? "btn-amber" : "btn-ghost"} btn-block" data-h="answer" data-answer="${escapeHtml(o.id)}">${escapeHtml(o.label)}</button>`
    ).join("");
    const isTent = q.kind === "tentacles";
    const isPhoto = q.kind === "photo";
    if (photoDraftQ && photoDraftQ !== q.id) {
      photoDraft = null;
      photoDraftQ = null;
    }
    root.innerHTML = `
      <div class="kicker">Question · ${escapeHtml(q.cost || "")}</div>
      <h2>${escapeHtml(q.title)}</h2>
      <p class="hint">${escapeHtml(q.hint || q.detail || "Answer truthfully. You may use the internet except Street View.")}</p>
      <div id="hider-deadline" class="deadline"></div>
      ${isTent ? `<label class="field"><span>Named place</span><input id="hider-note" placeholder="e.g. Louvre"></label>
        <button type="button" class="btn btn-amber btn-block" data-h="answer-note" data-answer="named">Send the name</button>` : ""}
      ${isPhoto ? `<div class="photo-answer">
        <label class="btn btn-ghost btn-block photo-pick">Take or choose a photo<input id="hider-photo-input" type="file" accept="image/*" capture="environment" hidden></label>
        <img id="hider-photo-preview" class="photo-preview" alt="Your photo" hidden>
        <label class="field"><span>Note (optional)</span><input id="hider-note" placeholder="Anything to add"></label>
        <button type="button" id="hider-photo-send" class="btn btn-amber btn-block" data-h="answer-photo" disabled>Send photo to seekers</button>
        <button type="button" class="btn btn-ghost btn-block" data-h="answer-note" data-answer="sent">Sent outside the app</button>
      </div>` : ""}
      <div class="answer-grid">${opts}</div>
      <div class="actions">
        ${hasVeto ? `<button type="button" class="btn btn-rose" data-h="veto">Veto</button>` : ""}
        ${hasRand ? `<button type="button" class="btn btn-teal" data-h="randomize">Randomize</button>` : ""}
      </div>`;
    applyPhotoPreview();
    pulseIn(root);
    if (q.id !== lastBuzzedQuestion) {
      lastBuzzedQuestion = q.id;
      if (navigator.vibrate) { try { navigator.vibrate(120); } catch { /* ignore */ } }
    }
    const tick = () => {
      const el = $("hider-deadline");
      if (!el || !q.deadline) return;
      const left = q.deadline - Date.now();
      if (left <= 0) {
        el.textContent = "Time’s up — hiding clock should pause until you answer.";
        return;
      }
      el.textContent = JLState.formatDuration(left) + " to answer";
    };
    tick();
    deadlineTimer = setInterval(tick, 500);
  }

  function renderDraw() {
    const root = $("hider-draw");
    const sig = pendingDraw
      ? JSON.stringify([pendingDraw.cards.map((c) => c.uid), pendingDraw.selected, pendingDraw.keep])
      : "";
    if (!sigChanged("draw", sig)) return;
    if (!pendingDraw) {
      root.hidden = true;
      root.innerHTML = "";
      return;
    }
    const wasHidden = root.hidden;
    root.hidden = false;
    const required = Math.min(pendingDraw.keep, pendingDraw.cards.length);
    root.innerHTML = `
      <div class="kicker">Draw</div>
      <h2>Keep ${required} of ${pendingDraw.cards.length}</h2>
      <p class="hint">Tap the card${required > 1 ? "s" : ""} you want in hand. The rest are discarded.</p>
      <div class="card-row">${pendingDraw.cards.map((c) => cardHtml(c, pendingDraw.selected.includes(c.uid), "keep-toggle")).join("")}</div>
      <button type="button" class="btn btn-amber btn-block" data-h="keep-confirm"${pendingDraw.selected.length === required ? "" : " disabled"}>${required === 1 ? "Keep this card" : "Keep " + required + " cards"}</button>`;
    if (wasHidden) pulseIn(root);
  }

  function renderHand() {
    const sig = JSON.stringify([table.hand.map((c) => c.uid), table.maxHand, size()]);
    if (!sigChanged("hand", sig)) return;
    $("hider-hand-meta").textContent = table.hand.length + " / " + table.maxHand;
    $("hider-hand").innerHTML = table.hand.length
      ? table.hand.map((c) => cardHtml(c, false, "open-card")).join("")
      : `<p class="empty">Answer a question to draw. Hand limit is ${table.maxHand}.</p>`;
  }

  const CARD_ICONS = { time: "⏱", powerup: "⚡", curse: "🌀" };

  function cardHtml(card, on, act) {
    const mins = card.type === "time" ? JLDeck.timeValue(card, size()) : 0;
    const effect = card.type === "time" ? "Counts if still in hand at the end." : (card.effect || "");
    const body = effect.length > 92 ? effect.slice(0, 92).trimEnd() + "…" : effect;
    return `<button type="button" class="play-card play-card--${card.type}${on ? " is-on" : ""}" data-h="${act}" data-uid="${card.uid}">
      <span class="play-card__icon" aria-hidden="true">${CARD_ICONS[card.type] || "🂠"}</span>
      <span class="play-card__type">${JLDeck.typeLabel(card.type)}</span>
      <strong>${escapeHtml(card.type === "time" ? "+" + mins + " min" : card.name)}</strong>
      <span class="play-card__body">${escapeHtml(body)}</span>
    </button>`;
  }

  function renderCurses() {
    const list = (JLNet.room && JLNet.room.activeCurses) || [];
    const root = $("hider-curses");
    const sig = JSON.stringify([list.map((c) => [c.id, !!(c.proof && c.proof.photo), c.proof && c.proof.at]), size()]);
    if (!sigChanged("curses", sig)) return;
    if (!list.length) {
      root.innerHTML = `<p class="empty">No curses on the seekers right now.</p>`;
      return;
    }
    root.innerHTML = list.map((c) => {
      const def = JLDeck.CURSES.find((d) => d.id === c.cardId);
      const bonus = def && def.bonusBySize ? def.bonusBySize[size()] : 0;
      const proof = c.proof && c.proof.photo;
      return `<article class="curse-card">
        <header><strong>${escapeHtml(c.name)}</strong>
          ${c.blocksQuestions || c.blocksTransit ? `<span class="chip-warn">Blocks ${[c.blocksQuestions ? "questions" : "", c.blocksTransit ? "transit" : ""].filter(Boolean).join(" + ")}</span>` : ""}
        </header>
        <p>${escapeHtml(c.effect)}</p>
        ${proof
          ? `<img class="curse-proof-thumb" src="${proof}" alt="Seeker proof">
             ${c.proof.note ? `<p>${escapeHtml(c.proof.note)}</p>` : ""}
             <p class="hint">Seekers sent proof. Confirm only if it actually completes the curse.</p>`
          : `<p class="hint">Waiting for photo proof from the seekers.</p>`}
        <div class="actions">
          ${bonus ? `<button type="button" class="btn btn-teal" data-h="bonus" data-min="${bonus}" data-why="${escapeHtml(c.name)}">They broke it · +${bonus} min</button>` : ""}
          ${proof ? `<button type="button" class="btn btn-ghost" data-h="view-proof" data-id="${escapeHtml(c.id)}">View proof</button>` : ""}
          ${proof ? `<button type="button" class="btn btn-ghost" data-h="reject-proof" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}">Reject proof</button>` : ""}
          <button type="button" class="btn ${proof ? "btn-amber" : "btn-ghost"}" data-h="clear-curse" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}">${proof ? "Accept and clear" : "I saw them clear it"}</button>
        </div>
      </article>`;
    }).join("");
  }

  function renderStats() {
    const live = JLDeck.handTime(table);
    const sig = [live, table.timeAwarded || 0, table.drawPile.length, table.hand.length, table.maxHand].join("|");
    if (!sigChanged("stats", sig)) return;
    $("hider-stats").innerHTML = `
      <div class="stat-grid">
        <div><b>${live} min</b><span>Time bonuses in hand</span></div>
        <div><b>${table.timeAwarded || 0} min</b><span>Curse bonuses awarded</span></div>
        <div><b>${table.drawPile.length}</b><span>Cards left in deck</span></div>
        <div><b>${table.hand.length}/${table.maxHand}</b><span>Hand</span></div>
      </div>
      <p class="hint">Time bonuses only count if they are still in hand when you are found. Discarding one loses it.</p>`;
  }

  function renderLog() {
    const log = ((JLNet.room && JLNet.room.log) || []).slice().reverse();
    const sig = log.length + "|" + (log[0] ? (log[0].at || log[0].title || "") : "");
    if (!sigChanged("log", sig)) return;
    $("hider-log").innerHTML = log.length
      ? log.map((e) => `<article class="log-item"><div class="log-item__kind">${escapeHtml((e.kind || "").toUpperCase())}</div><h4>${escapeHtml(e.title || "")}</h4><p>${escapeHtml(e.detail || "")}</p>${e.at ? `<footer>${escapeHtml(formatLogTime(e.at))}</footer>` : ""}</article>`).join("")
      : `<p class="empty">Questions will land here as seekers ask them.</p>`;
  }

  function renderSheet() {
    const root = $("hider-sheet");
    const room0 = JLNet.room || {};
    const sig = sheetMode
      ? JSON.stringify([
          sheetMode,
          table.hand.map((c) => c.uid),
          table.maxHand,
          (room0.activeCurses || []).map((c) => c.id),
          room0.pendingQuestion ? room0.pendingQuestion.id : null,
          room0.phase || null,
        ])
      : "";
    if (!sigChanged("sheet", sig)) return;
    if (!sheetMode) {
      root.hidden = true;
      root.innerHTML = "";
      return;
    }
    if (sheetMode.type === "over") {
      root.hidden = false;
      root.innerHTML = `<div class="sheet__card">
        <div class="kicker">Hand limit</div>
        <h3>Play or discard down to ${table.maxHand}</h3>
        <p class="hint">You have ${table.hand.length} cards. Open one to play or discard it.</p>
        <div class="card-row">${table.hand.map((c) => cardHtml(c, false, "open-card")).join("")}</div>
        <button type="button" class="btn btn-ghost btn-block" data-h="close-sheet">Close</button>
      </div>`;
      return;
    }
    const card = table.hand.find((c) => c.uid === sheetMode.uid);
    if (!card) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    const others = table.hand.filter((c) => c.uid !== card.uid);
    let extra = "";
    let actions = `<button type="button" class="btn btn-ghost" data-h="discard-only">Discard</button>
      <button type="button" class="btn btn-ghost" data-h="close-sheet">Close</button>`;

    if (card.type === "time") {
      extra = `<p class="hint">Keep this until you are found. It is worth ${JLDeck.timeValue(card, size())} minutes on the ${JLQuestions.SIZES[size()].label} scale.</p>`;
    } else if (card.type === "curse") {
      const check = JLDeck.canPlayCurse(card, table, (JLNet.room && JLNet.room.activeCurses) || []);
      extra = `<p class="hint"><b>Cost:</b> ${escapeHtml(JLDeck.costText(card, size()) || card.cost || "—")}</p>
        ${check.ok ? "" : `<p class="warn">${escapeHtml(check.why)}</p>`}`;
      extra += pickList(card, others);
      if (card.defId === "drained-brain") extra += banPicker();
      actions = `<button type="button" class="btn btn-rose" data-h="play-curse" ${check.ok ? "" : "disabled"}>Play curse</button>` + actions;
    } else {
      const check = JLDeck.canPlayPowerup(card, table, { pending: JLNet.room && JLNet.room.pendingQuestion });
      extra = `${check.ok ? "" : `<p class="warn">${escapeHtml(check.why)}</p>`}`;
      extra += pickList(card, others);
      actions = `<button type="button" class="btn btn-teal" data-h="play-power" ${check.ok ? "" : "disabled"}>Play powerup</button>` + actions;
    }

    root.innerHTML = `<div class="sheet__card sheet__card--${card.type}">
      <div class="kicker">${JLDeck.typeLabel(card.type)}</div>
      <h3>${escapeHtml(card.type === "time" ? "+" + JLDeck.timeValue(card, size()) + " min" : card.name)}</h3>
      <p>${escapeHtml(card.effect || "")}</p>
      ${extra}
      <div class="actions">${actions}</div>
    </div>`;
  }

  function pickList(card, others) {
    let n = 0;
    let label = "Discard";
    if (card.discard) n = card.discard;
    if (card.discardType === "time") { n = 1; label = "Discard a time bonus"; }
    if (card.discardType === "powerup") { n = 1; label = "Discard a powerup"; }
    if (card.defId === "discard1draw2") { n = 1; label = "Discard"; }
    if (card.defId === "discard2draw3") { n = 2; label = "Discard"; }
    if (card.defId === "duplicate") { n = 1; label = "Copy this card"; }
    if (!n) return "";
    const pool = others.filter((c) => {
      if (card.discardType === "time") return c.type === "time";
      if (card.discardType === "powerup") return c.type === "powerup";
      return true;
    });
    if (!pool.length) return `<p class="warn">Nothing in hand matches that cost.</p>`;
    return `<p class="field-label">${label}</p><div class="pick-list">${pool.map((c) =>
      `<label><input type="checkbox" data-pick="${c.uid}"> ${escapeHtml(c.type === "time" ? "+" + JLDeck.timeValue(c, size()) + " min" : c.name)}</label>`
    ).join("")}</div>`;
  }

  function banPicker() {
    const cats = [
      ["radar", "Radar", JLQuestions.RADAR_MILES.map((m) => JLQuestions.promptFor("radar", JLQuestions.formatMiles(m, "mi")))],
      ["thermometer", "Thermometer", JLQuestions.thermosFor(size()).map((m) => JLQuestions.promptFor("thermometer", JLQuestions.formatMiles(m, "mi")))],
      ["measuring", "Measuring", JLQuestions.MEASURING.map((m) => m.label)],
      ["matching", "Matching", JLQuestions.MATCHING.map((m) => m.label)],
      ["photo", "Photo", JLQuestions.photosFor(size()).map((p) => p.label)],
    ];
    if (size() !== "S") cats.push(["tentacles", "Tentacles", JLQuestions.tentaclesFor(size()).map((t) => t.label)]);
    return `<p class="field-label">Ban 3 questions, each from a different category</p>
      <div class="ban-list">${cats.map(([id, name, items]) =>
        `<fieldset><legend>${name}</legend>${items.slice(0, 8).map((label, i) =>
          `<label><input type="checkbox" data-ban value="${id}:${i}"> ${escapeHtml(label)}</label>`
        ).join("")}</fieldset>`
      ).join("")}</div>`;
  }

  global.JLHider = { start, render, ensureTable, reset };
})(window);
