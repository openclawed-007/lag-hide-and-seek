# LAG — Hide + Seek

A fan-made companion for **Jet Lag: The Game — Hide + Seek**. Seekers run the map. The hider joins with a QR code or a six-character room code, answers questions on their phone, draws from an official-style deck, and plays curses.

Not affiliated with Wendover Productions or Nebula.

## Live site

The production game runs on Firebase Hosting with Firestore room sync:

https://translate-python-372617.web.app

Linked games work across phones without running a local server. Firebase Hosting supplies HTTPS for GPS, camera access, and QR join links.

## Run locally

For local development, either use the Firebase emulator or the included LAN server:

```bash
firebase emulators:start
# or
python3 serve.py
```

The LAN server remains available as a fallback at http://127.0.0.1:8877 and HTTPS port 8878.

Deep links: `/?map=switzerland`, `/?map=japan&size=L`, `/?join=K7M2QX`.

## How a linked game works

1. **Seekers** choose Host the map, pick a country or metro, set Small / Medium / Large, then **Create game**.
2. An invite card shows a **QR code** and a **6-character code**. The hider scans the QR or types the code.
3. Seekers ask a radar, thermometer, measuring, matching, tentacle, or photo question and tap **Ask the hider**.
4. The hider answers on their phone (or plays Veto / Randomize). The seekers’ map updates from that answer.
5. After answering, the hider **draws and keeps** the official number of cards, then can play curses and powerups.

You can still apply an answer yourself if you already have it, or play the map solo.

## Hider deck

The in-app deck follows the community transcription of the official rulebook:

- Time bonuses (S / M / L values) count only if they are still in hand at the end
- Powerups: Veto, Randomize, discard/draw, expand hand, Duplicate, Move
- All 24 standard curses, including casting costs and the “one blocking curse at a time” rule
- Hand limit 6 (or 7–8 after the expand powerup)
- Overflowing Chalice adds one extra draw for the next three questions

Rules reference: https://jetlag.denull.ru/en/rules/

## Map tools

1. Choose a show map, metro, or country.
2. Out-of-bounds land is masked. Rail is an OpenRailwayMap overlay on OSM roads.
3. Zoom in and **Load stations in view** (or wait — it loads automatically past zoom 9).
4. Ask with the left tools. If a hider is linked, wait for their answer; otherwise apply it yourself.

Keyboard: `1–6` tools, `7` zone, `8` bounds, `Esc` cancel, `⌘/Ctrl+Z` undo.

## Data

- Borders: country GeoJSON (johan/world.geo.json) or metro bounding boxes
- Roads: CARTO Voyager / Dark Matter (OSM)
- Rail: OpenRailwayMap
- Stations & POIs: Overpass API
