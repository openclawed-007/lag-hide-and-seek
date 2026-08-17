/* Official Hide + Seek question catalog (community rulebook) */
(function (global) {
  const SIZES = {
    S: {
      label: "Small",
      blurb: "A town or slice of a city · 4–8 hours",
      hideMinutes: 30,
      zoneMiles: 0.25,
      photoSeconds: 10 * 60,
      examples: "Lower Manhattan, a small city",
    },
    M: {
      label: "Medium",
      blurb: "A metro area · about a day",
      hideMinutes: 60,
      zoneMiles: 0.25,
      photoSeconds: 10 * 60,
      examples: "Hong Kong, NYC, Greater London",
    },
    L: {
      label: "Large",
      blurb: "A region or country · 2–4 days",
      hideMinutes: 180,
      zoneMiles: 0.5,
      photoSeconds: 20 * 60,
      examples: "Switzerland, Japan, New England",
    },
  };

  const COSTS = {
    matching: { draw: 3, keep: 1, minutes: 5 },
    measuring: { draw: 3, keep: 1, minutes: 5 },
    radar: { draw: 2, keep: 1, minutes: 5 },
    thermometer: { draw: 2, keep: 1, minutes: 5 },
    tentacles: { draw: 4, keep: 2, minutes: 5 },
    photo: { draw: 1, keep: 1, minutes: null },
  };

  const RADAR_MILES = [0.25, 0.5, 1, 3, 5, 10, 25, 50, 100];

  const THERMO_BY_SIZE = {
    S: [0.5, 3],
    M: [0.5, 3, 10],
    L: [0.5, 3, 10, 50],
  };

  const POI_CLASSES = [
    { id: "airport", label: "Commercial airport", overpass: 'nwr["aeroway"="aerodrome"]["iata"]', tip: "Commercial if you can view flights on Google Flights. We use airports with an IATA code." },
    { id: "mountain", label: "Mountain", overpass: 'nwr["natural"="peak"]', tip: "Measure to the map icon." },
    { id: "park", label: "Park", overpass: 'nwr["leisure"="park"]', tip: "Measure to the map icon — even if you are standing in a larger park." },
    { id: "amusement", label: "Amusement park", overpass: 'nwr["tourism"="theme_park"]', tip: "Anything your maps app classifies as an amusement park." },
    { id: "zoo", label: "Zoo", overpass: 'nwr["tourism"="zoo"]' },
    { id: "aquarium", label: "Aquarium", overpass: 'nwr["tourism"="aquarium"]' },
    { id: "golf", label: "Golf course", overpass: 'nwr["leisure"="golf_course"]', tip: "Outdoor courses only. No mini-golf or driving ranges." },
    { id: "museum", label: "Museum", overpass: 'nwr["tourism"="museum"]' },
    { id: "theater", label: "Movie theater", overpass: 'nwr["amenity"="cinema"]' },
    { id: "hospital", label: "Hospital", overpass: 'nwr["amenity"="hospital"]' },
    { id: "library", label: "Library", overpass: 'nwr["amenity"="library"]' },
    { id: "consulate", label: "Foreign consulate", overpass: 'nwr["office"~"diplomatic|embassy|consulate"]', tip: "Exclude honorary consulates." },
  ];

  const MATCHING = [
    { id: "airport", label: "Commercial airport", group: "Transit" },
    { id: "transit-line", label: "Transit line", group: "Transit", tip: "Only while riding public transit. Yes if that vehicle will stop at the hider's station." },
    { id: "station-length", label: "Station name's length", group: "Transit", tip: "Characters including hyphens and spaces, as your maps app spells it. Also say longer/shorter." },
    { id: "street", label: "Street or path", group: "Transit", tip: "A street ends when the name changes." },
    { id: "admin1", label: "1st administrative division", group: "Administrative", tip: "US states · Swiss cantons · Japanese prefectures" },
    { id: "admin2", label: "2nd administrative division", group: "Administrative", tip: "US counties · Swiss districts · Japanese subprefectures" },
    { id: "admin3", label: "3rd administrative division", group: "Administrative", tip: "Municipalities. Seekers clarify any fuzzy border." },
    { id: "admin4", label: "4th administrative division", group: "Administrative", tip: "Boroughs, wards, city districts — if they exist." },
    { id: "mountain", label: "Mountain", group: "Natural" },
    { id: "landmass", label: "Landmass", group: "Natural", tip: "Land in one piece, not broken by a waterway. Discuss weird geography first." },
    { id: "park", label: "Park", group: "Natural" },
    { id: "amusement", label: "Amusement park", group: "Places of interest" },
    { id: "zoo", label: "Zoo", group: "Places of interest" },
    { id: "aquarium", label: "Aquarium", group: "Places of interest" },
    { id: "golf", label: "Golf course", group: "Places of interest" },
    { id: "museum", label: "Museum", group: "Places of interest" },
    { id: "theater", label: "Movie theater", group: "Places of interest" },
    { id: "hospital", label: "Hospital", group: "Public utilities" },
    { id: "library", label: "Library", group: "Public utilities" },
    { id: "consulate", label: "Foreign consulate", group: "Public utilities" },
  ];

  const MEASURING = [
    { id: "airport", label: "Commercial airport", group: "Transit" },
    { id: "hsr", label: "High-speed train line", group: "Transit", tip: "EU rule of thumb: 250 km/h on new lines, ~200 km/h on upgraded lines — or the local definition." },
    { id: "rail-station", label: "Rail station", group: "Transit", tip: "Heavy rail, light rail, and metro all count." },
    { id: "intl-border", label: "International border", group: "Borders", tip: "Enclaves count." },
    { id: "admin1-border", label: "1st-division border", group: "Borders" },
    { id: "admin2-border", label: "2nd-division border", group: "Borders" },
    { id: "sea-level", label: "Sea level", group: "Natural", tip: "Altitude. Use a phone compass/altimeter — it can be wrong." },
    { id: "water", label: "Body of water", group: "Natural", tip: "Any named body of water on your maps app, excluding pools." },
    { id: "coastline", label: "Coastline", group: "Natural", tip: "Land meeting ocean, a Great Lake, or a waterway ≥1 mile wide that flows into one." },
    { id: "mountain", label: "Mountain", group: "Natural" },
    { id: "park", label: "Park", group: "Natural" },
    { id: "amusement", label: "Amusement park", group: "Places of interest" },
    { id: "zoo", label: "Zoo", group: "Places of interest" },
    { id: "aquarium", label: "Aquarium", group: "Places of interest" },
    { id: "golf", label: "Golf course", group: "Places of interest" },
    { id: "museum", label: "Museum", group: "Places of interest" },
    { id: "theater", label: "Movie theater", group: "Places of interest" },
    { id: "hospital", label: "Hospital", group: "Public utilities" },
    { id: "library", label: "Library", group: "Public utilities" },
    { id: "consulate", label: "Foreign consulate", group: "Public utilities" },
  ];

  const PHOTOS = [
    { id: "building-station", label: "Any building visible from transit station", min: "S", tip: "Stand at an entrance. Roof + both sides. Top of the building in the top third of the frame." },
    { id: "widest-street", label: "Widest street", min: "S", tip: "Must include both sides of the street." },
    { id: "tree", label: "Tree", min: "S", tip: "The entire tree." },
    { id: "tallest-sightline", label: "Tallest structure in your current sightline", min: "S", tip: "Tallest from your perspective. Top + both sides. Top in the top third." },
    { id: "you", label: "You", min: "S", tip: "Selfie, arm extended, default lens, no zoom, phone perpendicular to the ground." },
    { id: "sky", label: "The sky", min: "S", tip: "Phone on the ground, shoot straight up, no zoom." },
    { id: "tallest-station", label: "Tallest building visible from transit station", min: "M", tip: "The station itself usually does not count." },
    { id: "trace-street", label: "Trace nearest street/path", min: "M", tip: "Intersection to intersection, as it appears on the maps app." },
    { id: "two-buildings", label: "2 buildings", min: "M", tip: "Bottom up to four stories." },
    { id: "restaurant", label: "Restaurant interior", min: "M", tip: "No zoom. Through the window from outside." },
    { id: "park-photo", label: "Park", min: "M", tip: "No zoom, perpendicular to ground, 5 feet from any obstruction." },
    { id: "grocery", label: "Grocery store aisle", min: "M", tip: "Stand at the end of the aisle, shoot down it, no zoom." },
    { id: "worship", label: "Place of worship", min: "M", tip: "5×5 ft section with 3 distinct elements." },
    { id: "platform", label: "Train platform", min: "M", tip: "5×5 ft section with 3 distinct elements." },
    { id: "half-mile-trace", label: "½ mile of streets traced", min: "L", tip: "Continuous, 5 turns, no doubling back, north–south oriented." },
    { id: "mountain-station", label: "Tallest mountain visible from transit station", min: "L", tip: "From your perspective. Max 3× zoom. Top in the top third." },
    { id: "water-zone", label: "Biggest body of water in your zone", min: "L", tip: "Max 3× zoom. Both sides or the horizon." },
    { id: "five-buildings", label: "5 buildings", min: "L", tip: "Bottom up to four stories." },
  ];

  const TENTACLES = [
    { id: "museum-1", label: "Museums", miles: 1, poi: "museum", min: "M" },
    { id: "library-1", label: "Libraries", miles: 1, poi: "library", min: "M" },
    { id: "theater-1", label: "Movie theaters", miles: 1, poi: "theater", min: "M" },
    { id: "hospital-1", label: "Hospitals", miles: 1, poi: "hospital", min: "M" },
    { id: "metro-15", label: "Metro lines", miles: 15, poi: "metro", min: "L", tip: "Colored metro lines as drawn in Google Maps." },
    { id: "zoo-15", label: "Zoos", miles: 15, poi: "zoo", min: "L" },
    { id: "aquarium-15", label: "Aquariums", miles: 15, poi: "aquarium", min: "L" },
    { id: "amusement-15", label: "Amusement parks", miles: 15, poi: "amusement", min: "L" },
  ];

  const SIZE_ORDER = { S: 0, M: 1, L: 2 };

  function allowedForSize(min, size) {
    return SIZE_ORDER[size] >= SIZE_ORDER[min];
  }

  function photosFor(size) {
    return PHOTOS.filter((p) => allowedForSize(p.min, size));
  }

  function tentaclesFor(size) {
    if (size === "S") return [];
    return TENTACLES.filter((t) => allowedForSize(t.min, size));
  }

  function thermosFor(size) {
    return THERMO_BY_SIZE[size] || THERMO_BY_SIZE.S;
  }

  function formatMiles(mi, units) {
    if (units === "km") {
      const km = mi * 1.60934;
      const n = km >= 10 ? Math.round(km) : Math.round(km * 10) / 10;
      return n + " km";
    }
    if (mi < 1) {
      const frac = { 0.25: "¼", 0.5: "½" }[mi];
      return (frac || mi) + " mi";
    }
    return mi + (mi === 1 ? " mile" : " miles");
  }

  function costLabel(cat) {
    const c = COSTS[cat];
    return `Draw ${c.draw}, keep ${c.keep}`;
  }

  function promptFor(cat, detail) {
    switch (cat) {
      case "radar":
        return `Are you within ${detail} of me?`;
      case "thermometer":
        return `After traveling ${detail}, am I hotter or colder?`;
      case "measuring":
        return `Compared to me, are you closer to or further from ${detail}?`;
      case "matching":
        return `Is your nearest ${detail} the same as mine?`;
      case "tentacles":
        return `Within ${detail.miles} of me, which ${detail.label.toLowerCase()} are you nearest to? (You must also be within ${detail.miles}.)`;
      case "photo":
        return `Send me a photo of: ${detail}`;
      default:
        return detail;
    }
  }

  global.JLQuestions = {
    SIZES,
    COSTS,
    RADAR_MILES,
    POI_CLASSES,
    MATCHING,
    MEASURING,
    PHOTOS,
    TENTACLES,
    photosFor,
    tentaclesFor,
    thermosFor,
    formatMiles,
    costLabel,
    promptFor,
    allowedForSize,
  };
})(window);
