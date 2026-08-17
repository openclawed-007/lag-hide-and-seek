/* Turf helpers — remaining area, masks, half-planes, voronoi */
(function (global) {
  const WORLD = turf.polygon([[
    [-179.9, 85], [179.9, 85], [179.9, -85], [-179.9, -85], [-179.9, 85],
  ]]);

  function asFeature(g) {
    if (!g) return null;
    if (g.type === "Feature") return g;
    if (g.type === "FeatureCollection") {
      if (!g.features.length) return null;
      if (g.features.length === 1) return g.features[0];
      try {
        return unionAll(g.features);
      } catch {
        return g.features[0];
      }
    }
    return turf.feature(g);
  }

  function unionAll(features) {
    const clean = features.filter(Boolean).map(asFeature).filter(Boolean);
    if (!clean.length) return null;
    let acc = clean[0];
    for (let i = 1; i < clean.length; i++) {
      try {
        const u = turf.union(acc, clean[i]);
        if (u) acc = u;
      } catch {
        /* skip un-unionable piece */
      }
    }
    return acc;
  }

  function safeIntersect(a, b) {
    a = asFeature(a);
    b = asFeature(b);
    if (!a || !b) return null;
    try {
      return turf.intersect(a, b) || null;
    } catch (err) {
      try {
        const sa = turf.simplify(a, { tolerance: 0.002, highQuality: false });
        const sb = turf.simplify(b, { tolerance: 0.002, highQuality: false });
        return turf.intersect(sa, sb) || null;
      } catch {
        console.warn("intersect failed", err);
        return null;
      }
    }
  }

  function safeDifference(a, b) {
    a = asFeature(a);
    b = asFeature(b);
    if (!a) return null;
    if (!b) return a;
    try {
      return turf.difference(a, b);
    } catch (err) {
      try {
        const sa = turf.simplify(a, { tolerance: 0.002, highQuality: false });
        const sb = turf.simplify(b, { tolerance: 0.002, highQuality: false });
        return turf.difference(sa, sb);
      } catch {
        console.warn("difference failed", err);
        return a;
      }
    }
  }

  function clipKeep(remaining, shape) {
    return safeIntersect(remaining, shape);
  }

  function clipCut(remaining, shape) {
    const next = safeDifference(remaining, shape);
    return next || remaining;
  }

  function circleMiles(latlng, miles) {
    return turf.circle([latlng.lng, latlng.lat], miles, { units: "miles", steps: 64 });
  }

  function pt(latlng) {
    return turf.point([latlng.lng, latlng.lat]);
  }

  function distMiles(a, b) {
    return turf.distance(pt(a), pt(b), { units: "miles" });
  }

  function contains(poly, latlng) {
    if (!poly) return false;
    try {
      return turf.booleanPointInPolygon(pt(latlng), poly);
    } catch {
      return false;
    }
  }

  function areaSqMiles(poly) {
    if (!poly) return 0;
    try {
      return turf.area(poly) / 2589988.11;
    } catch {
      return 0;
    }
  }

  function halfPlane(start, end, hotter, reachMiles) {
    const a = pt(start);
    const b = pt(end);
    const mid = turf.midpoint(a, b);
    const bear = turf.bearing(a, b);
    const keepBear = hotter ? bear : bear + 180;
    const r = reachMiles || 4000;
    const p1 = turf.destination(mid, r, bear + 90, { units: "miles" });
    const p2 = turf.destination(mid, r, bear - 90, { units: "miles" });
    const p3 = turf.destination(p2, r, keepBear, { units: "miles" });
    const p4 = turf.destination(p1, r, keepBear, { units: "miles" });
    return turf.polygon([[
      p1.geometry.coordinates,
      p2.geometry.coordinates,
      p3.geometry.coordinates,
      p4.geometry.coordinates,
      p1.geometry.coordinates,
    ]]);
  }

  function thermoLine(start, end) {
    return turf.lineString([
      [start.lng, start.lat],
      [end.lng, end.lat],
    ]);
  }

  function voronoiCells(points, bbox) {
    if (points.length < 2) return [];
    const fc = turf.featureCollection(points.map((p, i) => {
      const f = pt(p);
      f.properties = { i, name: p.name || "", id: p.id || i };
      return f;
    }));
    const pad = 0.4;
    const box = bbox || turf.bbox(fc);
    const expanded = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
    let cells;
    try {
      cells = turf.voronoi(fc, { bbox: expanded });
    } catch (err) {
      console.warn("voronoi failed", err);
      return [];
    }
    return (cells.features || []).map((cell, idx) => {
      if (!cell || !cell.geometry) return null;
      const src = fc.features[idx] || points[idx];
      cell.properties = Object.assign({}, (src && src.properties) || {}, {
        i: idx,
        name: points[idx]?.name || "",
        id: points[idx]?.id || idx,
      });
      return cell;
    }).filter(Boolean);
  }

  function cellContaining(cells, latlng) {
    return cells.find((c) => contains(c, latlng)) || null;
  }

  function nearestPoint(latlng, points) {
    if (!points.length) return null;
    let best = points[0];
    let bestD = distMiles(latlng, points[0]);
    for (let i = 1; i < points.length; i++) {
      const d = distMiles(latlng, points[i]);
      if (d < bestD) {
        best = points[i];
        bestD = d;
      }
    }
    return { point: best, miles: bestD };
  }

  function leafletLatLngs(feature) {
    const f = asFeature(feature);
    if (!f) return [];
    const g = f.geometry;
    if (!g) return [];
    const ringToLL = (ring) => ring.map(([lng, lat]) => [lat, lng]);
    if (g.type === "Polygon") return [g.coordinates.map(ringToLL)];
    if (g.type === "MultiPolygon") return g.coordinates.map((poly) => poly.map(ringToLL));
    return [];
  }

  function worldMinus(feature) {
    const holes = [];
    const f = asFeature(feature);
    if (!f) return [WORLD];
    const g = f.geometry;
    const push = (poly) => {
      if (poly[0]) holes.push(poly[0]);
    };
    if (g.type === "Polygon") push(g.coordinates);
    if (g.type === "MultiPolygon") g.coordinates.forEach(push);
    if (!holes.length) return [WORLD];
    return turf.polygon([WORLD.geometry.coordinates[0], ...holes]);
  }

  function featureToLeafletMask(playable) {
    const worldRing = [[90, -180], [90, 180], [-90, 180], [-90, -180]];
    const holes = [];
    const f = asFeature(playable);
    if (!f) return [worldRing];
    const g = f.geometry;
    const addOuter = (coords) => {
      holes.push(coords[0].map(([lng, lat]) => [lat, lng]));
    };
    if (g.type === "Polygon") addOuter(g.coordinates);
    if (g.type === "MultiPolygon") g.coordinates.forEach(addOuter);
    return [worldRing, ...holes];
  }

  function polygonsOf(feature) {
    const f = asFeature(feature);
    if (!f) return [];
    if (f.geometry.type === "Polygon") return [f];
    if (f.geometry.type === "MultiPolygon") {
      return f.geometry.coordinates.map((coords) => turf.polygon(coords, f.properties || {}));
    }
    return [];
  }

  function bufferMiles(feature, miles) {
    try {
      return turf.buffer(asFeature(feature), miles, { units: "miles", steps: 32 });
    } catch {
      return null;
    }
  }

  function lineFromCoords(coords) {
    if (!coords || coords.length < 2) return null;
    return turf.lineString(coords);
  }

  function pointFeature(lat, lng, props) {
    const f = turf.point([lng, lat]);
    f.properties = props || {};
    return f;
  }

  global.JLGeo = {
    WORLD,
    asFeature,
    unionAll,
    safeIntersect,
    safeDifference,
    clipKeep,
    clipCut,
    circleMiles,
    pt,
    distMiles,
    contains,
    areaSqMiles,
    halfPlane,
    thermoLine,
    voronoiCells,
    cellContaining,
    nearestPoint,
    leafletLatLngs,
    worldMinus,
    featureToLeafletMask,
    polygonsOf,
    bufferMiles,
    lineFromCoords,
    pointFeature,
  };
})(window);
