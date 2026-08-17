/* Overpass + Nominatim — stations, POIs, admin areas */
(function (global) {
  const MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
  ];

  const cache = new Map();
  const inflight = new Map();

  function bboxFromMap(map) {
    const b = map.getBounds();
    return `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
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

    const body = ql;
    const job = (async () => {
      let lastErr;
      for (const url of MIRRORS) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 28000);
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body,
            signal: ctrl.signal,
          });
          clearTimeout(t);
          if (!res.ok) throw new Error("Overpass " + res.status);
          const data = await res.json();
          cache.set(ck, data);
          return data;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr || new Error("Overpass unavailable");
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
