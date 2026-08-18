/* Official-style Hide + Seek hider deck (community rulebook) */
(function (global) {
  const TIME = [
    { id: "t5", name: "5 / 5 / 10 minutes", s: 5, m: 5, l: 10, copies: 18 },
    { id: "t10", name: "10 / 10 / 20 minutes", s: 10, m: 10, l: 20, copies: 12 },
    { id: "t15", name: "15 / 15 / 30 minutes", s: 15, m: 15, l: 30, copies: 6 },
    { id: "t20", name: "20 / 20 / 45 minutes", s: 20, m: 20, l: 45, copies: 3 },
    { id: "t30", name: "30 / 30 / 60 minutes", s: 30, m: 30, l: 60, copies: 2 },
  ];

  const POWERUPS = [
    {
      id: "veto",
      name: "Veto",
      copies: 4,
      when: "response",
      effect: "Play instead of answering. Seekers get no answer. The question is still considered asked. You do not draw cards.",
    },
    {
      id: "randomize",
      name: "Randomize",
      copies: 4,
      when: "response",
      effect: "Play instead of answering. Seekers randomly pick a different unasked question in the same category. The original is not considered asked. Answer the new one as normal.",
    },
    {
      id: "discard1draw2",
      name: "Discard 1, draw 2",
      copies: 3,
      when: "any",
      effect: "Discard one other card from your hand, then draw and keep 2. You need at least one extra card to play this.",
    },
    {
      id: "discard2draw3",
      name: "Discard 2, draw 3",
      copies: 2,
      when: "any",
      effect: "Discard two other cards from your hand, then draw and keep 3. You need at least two extra cards to play this.",
    },
    {
      id: "expand",
      name: "Draw 1, expand hand",
      copies: 2,
      when: "any",
      effect: "Draw and keep 1 card. Your maximum hand size increases by 1 for the rest of the round (up to 8).",
    },
    {
      id: "duplicate",
      name: "Duplicate",
      copies: 2,
      when: "any",
      effect: "Play as an exact copy of another card in your hand. The original stays. If this is still in hand at the end, it can copy a time bonus.",
    },
    {
      id: "move",
      name: "Move",
      copies: 2,
      when: "any",
      minutes: { S: 15, M: 30, L: 90 },
      effect: "Pause the hide clock. You have 15 / 30 / 90 minutes to reach a new station and set a new zone. Seekers stay put and cannot ask questions. Discard your whole hand and tell them your original station. Cannot be played in the end game.",
    },
  ];

  const CURSES = [
    {
      id: "luxury-car",
      name: "The Luxury Car",
      cost: "A photo of a car",
      effect: "Send a photo of a car (identifiable, MSRP by year/model). Seekers must photograph a more expensive car before asking another question.",
      blocksQuestions: true,
    },
    {
      id: "bridge-troll",
      name: "The Bridge Troll",
      cost: "Seekers are at least 0.3 / 1.5 / 9.1 km from you",
      costBySize: { S: "Seekers ≥ 0.3 km away", M: "Seekers ≥ 1.5 km away", L: "Seekers ≥ 9.1 km away" },
      effect: "Seekers must ask their next question from under a bridge. Every seeker needs some part of their body under it.",
      blocksQuestions: true,
    },
    {
      id: "drained-brain",
      name: "The Drained Brain",
      cost: "Discard your hand",
      effect: "Choose three questions in different categories. Seekers cannot ask those for the rest of the run — not even for extra cost. May be paid after a question is asked but before you answer; you cannot ban the question just asked.",
      needsPick: "ban3",
    },
    {
      id: "water-weight",
      name: "Water Weight",
      cost: "Seekers are within 300 m of a body of water",
      effect: "Each seeker must acquire and carry at least 2 L of new liquid before the next question. If it is lost or abandoned (>10 ft from every seeker), you get a 30 / 30 / 60 minute bonus.",
      blocksQuestions: true,
      bonusBySize: { S: 30, M: 30, L: 60 },
    },
    {
      id: "zoologist",
      name: "The Zoologist",
      cost: "A photo of a wild animal",
      effect: "Photograph a wild fish, bird, mammal, reptile, amphibian, or bug. Seekers must photograph a wild animal in the same category before asking again.",
      blocksQuestions: true,
    },
    {
      id: "egg-partner",
      name: "The Egg Partner",
      cost: "Discard 2 cards",
      discard: 2,
      effect: "Seekers must acquire a real egg before asking again. The egg is a team member. If it is abandoned or cracked, you get 30 / 45 / 60 minutes. Cannot be played in the end game.",
      blocksQuestions: true,
      bonusBySize: { S: 30, M: 45, L: 60 },
      noEndgame: true,
    },
    {
      id: "jammed-door",
      name: "The Jammed Door",
      cost: "Discard 2 cards",
      discard: 2,
      effect: "For 0.5 / 1 / 3 hours, seekers roll 2d6 to enter a building, business, train, or vehicle. Need 7+ to enter. Retry a doorway after 5 / 10 / 15 minutes.",
      durationBySize: { S: 30, M: 60, L: 180 },
    },
    {
      id: "spotty-memory",
      name: "Spotty Memory",
      cost: "Discard a time bonus card",
      discardType: "time",
      effect: "For the rest of the run, one random question category is disabled at all times. After each asked question, seekers reroll the disabled category (same one can repeat).",
    },
    {
      id: "bird-guide",
      name: "The Bird Guide",
      cost: "Film a bird",
      effect: "Film a bird in frame for as long as you can, up to 5 / 10 / 15 minutes. Seekers must film a bird for that long or longer before asking again.",
      blocksQuestions: true,
    },
    {
      id: "unguided-tourist",
      name: "The Unguided Tourist",
      cost: "Seekers are outside",
      effect: "Send an unzoomed Street View still from a street within 150 m of them, horizon-level, with a human-built structure that is not a road. They must find it in real life (no internet research) and send a photo before using transit or asking again.",
      blocksQuestions: true,
      blocksTransit: true,
    },
    {
      id: "ransom-note",
      name: "The Ransom Note",
      cost: "Spell “Ransom Note” as a ransom note (without this card)",
      effect: "The next question must be at least 5 coherent words cut from found printed material. Extra context (pins, thermo start/end) can be sent normally.",
      blocksQuestions: true,
    },
    {
      id: "travel-agent",
      name: "The Mediocre Travel Agent",
      cost: "The destination is further from you than they are now",
      effect: "Pick a publicly accessible place within 400 / 400 / 500 m. They cannot be on transit. They go there, stay 5 / 5 / 10 minutes, send 3 vacation photos, and bring you a souvenir. Lost souvenir: 30 / 45 / 60 minute bonus.",
      blocksQuestions: true,
      bonusBySize: { S: 30, M: 45, L: 60 },
    },
    {
      id: "consumer",
      name: "The Impressionable Consumer",
      cost: "Their next question is free (you draw no cards)",
      effect: "Seekers must enter / gain admission to a place or buy a product they saw advertised in the wild, at least 30 m from the thing itself, before asking again.",
      blocksQuestions: true,
      nextQuestionFree: true,
    },
    {
      id: "u-turn",
      name: "The U-Turn",
      cost: "They are heading the wrong way (next station is further from you)",
      effect: "They must get off at the next station, as long as another transit option serves that station within 0.5 / 0.5 / 1 hour.",
      blocksTransit: true,
    },
    {
      id: "cairn",
      name: "The Cairn",
      cost: "Build a rock tower",
      effect: "Stack found rocks (each touching only one other, 5 seconds between adds). Tell them the height of the last standing tower. They must match it before asking again, then both sides disperse the rocks.",
      blocksQuestions: true,
    },
    {
      id: "distant-cuisine",
      name: "The Distant Cuisine",
      cost: "You are at the restaurant",
      effect: "Find a restaurant in your zone that names a single foreign country. Seekers must visit a restaurant of a country at equal or greater distance before asking again.",
      blocksQuestions: true,
    },
    {
      id: "lemon",
      name: "The Lemon Phylactery",
      cost: "Discard a powerup card",
      discardType: "powerup",
      effect: "Before asking again, each seeker finds a real lemon and affixes it to their outermost clothes or skin. If a lemon stops touching them, you get 30 / 45 / 60 minutes. Not in the end game.",
      blocksQuestions: true,
      bonusBySize: { S: 30, M: 45, L: 60 },
      noEndgame: true,
    },
    {
      id: "gamblers-feet",
      name: "The Gambler’s Feet",
      cost: "Roll a d6 — if even, this curse has no effect",
      coinFlip: "even-fail",
      effect: "For 20 / 40 / 60 minutes seekers roll a d6 before taking steps, then may take that many. Extra steps only if unsafe.",
      durationBySize: { S: 20, M: 40, L: 60 },
    },
    {
      id: "hangman",
      name: "The Hidden Hangman",
      cost: "Discard 2 cards",
      discard: 2,
      effect: "Before asking or boarding transit, seekers must beat you at hangman. You pick a real 5-letter word in the game language. If you take more than 30 seconds to reply to a guess, the curse clears.",
      blocksQuestions: true,
      blocksTransit: true,
    },
    {
      id: "endless-tumble",
      name: "The Endless Tumble",
      cost: "Roll a d6 — if 5 or 6, this curse has no effect",
      coinFlip: "high-fail",
      effect: "Seekers must roll a die at least 30 m / 100 ft and land a 5 or 6 before asking again. If they hit someone with the die you get 10 / 20 / 30 minutes.",
      blocksQuestions: true,
      bonusBySize: { S: 10, M: 20, L: 30 },
    },
    {
      id: "right-turn",
      name: "The Right Turn",
      cost: "Discard a card",
      discard: 1,
      effect: "For 20 / 40 / 60 minutes seekers may only turn right at street intersections. A dead end with no forward/right for 300 m allows a 180.",
      durationBySize: { S: 20, M: 40, L: 60 },
    },
    {
      id: "urban-explorer",
      name: "The Urban Explorer",
      cost: "Discard 2 cards",
      discard: 2,
      effect: "For the rest of the run seekers cannot ask questions while on transit or inside a train station. Pending questions asked on transit before this still get answered.",
    },
    {
      id: "chalice",
      name: "The Overflowing Chalice",
      cost: "Discard a card",
      discard: 1,
      effect: "For the next three questions you draw one extra card (not an extra keep): matching/measuring 4 keep 1, radar/thermo 3 keep 1, photo 2 keep 1, tentacles 5 keep 2.",
      overflowing: 3,
    },
    {
      id: "labyrinth",
      name: "The Labyrinth",
      cost: "Draw a maze",
      effect: "Spend up to 10 / 20 / 30 minutes drawing a solvable maze from your head (no research) and send a photo. Seekers must solve it before asking again.",
      blocksQuestions: true,
    },
  ];

  function minutesFor(card, size) {
    if (!card) return 0;
    const key = String(size || "L").toLowerCase();
    return card[key] || card.l || 0;
  }

  function costText(card, size) {
    if (card.costBySize && card.costBySize[size]) return card.costBySize[size];
    return card.cost || "";
  }

  function buildPile() {
    const pile = [];
    TIME.forEach((t) => {
      for (let i = 0; i < t.copies; i++) {
        pile.push({
          uid: t.id + "-" + i,
          type: "time",
          defId: t.id,
          name: t.name,
          s: t.s,
          m: t.m,
          l: t.l,
        });
      }
    });
    POWERUPS.forEach((p) => {
      for (let i = 0; i < p.copies; i++) {
        pile.push({
          uid: p.id + "-" + i,
          type: "powerup",
          defId: p.id,
          name: p.name,
          effect: p.effect,
          when: p.when,
          minutes: p.minutes || null,
        });
      }
    });
    CURSES.forEach((c, i) => {
      pile.push({
        uid: c.id + "-" + i,
        type: "curse",
        defId: c.id,
        name: c.name,
        effect: c.effect,
        cost: c.cost,
        costBySize: c.costBySize || null,
        blocksQuestions: !!c.blocksQuestions,
        blocksTransit: !!c.blocksTransit,
        discard: c.discard || 0,
        discardType: c.discardType || null,
        bonusBySize: c.bonusBySize || null,
        durationBySize: c.durationBySize || null,
        coinFlip: c.coinFlip || null,
        overflowing: c.overflowing || 0,
        noEndgame: !!c.noEndgame,
        nextQuestionFree: !!c.nextQuestionFree,
        needsPick: c.needsPick || null,
      });
    });
    return pile;
  }

  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function emptyTable(size) {
    return {
      size: size || "L",
      drawPile: shuffle(buildPile()),
      discard: [],
      hand: [],
      maxHand: 6,
      overflowingLeft: 0,
      nextQuestionFree: false,
      timeAwarded: 0,
    };
  }

  function timeValue(card, size) {
    if (!card || card.type !== "time") return 0;
    return minutesFor(card, size);
  }

  function handTime(table) {
    return (table.hand || []).reduce((n, c) => n + timeValue(c, table.size), 0);
  }

  function draw(table, n) {
    const taken = [];
    for (let i = 0; i < n; i++) {
      if (!table.drawPile.length) break;
      taken.push(table.drawPile.shift());
    }
    return taken;
  }

  function keepFromDrawn(table, drawn, keepIds) {
    const keepSet = new Set(keepIds);
    drawn.forEach((c) => {
      if (keepSet.has(c.uid)) table.hand.push(c);
      else table.discard.push(c);
    });
    return table;
  }

  function discardUids(table, uids) {
    const set = new Set(uids);
    const kept = [];
    table.hand.forEach((c) => {
      if (set.has(c.uid)) table.discard.push(c);
      else kept.push(c);
    });
    table.hand = kept;
    return table;
  }

  function playFromHand(table, uid) {
    const i = table.hand.findIndex((c) => c.uid === uid);
    if (i < 0) return null;
    const card = table.hand.splice(i, 1)[0];
    table.discard.push(card);
    return card;
  }

  function findDef(card) {
    if (!card) return null;
    if (card.type === "time") return TIME.find((t) => t.id === card.defId) || card;
    if (card.type === "powerup") return POWERUPS.find((p) => p.id === card.defId) || card;
    return CURSES.find((c) => c.id === card.defId) || card;
  }

  function blockingActive(curses) {
    return (curses || []).some((c) => c.blocksQuestions || c.blocksTransit);
  }

  function canPlayCurse(card, table, curses, opts) {
    opts = opts || {};
    if (!card || card.type !== "curse") return { ok: false, why: "Not a curse." };
    if (card.noEndgame && opts.endgame) return { ok: false, why: "Cannot be played during the end game." };
    if ((card.blocksQuestions || card.blocksTransit) && blockingActive(curses)) {
      return { ok: false, why: "A curse that blocks questions or transit is already active." };
    }
    if (card.discard && table.hand.filter((c) => c.uid !== card.uid).length < card.discard) {
      return { ok: false, why: "Need " + card.discard + " other card" + (card.discard > 1 ? "s" : "") + " to discard." };
    }
    if (card.discardType === "time" && !table.hand.some((c) => c.type === "time" && c.uid !== card.uid)) {
      return { ok: false, why: "Need a time bonus to discard." };
    }
    if (card.discardType === "powerup" && !table.hand.some((c) => c.type === "powerup" && c.uid !== card.uid)) {
      return { ok: false, why: "Need a powerup to discard." };
    }
    return { ok: true };
  }

  function canPlayPowerup(card, table, ctx) {
    ctx = ctx || {};
    if (!card || card.type !== "powerup") return { ok: false, why: "Not a powerup." };
    if (card.defId === "veto" || card.defId === "randomize") {
      if (!ctx.pending) return { ok: false, why: "Play this while a question is waiting." };
    }
    if (card.defId === "discard1draw2" && table.hand.filter((c) => c.uid !== card.uid).length < 1) {
      return { ok: false, why: "Need another card to discard." };
    }
    if (card.defId === "discard2draw3" && table.hand.filter((c) => c.uid !== card.uid).length < 2) {
      return { ok: false, why: "Need two other cards to discard." };
    }
    if (card.defId === "duplicate" && table.hand.filter((c) => c.uid !== card.uid).length < 1) {
      return { ok: false, why: "Need another card in hand to copy." };
    }
    if (card.defId === "move" && ctx.endgame) return { ok: false, why: "Move cannot be played in the end game." };
    if (card.defId === "expand" && table.maxHand >= 8) return { ok: false, why: "Hand size is already at 8." };
    return { ok: true };
  }

  function drawCost(kind, overflowing) {
    const base = (JLQuestions && JLQuestions.COSTS[kind]) || { draw: 1, keep: 1 };
    return {
      draw: base.draw + (overflowing ? 1 : 0),
      keep: base.keep,
    };
  }

  function labelFor(card, size) {
    if (!card) return "";
    if (card.type === "time") return "+" + timeValue(card, size) + " min";
    return card.name;
  }

  function typeLabel(type) {
    return { time: "Time bonus", powerup: "Powerup", curse: "Curse" }[type] || type;
  }

  global.JLDeck = {
    TIME,
    POWERUPS,
    CURSES,
    minutesFor,
    costText,
    buildPile,
    shuffle,
    emptyTable,
    timeValue,
    handTime,
    draw,
    keepFromDrawn,
    discardUids,
    playFromHand,
    findDef,
    blockingActive,
    canPlayCurse,
    canPlayPowerup,
    drawCost,
    labelFor,
    typeLabel,
  };
})(window);
