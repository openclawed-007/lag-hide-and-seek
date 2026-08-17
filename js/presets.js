/* Jet Lag Hide + Seek — region presets */
(function (global) {
  const SHOW = "show";
  const METRO = "metro";
  const COUNTRY = "country";

  const PRESETS = [
    { id: "japan", name: "Japan", iso: "JPN", kind: SHOW, season: "S6 · S12", emoji: "🇯🇵", center: [36.5, 138.0], zoom: 5.4, sizeHint: "L", focus: [[24.0, 122.9], [45.8, 146.0]] },
    { id: "switzerland", name: "Switzerland", iso: "CHE", kind: SHOW, season: "S9", emoji: "🇨🇭", center: [46.8, 8.2], zoom: 7.4, sizeHint: "L" },
    { id: "uk", name: "United Kingdom", iso: "GBR", kind: SHOW, season: "S16", emoji: "🇬🇧", center: [54.2, -2.5], zoom: 5.8, sizeHint: "L" },
    { id: "new-zealand", name: "New Zealand", iso: "NZL", kind: SHOW, season: "S11", emoji: "🇳🇿", center: [-41.2, 173.0], zoom: 5.4, sizeHint: "L" },
    { id: "south-korea", name: "South Korea", iso: "KOR", kind: SHOW, season: "S14", emoji: "🇰🇷", center: [36.4, 127.8], zoom: 7.0, sizeHint: "L" },
    { id: "taiwan", name: "Taiwan", iso: "TWN", kind: SHOW, season: "S17", emoji: "🇹🇼", center: [23.7, 121.0], zoom: 7.2, sizeHint: "L" },
    { id: "netherlands", name: "Netherlands", iso: "NLD", kind: SHOW, season: "Home games", emoji: "🇳🇱", center: [52.15, 5.3], zoom: 7.4, sizeHint: "L" },
    { id: "usa", name: "United States", iso: "USA", kind: SHOW, season: "S8 · S18", emoji: "🇺🇸", center: [39.8, -98.5], zoom: 4.2, sizeHint: "L" },
    { id: "canada", name: "Canada", iso: "CAN", kind: SHOW, season: "S18", emoji: "🇨🇦", center: [56.1, -96.0], zoom: 3.6, sizeHint: "L" },
    { id: "australia", name: "Australia", iso: "AUS", kind: SHOW, season: "S10", emoji: "🇦🇺", center: [-25.3, 134.0], zoom: 4.2, sizeHint: "L" },

    { id: "london", name: "Greater London", kind: METRO, emoji: "🚇", center: [51.507, -0.127], zoom: 11, sizeHint: "M", bbox: [51.28, -0.51, 51.70, 0.33] },
    { id: "nyc", name: "New York City", kind: METRO, emoji: "🗽", center: [40.73, -73.98], zoom: 11, sizeHint: "M", bbox: [40.49, -74.26, 40.92, -73.70] },
    { id: "tokyo", name: "Tokyo", kind: METRO, emoji: "🗼", center: [35.68, 139.76], zoom: 10.5, sizeHint: "M", bbox: [35.52, 139.45, 35.90, 139.95] },
    { id: "hong-kong", name: "Hong Kong", kind: METRO, emoji: "🏙️", center: [22.32, 114.17], zoom: 11, sizeHint: "M", bbox: [22.15, 113.83, 22.56, 114.41] },
    { id: "paris", name: "Paris", kind: METRO, emoji: "🇫🇷", center: [48.86, 2.35], zoom: 11, sizeHint: "M", bbox: [48.75, 2.15, 48.99, 2.52] },
    { id: "berlin", name: "Berlin", kind: METRO, emoji: "🇩🇪", center: [52.52, 13.40], zoom: 11, sizeHint: "M", bbox: [52.33, 13.08, 52.68, 13.77] },
    { id: "amsterdam", name: "Amsterdam", kind: METRO, emoji: "🚲", center: [52.37, 4.90], zoom: 11.2, sizeHint: "M", bbox: [52.28, 4.73, 52.43, 5.08] },
    { id: "seoul", name: "Seoul", kind: METRO, emoji: "🇰🇷", center: [37.57, 126.98], zoom: 11, sizeHint: "M", bbox: [37.42, 126.76, 37.70, 127.18] },
    { id: "taipei", name: "Taipei", kind: METRO, emoji: "🇹🇼", center: [25.04, 121.56], zoom: 11, sizeHint: "M", bbox: [24.94, 121.43, 25.19, 121.67] },
    { id: "zurich", name: "Zurich", kind: METRO, emoji: "🇨🇭", center: [47.38, 8.54], zoom: 11.2, sizeHint: "M", bbox: [47.32, 8.44, 47.44, 8.63] },
    { id: "munich", name: "Munich", kind: METRO, emoji: "🇩🇪", center: [48.14, 11.58], zoom: 11, sizeHint: "M", bbox: [48.06, 11.36, 48.25, 11.74] },
    { id: "glasgow", name: "Glasgow", kind: METRO, emoji: "🇬🇧", center: [55.86, -4.26], zoom: 11.2, sizeHint: "M", bbox: [55.78, -4.45, 55.93, -4.07] },
    { id: "contig-us", name: "Contiguous US", kind: METRO, emoji: "🗺️", center: [39.5, -98.0], zoom: 4.4, sizeHint: "L", bbox: [24.5, -125.0, 49.4, -66.9] },

    { id: "germany", name: "Germany", iso: "DEU", kind: COUNTRY, emoji: "🇩🇪", center: [51.16, 10.45], zoom: 6, sizeHint: "L" },
    { id: "france", name: "France", iso: "FRA", kind: COUNTRY, emoji: "🇫🇷", center: [46.6, 2.4], zoom: 6, sizeHint: "L" },
    { id: "italy", name: "Italy", iso: "ITA", kind: COUNTRY, emoji: "🇮🇹", center: [42.5, 12.6], zoom: 6, sizeHint: "L" },
    { id: "ireland", name: "Ireland", iso: "IRL", kind: COUNTRY, emoji: "🇮🇪", center: [53.4, -8.0], zoom: 7, sizeHint: "L" },
    { id: "belgium", name: "Belgium", iso: "BEL", kind: COUNTRY, emoji: "🇧🇪", center: [50.6, 4.5], zoom: 8, sizeHint: "L" },
    { id: "austria", name: "Austria", iso: "AUT", kind: COUNTRY, emoji: "🇦🇹", center: [47.6, 13.3], zoom: 7.2, sizeHint: "L" },
    { id: "spain", name: "Spain", iso: "ESP", kind: COUNTRY, emoji: "🇪🇸", center: [40.2, -3.7], zoom: 6, sizeHint: "L" },
    { id: "sweden", name: "Sweden", iso: "SWE", kind: COUNTRY, emoji: "🇸🇪", center: [62.2, 16.0], zoom: 4.8, sizeHint: "L" },
    { id: "denmark", name: "Denmark", iso: "DNK", kind: COUNTRY, emoji: "🇩🇰", center: [56.0, 10.0], zoom: 7, sizeHint: "L" },
    { id: "norway", name: "Norway", iso: "NOR", kind: COUNTRY, emoji: "🇳🇴", center: [64.5, 11.0], zoom: 4.6, sizeHint: "L" },
    { id: "portugal", name: "Portugal", iso: "PRT", kind: COUNTRY, emoji: "🇵🇹", center: [39.6, -8.0], zoom: 7, sizeHint: "L" },
    { id: "czechia", name: "Czechia", iso: "CZE", kind: COUNTRY, emoji: "🇨🇿", center: [49.8, 15.5], zoom: 7.4, sizeHint: "L" },
    { id: "poland", name: "Poland", iso: "POL", kind: COUNTRY, emoji: "🇵🇱", center: [52.1, 19.4], zoom: 6.2, sizeHint: "L" },
  ];

  const GEO_SOURCES = [
    (iso) => `data/countries/${iso}.json?v=2`,
    (iso) => `https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries/${iso}.geo.json`,
    (iso) => `https://raw.githubusercontent.com/johan/world.geo.json/master/countries/${iso}.geo.json`,
  ];

  function bboxPolygon(bbox) {
    const [s, w, n, e] = bbox;
    return {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
      },
    };
  }

  async function fetchCountry(iso) {
    let lastErr;
    for (const src of GEO_SOURCES) {
      try {
        const res = await fetch(src(iso), { cache: "no-cache" });
        if (!res.ok) throw new Error(res.status + " " + iso);
        const gj = await res.json();
        if (gj.type === "FeatureCollection") {
          if (!gj.features?.length) throw new Error("empty collection");
          if (gj.features.length === 1) return gj.features[0];
          return turf.combine(turf.flatten(gj)).features[0] || gj.features[0];
        }
        if (gj.type === "Feature") return gj;
        return { type: "Feature", properties: {}, geometry: gj };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("Could not load " + iso);
  }

  async function loadBoundary(preset) {
    if (preset.bbox) return bboxPolygon(preset.bbox);
    if (preset.iso) {
      const feat = await fetchCountry(preset.iso);
      if (feat.properties && feat.properties.iso) return feat;
      const simplified = turf.simplify(feat, { tolerance: simplifyTol(preset.iso), highQuality: false });
      return turf.cleanCoords(simplified);
    }
    throw new Error("Preset has no boundary");
  }

  function simplifyTol(iso) {
    if (["USA", "CAN", "AUS", "RUS"].includes(iso)) return 0.08;
    if (["GBR", "JPN", "NOR", "SWE", "IDN"].includes(iso)) return 0.03;
    return 0.015;
  }

  global.JLPresets = { PRESETS, SHOW, METRO, COUNTRY, loadBoundary, bboxPolygon, fetchCountry };
})(window);
