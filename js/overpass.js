/* Overpass + Nominatim — stations, POIs, admin areas */
(function (global) {
  /* Ordered by observed reliability. The main .de instance rate-limits and 504s
     under load (browsers report those as CORS failures). mail.ru is a full mirror
     with area data (needed for is_in admin queries); kumi is flaky and lacks
     areas, so it is a last resort for simple POI lookups only. */
  const MIRRORS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];

  const cache = new Map();
  const inflight = new Map();
  const penaltyUntil = new Map(); // mirror -> timestamp to skip until
  let preferredMirror = null;
  try { preferredMirror = localStorage.getItem("lag-overpass-mirror"); } catch { /* ignore */ }

  function mirrorOrder() {
    const now = Date.now();
    const list = MIRRORS.slice();
    if (preferredMirror && list.includes(preferredMirror)) {
      list.splice(list.indexOf(preferredMirror), 1);
      list.unshift(preferredMirror);
    }
    // Healthy mirrors first; penalized ones as a last resort
    const ok = list.filter((u) => (penaltyUntil.get(u) || 0) <= now);
    const bad = list.filter((u) => (penaltyUntil.get(u) || 0) > now);
    return ok.concat(bad);
  }

  function penalize(url, ms) {
    penaltyUntil.set(url, Date.now() + ms);
  }

  function rememberGood(url) {
    preferredMirror = url;
    try { localStorage.setItem("lag-overpass-mirror", url); } catch { /* ignore */ }
  }

  function bboxFromMap(map) {
    const b = map.getBounds();
    // Quantize outward (~110m grid) so tiny pans hit the query cache
    const q = (v, up) => (up ? Math.ceil(v * 1000) / 1000 : Math.floor(v * 1000) / 1000);
    return `${q(b.getSouth(), false)},${q(b.getWest(), false)},${q(b.getNorth(), true)},${q(b.getEast(), true)}`;
  }

  function bboxFromFeature(feature) {
    const box = turf.bbox(JLGeo.asFeature(feature));
    return `${box[1]},${box[0]},${box[3]},${box[2]}`;
  }

  function bboxFromLatLngRadius(latlng, miles) {
    const c = turf.point([latlng.lng, latlng.lat]);
    const buffered = turf.buffer(c, miles, { units: "miles" });
    const box = turf.bbox(buffered);
    return `${box[1]},${box[0]},${box[3]},${box[2]}`;
  }

  async function query(ql, key) {
    const ck = key || ql;
    if (cache.has(ck)) return cache.get(ck);
    if (inflight.has(ck)) return inflight.get(ck);

    // Form-encoded "data=" is what Overpass instances canonically accept,
    // and it stays a CORS "simple request" (no preflight to reject).
    const body = "data=" + encodeURIComponent(ql);
    const job = (async () => {
      let lastErr;
      for (const url of mirrorOrder()) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 16000);
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
            signal: ctrl.signal,
          });
          clearTimeout(t);
          if (!res.ok) {
            // Rate-limited / overloaded: rest this mirror longer
            penalize(url, res.status === 429 || res.status === 504 ? 90000 : 30000);
            throw new Error("Overpass " + res.status);
          }
          const data = await res.json();
          rememberGood(url);
          cache.set(ck, data);
          return data;
        } catch (err) {
          if (err && err.name === "AbortError") penalize(url, 45000);
          else if (!penaltyUntil.has(url) || penaltyUntil.get(url) < Date.now()) penalize(url, 30000);
          lastErr = err;
        }
      }
      throw lastErr || new Error("All Overpass mirrors are busy — try again shortly.");
    })();

    inflight.set(ck, job);
    try {
      return await job;
    } finally {
      inflight.delete(ck);
    }
  }

  function nameOf(tags) {
    if (!tags) return "Unnamed";
    return tags.name || tags["name:en"] || tags.ref || tags.iata || "Unnamed";
  }

  function elementsToPoints(data) {
    const out = [];
    const seen = new Set();
    for (const el of data.elements || []) {
      let lat = el.lat;
      let lng = el.lon;
      if (lat == null && el.center) {
        lat = el.center.lat;
        lng = el.center.lon;
      }
      if (lat == null && el.type === "way" && el.geometry?.length) {
        const mid = el.geometry[Math.floor(el.geometry.length / 2)];
        lat = mid.lat;
        lng = mid.lon;
      }
      if (lat == null) continue;
      const id = el.type + "/" + el.id;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        lat,
        lng,
        name: nameOf(el.tags),
        tags: el.tags || {},
        type: el.type,
      });
    }
    return out;
  }

  function elementsToLines(data) {
    const lines = [];
    for (const el of data.elements || []) {
      if (el.type === "way" && el.geometry?.length >= 2) {
        lines.push({
          id: "way/" + el.id,
          name: nameOf(el.tags),
          tags: el.tags || {},
          coords: el.geometry.map((g) => [g.lon, g.lat]),
        });
      }
    }
    return lines;
  }

  async function stationsInBbox(bbox, transit) {
    const filters = [];
    if (!transit || transit.rail) {
      filters.push(`node["railway"="station"](${bbox});`);
      filters.push(`node["railway"="halt"](${bbox});`);
    }
    if (!transit || transit.metro) {
      filters.push(`node["station"="subway"](${bbox});`);
      filters.push(`node["railway"="station"]["station"="subway"](${bbox});`);
    }
    if (!transit || transit.light) {
      filters.push(`node["railway"="station"]["station"="light_rail"](${bbox});`);
    }
    if (!transit || transit.tram) {
      filters.push(`node["railway"="tram_stop"](${bbox});`);
    }
    filters.push(`node["public_transport"="station"]["railway"](${bbox});`);
    const ql = `[out:json][timeout:25];(${filters.join("")});out body;`;
    const data = await query(ql, "st:" + bbox + JSON.stringify(transit || {}));
    return elementsToPoints(data);
  }

  const POI_QL = {
    airport: (b) => `nwr["aeroway"="aerodrome"]["iata"](${b});`,
    mountain: (b) => `nwr["natural"="peak"](${b});`,
    park: (b) => `nwr["leisure"="park"](${b});`,
    amusement: (b) => `nwr["tourism"="theme_park"](${b});`,
    zoo: (b) => `nwr["tourism"="zoo"](${b});`,
    aquarium: (b) => `nwr["tourism"="aquarium"](${b});`,
    golf: (b) => `nwr["leisure"="golf_course"](${b});`,
    museum: (b) => `nwr["tourism"="museum"](${b});`,
    theater: (b) => `nwr["amenity"="cinema"](${b});`,
    hospital: (b) => `nwr["amenity"="hospital"](${b});`,
    library: (b) => `nwr["amenity"="library"](${b});`,
    consulate: (b) => `nwr["office"~"diplomatic|embassy|consulate"](${b});`,
    water: (b) => `nwr["natural"="water"]["name"](${b});nwr["waterway"="riverbank"]["name"](${b});`,
    coastline: (b) => `way["natural"="coastline"](${b});`,
    hsr: (b) => `way["railway"="rail"]["highspeed"="yes"](${b});way["railway"="rail"]["usage"="main"]["highspeed"="yes"](${b});`,
    metro: (b) => `way["railway"="subway"](${b});way["route"="subway"](${b});`,
    "rail-station": (b) => `node["railway"="station"](${b});node["railway"="halt"](${b});node["station"="subway"](${b});`,
  };

  async function pois(kind, bbox) {
    const builder = POI_QL[kind];
    if (!builder) throw new Error("Unknown POI class: " + kind);
    const ql = `[out:json][timeout:25];(${builder(bbox)});out center tags;`;
    const data = await query(ql, kind + ":" + bbox);
    return {
      points: elementsToPoints(data),
      lines: elementsToLines(data),
    };
  }

  const ADMIN_LEVEL = { admin1: "4", admin2: "6", admin3: "8", admin4: "10" };

  async function adminAt(latlng, which) {
    const level = ADMIN_LEVEL[which] || "4";
    const ql = `[out:json][timeout:25];
      is_in(${latlng.lat},${latlng.lng})->.a;
      area.a["admin_level"="${level}"];
      rel(pivot.a)["admin_level"="${level}"];
      out geom;`;
    const data = await query(ql, `admin:${level}:${latlng.lat.toFixed(4)},${latlng.lng.toFixed(4)}`);
    const rel = (data.elements || []).find((e) => e.type === "relation");
    if (!rel) return null;
    return relationToPolygon(rel);
  }

  async function adminBorders(which, bbox) {
    const level = which === "intl-border" ? "2" : which === "admin1-border" ? "4" : "6";
    const ql = `[out:json][timeout:25];
      rel["boundary"="administrative"]["admin_level"="${level}"](${bbox});
      out geom;`;
    const data = await query(ql, `border:${level}:${bbox}`);
    const feats = [];
    for (const el of data.elements || []) {
      const f = relationToPolygon(el);
      if (f) feats.push(f);
    }
    return feats;
  }

  function relationToPolygon(rel) {
    if (!rel) return null;
    const outers = [];
    if (rel.members) {
      for (const m of rel.members) {
        if (m.role !== "outer" && m.role !== "") continue;
        if (!m.geometry || m.geometry.length < 3) continue;
        const ring = m.geometry.map((g) => [g.lon, g.lat]);
        if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
          ring.push(ring[0]);
        }
        if (ring.length >= 4) outers.push(ring);
      }
    }
    if (!outers.length && rel.geometry) {
      const ring = rel.geometry.map((g) => [g.lon, g.lat]);
      if (ring.length >= 4) {
        ring.push(ring[0]);
        outers.push(ring);
      }
    }
    if (!outers.length) return null;
    try {
      if (outers.length === 1) {
        return turf.polygon(outers, { name: nameOf(rel.tags), id: "rel/" + rel.id });
      }
      return turf.multiPolygon(outers.map((r) => [r]), { name: nameOf(rel.tags), id: "rel/" + rel.id });
    } catch {
      return turf.polygon([outers[0]], { name: nameOf(rel.tags), id: "rel/" + rel.id });
    }
  }

  function filterIn(playable, points) {
    if (!playable) return points;
    return points.filter((p) => JLGeo.contains(playable, p));
  }

  global.JLOverpass = {
    bboxFromMap,
    bboxFromFeature,
    bboxFromLatLngRadius,
    query,
    stationsInBbox,
    pois,
    adminAt,
    adminBorders,
    filterIn,
    elementsToPoints,
    nameOf,
  };
})(window);
