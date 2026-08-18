/* Game state, history, persist, timer */
(function (global) {
  const KEY = "jetlag-hide-seek-v1";

  function empty() {
    return {
      version: 1,
      presetId: null,
      presetName: "Custom",
      size: "L",
      units: "mi",
      transit: { rail: true, metro: true, light: true, tram: true },
      playable: null,
      remaining: null,
      log: [],
      stations: [],
      hidingZones: [],
      timer: {
        phase: "idle",
        hideStartedAt: null,
        hideElapsedMs: 0,
        seekStartedAt: null,
        seekElapsedMs: 0,
        running: false,
        pauseVotes: { seeker: false, hider: false },
        resumeVotes: { seeker: false, hider: false },
      },
      layers: { rail: true, roads: true, stations: true, dark: true },
    };
  }

  let state = empty();
  const listeners = new Set();

  function emit() {
    listeners.forEach((fn) => {
      try { fn(state); } catch (e) { console.error(e); }
    });
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function get() {
    return state;
  }

  function replace(next) {
    state = next;
    emit();
  }

  function patch(partial) {
    state = Object.assign({}, state, partial);
    emit();
  }

  function setGeo(playable, remaining) {
    state = Object.assign({}, state, {
      playable,
      remaining: remaining || playable,
    });
    emit();
  }

  function applyClip(nextRemaining, entry) {
    const prevRemaining = state.remaining;
    const item = Object.assign(
      {
        id: "q-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        at: new Date().toISOString(),
      },
      entry
    );
    state = Object.assign({}, state, {
      remaining: nextRemaining || state.remaining,
      log: state.log.concat([
        Object.assign({}, item, { _prevRemaining: prevRemaining }),
      ]),
    });
    persist();
    emit();
    return item;
  }

  function undo() {
    if (!state.log.length) return null;
    const log = state.log.slice();
    const last = log.pop();
    state = Object.assign({}, state, {
      remaining: last._prevRemaining || state.remaining,
      log,
      hidingZones: last.kind === "zone"
        ? state.hidingZones.filter((z) => z.id !== last.zoneId)
        : state.hidingZones,
    });
    persist();
    emit();
    return last;
  }

  function addZone(zone) {
    state = Object.assign({}, state, {
      hidingZones: state.hidingZones.concat([zone]),
    });
    persist();
    emit();
  }

  function setStations(stations) {
    state = Object.assign({}, state, { stations });
    emit();
  }

  function remainingStations() {
    if (!state.remaining) return state.stations;
    return state.stations.filter((s) => JLGeo.contains(state.remaining, s));
  }

  function remainingPct() {
    if (!state.playable) return 100;
    const a = JLGeo.areaSqMiles(state.playable);
    const b = JLGeo.areaSqMiles(state.remaining);
    if (!a) return 0;
    return Math.max(0, Math.min(100, (b / a) * 100));
  }

  function tickTimer() {
    const t = state.timer;
    if (!t.running) return;
    const now = Date.now();
    if (t.phase === "hiding" && t.hideStartedAt) {
      t.hideElapsedMs = now - t.hideStartedAt;
    } else if (t.phase === "seeking" && t.seekStartedAt) {
      t.seekElapsedMs = now - t.seekStartedAt;
    }
  }

  function startHidePeriod() {
    const mins = JLQuestions.SIZES[state.size].hideMinutes;
    state.timer = {
      phase: "hiding",
      hideStartedAt: Date.now(),
      hideElapsedMs: 0,
      hideDurationMs: mins * 60 * 1000,
      seekStartedAt: null,
      seekElapsedMs: 0,
      running: true,
      pauseVotes: { seeker: false, hider: false },
      resumeVotes: { seeker: false, hider: false },
    };
    persist();
    emit();
  }

  function startSeekClock() {
    state.timer = Object.assign({}, state.timer, {
      phase: "seeking",
      seekStartedAt: Date.now() - (state.timer.seekElapsedMs || 0),
      running: true,
    });
    persist();
    emit();
  }

  function pauseTimer() {
    tickTimer();
    state.timer = Object.assign({}, state.timer, {
      running: false,
      hideStartedAt: null,
      seekStartedAt: null,
    });
    persist();
    emit();
  }

  function resumeTimer() {
    const t = state.timer;
    if (t.phase === "hiding") {
      state.timer = Object.assign({}, t, {
        running: true,
        hideStartedAt: Date.now() - (t.hideElapsedMs || 0),
      });
    } else if (t.phase === "seeking") {
      state.timer = Object.assign({}, t, {
        running: true,
        seekStartedAt: Date.now() - (t.seekElapsedMs || 0),
      });
    }
    persist();
    emit();
  }

  function persist() {
    try {
      const slim = Object.assign({}, state, {
        playable: state.playable,
        remaining: state.remaining,
        log: state.log.map((e) => {
          const copy = Object.assign({}, e);
          delete copy._prevRemaining;
          return copy;
        }),
      });
      const raw = JSON.stringify(slim);
      if (raw.length > 4_500_000) {
        const tinier = Object.assign({}, slim, { playable: null, remaining: null, stations: [] });
        localStorage.setItem(KEY, JSON.stringify(tinier));
        return;
      }
      localStorage.setItem(KEY, raw);
    } catch (err) {
      console.warn("persist failed", err);
    }
  }

  function restore() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || data.version !== 1) return false;
      const timer = Object.assign(empty().timer, data.timer || {});
      if (timer.running) {
        if (timer.phase === "hiding") {
          timer.hideStartedAt = Date.now() - (timer.hideElapsedMs || 0);
        } else if (timer.phase === "seeking") {
          timer.seekStartedAt = Date.now() - (timer.seekElapsedMs || 0);
        }
      }
      state = Object.assign(empty(), data, { timer });
      emit();
      return true;
    } catch {
      return false;
    }
  }

  function reset() {
    state = empty();
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    emit();
  }

  function exportJson() {
    const slim = Object.assign({}, state, {
      log: state.log.map((e) => {
        const copy = Object.assign({}, e);
        delete copy._prevRemaining;
        return copy;
      }),
    });
    return JSON.stringify(slim, null, 2);
  }

  function formatDuration(ms) {
    ms = Math.max(0, ms | 0);
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  }

  global.JLState = {
    empty,
    get,
    replace,
    patch,
    setGeo,
    applyClip,
    undo,
    addZone,
    setStations,
    remainingStations,
    remainingPct,
    onChange,
    tickTimer,
    startHidePeriod,
    startSeekClock,
    pauseTimer,
    resumeTimer,
    persist,
    restore,
    reset,
    exportJson,
    formatDuration,
  };
})(window);
