# LAG — Hide + Seek map

A fan-made map companion for **Jet Lag: The Game — Hide + Seek**.

Pick a country or metro, cut everything outside the agreed borders, then shrink the remaining ground with the official question tools: radar, thermometer, measuring, matching, tentacles, and photos.

Not affiliated with Wendover Productions or Nebula.

## Run it

Any static server. From this folder:

```bash
python3 -m http.server 8877
```

Then open http://127.0.0.1:8877

Deep links: `/?map=switzerland`, `/?map=japan&size=L`, `/?map=london&units=km`.

## How to play on the map

1. Choose a **show map**, metro, or country. Set Small / Medium / Large.
2. **Open the map**. Out-of-bounds land is masked. Rail is an OpenRailwayMap overlay on OSM roads.
3. Zoom in and **Load stations in view** (or wait — it loads automatically past zoom 9).
4. Ask a question with the left tools, click the seeker position, pick the official answer, apply.
5. Ruled-out ground turns rose. The question log records wording and card cost so you can draw from a physical or official digital deck.

Keyboard: `1–6` tools, `Esc` cancel, `⌘/Ctrl+Z` undo.

## Data

- Borders: country GeoJSON (johan/world.geo.json) or metro bounding boxes
- Roads: CARTO Voyager / Dark Matter (OSM)
- Rail: OpenRailwayMap
- Stations & POIs: Overpass API

## Rules

Question list, costs, and size gates follow the community transcription of the official Hide + Seek rulebook: https://jetlag.denull.ru/en/rules/
