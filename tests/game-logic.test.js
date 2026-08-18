const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    get length() { return values.size; },
    key: (i) => Array.from(values.keys())[i] || null,
  };
}

const context = {
  window: {},
  console,
  Date,
  Math,
  Set,
  Map,
  JSON,
  localStorage: memoryStorage(),
  sessionStorage: memoryStorage(),
  location: { hostname: 'localhost', origin: 'http://localhost', pathname: '/', search: '', hash: '', port: '' },
  fetch: async () => { throw new Error('offline'); },
  setTimeout: () => 0,
  clearTimeout() {},
  BroadcastChannel: function () { this.postMessage = () => {}; this.close = () => {}; },
  crypto: require('crypto').webcrypto,
};
context.window = context;
vm.createContext(context);
for (const file of ['js/questions.js', 'js/deck.js', 'js/net.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}

const { JLDeck, JLNet } = context;
const pile = JLDeck.buildPile();
assert.strictEqual(pile.length, 84, 'deck should contain 84 cards');
assert.strictEqual(new Set(pile.map((c) => c.uid)).size, pile.length, 'card IDs must be unique');
assert.strictEqual(JLDeck.CURSES.length, 24, 'deck should contain 24 curses');

const table = JLDeck.emptyTable('L');
const drawn = JLDeck.draw(table, 4);
JLDeck.keepFromDrawn(table, drawn, [drawn[0].uid, drawn[1].uid]);
assert.strictEqual(table.hand.length, 2);
assert.strictEqual(table.discard.length, 2);
assert.strictEqual(table.drawPile.length + table.hand.length + table.discard.length, 84, 'cards must never disappear');

(async () => {
  const seeker = await JLNet.create({ size: 'L', presetName: 'Test' });
  assert.strictEqual(seeker.role, 'seeker');
  await assert.rejects(() => JLNet.send('question.answer', { answer: 'yes' }), /Only the hider/);

  const code = seeker.code;
  const hider = await JLNet.join(code, 'hider');
  assert.strictEqual(hider.role, 'hider');
  await assert.rejects(() => JLNet.send('question.ask', { title: 'Nope' }), /Only seekers/);
  await JLNet.send('cards.sync', { overflowingLeft: 0, handCount: 2 });
  assert.strictEqual(JLNet.room.overflowingLeft, 0, 'Chalice counter must synchronize down to zero');

  await JLNet.leave();
  const host = await JLNet.join(code, 'seeker');
  await JLNet.send('timer', {
    phase: 'hiding', running: true, hideStartedAt: Date.now(), hideElapsedMs: 0,
    pauseVotes: { seeker: false, hider: false }, resumeVotes: { seeker: false, hider: false },
  });
  await JLNet.send('timer.vote', { action: 'pause' });
  assert.strictEqual(JLNet.room.timer.running, true, 'seeker vote alone must not pause a linked game');
  assert.strictEqual(JLNet.room.timer.pauseVotes.seeker, true);
  await JLNet.leave();
  await JLNet.join(code, 'hider');
  await JLNet.send('timer.vote', { action: 'pause' });
  assert.strictEqual(JLNet.room.timer.running, false, 'both votes should pause the timer');

  await JLNet.send('curse.play', { id: 'c-test', name: 'The Lemon Phylactery', effect: 'Find a lemon.' });
  assert.strictEqual(JLNet.room.activeCurses.length, 1);
  await JLNet.leave();
  await JLNet.join(code, 'seeker');
  await assert.rejects(
    () => JLNet.send('curse.clear', { id: 'c-test', name: 'The Lemon Phylactery' }),
    /hider/,
    'seekers must not clear a curse themselves'
  );
  await JLNet.send('curse.proof', { id: 'c-test', photo: 'data:image/jpeg;base64,xx', note: 'lemon on shirt' });
  assert.ok(JLNet.room.activeCurses[0].proof, 'seekers can send proof');
  await JLNet.leave();
  await JLNet.join(code, 'hider');
  await JLNet.send('curse.clear', { id: 'c-test', name: 'The Lemon Phylactery' });
  assert.strictEqual(JLNet.room.activeCurses.length, 0, 'hider confirms the curse is cleared');

  await JLNet.leave();
  const solo = await JLNet.create({ size: 'L', presetName: 'Wipe' });
  const soloCode = solo.code;
  await JLNet.leave();
  await assert.rejects(() => JLNet.join(soloCode, 'hider'), /No game/, 'last player leave must wipe the room');

  JLNet.stop();
  console.log('game logic tests passed');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
