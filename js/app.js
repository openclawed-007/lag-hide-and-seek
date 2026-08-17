/* App shell — setup, play UI, keyboard, persist */
(function () {
  const $ = (id) => document.getElementById(id);

  let mapReady = false;
  let stationLoadTimer = null;

  function boot() {
    bindSetup();
    bindChrome();
    JLTools.setOnRender(syncChrome);
    JLState.onChange(syncChrome);

    const params = new URLSearchParams(location.search);
    const mapId = params.get("map");
    if (mapId) {
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
        return;
      }
    }

    const restored = JLState.restore();
    if (restored && JLState.get().playable) {
      enterPlay(true);
    } else {
      showSetup();
    }

    setInterval(() => {
      JLState.tickTimer();
      renderTimer();
    }, 500);
    noteInsecure();
  }

  function noteInsecure() {
    const host = location.hostname;
    if (window.isSecureContext || host === "localhost" || host === "127.0.0.1") return;
    const bar = document.createElement("div");
    bar.className = "insecure-note";
    bar.innerHTML = `On a phone, GPS only works over HTTPS. Open <a href="https://${host}:8878${location.pathname}${location.search}">https://${host}:8878</a> and accept the warning.`;
    (document.querySelector(".setup__inner") || document.body).prepend(bar);
  }

  function showSetup() {
    $("setup").hidden = false;
    $("play").hidden = true;
    renderPresetGrid();
    syncSetupForm();
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
    $("start-custom").addEventListener("click", startCustom);
    $("setup-search").addEventListener("input", renderPresetGrid);
    $("resume-btn").addEventListener("click", () => {
      if (JLState.get().playable) enterPlay(true);
    });
  }

  function syncSetupForm() {
    const s = JLState.get();
    document.querySelectorAll("[data-size]").forEach((b) => b.classList.toggle("is-on", b.getAttribute("data-size") === s.size));
    document.querySelectorAll("[data-units]").forEach((b) => b.classList.toggle("is-on", b.getAttribute("data-units") === s.units));
    const meta = JLQuestions.SIZES[s.size];
    $("size-blurb").textContent = `${meta.blurb} · hide ${meta.hideMinutes} min · zone ${JLQuestions.formatMiles(meta.zoneMiles, s.units)}`;
    $("resume-btn").hidden = !s.playable;
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
    $("setup").classList.add("is-loading");
    try {
      let poly = await JLPresets.loadBoundary(preset);
      if (preset.focus) {
        const [[sLat, wLng], [nLat, eLng]] = preset.focus;
        const clip = JLPresets.bboxPolygon([sLat, wLng, nLat, eLng]);
        poly = JLGeo.safeIntersect(poly, clip) || poly;
      }
      JLState.patch({ presetId: preset.id, presetName: preset.name });
      JLState.setGeo(poly, poly);
      enterPlay(false);
    } catch (err) {
      console.error(err);
      JLTools.toast("Could not load that border. Try again or draw custom.");
    } finally {
      $("start-game").disabled = false;
      $("start-game").textContent = "Open the map";
      $("setup").classList.remove("is-loading");
    }
  }

  function startCustom() {
    const worldish = turf.bboxPolygon([-20, 35, 20, 60]);
    JLState.patch({ presetId: "custom", presetName: "Custom" });
    JLState.setGeo(worldish, worldish);
    enterPlay(false);
    setTimeout(() => JLTools.activate("draw"), 200);
  }

  function enterPlay(fromRestore) {
    $("setup").hidden = true;
    $("play").hidden = false;
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
      ["jl-inspector", "toggle-log", "drawer", "btn-locate"].forEach((id) => {
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
    scheduleStationLoad(true);
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
      }
    });
    $("btn-new").addEventListener("click", () => {
      if (!confirm("Leave this game and pick a new map?")) return;
      JLTools.cancel();
      showSetup();
    });
    $("btn-reset").addEventListener("click", () => {
      if (!confirm("Reset remaining area back to the full map? Question log stays.")) return;
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
    });
    $("btn-locate").addEventListener("click", locateMe);
    $("btn-load-stations").addEventListener("click", () => loadStations(true));
    $("btn-timer").addEventListener("click", toggleTimer);
    $("toggle-rail").addEventListener("change", (e) => {
      JLState.patch({ layers: Object.assign({}, JLState.get().layers, { rail: e.target.checked }) });
      JLMap.setRail(e.target.checked);
    });
    $("toggle-dark").addEventListener("change", (e) => {
      JLState.patch({ layers: Object.assign({}, JLState.get().layers, { dark: e.target.checked }) });
      JLMap.setDark(e.target.checked);
    });
    $("toggle-stations").addEventListener("change", () => renderStations());
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
      if (e.key === "Escape") JLTools.cancel();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        $("btn-undo").click();
      }
      if (e.target.matches("input, textarea, select")) return;
      const mapKeys = { 1: "radar", 2: "thermometer", 3: "measuring", 4: "matching", 5: "tentacles", 6: "photo" };
      if (mapKeys[e.key]) {
        JLTools.activate(mapKeys[e.key]);
        if (e.key === "6") JLTools.handleClick(null);
      }
    });
  }

  function toggleTimer() {
    const t = JLState.get().timer;
    if (t.phase === "idle") JLState.startHidePeriod();
    else if (t.phase === "hiding" && t.running) {
      if (confirm("End the hiding period and start the seek clock?")) JLState.startSeekClock();
    } else if (t.running) JLState.pauseTimer();
    else JLState.resumeTimer();
  }

  function renderTimer() {
    const t = JLState.get().timer;
    const el = $("timer-readout");
    const btn = $("btn-timer");
    if (!el) return;
    if (t.phase === "idle") {
      el.textContent = "Timer";
      btn.textContent = "Start hide";
      return;
    }
    if (t.phase === "hiding") {
      const left = Math.max(0, (t.hideDurationMs || 0) - (t.hideElapsedMs || 0));
      el.textContent = "Hide " + JLState.formatDuration(left);
      btn.textContent = t.running ? "Begin seek" : "Resume";
      if (t.running && left <= 0) JLState.startSeekClock();
      return;
    }
    el.textContent = JLState.formatDuration(t.seekElapsedMs || 0);
    btn.textContent = t.running ? "Pause" : "Resume";
  }

  function syncChrome() {
    const s = JLState.get();
    $("hud-region").textContent = s.presetName || "Map";
    $("hud-size").textContent = JLQuestions.SIZES[s.size].label;
    const pct = JLState.remainingPct();
    $("hud-pct").textContent = (Math.round(pct * 10) / 10) + "% left";
    const st = JLState.remainingStations();
    $("hud-stations").textContent = st.length ? st.length + " stations" : "— stations";
    $("toggle-rail").checked = s.layers.rail;
    $("toggle-dark").checked = s.layers.dark;
    document.querySelectorAll("[data-tool]").forEach((b) => {
      b.classList.toggle("is-on", b.getAttribute("data-tool") === JLTools.current());
    });
    JLMap.paintMasks(s.playable, s.remaining);
    JLMap.renderZones(s.hidingZones);
    renderStations();
    renderLog();
    renderBook();
    renderTimer();
  }

  function renderStations() {
    const s = JLState.get();
    if (!$("toggle-stations").checked) {
      JLMap.renderStations([], s.remaining, null);
      renderStationList();
      return;
    }
    JLMap.renderStations(s.stations, s.remaining, (st) => {
      JLTools.placeZoneOnStation(st);
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
        JLTools.placeZoneOnStation(st);
      });
    });
    $("hud-stations").textContent = JLState.remainingStations().length + " stations";
  }

  function scheduleStationLoad(immediate) {
    clearTimeout(stationLoadTimer);
    stationLoadTimer = setTimeout(() => loadStations(false), immediate ? 80 : 700);
  }

  async function loadStations(force) {
    const m = JLMap.getMap();
    if (!m) return;
    if (!force && m.getZoom() < 9) return;
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
    const log = JLState.get().log.slice().reverse();
    $("log-list").innerHTML = log.map((e) => `
      <article class="log-item log-item--${e.kind || "note"}">
        <div class="log-item__kind">${escapeHtml((e.kind || "note").toUpperCase())}</div>
        <h4>${escapeHtml(e.title || "")}</h4>
        <p>${escapeHtml(e.answer || "")}${e.nullAnswer ? " · null" : ""}</p>
        <footer>${escapeHtml(e.cost || "")}</footer>
      </article>
    `).join("") || `<p class="empty">Ask a radar, thermometer, measuring, matching, tentacle, or photo question. Cuts land here.</p>`;
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

  document.addEventListener("DOMContentLoaded", boot);
})();
