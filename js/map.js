/* Leaflet map, tiles, inverse masks, stations, overlays */
(function (global) {
  let map;
  let roadsLight;
  let roadsDark;
  let railLayer;
  let oobLayer;
  let ruledLayer;
  let flashLayer;
  let previewLayer;
  let stationLayer;
  let pinLayer;
  let zoneLayer;
  let drawLayer;
  let playableOutline;

  const HATCH_OOB = "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
      <rect width="10" height="10" fill="#070b14"/>
      <path d="M0 10 L10 0" stroke="#1a2336" stroke-width="1"/>
    </svg>`
  );
  const HATCH_OUT = "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
      <rect width="10" height="10" fill="#2a1520"/>
      <path d="M0 10 L10 0" stroke="#6b3044" stroke-width="1"/>
    </svg>`
  );

  function init(el) {
    const start = (global.__jlStartView) || { center: [30, 10], zoom: 3 };
    map = L.map(el, {
      zoomControl: false,
      minZoom: 2,
      maxZoom: 18,
      worldCopyJump: true,
      attributionControl: true,
      tap: false,
      tapTolerance: 25,
    }).setView(start.center, start.zoom);

    L.control.zoom({ position: "bottomright" }).addTo(map);

    roadsLight = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OSM &copy; CARTO',
      subdomains: "abcd",
      maxZoom: 20,
    });
    roadsDark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OSM &copy; CARTO',
      subdomains: "abcd",
      maxZoom: 20,
    });
    railLayer = L.tileLayer("https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenRailwayMap',
      maxZoom: 19,
      opacity: 0.85,
    });

    roadsDark.addTo(map);
    railLayer.addTo(map);

    oobLayer = L.layerGroup().addTo(map);
    ruledLayer = L.layerGroup().addTo(map);
    flashLayer = L.layerGroup().addTo(map);
    playableOutline = L.geoJSON(null, {
      style: { color: "#f5c15c", weight: 1.5, opacity: 0.85, fill: false, dashArray: "6 8" },
    }).addTo(map);
    previewLayer = L.layerGroup().addTo(map);
    zoneLayer = L.layerGroup().addTo(map);
    stationLayer = L.layerGroup().addTo(map);
    pinLayer = L.layerGroup().addTo(map);
    drawLayer = L.layerGroup().addTo(map);

    map.attributionControl.setPrefix("");
    return map;
  }

  function getMap() {
    return map;
  }

  function setDark(on) {
    if (!map) return;
    if (on) {
      if (map.hasLayer(roadsLight)) map.removeLayer(roadsLight);
      if (!map.hasLayer(roadsDark)) roadsDark.addTo(map);
    } else {
      if (map.hasLayer(roadsDark)) map.removeLayer(roadsDark);
      if (!map.hasLayer(roadsLight)) roadsLight.addTo(map);
    }
    if (map.hasLayer(railLayer)) railLayer.bringToFront();
  }

  function setRail(on) {
    if (!map) return;
    if (on && !map.hasLayer(railLayer)) railLayer.addTo(map);
    if (!on && map.hasLayer(railLayer)) map.removeLayer(railLayer);
  }

  function clearGroup(g) {
    if (g) g.clearLayers();
  }

  let lastPlayableRef = null;
  let lastRemainingRef = null;
  let flashTimer = null;

  function paintMasks(playable, remaining) {
    // Nothing changed — keep the current layers (also prevents animation flicker)
    if (playable === lastPlayableRef && remaining === lastRemainingRef) return;
    const prevRemaining = lastRemainingRef;
    const samePlayable = playable === lastPlayableRef;
    lastPlayableRef = playable;
    lastRemainingRef = remaining;

    clearGroup(oobLayer);
    clearGroup(ruledLayer);
    playableOutline.clearLayers();

    if (playable) {
      const maskLatLngs = JLGeo.featureToLeafletMask(playable);
      L.polygon(maskLatLngs, {
        stroke: false,
        fillColor: "#070b14",
        fillOpacity: 0.78,
        interactive: false,
        pane: "overlayPane",
      }).addTo(oobLayer);

      playableOutline.addData(JLGeo.asFeature(playable));
    }

    if (remaining) {
      L.geoJSON(JLGeo.asFeature(remaining), {
        style: {
          stroke: false,
          fillColor: "#d7e7ff",
          fillOpacity: 0.07,
          interactive: false,
        },
      }).addTo(oobLayer);
    }

    if (playable && remaining) {
      const ruled = JLGeo.safeDifference(playable, remaining);
      if (ruled) {
        L.geoJSON(ruled, {
          style: {
            stroke: false,
            fillColor: "#6b3044",
            fillOpacity: 0.5,
            interactive: false,
          },
        }).addTo(ruledLayer);

        L.geoJSON(ruled, {
          style: {
            color: "#c45a72",
            weight: 1,
            opacity: 0.35,
            fill: false,
            interactive: false,
          },
        }).addTo(ruledLayer);
      }
    }

    // Animate the change: flash the area that was just cut (or restored by undo)
    if (samePlayable && prevRemaining && remaining && prevRemaining !== remaining) {
      animateRemainingChange(prevRemaining, remaining);
    }
  }

  function animateRemainingChange(prev, next) {
    let prevArea = 0;
    let nextArea = 0;
    try {
      prevArea = turf.area(JLGeo.asFeature(prev));
      nextArea = turf.area(JLGeo.asFeature(next));
    } catch { return; }
    const eps = Math.max(prevArea, nextArea, 1) * 0.0005;
    if (Math.abs(prevArea - nextArea) <= eps) return;
    const shrank = nextArea < prevArea;

    // "Keep inside": most of the map was eliminated. Celebrate what is LEFT and
    // frame it, instead of flashing (and zooming out to) the huge removed region.
    // Also skips the expensive polygon difference for this case.
    if (shrank && nextArea < prevArea * 0.6) {
      flashArea(next, "keep");
      focusRemaining(next);
      return;
    }

    let diff = null;
    try {
      diff = shrank ? JLGeo.safeDifference(prev, next) : JLGeo.safeDifference(next, prev);
    } catch { /* ignore */ }
    if (!diff) return;
    flashArea(diff, shrank ? "cut" : "restore");
    ensureVisible(diff);
  }

  const FLASH_STYLES = {
    cut:     { color: "#ff8ba1", fillColor: "#ff5f7e", weight: 2, cls: "jl-flash jl-flash--cut" },
    restore: { color: "#8be8d5", fillColor: "#3dbaa4", weight: 2, cls: "jl-flash jl-flash--restore" },
    keep:    { color: "#ffd489", fillColor: "#e8b04a", weight: 3, cls: "jl-flash jl-flash--keep" },
  };

  function flashArea(feature, kind) {
    if (!flashLayer) return;
    clearGroup(flashLayer);
    const st = FLASH_STYLES[kind] || FLASH_STYLES.cut;
    L.geoJSON(JLGeo.asFeature(feature), {
      style: {
        color: st.color,
        weight: st.weight,
        fillColor: st.fillColor,
        fillOpacity: 0.7,
        interactive: false,
        className: st.cls,
      },
    }).addTo(flashLayer);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => clearGroup(flashLayer), 1800);
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /* Frame the remaining area — zooms in or out to fit what is left in play */
  function focusRemaining(feature) {
    if (!map || !feature) return;
    try {
      const b = turf.bbox(JLGeo.asFeature(feature));
      if (!isFinite(b[0]) || !isFinite(b[3])) return;
      const target = L.latLngBounds([b[1], b[0]], [b[3], b[2]]);
      if (reducedMotion()) map.fitBounds(target, { padding: [70, 70], maxZoom: 14, animate: false });
      else map.flyToBounds(target, { padding: [70, 70], maxZoom: 14, duration: 1.0 });
    } catch { /* ignore */ }
  }

  /* Zoom out (never in) just enough to keep a gameplay feature in view */
  function ensureVisible(feature, opts) {
    if (!map || !feature) return;
    try {
      const b = turf.bbox(JLGeo.asFeature(feature));
      if (!isFinite(b[0]) || !isFinite(b[3])) return;
      // Ignore world-spanning shapes (e.g. half-plane fallbacks)
      if (Math.max(b[2] - b[0], b[3] - b[1]) > 45) return;
      const target = L.latLngBounds([b[1], b[0]], [b[3], b[2]]);
      const view = map.getBounds();
      if (view.pad(-0.04).contains(target)) return;
      const merged = view.extend(target);
      const o = Object.assign({ padding: [60, 60], maxZoom: map.getZoom(), duration: 0.9 }, opts || {});
      if (reducedMotion()) map.fitBounds(merged, { padding: o.padding, maxZoom: o.maxZoom, animate: false });
      else map.flyToBounds(merged, o);
    } catch { /* ignore */ }
  }

  function fitPlayable(playable) {
    if (!playable || !map) return;
    try {
      const b = turf.bbox(JLGeo.asFeature(playable));
      map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [40, 40], maxZoom: 11 });
    } catch { /* ignore */ }
  }

  function clearPreview() {
    clearGroup(previewLayer);
  }

  function showPreview(feature, opts) {
    clearPreview();
    if (!feature) return;
    L.geoJSON(feature, {
      style: Object.assign({
        color: "#f5c15c",
        weight: 2,
        fillColor: "#f5c15c",
        fillOpacity: 0.18,
        dashArray: "5 4",
        className: "jl-preview",
      }, opts || {}),
    }).addTo(previewLayer);
    ensureVisible(feature);
  }

  function showPreviewMulti(features, opts) {
    clearPreview();
    (features || []).forEach((f) => {
      if (!f) return;
      L.geoJSON(f, {
        style: Object.assign({
          color: "#f5c15c",
          weight: 1.5,
          fillColor: "#f5c15c",
          fillOpacity: 0.12,
          dashArray: "4 4",
        }, opts || {}),
      }).addTo(previewLayer);
    });
  }

  function seekerIcon(label) {
    return L.divIcon({
      className: "jl-pin",
      html: `<span class="jl-pin__dot"></span><span class="jl-pin__label">${label || "Seeker"}</span>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
  }

  function stationIcon(active) {
    return L.divIcon({
      className: "jl-st" + (active ? " is-in" : " is-out"),
      html: `<span></span>`,
      iconSize: [10, 10],
      iconAnchor: [5, 5],
    });
  }

  function clearPins() {
    clearGroup(pinLayer);
  }

  function addPin(latlng, label) {
    return L.marker(latlng, { icon: seekerIcon(label), zIndexOffset: 800 }).addTo(pinLayer);
  }

  function renderStations(stations, remaining, onClick) {
    clearGroup(stationLayer);
    const zoom = map ? map.getZoom() : 3;
    if (zoom < 11) return;
    const max = 250;
    const list = stations.length > max ? stations.slice(0, max) : stations;
    list.forEach((s) => {
      const inside = !remaining || JLGeo.contains(remaining, s);
      const m = L.marker([s.lat, s.lng], {
        icon: stationIcon(inside),
        opacity: inside ? 1 : 0.25,
        keyboard: false,
      });
      m.bindTooltip(s.name, { direction: "top", offset: [0, -6], className: "jl-tip" });
      if (onClick) m.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onClick(s);
      });
      m.addTo(stationLayer);
    });
  }

  function renderZones(zones) {
    clearGroup(zoneLayer);
    (zones || []).forEach((z) => {
      L.circle([z.lat, z.lng], {
        radius: z.miles * 1609.34,
        color: "#7dd3c0",
        weight: 2,
        fillColor: "#7dd3c0",
        fillOpacity: 0.12,
        dashArray: "2 6",
      }).addTo(zoneLayer);
      L.circleMarker([z.lat, z.lng], {
        radius: 5,
        color: "#7dd3c0",
        fillColor: "#0b1220",
        fillOpacity: 1,
        weight: 2,
      }).bindTooltip(z.name || "Hiding zone", { className: "jl-tip" }).addTo(zoneLayer);
    });
  }

  function drawGroup() {
    return drawLayer;
  }

  function invalidate() {
    if (map) setTimeout(() => map.invalidateSize(), 60);
  }

  global.JLMap = {
    init,
    getMap,
    setDark,
    setRail,
    paintMasks,
    fitPlayable,
    ensureVisible,
    focusRemaining,
    clearPreview,
    showPreview,
    showPreviewMulti,
    clearPins,
    addPin,
    renderStations,
    renderZones,
    drawGroup,
    invalidate,
    HATCH_OOB,
    HATCH_OUT,
  };
})(window);
