/* App shell — start, join, seeker map, hider hand */
(function () {
  const $ = (id) => document.getElementById(id);

  let mapReady = false;
  let stationLoadTimer = null;
  let lastHandledAnswer = null;
  let lastTimerPush = 0;
  let roomBound = false;

  function hideAll() {
    ["start", "setup", "join", "hider", "play"].forEach((id) => {
      if ($(id)) $(id).hidden = true;
    });
  }

  function boot() {
    bindStart();
    bindJoin();
    bindSetup();
    bindChrome();
    bindInvite();
    JLTools.setOnRender(syncChrome);
    JLState.onChange(syncChrome);
    JLState.restore();

    const params = new URLSearchParams(location.search);
    const joinCode = (params.get("join") || "").toUpperCase();
    const mapId = params.get("map");

    if (joinCode) {
      showJoin(joinCode, { autoJoin: joinCode.length >= 4 });
      if (joinCode.length >= 4) doJoin(joinCode);
    } else if (params.get("role") === "hide") {
      showJoin("");
    } else if (params.get("role") === "seek") {
      showSetup();
    } else if (mapId) {
      const preset = JLPresets.PRESETS.find((p) => p.id === mapId);
      if (preset) {
        const size = (params.get("size") || preset.sizeHint || "L").toUpperCase();
        JLState.patch({
          presetId: preset.id,
          presetName: preset.name,
          size: JLQuestions.SIZES[size] ? size : "L",
          units: params.get("units") === "km" ? "km" : "mi",
        });
        startFromSetup().then(() => {
          if (params.get("demo") === "1") runDemo(preset);
        });
      } else {
        resumeIntoGame();
      }
    } else {
      resumeIntoGame();
    }

    setInterval(() => {
      JLState.tickTimer();
      renderTimer();
      if (JLNet.role === "hider") JLHider.render();
    }, 500);
    noteInsecure();
  }

  function noteInsecure() {
    const host = location.hostname;
    if (window.isSecureContext || host === "localhost" || host === "127.0.0.1") return;
    const bar = document.createElement("div");
    bar.className = "insecure-note";
    bar.innerHTML = `On a phone, GPS and the camera need HTTPS. Open <a href="https://${host}:8878${location.pathname}${location.search}">https://${host}:8878</a> and accept the warning.`;
    const hostEl = document.querySelector(".start__inner") || document.querySelector(".setup__inner") || document.body;
    hostEl.prepend(bar);
  }

  async function resumeIntoGame() {
    const netOk = await JLNet.resume();
    if (netOk && JLNet.role === "hider") {
      bindRoom();
      JLHider.start();
      return;
    }
    if (netOk && JLNet.role === "seeker" && JLState.get().playable) {
      bindRoom();
      enterPlay(true);
      return;
    }
    showStart();
  }

  function showStart() {
    hideAll();
    $("start").hidden = false;
    const seekerResume = JLState.get().playable;
    $("start-resume-seek").hidden = !seekerResume;
    JLNet.resume().then((ok) => {
      $("start-resume-hide").hidden = !(ok && JLNet.role === "hider");
    });
  }

  function showSetup() {
    hideAll();
    $("setup").hidden = false;
    renderPresetGrid();
    syncSetupForm();
  }

  function showJoin(prefill, opts) {
    hideAll();
    $("join").hidden = false;
    if (prefill) $("join-code").value = String(prefill).toUpperCase();
    syncJoinGo();
    const canScan = typeof window.BarcodeDetector === "function" && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
    if ($("join-scan")) $("join-scan").hidden = !canScan;
    if ($("join-scan-fallback")) $("join-scan-fallback").hidden = !!canScan;
    if (!(opts && opts.autoJoin)) $("join-code").focus();
  }

  function bindStart() {
    $("start-seek").addEventListener("click", showSetup);
    $("start-hide").addEventListener("click", () => showJoin(""));
    $("start-resume-seek").addEventListener("click", async () => {
      if (!JLState.get().playable) return;
      await ensureSeekerRoom();
      enterPlay(true);
    });
    $("start-resume-hide").addEventListener("click", async () => {
      const ok = await JLNet.resume();
      if (!ok) return JLTools.toast("That linked game is gone. Join with the code again.");
      bindRoom();
      JLHider.start();
    });
  }

  function bindJoin() {
    $("join-back").addEventListener("click", showStart);
    $("join-go").addEventListener("click", () => doJoin($("join-code").value));
    $("join-code").addEventListener("input", (e) => {
      const next = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      e.target.value = next;
      syncJoinGo();
      if (next.length === 6) doJoin(next);
    });
    $("join-code").addEventListener("keydown", (e) => {
      if (e.key === "Enter") doJoin($("join-code").value);
    });
    $("join-scan").addEventListener("click", startScan);
    $("join-scan-stop").addEventListener("click", stopScan);
  }

  function syncJoinGo() {
    const el = $("join-go");
    if (!el) return;
    const n = ($("join-code").value || "").trim().length;
    el.disabled = joining || n < 6;
    el.title = el.disabled && !joining ? "Enter all 6 characters" : "";
  }

  let joining = false;
  async function doJoin(raw) {
    if (joining) return;
    const code = JLQR.codeFromText(raw) || String(raw || "").trim().toUpperCase();
    if (code.length < 4) return JLTools.toast("Enter the 6-character code from the seekers.");
    joining = true;
    $("join-go").disabled = true;
    $("join-go").textContent = "Joining…";
    try {
      await JLNet.join(code, "hider");
      bindRoom();
      if (JLNet.room && JLNet.room.meta) {
        JLState.patch({
          size: JLNet.room.meta.size || JLState.get().size,
          units: JLNet.room.meta.units || JLState.get().units,
          presetName: JLNet.room.meta.presetName || "Linked game",
        });
      }
      JLHider.start();
      JLTools.toast("You’re in. Wait for the first question.");
    } catch (err) {
      JLTools.toast(err.message || "Could not join that game.");
    } finally {
      joining = false;
      $("join-go").textContent = "Join game";
      syncJoinGo();
    }
  }

  async function startScan() {
    const wrap = $("join-camera");
    const video = $("join-video");
    wrap.hidden = false;
    $("join-scan").hidden = true;
    try {
      const text = await JLQR.scan(video);
      stopScan();
      const code = JLQR.codeFromText(text);
      if (!code) return JLTools.toast("That QR didn’t contain a game code.");
      $("join-code").value = code;
      doJoin(code);
    } catch (err) {
      stopScan();
      JLTools.toast(err.message || "Could not open the camera. Type the code instead.");
    }
  }

  function stopScan() {
    JLQR.stopScan();
    const video = $("join-video");
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
    $("join-camera").hidden = true;
    const canScan = typeof window.BarcodeDetector === "function" && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
    if ($("join-scan")) $("join-scan").hidden = !canScan;
  }

  function bindSetup() {
    document.querySelectorAll("[data-size]").forEach((btn) => {
      btn.addEventListener("click", () => {
        JLState.patch({ size: btn.getAttribute("data-size") });
        syncSetupForm();
      });
    });
    document.querySelectorAll("[data-units]").forEach((btn) => {
      btn.addEventListener("click", () => {
        JLState.patch({ units: btn.getAttribute("data-units") });
        syncSetupForm();
      });
    });
    ["rail", "metro", "light", "tram"].forEach((k) => {
      const el = $("t-" + k);
      if (!el) return;
      el.addEventListener("change", () => {
        const transit = Object.assign({}, JLState.get().transit, { [k]: el.checked });
        JLState.patch({ transit });
      });
    });
    $("start-game").addEventListener("click", startFromSetup);
    $("setup-cta-go").addEventListener("click", startFromSetup);
    $("start-custom").addEventListener("click", startCustom);
    $("setup-search").addEventListener("input", renderPresetGrid);
    $("resume-btn").addEventListener("click", async () => {
      if (!JLState.get().playable) return;
      await ensureSeekerRoom();
      enterPlay(true);
    });
    $("setup-back").addEventListener("click", showStart);
  }

  function syncSetupForm() {
    const s = JLState.get();
    document.querySelectorAll("[data-size]").forEach((b) => b.classList.toggle("is-on", b.getAttribute("data-size") === s.size));
    document.querySelectorAll("[data-units]").forEach((b) => b.classList.toggle("is-on", b.getAttribute("data-units") === s.units));
    const meta = JLQuestions.SIZES[s.size];
    $("size-blurb").textContent = `${meta.blurb} · hide ${meta.hideMinutes} min · zone ${JLQuestions.formatMiles(meta.zoneMiles, s.units)}`;
    $("resume-btn").hidden = !s.playable;
    $("setup-cta-name").textContent = s.presetName || "Pick a map";
    $("setup-cta-size").textContent = s.presetId
      ? `${meta.label} game · ${s.units === "km" ? "kilometres" : "miles"}`
      : "Choose a country or metro above";
    $("start-game").disabled = !s.presetId;
    $("setup-cta-go").disabled = !s.presetId;
    $("start-game").title = s.presetId ? "" : "Pick a country or metro first";
    $("setup-cta-go").title = s.presetId ? "" : "Pick a country or metro first";
  }

  function renderPresetGrid() {
    const q = ($("setup-search").value || "").toLowerCase();
    const groups = [
      { id: "show", title: "Played on the show", filter: (p) => p.kind === "show" },
      { id: "metro", title: "Metros", filter: (p) => p.kind === "metro" },
      { id: "country", title: "More countries", filter: (p) => p.kind === "country" },
    ];
    const root = $("preset-grid");
    root.innerHTML = "";
    const selected = JLState.get().presetId;
    groups.forEach((g) => {
      const items = JLPresets.PRESETS.filter(g.filter).filter((p) =>
        !q || p.name.toLowerCase().includes(q) || (p.season || "").toLowerCase().includes(q)
      );
      if (!items.length) return;
      const h = document.createElement("h3");
      h.className = "preset-head";
      h.textContent = g.title;
      root.appendChild(h);
      const grid = document.createElement("div");
      grid.className = "preset-cards";
      items.forEach((p) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "preset-card" + (selected === p.id ? " is-on" : "");
        b.innerHTML = `<span class="preset-card__emoji">${p.emoji || "🗺️"}</span>
          <span class="preset-card__name">${p.name}</span>
          <span class="preset-card__meta">${p.season || p.kind}${p.sizeHint ? " · " + p.sizeHint : ""}</span>`;
        b.addEventListener("click", () => {
          JLState.patch({ presetId: p.id, presetName: p.name, size: p.sizeHint || JLState.get().size });
          syncSetupForm();
          renderPresetGrid();
        });
        grid.appendChild(b);
      });
      root.appendChild(grid);
    });
    if (!root.children.length) {
      const empty = document.createElement("p");
      empty.className = "empty preset-empty";
      empty.textContent = q
        ? "No maps match “" + ($("setup-search").value || "").trim() + "”. Try Japan, London, or a country name."
        : "No maps to show.";
      root.appendChild(empty);
    }
  }

  async function startFromSetup() {
    const s = JLState.get();
    const preset = JLPresets.PRESETS.find((p) => p.id === s.presetId);
    if (!preset) {
      JLTools.toast("Pick a country or metro first.");
      return;
    }
    $("start-game").disabled = true;
    $("start-game").textContent = "Loading map…";
    $("setup-cta-go").disabled = true;
    $("setup-cta-go").textContent = "Loading…";
    $("setup").classList.add("is-loading");
    try {
      let poly = await JLPresets.loadBoundary(preset);
      if (preset.focus) {
        const [[sLat, wLng], [nLat, eLng]] = preset.focus;
        const clip = JLPresets.bboxPolygon([sLat, wLng, nLat, eLng]);
        poly = JLGeo.safeIntersect(poly, clip) || poly;
      }
      const keep = {
        size: s.size,
        units: s.units,
        presetId: preset.id,
        presetName: preset.name,
        transit: s.transit,
        layers: s.layers,
      };
      JLState.reset();
      JLState.patch(keep);
      JLState.setGeo(poly, poly);
      await ensureSeekerRoom();
      enterPlay(false);
      if (JLNet.code) openInvite();
    } catch (err) {
      console.error(err);
      JLTools.toast("Could not load that border. Try again or draw custom.");
    } finally {
      $("start-game").textContent = "Create game";
      $("setup-cta-go").textContent = "Create game";
      $("setup").classList.remove("is-loading");
      syncSetupForm();
    }
  }

  function startCustom() {
    const s = JLState.get();
    JLState.reset();
    JLState.patch({
      size: s.size,
      units: s.units,
      transit: s.transit,
      layers: s.layers,
      presetId: "custom",
      presetName: "Custom",
    });
    const worldish = turf.bboxPolygon([-20, 35, 20, 60]);
    JLState.setGeo(worldish, worldish);
    ensureSeekerRoom().then(() => {
      enterPlay(false);
      if (JLNet.code) openInvite();
      setTimeout(() => JLTools.activate("draw"), 200);
    });
  }

  async function ensureSeekerRoom() {
    if (JLNet.code && JLNet.role === "seeker") {
      if (await JLNet.alive()) {
        bindRoom();
        pushMeta();
        return;
      }
      await JLNet.leave();
    }
    const s = JLState.get();
    try {
      await JLNet.create({
        size: s.size,
        units: s.units,
        presetName: s.presetName,
        presetId: s.presetId,
      });
      lastHandledAnswer = null;
      lastInviteSig = "";
      lastBannerSig = "";
      try { sessionStorage.removeItem("lag-last-answer"); } catch { /* ignore */ }
      bindRoom();
    } catch (err) {
      console.warn(err);
      JLTools.toast("Playing on this device only — run serve.py so a hider can join.");
    }
  }

  function bindRoom() {
    if (roomBound) return;
    roomBound = true;
    JLNet.onChange(onRoom);
  }

  function pushMeta() {
    const s = JLState.get();
    if (!JLNet.code) return;
    JLNet.send("meta", {
      size: s.size,
      units: s.units,
      presetName: s.presetName,
      presetId: s.presetId,
    }).catch(() => {});
  }

  function onRoom(snap) {
    if (snap.endedCode) {
      JLTools.toast("That game ended because everyone left.");
      JLState.reset();
      if (window.JLHider) JLHider.reset();
      showStart();
      return;
    }
    const room = snap.room;
    renderInvite(room);
    renderSeekerBanners(room);
    if (JLNet.role === "seeker") {
      renderLinkPill(room);
      if (room && room.timer) applyRoomTimer(room.timer);
    }
    if (JLNet.role === "hider") JLHider.render();
    const ans = room && room.lastAnswer;
    if (JLNet.role === "seeker" && ans && ans.questionId && ans.questionId !== lastHandledAnswer) {
      lastHandledAnswer = ans.questionId;
      try { sessionStorage.setItem("lag-last-answer", lastHandledAnswer); } catch { /* ignore */ }
      JLTools.applyRemoteAnswer(ans);
    }
  }

  function renderLinkPill(room) {
    const el = $("seeker-link");
    if (!el) return;
    if (!JLNet.code) {
      el.textContent = "Solo";
      el.className = "link-pill";
      return;
    }
    if (room && room.hiderOnline) {
      el.textContent = "Hider live · " + JLNet.code;
      el.className = "link-pill is-on";
    } else {
      el.textContent = "Waiting for hider · " + JLNet.code;
      el.className = "link-pill is-wait";
    }
  }

  let lastBannerSig = "";
  function renderSeekerBanners(room) {
    const bar = $("seeker-banner");
    if (!bar) return;
    if (!room) {
      lastBannerSig = "";
      bar.hidden = true;
      bar.innerHTML = "";
      return;
    }
    const timer = room.timer || {};
    const sig = JSON.stringify([
      room.pendingQuestion && [room.pendingQuestion.id, room.pendingQuestion.title],
      (room.activeCurses || []).map((c) => [c.id, c.name, !!(c.proof && c.proof.photo)]),
      room.disabledCategory || "",
      room.move && room.move.minutes,
      timer.running,
      timer.pauseVotes || {},
      timer.resumeVotes || {},
    ]);
    if (sig === lastBannerSig) return;
    lastBannerSig = sig;
    const bits = [];
    if (room.pendingQuestion) {
      bits.push(`<div class="banner-card is-wait"><b>Waiting for the hider</b><span>${escapeHtml(room.pendingQuestion.title)}</span>
        <button type="button" class="btn btn-ghost" data-withdraw-q>Withdraw question</button></div>`);
    }
    (room.activeCurses || []).forEach((c) => {
      const proof = c.proof && c.proof.photo;
      bits.push(`<div class="banner-card is-curse"><b>${escapeHtml(c.name)}</b><span>${escapeHtml(c.effect)}</span>
        ${proof
          ? `<span>Proof sent — waiting for the hider to confirm.</span>
             <img class="curse-proof-thumb" src="${proof}" alt="Your proof">
             <button type="button" class="btn btn-ghost" data-view-proof="${escapeHtml(c.id)}">View proof</button>`
          : `<span>The hider has to confirm this. Send a photo of you completing it.</span>
             <label class="btn btn-amber photo-pick">Send photo proof<input type="file" accept="image/*" capture="environment" data-curse-proof="${escapeHtml(c.id)}" data-curse-name="${escapeHtml(c.name)}" hidden></label>`}
      </div>`);
    });
    if (room.disabledCategory) {
      bits.push(`<div class="banner-card"><b>Spotty Memory</b><span>${escapeHtml(room.disabledCategory)} questions are disabled until you ask something else.</span></div>`);
    }
    if (room.move) {
      bits.push(`<div class="banner-card is-wait"><b>Hider is moving</b><span>Stay put for ${room.move.minutes} minutes. They will tell you their original station.</span></div>`);
    }
    if (timer.pauseVotes && timer.running && (timer.pauseVotes.seeker || timer.pauseVotes.hider)) {
      const who = timer.pauseVotes.seeker && timer.pauseVotes.hider
        ? "Both sides"
        : (timer.pauseVotes.seeker ? "Seekers are waiting for the hider" : "The hider is waiting for seekers");
      bits.push(`<div class="banner-card is-wait"><b>Pause requested</b><span>${who} to confirm before the clock stops.</span></div>`);
    }
    if (timer.resumeVotes && !timer.running && (timer.resumeVotes.seeker || timer.resumeVotes.hider)) {
      const who = timer.resumeVotes.seeker && timer.resumeVotes.hider
        ? "Both sides"
        : (timer.resumeVotes.seeker ? "Seekers are waiting for the hider" : "The hider is waiting for seekers");
      bits.push(`<div class="banner-card is-wait"><b>Resume requested</b><span>${who} to confirm before the clock starts again.</span></div>`);
    }
    bar.innerHTML = bits.join("");
    bar.hidden = !bits.length;
    bar.querySelectorAll("[data-curse-proof]").forEach((input) => {
      input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
          JLTools.toast("Preparing proof…");
          const photo = await JLTools.compressImage(file);
          await JLNet.send("curse.proof", {
            id: input.getAttribute("data-curse-proof"),
            name: input.getAttribute("data-curse-name"),
            photo,
          });
          JLTools.toast("Proof sent. The hider has to confirm it.");
        } catch (err) {
          JLTools.toast(err.message || "Could not send that proof.");
        }
        input.value = "";
      });
    });
    bar.querySelectorAll("[data-view-proof]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const curse = (room.activeCurses || []).find((c) => c.id === btn.getAttribute("data-view-proof"));
        if (curse && curse.proof) {
          JLTools.showPhoto({
            title: curse.name + " — your proof",
            photo: curse.proof.photo,
            note: curse.proof.note || "Waiting for the hider to confirm.",
          });
        }
      });
    });
    bar.querySelectorAll("[data-withdraw-q]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (window.JLTools && JLTools.withdrawQuestion) JLTools.withdrawQuestion();
      });
    });
  }

  async function askHider(q) {
    if (!JLNet.code) return JLTools.toast("Create the game from the home screen so a hider can join.");
    try {
      await JLNet.send("question.ask", q);
      JLTools.toast("Sent to the hider.");
    } catch (err) {
      JLTools.toast(err.message || "Could not send that question.");
    }
  }

  function bindInvite() {
    $("btn-invite").addEventListener("click", openInvite);
    $("seeker-link").addEventListener("click", openInvite);
    $("invite-close").addEventListener("click", () => setInviteOpen(false));
    async function copyText(text, okMsg) {
      try {
        await navigator.clipboard.writeText(text);
        JLTools.toast(okMsg);
      } catch {
        JLTools.toast(text);
      }
    }
    $("invite-code").addEventListener("click", () => {
      if (JLNet.code) copyText(JLNet.code, "Code copied · " + JLNet.code);
    });
    $("invite-copy").addEventListener("click", async () => {
      const url = JLNet.joinUrl();
      copyText(url, "Join link copied.");
    });
    $("invite-url").addEventListener("click", () => {
      if (JLNet.code) copyText(JLNet.joinUrl(), "Join link copied.");
    });
    if (navigator.share) $("invite-share").hidden = false;
    $("invite-share").addEventListener("click", async () => {
      try {
        await navigator.share({
          title: "LAG — Hide + Seek",
          text: "Join our Hide + Seek game" + (JLNet.code ? " · code " + JLNet.code : ""),
          url: JLNet.joinUrl(),
        });
      } catch { /* user cancelled the share sheet */ }
    });
    $("invite").addEventListener("click", (e) => {
      if (e.target.id === "invite") setInviteOpen(false);
    });
  }

  function openInvite() {
    if (!JLNet.code) {
      ensureSeekerRoom().then(() => {
        if (!JLNet.code) {
          JLTools.toast("Couldn’t create a linked room. You can still play on this device.");
          return;
        }
        renderInvite(JLNet.room);
        setInviteOpen(true);
      });
      return;
    }
    renderInvite(JLNet.room);
    setInviteOpen(true);
  }

  function setInviteOpen(on) {
    $("invite").hidden = !on;
    const play = $("play");
    if (play) play.inert = !!on;
    if (on) {
      const focusEl = $("invite-copy") || $("invite-close");
      if (focusEl) setTimeout(() => focusEl.focus(), 30);
    }
  }

  let lastInviteSig = "";
  function renderInvite(room) {
    if (!JLNet.code) return;
    const st = $("invite-status");
    let status;
    if (JLNet.mode === "local") status = "This tab can share the game with another tab. For a second phone, run python3 serve.py and open that address.";
    else if (room && room.hiderOnline) status = "Hider is connected.";
    else if (room && room.hiders > 0) status = "Hider joined — they may be in the background.";
    else status = "Waiting for the hider to scan or type this code.";
    const url = JLNet.joinUrl();
    const sig = JLNet.code + "|" + url + "|" + status;
    if (sig === lastInviteSig) return;
    lastInviteSig = sig;
    $("invite-code").textContent = JLNet.code;
    $("invite-url").textContent = url;
    JLQR.draw($("invite-qr"), url);
    st.textContent = status;
  }

  function enterPlay(fromRestore) {
    hideAll();
    $("play").hidden = false;
    try { lastHandledAnswer = sessionStorage.getItem("lag-last-answer"); } catch { /* ignore */ }
    const preset = JLPresets.PRESETS.find((p) => p.id === JLState.get().presetId);
    if (preset && preset.center) {
      window.__jlStartView = { center: preset.center, zoom: preset.zoom || 6 };
    }
    if (!mapReady) {
      JLMap.init($("map"));
      mapReady = true;
      const m = JLMap.getMap();
      m.on("click", (e) => {
        if (dropYouNext) {
          dropYouNext = false;
          pinHere(e.latlng);
          return;
        }
        JLTools.handleClick(e.latlng);
      });
      m.on("zoomend moveend", () => {
        renderStations();
        scheduleStationLoad();
      });
      ["jl-inspector", "toggle-log", "drawer", "btn-locate", "invite", "seeker-banner", "layers-toggle", "more-menu"].forEach((id) => {
        const n = $(id);
        if (n && window.L) {
          L.DomEvent.disableClickPropagation(n);
          L.DomEvent.disableScrollPropagation(n);
        }
      });
      document.querySelectorAll(".tools, .layers, .topbar").forEach((n) => {
        if (window.L) {
          L.DomEvent.disableClickPropagation(n);
          L.DomEvent.disableScrollPropagation(n);
        }
      });
    }
    const s = JLState.get();
    JLMap.setDark(s.layers.dark);
    JLMap.setRail(s.layers.rail);
    JLMap.paintMasks(s.playable, s.remaining);
    JLMap.renderZones(s.hidingZones);
    const frame = () => {
      const m = JLMap.getMap();
      if (!m) return;
      m.invalidateSize();
      if (s.playable) JLMap.fitPlayable(s.playable);
    };
    frame();
    requestAnimationFrame(() => requestAnimationFrame(frame));
    setTimeout(frame, 120);
    syncChrome();
    renderLinkPill(JLNet.room);
    renderSeekerBanners(JLNet.room);
    scheduleStationLoad(true);
    pushMeta();
    ensureTimerRunning();
    startLocationShare();
  }

  /* Seekers share their live position with the hider (piggybacked on presence pings) */
  let geoWatchId = null;
  function startLocationShare() {
    if (geoWatchId != null) return;
    if (!navigator.geolocation || !window.isSecureContext) return;
    try {
      geoWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          const ll = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
          JLNet.setMyLocation(ll);
          JLTools.remember(ll);
        },
        () => { /* denied or unavailable — tools still work via map taps */ },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
      );
    } catch { /* ignore */ }
  }

  function bindChrome() {
    document.querySelectorAll("[data-tool]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-tool");
        if (id === "photo") {
          JLTools.activate("photo");
          JLTools.handleClick(null);
          return;
        }
        JLTools.activate(id);
      });
    });
    $("btn-undo").addEventListener("click", () => {
      const last = JLState.undo();
      if (!last) JLTools.toast("Nothing to undo.");
      else {
        const s = JLState.get();
        JLMap.paintMasks(s.playable, s.remaining);
        JLMap.renderZones(s.hidingZones);
        renderStations();
        JLTools.toast("Undid " + (last.title || "the last cut") + ".");
      }
    });
    $("btn-new").addEventListener("click", async () => {
      const linked = !!JLNet.code;
      const ok = await JLTools.confirm(
        linked
          ? "This removes you from the shared game. If the hider has also left, the room is deleted and the code will not work again."
          : "Go back to the home screen? Start a new game to wipe this map.",
        {
          title: linked ? "Leave this game?" : "Leave this map?",
          confirmLabel: "Leave",
          danger: true,
        }
      );
      if (!ok) return;
      JLTools.cancel();
      if (linked) await JLNet.leave();
      JLState.reset();
      if (window.JLHider) JLHider.reset();
      showStart();
    });
    $("btn-reset").addEventListener("click", async () => {
      const ok = await JLTools.confirm("The remaining area goes back to the full map. The question log stays.", {
        title: "Reset all cuts?",
        confirmLabel: "Reset cuts",
        danger: true,
      });
      if (!ok) return;
      const s = JLState.get();
      JLState.setGeo(s.playable, s.playable);
      JLMap.paintMasks(s.playable, s.playable);
      renderStations();
    });
    $("btn-export").addEventListener("click", () => {
      const blob = new Blob([JLState.exportJson()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "jetlag-game.json";
      a.click();
      JLTools.toast("Downloaded jetlag-game.json.");
    });
    $("btn-locate").addEventListener("click", locateMe);
    $("btn-load-stations").addEventListener("click", () => loadStations(true));
    $("btn-timer").addEventListener("click", toggleTimer);
    $("btn-end-hide").addEventListener("click", endHidePeriod);
    $("toggle-rail").addEventListener("change", (e) => {
      JLState.patch({ layers: Object.assign({}, JLState.get().layers, { rail: e.target.checked }) });
      JLMap.setRail(e.target.checked);
    });
    $("toggle-dark").addEventListener("change", (e) => {
      JLState.patch({ layers: Object.assign({}, JLState.get().layers, { dark: e.target.checked }) });
      JLMap.setDark(e.target.checked);
    });
    $("toggle-stations").addEventListener("change", () => renderStations());
    $("layers-toggle").addEventListener("click", (e) => {
      e.stopPropagation();
      $("layers").classList.toggle("is-open");
    });
    $("layers").addEventListener("click", (e) => e.stopPropagation());
    const moreBtn = $("btn-more");
    const moreMenu = $("more-menu");
    function setMoreOpen(open) {
      moreMenu.hidden = !open;
      moreBtn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setMoreOpen(moreMenu.hidden);
    });
    moreMenu.addEventListener("click", (e) => {
      const b = e.target.closest("[data-proxy]");
      if (!b) return;
      setMoreOpen(false);
      const target = $(b.getAttribute("data-proxy"));
      if (target) target.click();
    });
    document.addEventListener("click", (e) => {
      if (!moreMenu.hidden && !moreMenu.contains(e.target) && !moreBtn.contains(e.target)) {
        setMoreOpen(false);
      }
      if ($("layers").classList.contains("is-open") && !$("layers").contains(e.target) && !$("layers-toggle").contains(e.target)) {
        $("layers").classList.remove("is-open");
      }
    });
    function closeDrawer() {
      const d = $("drawer");
      if (window.matchMedia("(max-width: 720px)").matches) d.classList.remove("is-open");
      else d.classList.add("is-collapsed");
    }
    function toggleDrawer() {
      const d = $("drawer");
      if (window.matchMedia("(max-width: 720px)").matches) d.classList.toggle("is-open");
      else d.classList.toggle("is-collapsed");
    }
    $("toggle-log").addEventListener("click", toggleDrawer);
    $("drawer-close").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeDrawer();
    });
    $("drawer-close").addEventListener("pointerup", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeDrawer();
    });
    $("log-tabs").addEventListener("click", (e) => {
      const tab = e.target.closest("[data-tab]");
      if (!tab) return;
      document.querySelectorAll("[data-tab]").forEach((t) => t.classList.toggle("is-on", t === tab));
      $("log-list").hidden = tab.getAttribute("data-tab") !== "log";
      $("book-list").hidden = tab.getAttribute("data-tab") !== "book";
    });
    $("station-search").addEventListener("input", renderStationList);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!$("invite").hidden) { setInviteOpen(false); return; }
        if (!$("more-menu").hidden) { setMoreOpen(false); return; }
        if ($("layers").classList.contains("is-open")) { $("layers").classList.remove("is-open"); return; }
        JLTools.cancel();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        $("btn-undo").click();
      }
      if (e.target.matches("input, textarea, select")) return;
      const mapKeys = { 1: "radar", 2: "thermometer", 3: "measuring", 4: "matching", 5: "tentacles", 6: "photo", 7: "zone", 8: "draw" };
      if (mapKeys[e.key]) {
        JLTools.activate(mapKeys[e.key]);
        if (e.key === "6") JLTools.handleClick(null);
      }
    });
  }

  function linkedGame() {
    return !!(JLNet.code && JLNet.hasHider());
  }

  function ensureTimerRunning() {
    const t = JLState.get().timer;
    if (t.phase && t.phase !== "idle") return;
    JLState.startHidePeriod();
    pushTimer();
  }

  function pushTimer() {
    lastTimerPush = Date.now();
    if (JLNet.code) JLNet.send("timer", JLState.get().timer).catch(() => {});
  }

  function applyRoomTimer(rt) {
    if (!rt || !rt.phase) return;
    const local = JLState.get().timer;
    const same =
      local.running === rt.running &&
      local.phase === rt.phase &&
      JSON.stringify(local.pauseVotes || {}) === JSON.stringify(rt.pauseVotes || {}) &&
      JSON.stringify(local.resumeVotes || {}) === JSON.stringify(rt.resumeVotes || {});
    if (same) return;
    const next = Object.assign({}, local, rt);
    if (next.running) {
      if (next.phase === "hiding") next.hideStartedAt = Date.now() - (next.hideElapsedMs || 0);
      if (next.phase === "seeking") next.seekStartedAt = Date.now() - (next.seekElapsedMs || 0);
    } else {
      next.hideStartedAt = null;
      next.seekStartedAt = null;
    }
    JLState.patch({ timer: next });
  }

  async function endHidePeriod() {
    const t = JLState.get().timer;
    if (t.phase !== "hiding") return;
    const ok = await JLTools.confirm("This ends the hiding period and starts the seek clock.", {
      title: "Begin the seek?",
      confirmLabel: "Begin seek",
    });
    if (!ok) return;
    JLState.startSeekClock();
    pushTimer();
  }

  async function toggleTimer() {
    const t = JLState.get().timer;
    if (!t.phase || t.phase === "idle") {
      JLState.startHidePeriod();
      pushTimer();
      return;
    }
    const action = t.running ? "pause" : "resume";
    const both = linkedGame();
    const detail = both
      ? (action === "pause"
        ? "The clock only stops after both the hider and the seekers confirm."
        : "The clock only starts again after both sides confirm.")
      : "";
    const ok = await JLTools.confirm(detail, {
      title: action === "pause" ? "Pause the clock?" : "Resume the clock?",
      confirmLabel: action === "pause" ? "Pause" : "Resume",
    });
    if (!ok) return;
    if (JLNet.code) {
      JLNet.send("timer.vote", { action }).catch((err) => JLTools.toast(err.message));
      if (!both) {
        if (action === "pause") JLState.pauseTimer();
        else JLState.resumeTimer();
      }
    } else if (action === "pause") JLState.pauseTimer();
    else JLState.resumeTimer();
  }

  function renderTimer() {
    const t = JLState.get().timer;
    const el = $("timer-readout");
    const btn = $("btn-timer");
    const endBtn = $("btn-end-hide");
    if (!el || !btn) return;
    const votes = t.running ? (t.pauseVotes || {}) : (t.resumeVotes || {});
    if (endBtn) endBtn.hidden = !(t.phase === "hiding" && t.running);
    if (t.phase === "idle") {
      el.textContent = "Timer";
      btn.textContent = "Start hide";
      return;
    }
    if (t.phase === "hiding") {
      const left = Math.max(0, (t.hideDurationMs || 0) - (t.hideElapsedMs || 0));
      el.textContent = "Hide " + JLState.formatDuration(left);
      if (t.running && left <= 0) {
        JLState.startSeekClock();
        pushTimer();
        JLTools.toast("Hiding time is up — seek has begun.");
      }
    } else {
      el.textContent = JLState.formatDuration(t.seekElapsedMs || 0);
    }
    if (t.running) {
      btn.textContent = votes.seeker ? "Waiting…" : "Pause";
    } else {
      btn.textContent = votes.seeker ? "Waiting…" : "Resume";
    }
  }

  function syncChrome() {
    if ($("play").hidden) return;
    const s = JLState.get();
    $("hud-region").textContent = s.presetName || "Map";
    $("hud-size").textContent = JLQuestions.SIZES[s.size].label;
    const pct = JLState.remainingPct();
    $("hud-pct").textContent = (Math.round(pct * 10) / 10) + "% left";
    const bar = $("hud-progress");
    if (bar && bar.firstElementChild) {
      bar.firstElementChild.style.width = Math.max(0, Math.min(100, pct)) + "%";
    }
    const moreHead = $("more-head");
    if (moreHead) {
      moreHead.textContent = `${s.presetName || "Map"} · ${JLQuestions.SIZES[s.size].label} · ${Math.round(pct * 10) / 10}% left`;
    }
    const st = JLState.remainingStations();
    $("hud-stations").textContent = st.length ? st.length + " stations" : "— stations";
    $("toggle-rail").checked = s.layers.rail;
    $("toggle-dark").checked = s.layers.dark;
    document.querySelectorAll("[data-tool]").forEach((b) => {
      b.classList.toggle("is-on", b.getAttribute("data-tool") === JLTools.current());
      if (b.getAttribute("data-tool") === "tentacles") b.hidden = s.size === "S";
    });
    if (window.JLMap) {
      JLMap.paintMasks(s.playable, s.remaining);
      JLMap.renderZones(s.hidingZones);
    }
    renderStations();
    renderLog();
    renderBook();
    renderTimer();
  }

  function renderStations() {
    const s = JLState.get();
    if (!$("toggle-stations").checked) {
      if (window.JLMap) JLMap.renderStations([], s.remaining, null);
      renderStationList();
      return;
    }
    JLMap.renderStations(s.stations, s.remaining, (st) => {
      if (JLTools.current() === "zone") JLTools.placeZoneOnStation(st);
      else JLMap.getMap().setView([st.lat, st.lng], Math.max(JLMap.getMap().getZoom(), 14));
    });
    renderStationList();
  }

  function renderStationList() {
    const q = ($("station-search").value || "").toLowerCase();
    const list = JLState.remainingStations()
      .filter((s) => !q || s.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 80);
    const root = $("station-list");
    root.innerHTML = list.map((s) =>
      `<button type="button" class="station-row" data-id="${s.id}">
        <strong>${escapeHtml(s.name)}</strong>
        <span>${s.lat.toFixed(3)}, ${s.lng.toFixed(3)}</span>
      </button>`
    ).join("") || `<p class="empty">Zoom in and load stations for this view.</p>`;
    root.querySelectorAll(".station-row").forEach((btn) => {
      btn.addEventListener("click", () => {
        const st = JLState.get().stations.find((x) => x.id === btn.getAttribute("data-id"));
        if (!st) return;
        JLMap.getMap().setView([st.lat, st.lng], 14);
        if (JLTools.current() === "zone") JLTools.placeZoneOnStation(st);
      });
    });
    const n = JLState.remainingStations().length;
    $("hud-stations").textContent = n ? n + " stations" : "— stations";
  }

  function scheduleStationLoad(immediate) {
    clearTimeout(stationLoadTimer);
    stationLoadTimer = setTimeout(() => loadStations(false), immediate ? 80 : 700);
  }

  let lastStationLoadAt = 0;

  async function loadStations(force) {
    const m = JLMap.getMap();
    if (!m) return;
    if (!force && m.getZoom() < 9) return;
    // Don't hammer Overpass while panning around — auto loads at most every 4s
    if (!force && Date.now() - lastStationLoadAt < 4000) {
      scheduleStationLoad();
      return;
    }
    lastStationLoadAt = Date.now();
    $("btn-load-stations").classList.add("is-busy");
    try {
      const bbox = JLOverpass.bboxFromMap(m);
      const found = await JLOverpass.stationsInBbox(bbox, JLState.get().transit);
      const playable = JLState.get().playable;
      const clipped = JLOverpass.filterIn(playable, found);
      const byId = new Map(JLState.get().stations.map((s) => [s.id, s]));
      clipped.forEach((s) => byId.set(s.id, s));
      JLState.setStations([...byId.values()]);
      renderStations();
      if (force) JLTools.toast(`Loaded ${clipped.length} stations in view.`);
    } catch (err) {
      JLTools.toast(err.message || "Overpass is busy — try again in a moment.");
    } finally {
      $("btn-load-stations").classList.remove("is-busy");
    }
  }

  function renderLog() {
    const local = JLState.get().log.slice().reverse();
    const remote = ((JLNet.room && JLNet.room.log) || []).slice().reverse();
    const merged = local.length ? local : remote;
    $("log-list").innerHTML = merged.map((e) => `
      <article class="log-item log-item--${e.kind || "note"}">
        <div class="log-item__kind">${escapeHtml((e.kind || "note").toUpperCase())}</div>
        <h4>${escapeHtml(e.title || "")}</h4>
        <p>${escapeHtml(e.answer || e.detail || "")}${e.nullAnswer ? " · null" : ""}</p>
        <footer>${escapeHtml([e.cost, formatLogTime(e.at)].filter(Boolean).join(" · "))}</footer>
      </article>
    `).join("") || `<p class="empty">Ask a question. If a hider is linked, it goes to their phone first.</p>`;
  }

  function renderBook() {
    const s = JLState.get();
    const u = s.units;
    const blocks = [];
    blocks.push(bookBlock("Radar", "Draw 2, keep 1",
      JLQuestions.RADAR_MILES.map((m) => JLQuestions.promptFor("radar", JLQuestions.formatMiles(m, u))).concat(["Are you within (choose) of me?"])
    ));
    blocks.push(bookBlock("Thermometer", "Draw 2, keep 1",
      JLQuestions.thermosFor(s.size).map((m) => JLQuestions.promptFor("thermometer", JLQuestions.formatMiles(m, u)))
    ));
    blocks.push(bookBlock("Measuring", "Draw 3, keep 1",
      JLQuestions.MEASURING.map((m) => m.label)
    ));
    blocks.push(bookBlock("Matching", "Draw 3, keep 1",
      JLQuestions.MATCHING.map((m) => m.label)
    ));
    const tens = JLQuestions.tentaclesFor(s.size);
    blocks.push(bookBlock("Tentacles", tens.length ? "Draw 4, keep 2" : "Not in Small",
      tens.length ? tens.map((t) => `${t.label} within ${JLQuestions.formatMiles(t.miles, u)}`) : ["Switch to Medium or Large"]
    ));
    blocks.push(bookBlock("Photos", "Draw 1, keep 1",
      JLQuestions.photosFor(s.size).map((p) => p.label)
    ));
    $("book-list").innerHTML = blocks.join("");
  }

  function bookBlock(title, cost, items) {
    return `<section class="book-block">
      <header><h4>${title}</h4><span>${cost}</span></header>
      <ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
    </section>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function formatLogTime(at) {
    if (!at) return "";
    const d = typeof at === "number" ? new Date(at) : new Date(at);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  async function runDemo(preset) {
    const pin = { lat: preset.center[0], lng: preset.center[1] };
    const radar = JLGeo.circleMiles(pin, 50);
    const next = JLGeo.clipCut(JLState.get().remaining, radar);
    if (next) {
      JLState.applyClip(next, {
        kind: "radar",
        title: "Are you within 50 miles of me?",
        answer: "No",
        cost: "Draw 2, keep 1",
        detail: "50 miles",
      });
    }
    JLMap.addPin(pin, "Radar");
    JLMap.showPreview(radar);
    const s = JLState.get();
    JLMap.paintMasks(s.playable, s.remaining);
  }

  let dropYouNext = false;

  function httpsHint() {
    const host = location.hostname;
    if (host === "localhost" || host === "127.0.0.1") return "";
    return ` Open https://${host}:8878 (accept the warning), then allow location.`;
  }

  function pinHere(ll) {
    JLTools.remember(ll);
    if (JLTools.current()) {
      JLTools.applyHere(ll);
      return;
    }
    const m = JLMap.getMap();
    if (!m) return;
    m.setView(ll, Math.max(m.getZoom(), 13));
    JLMap.clearPins();
    JLMap.addPin(ll, "You");
    JLTools.toast("Got you. Open Radar (or another tool) — it will use this spot.");
  }

  function locateMe() {
    const insecure = !window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1";
    if (insecure || !navigator.geolocation) {
      dropYouNext = true;
      JLTools.toast(
        (insecure
          ? "Phones block GPS on HTTP." + httpsHint()
          : "GPS is not available on this browser.") + " Or tap the map to drop yourself."
      );
      return;
    }
    JLTools.toast("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        pinHere({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        dropYouNext = true;
        const why = {
          1: "Location permission was denied. Allow it for this site, or tap the map.",
          2: "GPS is unavailable. Tap the map to drop yourself.",
          3: "Location timed out. Tap the map to drop yourself.",
        }[err && err.code] || "Could not read your location. Tap the map to drop yourself.";
        JLTools.toast(why + (err && err.code === 1 ? httpsHint() : ""));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
    );
  }

  window.JLApp = { askHider, showStart };

  document.addEventListener("DOMContentLoaded", boot);
})();
