/* Room relay — HTTP API with localStorage fallback for two tabs */
(function (global) {
  const listeners = new Set();
  let mode = "none";
  let code = null;
  let token = null;
  let role = null;
  let room = null;
  let timer = null;
  let lastSince = 0;
  let stopped = false;
  let publicOrigin = null;
  let myLoc = null;
  let firestore = null;
  let unsubscribeFirestore = null;
  let endedCode = null;
  const PHOTO_TTL_MS = 15 * 60 * 1000;
  const ROOM_TTL_MS = 48 * 60 * 60 * 1000;
  const channelName = () => "lag-room-" + code;
  let channel = null;

  function initFirebase() {
    if (firestore) return firestore;
    if (!global.firebase || !global.__LAG_FIREBASE_CONFIG__) return null;
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(global.__LAG_FIREBASE_CONFIG__);
    firestore = app.firestore();
    return firestore;
  }

  function roomRef(c) {
    const db = initFirebase();
    return db ? db.collection("rooms").doc(c) : null;
  }

  function publicFirebaseRoom(data) {
    if (!data) return null;
    const now = Date.now();
    const players = data.players || [];
    const seekers = players.filter((p) => p.role === "seeker");
    const hiders = players.filter((p) => p.role === "hider");
    return Object.assign({}, data, {
      seekers: seekers.length,
      hiders: hiders.length,
      seekerOnline: seekers.some((p) => now - (p.seen || 0) < 30000),
      hiderOnline: hiders.some((p) => now - (p.seen || 0) < 30000),
      seekerLocs: seekers
        .filter((p) => p.loc && now - (p.locAt || 0) < 180000)
        .map((p) => ({ lat: p.loc.lat, lng: p.loc.lng, acc: p.loc.acc || null, at: p.locAt })),
    });
  }

  function friendlyFirebaseError(err, fallback) {
    const msg = String((err && err.message) || err || "");
    if (/permission|insufficient/i.test(msg)) return new Error(fallback || "No game with that code, or it has expired.");
    if (/failed-precondition/i.test(msg)) return new Error("The game was updated twice at once. Try that again.");
    if (/blocked|ERR_BLOCKED|Failed to fetch|NetworkError|offline/i.test(msg)) {
      return new Error("Firestore was blocked. Turn off the ad blocker for this site and reload.");
    }
    return err instanceof Error ? err : new Error(msg || fallback || "Request failed");
  }

  function setMyLocation(loc) {
    myLoc = loc && loc.lat != null
      ? { lat: +loc.lat, lng: +loc.lng, acc: loc.acc != null ? Math.round(loc.acc) : null }
      : null;
  }

  function emit() {
    listeners.forEach((fn) => {
      try { fn(snapshot()); } catch (e) { console.error(e); }
    });
  }

  function snapshot() {
    return {
      mode,
      code,
      token,
      role,
      room,
      linked: hasHider(),
      online: !!(room && (role === "hider" ? room.seekerOnline : room.hiderOnline)),
      endedCode,
    };
  }

  function forgetSession() {
    try {
      localStorage.removeItem("lag-net");
      sessionStorage.removeItem("lag-net");
      sessionStorage.removeItem("lag-last-answer");
    } catch { /* ignore */ }
  }

  function purgeLocalRoom(c) {
    if (!c) return;
    try {
      localStorage.removeItem(localKey(c));
      localStorage.removeItem("lag-hider-table-v1:" + c);
    } catch { /* ignore */ }
  }

  function pruneLocalJunk() {
    try {
      const now = Date.now();
      const drop = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith("lag-room-live-")) {
          try {
            const data = JSON.parse(localStorage.getItem(key) || "null");
            if (!data || data.ended || now - (data.touched || data.created || 0) > ROOM_TTL_MS) drop.push(key);
          } catch {
            drop.push(key);
          }
        } else if (key.startsWith("lag-hider-table-v1:") && key !== "lag-hider-table-v1:" + (code || "")) {
          const roomKey = "lag-room-live-" + key.slice("lag-hider-table-v1:".length);
          if (!localStorage.getItem(roomKey) && key.slice("lag-hider-table-v1:".length) !== (code || "")) {
            drop.push(key);
          }
        }
      }
      drop.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  }

  function roomExpired(store) {
    const exp = Number(store && store.expiresAt);
    return Number.isFinite(exp) && exp > 0 && exp <= Date.now();
  }

  function remainingPlayers(store) {
    return (store.players || []).filter((p) => p && !p.left);
  }

  function shouldWipeStore(store) {
    if (!store) return true;
    if (store.ended) return true;
    if (roomExpired(store)) return true;
    if (store.players) return remainingPlayers(store).length === 0;
    const tokens = store._tokens ? Object.keys(store._tokens) : [];
    return tokens.length === 0;
  }

  function stripHeavyFields(store) {
    const ans = store.lastAnswer;
    if (ans && ans.photo && (ans.at || 0) && Date.now() - ans.at > PHOTO_TTL_MS) {
      store.lastAnswer = Object.assign({}, ans, { photo: null });
    }
    return store;
  }

  function applyLeaveToStore(store, playerToken, playerRole, payload) {
    const soft = !!(payload && payload.soft);
    if (store.players) {
      if (soft) {
        store.players = store.players.map((p) => (
          p.token === playerToken ? Object.assign({}, p, { departed: true, seen: Date.now() }) : p
        ));
      } else {
        store.players = store.players.filter((p) => p.token !== playerToken);
      }
    }
    if (store._tokens && playerToken && !soft) delete store._tokens[playerToken];
    if (!store.players && !soft) {
      if (playerRole === "hider") store.hiderOnline = false;
      else store.seekerOnline = false;
    }
    store.touched = Date.now();
    store.seq = (store.seq || 0) + 1;
    if (shouldWipeStore(store)) {
      store.ended = true;
      store.phase = "ended";
      store.players = [];
      store.pendingQuestion = null;
      store.lastAnswer = null;
      store.activeCurses = [];
      store.seekerLocs = [];
      store.log = [];
      store.hiders = 0;
      store.seekers = 0;
      store.seekerOnline = false;
      store.hiderOnline = false;
    }
    return store;
  }

  function finishRemoteEnd(gone) {
    stop();
    forgetSession();
    purgeLocalRoom(gone);
    code = null;
    token = null;
    role = null;
    room = null;
    mode = "none";
    endedCode = gone;
    emit();
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function hasHider() {
    return !!(room && (room.hiders > 0 || room.hiderOnline));
  }

  function hasSeeker() {
    return !!(room && (room.seekers > 0 || room.seekerOnline));
  }

  async function api(path, opts) {
    const res = await fetch(path, Object.assign({
      headers: { "Content-Type": "application/json" },
    }, opts || {}));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || "Request failed");
    return data;
  }

  function isLoopbackHost(host) {
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host === "[::1]";
  }

  function rememberOrigin(data) {
    if (!data || !data.ok) return;
    const lan = (data.lan || []).find((ip) => ip && !isLoopbackHost(ip));
    const host = !isLoopbackHost(location.hostname) ? location.hostname : lan;
    if (!host) return;
    if (data.https) {
      const port = String(data.httpsPort || 8878);
      publicOrigin = "https://" + host + (port === "443" ? "" : ":" + port);
      return;
    }
    const port = location.port || String(data.port || data.httpPort || "") || "8877";
    publicOrigin = "http://" + host + (port && port !== "80" ? ":" + port : "");
  }

  async function health() {
    try {
      const data = await api("/api/health");
      rememberOrigin(data);
      return !!(data && data.ok);
    } catch {
      return false;
    }
  }

  function localKey(c) {
    return "lag-room-live-" + c;
  }

  function readLocal(c) {
    try {
      return JSON.parse(localStorage.getItem(localKey(c)) || "null");
    } catch {
      return null;
    }
  }

  function writeLocal(next) {
    localStorage.setItem(localKey(next.code), JSON.stringify(next));
    try {
      if (!channel) channel = new BroadcastChannel(channelName());
      channel.postMessage({ seq: next.seq, code: next.code });
    } catch { /* ignore */ }
  }

  function emptyLocal(c, meta, seekerToken) {
    return {
      code: c,
      seq: 1,
      created: Date.now(),
      meta: meta || {},
      phase: "lobby",
      seekers: 1,
      hiders: 0,
      seekerOnline: true,
      hiderOnline: false,
      pendingQuestion: null,
      lastAnswer: null,
      activeCurses: [],
      timer: {},
      bannedQuestions: [],
      disabledCategory: null,
      overflowingLeft: 0,
      handCount: 0,
      deckLeft: 0,
      maxHand: 6,
      move: null,
      log: [],
      _tokens: { [seekerToken]: "seeker" },
    };
  }

  function applyLocal(store, etype, payload, playerRole) {
    payload = payload || {};
    const seekerOnly = new Set(["question.ask", "question.cancel", "meta", "timer", "curse.proof"]);
    const hiderOnly = new Set(["question.answer", "question.veto", "question.randomize", "curse.play", "curse.clear", "curse.reject", "powerup.play", "cards.sync", "spotty"]);
    if (seekerOnly.has(etype) && playerRole !== "seeker") throw new Error("Only seekers can do that.");
    if (hiderOnly.has(etype) && playerRole !== "hider") throw new Error("Only the hider can do that.");
    if (etype === "question.ask") {
      if (store.pendingQuestion) throw new Error("A question is already waiting for an answer.");
      store.pendingQuestion = Object.assign({
        id: payload.id || ("q-" + Math.random().toString(36).slice(2, 8)),
        askedAt: Date.now(),
        askedBy: playerRole,
      }, payload);
      store.lastAnswer = null;
      store.log = (store.log || []).concat([{ kind: "question", title: store.pendingQuestion.title, detail: "Asked · waiting for hider", at: Date.now() }]).slice(-40);
    } else if (etype === "question.cancel") {
      if (store.pendingQuestion) {
        store.log = (store.log || []).concat([{ kind: "question", title: store.pendingQuestion.title, detail: "Withdrawn", at: Date.now() }]).slice(-40);
        store.pendingQuestion = null;
      }
    } else if (etype === "question.answer" || etype === "question.veto" || etype === "question.randomize") {
      const pending = store.pendingQuestion;
      if (!pending) throw new Error("No question is waiting.");
      store.lastAnswer = {
        questionId: pending.id,
        via: etype === "question.answer" ? "answer" : (etype === "question.veto" ? "veto" : "randomize"),
        answer: payload.answer || "",
        note: payload.note || "",
        photo: payload.photo || null,
        apply: pending.apply || {},
        kind: pending.kind,
        title: pending.title,
        cost: pending.cost,
        draw: pending.draw || 0,
        keep: pending.keep || 0,
        at: Date.now(),
      };
      store.pendingQuestion = null;
      store.disabledCategory = null;
      const detail = etype === "question.veto" ? "Vetoed" : (etype === "question.randomize" ? "Randomized" : (payload.answer || "Answered"));
      store.log = (store.log || []).concat([{ kind: etype === "question.answer" ? "answer" : "powerup", title: pending.title, detail, at: Date.now() }]).slice(-40);
    } else if (etype === "curse.play") {
      const curse = Object.assign({ id: "c-" + Math.random().toString(36).slice(2, 7), playedAt: Date.now() }, payload);
      const active = store.activeCurses || [];
      if ((curse.blocksQuestions || curse.blocksTransit) && active.some((c) => c.blocksQuestions || c.blocksTransit)) {
        throw new Error("A curse that blocks questions or transit is already active.");
      }
      store.activeCurses = active.concat([curse]);
      if (payload.overflowingLeft != null) store.overflowingLeft = payload.overflowingLeft;
      if (payload.disabledCategory) store.disabledCategory = payload.disabledCategory;
      if (payload.bannedQuestions) store.bannedQuestions = payload.bannedQuestions;
      store.log = (store.log || []).concat([{ kind: "curse", title: curse.name, detail: curse.effect, at: Date.now() }]).slice(-40);
    } else if (etype === "curse.proof") {
      const curse = (store.activeCurses || []).find((c) => c.id === payload.id);
      if (!curse) throw new Error("That curse is not active.");
      if (!payload.photo) throw new Error("Send a photo proving you completed the curse.");
      curse.proof = { photo: payload.photo, note: payload.note || "", at: Date.now() };
      store.log = (store.log || []).concat([{ kind: "curse", title: curse.name, detail: "Seekers sent proof", at: Date.now() }]).slice(-40);
    } else if (etype === "curse.reject") {
      const curse = (store.activeCurses || []).find((c) => c.id === payload.id);
      if (!curse) throw new Error("That curse is not active.");
      curse.proof = null;
      store.log = (store.log || []).concat([{ kind: "curse", title: curse.name || payload.name || "Curse", detail: "Proof rejected", at: Date.now() }]).slice(-40);
    } else if (etype === "curse.clear") {
      store.activeCurses = (store.activeCurses || []).filter((c) => c.id !== payload.id);
      store.log = (store.log || []).concat([{ kind: "curse", title: payload.name || "Curse", detail: "Cleared", at: Date.now() }]).slice(-40);
    } else if (etype === "leave") {
      applyLeaveToStore(store, payload.token, playerRole, payload);
      return store;
    } else if (etype === "powerup.play") {
      store.log = (store.log || []).concat([{ kind: "powerup", title: payload.name || "Powerup", detail: payload.detail || "Played", at: Date.now() }]).slice(-40);
      if (payload.maxHand) store.maxHand = payload.maxHand;
      if (payload.move) {
        store.move = payload.move;
        store.phase = "moving";
      }
    } else if (etype === "cards.sync") {
      if (payload.handCount != null) store.handCount = payload.handCount;
      if (payload.deckLeft != null) store.deckLeft = payload.deckLeft;
      if (payload.maxHand != null) store.maxHand = payload.maxHand;
      if (payload.overflowingLeft != null) store.overflowingLeft = payload.overflowingLeft;
    } else if (etype === "timer") {
      store.timer = payload;
    } else if (etype === "timer.vote") {
      const timer = Object.assign({}, store.timer || {});
      const action = payload.action;
      const pauseVotes = Object.assign({ seeker: false, hider: false }, timer.pauseVotes || {});
      const resumeVotes = Object.assign({ seeker: false, hider: false }, timer.resumeVotes || {});
      const hasHider = (store.players || []).some((p) => p.role === "hider") || (store.hiders || 0) > 0;
      const now = Date.now();
      if (action === "pause" && timer.running) {
        pauseVotes[playerRole] = true;
        resumeVotes[playerRole] = false;
        if (pauseVotes.seeker && (pauseVotes.hider || !hasHider)) {
          if (timer.phase === "hiding" && timer.hideStartedAt) timer.hideElapsedMs = now - timer.hideStartedAt;
          if (timer.phase === "seeking" && timer.seekStartedAt) timer.seekElapsedMs = now - timer.seekStartedAt;
          timer.running = false;
          timer.hideStartedAt = null;
          timer.seekStartedAt = null;
          timer.pauseVotes = { seeker: false, hider: false };
          timer.resumeVotes = { seeker: false, hider: false };
        } else {
          timer.pauseVotes = pauseVotes;
          timer.resumeVotes = resumeVotes;
        }
      } else if (action === "resume" && !timer.running && timer.phase && timer.phase !== "idle") {
        resumeVotes[playerRole] = true;
        pauseVotes[playerRole] = false;
        if (resumeVotes.seeker && (resumeVotes.hider || !hasHider)) {
          timer.running = true;
          if (timer.phase === "hiding") timer.hideStartedAt = now - (timer.hideElapsedMs || 0);
          if (timer.phase === "seeking") timer.seekStartedAt = now - (timer.seekElapsedMs || 0);
          timer.pauseVotes = { seeker: false, hider: false };
          timer.resumeVotes = { seeker: false, hider: false };
        } else {
          timer.pauseVotes = pauseVotes;
          timer.resumeVotes = resumeVotes;
        }
      }
      store.timer = timer;
    } else if (etype === "meta") {
      store.meta = Object.assign({}, store.meta, payload);
    } else if (etype === "phase") {
      store.phase = payload.phase || store.phase;
      if (store.phase !== "moving") store.move = null;
    } else if (etype === "spotty") {
      store.disabledCategory = payload.category;
    } else if (etype === "note") {
      store.log = (store.log || []).concat([{ kind: "note", title: payload.title || "Note", detail: payload.detail || "", at: Date.now() }]).slice(-40);
    } else if (etype === "ping") {
      if (playerRole === "hider") store.hiderOnline = true;
      if (playerRole === "seeker") store.seekerOnline = true;
      // Local/API stores have no players array — track seeker location at root.
      // (Firebase mode stores it on the player entry instead; see send().)
      if (payload.loc && playerRole === "seeker" && !store.players) {
        store.seekerLocs = [Object.assign({ at: Date.now() }, payload.loc)];
        store.seq = (store.seq || 0) + 1;
      }
      return store;
    }
    store.seq = (store.seq || 0) + 1;
    return store;
  }

  async function create(meta) {
    if (code && token) await leave();
    else stop();
    endedCode = null;
    pruneLocalJunk();
    try {
      if (initFirebase()) {
        mode = "firebase";
        role = "seeker";
        token = "s-" + cryptoToken();
        let createdOk = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          code = randomCode();
          const ref = roomRef(code);
          const created = Date.now();
          const store = emptyLocal(code, meta, token);
          store.created = created;
          store.touched = created;
          // Stay under the 48h rules cap even if this phone's clock is slightly ahead.
          store.expiresAt = created + ROOM_TTL_MS - 120000;
          store.seekerToken = token;
          store.players = [{ role, token, seen: created }];
          delete store._tokens;
          try {
            await firestore.runTransaction(async (tx) => {
              const snap = await tx.get(ref);
              if (snap.exists) throw new Error("collision");
              tx.set(ref, store);
            });
            room = publicFirebaseRoom(store);
            createdOk = true;
            break;
          } catch (err) {
            if (err.message !== "collision" || attempt === 9) throw err;
          }
        }
        if (!createdOk) throw new Error("Could not create a game.");
      } else if (await health()) {
        mode = "api";
        const data = await api("/api/rooms", { method: "POST", body: JSON.stringify(meta || {}) });
        code = data.code;
        token = data.token;
        role = "seeker";
        room = data.room;
      } else {
        mode = "local";
        code = randomCode();
        token = "s-" + Math.random().toString(36).slice(2);
        role = "seeker";
        room = emptyLocal(code, meta, token);
        writeLocal(room);
      }
      persistSession();
      startLoop();
      emit();
      return snapshot();
    } catch (err) {
      stop();
      code = null;
      token = null;
      role = null;
      room = null;
      mode = "none";
      forgetSession();
      throw friendlyFirebaseError(err, "Could not create a game. Check the connection and try again.");
    }
  }

  async function join(joinCode, joinRole) {
    joinCode = String(joinCode || "").trim().toUpperCase();
    if (code && token && code !== joinCode) await leave();
    else stop();
    endedCode = null;
    joinRole = joinRole || "hider";
    if (!/^[A-Z0-9]{4,8}$/.test(joinCode)) throw new Error("Enter the 6-character game code.");
    if (initFirebase()) {
      mode = "firebase";
      code = joinCode;
      role = joinRole;
      token = (joinRole === "hider" ? "h-" : "s-") + cryptoToken();
      const ref = roomRef(code);
      try {
        await firestore.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists || snap.data().ended || roomExpired(snap.data())) throw new Error("No game with that code.");
          const store = snap.data();
          store.players = (store.players || []).concat([{ role, token, seen: Date.now() }]).slice(-12);
          store.seq = (store.seq || 0) + 1;
          store.touched = Date.now();
          tx.set(ref, store);
          room = publicFirebaseRoom(store);
        });
      } catch (err) {
        throw friendlyFirebaseError(err, "No game with that code, or it has expired.");
      }
    } else if (await health()) {
      mode = "api";
      const data = await api("/api/rooms/" + joinCode + "/join", {
        method: "POST",
        body: JSON.stringify({ role: joinRole }),
      });
      code = data.code;
      token = data.token;
      role = data.role;
      room = data.room;
    } else {
      const store = readLocal(joinCode);
      if (!store || store.ended || shouldWipeStore(store)) {
        purgeLocalRoom(joinCode);
        throw new Error("No game with that code on this device. Use the same Wi-Fi server (serve.py) so phones can link.");
      }
      mode = "local";
      code = joinCode;
      token = (joinRole === "hider" ? "h-" : "s-") + Math.random().toString(36).slice(2);
      role = joinRole;
      store._tokens = store._tokens || {};
      store._tokens[token] = joinRole;
      if (joinRole === "hider") {
        store.hiders = (store.hiders || 0) + 1;
        store.hiderOnline = true;
      } else {
        store.seekers = (store.seekers || 0) + 1;
        store.seekerOnline = true;
      }
      store.seq += 1;
      writeLocal(store);
      room = store;
    }
    persistSession();
    startLoop();
    emit();
    return snapshot();
  }

  async function resume() {
    try {
      const raw = localStorage.getItem("lag-net") || sessionStorage.getItem("lag-net");
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data.code || !data.token) return false;
      code = data.code;
      token = data.token;
      role = data.role;
      mode = data.mode || "api";
      if (mode === "firebase") {
        if (!initFirebase()) return false;
        const snap = await roomRef(code).get();
        if (!snap.exists || snap.data().ended || roomExpired(snap.data())) {
          forgetSession();
          purgeLocalRoom(code);
          return false;
        }
        const store = snap.data();
        const player = (store.players || []).find((p) => p.token === token && p.role === role);
        if (!player) {
          forgetSession();
          return false;
        }
        if (player.departed) {
          player.departed = false;
          player.seen = Date.now();
          store.touched = Date.now();
          try { await roomRef(code).set(store); } catch { /* ignore */ }
        }
        room = publicFirebaseRoom(store);
      } else if (mode === "api") {
        if (!(await health())) return false;
        const data2 = await api("/api/rooms/" + code);
        if (!data2.room || data2.room.ended) {
          forgetSession();
          purgeLocalRoom(code);
          return false;
        }
        room = data2.room;
      } else {
        room = readLocal(code);
        if (!room || room.ended || shouldWipeStore(room)) {
          forgetSession();
          purgeLocalRoom(code);
          return false;
        }
      }
      startLoop();
      emit();
      return true;
    } catch {
      return false;
    }
  }

  function persistSession() {
    try {
      localStorage.setItem("lag-net", JSON.stringify({ mode, code, token, role }));
      sessionStorage.setItem("lag-net", JSON.stringify({ mode, code, token, role }));
    } catch { /* ignore */ }
  }

  let writeChain = Promise.resolve();

  async function sendFirebase(type, payload) {
    const ref = roomRef(code);
    try {
      await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("Room lost.");
        const store = snap.data();
        const player = (store.players || []).find((p) => p.token === token && p.role === role);
        if (!player) throw new Error("This device is not in that game.");
        if (store.ended) throw new Error("That game has ended.");
        player.seen = Date.now();
        if (player.departed && type !== "leave") player.departed = false;
        if (type === "ping") stripHeavyFields(store);
        if (type === "ping" && payload && payload.loc && role === "seeker") {
          player.loc = {
            lat: +payload.loc.lat,
            lng: +payload.loc.lng,
            acc: payload.loc.acc != null ? Math.round(payload.loc.acc) : null,
          };
          player.locAt = Date.now();
        }
        const body = Object.assign({}, payload || {});
        if (type === "leave") body.token = token;
        applyLocal(store, type, body, role);
        store.touched = Date.now();
        tx.set(ref, store);
        if (store.ended) room = null;
        else room = publicFirebaseRoom(store);
      });
    } catch (err) {
      throw friendlyFirebaseError(err, "Could not update the game. Try joining again.");
    }
    if (type === "leave" && !room) {
      try { await ref.delete(); } catch (err) { console.warn(err); }
    }
    emit();
    return room;
  }

  async function send(type, payload) {
    if (!code || !token) throw new Error("Not in a game.");
    if (mode === "firebase") {
      const run = () => sendFirebase(type, payload);
      const next = writeChain.then(run, run);
      writeChain = next.then(() => {}, () => {});
      return next;
    }
    if (mode === "api") {
      const data = await api("/api/rooms/" + code, {
        method: "POST",
        body: JSON.stringify({ token, type, payload: payload || {} }),
      });
      room = data.room && data.room.ended ? null : data.room;
      emit();
      return room;
    }
    const store = readLocal(code);
    if (!store || store.ended) throw new Error("Room lost.");
    const body = Object.assign({}, payload || {});
    if (type === "leave") body.token = token;
    applyLocal(store, type, body, role);
    if (store.ended) {
      purgeLocalRoom(code);
      room = null;
      emit();
      return null;
    }
    writeLocal(store);
    room = store;
    emit();
    return room;
  }

  async function refresh() {
    if (!code) return;
    if (mode === "api") {
      const data = await api("/api/rooms/" + code + "?since=" + lastSince + "&wait=1");
      room = data.room;
      lastSince = (room && room.seq) || lastSince;
    } else {
      room = readLocal(code) || room;
    }
    emit();
  }

  function startLoop() {
    stopped = false;
    lastSince = 0;
    if (mode === "firebase") {
      unsubscribeFirestore = roomRef(code).onSnapshot((snap) => {
        if (!snap.exists || (snap.data() && snap.data().ended)) {
          if (stopped) return;
          finishRemoteEnd(code);
          return;
        }
        room = publicFirebaseRoom(snap.data());
        emit();
      }, (err) => console.warn(err));
    }
    if (mode === "local") {
      try {
        channel = new BroadcastChannel(channelName());
        channel.onmessage = () => {
          room = readLocal(code) || room;
          emit();
        };
      } catch { /* ignore */ }
    }
    const tick = async () => {
      if (stopped) return;
      try {
        const pingPayload = (role === "seeker" && myLoc) ? { loc: myLoc } : {};
        if (mode === "api") {
          await send("ping", pingPayload);
          await refresh();
        } else {
          await send("ping", pingPayload);
        }
      } catch (err) {
        console.warn(err);
      }
      if (!stopped) timer = setTimeout(tick, mode === "firebase" ? 12000 : (mode === "api" ? 1600 : 900));
    };
    tick();
  }

  function stop() {
    stopped = true;
    writeChain = Promise.resolve();
    if (timer) clearTimeout(timer);
    timer = null;
    if (unsubscribeFirestore) {
      unsubscribeFirestore();
      unsubscribeFirestore = null;
    }
    if (channel) {
      try { channel.close(); } catch { /* ignore */ }
      channel = null;
    }
  }

  async function leave(opts) {
    const soft = !!(opts && opts.soft);
    const prevCode = code;
    let wiped = false;
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (prevCode && token) {
      try {
        await send("leave", { soft });
        wiped = !room || !!(room && room.ended);
      } catch (err) {
        console.warn(err);
      }
    }
    if (soft) return { wiped: false };
    stop();
    if (wiped) purgeLocalRoom(prevCode);
    forgetSession();
    pruneLocalJunk();
    code = null;
    token = null;
    role = null;
    room = null;
    mode = "none";
    emit();
    return { wiped };
  }

  function cryptoToken() {
    const bytes = new Uint8Array(16);
    if (global.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function randomCode() {
    const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  }

  function joinUrl(c) {
    const base = publicOrigin || location.origin;
    const url = new URL((location.pathname || "/") + location.search, base.endsWith("/") ? base : base + "/");
    url.search = "";
    url.hash = "";
    url.searchParams.set("join", c || code || "");
    return url.toString();
  }

  global.JLNet = {
    onChange,
    snapshot,
    hasHider,
    hasSeeker,
    health,
    create,
    join,
    resume,
    send,
    setMyLocation,
    refresh,
    leave,
    stop,
    joinUrl,
    get code() { return code; },
    get role() { return role; },
    get room() { return room; },
    get mode() { return mode; },
    get publicOrigin() { return publicOrigin || location.origin; },
    alive,
  };

  async function alive() {
    if (!code) return false;
    try {
      if (mode === "firebase" || (mode !== "api" && mode !== "local" && initFirebase())) {
        if (!initFirebase()) return false;
        const snap = await roomRef(code).get();
        return !!(snap.exists && snap.data() && !snap.data().ended && !roomExpired(snap.data()));
      }
      if (mode === "api") {
        const data = await api("/api/rooms/" + code);
        return !!(data.room && !data.room.ended);
      }
      const store = readLocal(code);
      return !!(store && !store.ended && !shouldWipeStore(store));
    } catch {
      return false;
    }
  }
})(window);
