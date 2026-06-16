const METERS_PER_MILE = 1609.344;
const CLOSURE_RADIUS_METERS = 180;
const STRAVA_SEGMENT_MATCH_METERS = 60;
const STRAVA_ROUTE_SAMPLE_METERS = 90;
const STRAVA_SCORE_PER_METER = 2.2;
const STRAVA_SCORE_PER_SEGMENT = 2600;
const STRAVA_MAX_EXPLORE_BOXES = 13;
const STRAVA_SEGMENT_CACHE_MS = 45 * 60 * 1000;
const STRAVA_STALE_SEGMENT_CACHE_MS = 24 * 60 * 60 * 1000;
const STRAVA_MAX_CACHE_ENTRIES = 18;
const STRAVA_ANCHOR_MAX_SEGMENTS = 5;
const STRAVA_ANCHOR_MIN_SPACING_METERS = 900;
const STRAVA_LOOP_SPUR_MULTIPLIER = 3.2;
const STRAVA_SPUR_METER_PENALTY = 16;
const STRAVA_MIN_SEGMENT_MATCH_METERS = 220;
const STRAVA_MIN_MATCH_SECTION_METERS = 180;
const STRAVA_DISTANCE_FALLBACK_WINDOW_METERS = 0.35 * METERS_PER_MILE;
const DEFAULT_CENTER = { lat: 40.73061, lng: -73.935242 };
const STORAGE_KEYS = {
  homeAddress: "cycle-route-lab.home-address",
  homeLocation: "cycle-route-lab.home-location",
  orsKey: "cycle-route-lab.ors-key",
  stravaToken: "cycle-route-lab.strava-token",
  stravaSegmentCache: "cycle-route-lab.strava-segments-cache.v1",
  lastStart: "cycle-route-lab.last-start",
  closures: "cycle-route-lab.closures",
  waypoints: "cycle-route-lab.waypoints",
};

const elements = {
  routeForm: document.querySelector("#routeForm"),
  originInput: document.querySelector("#originInput"),
  searchButton: document.querySelector("#searchButton"),
  locationButton: document.querySelector("#locationButton"),
  saveHomeButton: document.querySelector("#saveHomeButton"),
  useHomeButton: document.querySelector("#useHomeButton"),
  customDistance: document.querySelector("#customDistance"),
  distancePresets: [...document.querySelectorAll("[name='distancePreset']")],
  profileSelect: document.querySelector("#profileSelect"),
  fitnessSelect: document.querySelector("#fitnessSelect"),
  avoidBacktracksInput: document.querySelector("#avoidBacktracksInput"),
  familySafeInput: document.querySelector("#familySafeInput"),
  firstTurnRightInput: document.querySelector("#firstTurnRightInput"),
  favorStravaInput: document.querySelector("#favorStravaInput"),
  avoidRoadsInput: document.querySelector("#avoidRoadsInput"),
  markClosureButton: document.querySelector("#markClosureButton"),
  clearClosuresButton: document.querySelector("#clearClosuresButton"),
  addWaypointButton: document.querySelector("#addWaypointButton"),
  clearWaypointsButton: document.querySelector("#clearWaypointsButton"),
  orsKeyInput: document.querySelector("#orsKeyInput"),
  saveKeyButton: document.querySelector("#saveKeyButton"),
  stravaTokenInput: document.querySelector("#stravaTokenInput"),
  saveStravaKeyButton: document.querySelector("#saveStravaKeyButton"),
  buildButton: document.querySelector("#buildButton"),
  downloadButton: document.querySelector("#downloadButton"),
  downloadEnhancedButton: document.querySelector("#downloadEnhancedButton"),
  downloadTcxButton: document.querySelector("#downloadTcxButton"),
  shareButton: document.querySelector("#shareButton"),
  undoEditButton: document.querySelector("#undoEditButton"),
  sourceBadge: document.querySelector("#sourceBadge"),
  statusText: document.querySelector("#statusText"),
  distanceOut: document.querySelector("#distanceOut"),
  timeOut: document.querySelector("#timeOut"),
  driveOut: document.querySelector("#driveOut"),
  pointsOut: document.querySelector("#pointsOut"),
};

const state = {
  start: loadJson(STORAGE_KEYS.lastStart) || DEFAULT_CENTER,
  homeLocation: loadHomeLocation(),
  startLabel: "Map point",
  route: null,
  routeSeed: Math.floor(Math.random() * 9000) + 1000,
  startMarker: null,
  routeLayer: null,
  spurLayer: null,
  stravaLayer: null,
  stravaMatchLayer: null,
  routeHistory: [],
  closureLayer: null,
  closures: loadClosures(),
  closureMode: false,
  waypointLayer: null,
  waypoints: loadWaypoints(),
  waypointMode: false,
  busy: false,
};

elements.orsKeyInput.value = localStorage.getItem(STORAGE_KEYS.orsKey) || "";
elements.stravaTokenInput.value =
  localStorage.getItem(STORAGE_KEYS.stravaToken) || "";
elements.originInput.value = localStorage.getItem(STORAGE_KEYS.homeAddress) || "";

const map = L.map("map", {
  zoomControl: false,
  preferCanvas: true,
}).setView([state.start.lat, state.start.lng], 12);

L.control.zoom({ position: "bottomright" }).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

setStart(state.start, "Map point", { pan: false });
state.closureLayer = L.layerGroup().addTo(map);
state.waypointLayer = L.layerGroup().addTo(map);
renderClosures();
renderWaypoints();
updateClosureControls();
updateWaypointControls();

map.on("click", (event) => {
  if (state.closureMode) {
    addClosure(event.latlng);
    setClosureMode(false);
    return;
  }

  if (state.waypointMode) {
    addWaypoint(event.latlng);
    return;
  }

  setStart(event.latlng, "Map point");
  setStatus("Start point updated.", "success");
});

elements.distancePresets.forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) {
      elements.customDistance.value = input.value;
    }
  });
});

elements.customDistance.addEventListener("input", () => {
  const value = Number(elements.customDistance.value);
  const matchingPreset = elements.distancePresets.find(
    (preset) => Number(preset.value) === value,
  );

  elements.distancePresets.forEach((preset) => {
    preset.checked = preset === matchingPreset;
  });
});

elements.searchButton.addEventListener("click", async () => {
  await findOrigin();
});

elements.originInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    await findOrigin();
  }
});

elements.locationButton.addEventListener("click", () => {
  useCurrentLocation();
});

elements.saveHomeButton.addEventListener("click", async () => {
  const address = elements.originInput.value.trim();

  if (!address) {
    setStatus("Enter an address before saving home.", "error");
    return;
  }

  localStorage.setItem(STORAGE_KEYS.homeAddress, address);
  setBusy(true, "Saving home address...");

  try {
    const location = await geocodeAddress(address);

    state.homeLocation = {
      lat: location.lat,
      lng: location.lng,
      label: location.label || address,
      address,
    };
    saveHomeLocation();
    setStatus("Home saved. Drive estimate ready.", "success");
  } catch (error) {
    state.homeLocation = null;
    localStorage.removeItem(STORAGE_KEYS.homeLocation);
    setStatus(
      `Home address saved, but location lookup failed: ${error.message}`,
      "error",
    );
  } finally {
    setBusy(false);
  }
});

elements.useHomeButton.addEventListener("click", async () => {
  const address = localStorage.getItem(STORAGE_KEYS.homeAddress);

  if (!address) {
    setStatus("No home address saved yet.", "error");
    return;
  }

  elements.originInput.value = address;
  if (state.homeLocation) {
    setStart(state.homeLocation, state.homeLocation.label || address);
    setStatus("Home start point set.", "success");
    return;
  }

  await findOrigin();
});

elements.saveKeyButton.addEventListener("click", () => {
  localStorage.setItem(STORAGE_KEYS.orsKey, elements.orsKeyInput.value.trim());
  setStatus("Routing key saved in this browser.", "success");
});

elements.saveStravaKeyButton.addEventListener("click", () => {
  localStorage.setItem(
    STORAGE_KEYS.stravaToken,
    elements.stravaTokenInput.value.trim(),
  );
  setStatus("Strava token saved in this browser.", "success");
});

elements.markClosureButton.addEventListener("click", () => {
  setClosureMode(!state.closureMode);
});

elements.clearClosuresButton.addEventListener("click", () => {
  clearClosures();
});

elements.addWaypointButton.addEventListener("click", () => {
  setWaypointMode(!state.waypointMode);
});

elements.clearWaypointsButton.addEventListener("click", () => {
  clearWaypoints();
});

elements.routeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await buildRoute();
});

elements.downloadButton.addEventListener("click", () => {
  if (!state.route) return;
  downloadGpx(state.route);
});

elements.downloadEnhancedButton.addEventListener("click", () => {
  if (!state.route) return;
  downloadEnhancedGpx(state.route);
});

elements.downloadTcxButton.addEventListener("click", () => {
  if (!state.route) return;
  downloadTcx(state.route);
});

elements.shareButton.addEventListener("click", async () => {
  if (!state.route) return;
  await shareGpx(state.route);
});

elements.undoEditButton.addEventListener("click", () => {
  undoRouteEdit();
});

async function findOrigin() {
  const query = elements.originInput.value.trim();

  if (!query) {
    setStatus("Enter an address or place.", "error");
    return;
  }

  setBusy(true, "Finding start point...");

  try {
    const result = await geocodeAddress(query);

    setStart({ lat: result.lat, lng: result.lng }, result.label);
    setStatus("Start point found.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

function useCurrentLocation() {
  if (!navigator.geolocation) {
    setStatus("Location is not available in this browser.", "error");
    return;
  }

  setBusy(true, "Getting current location...");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const start = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      setStart(start, "Current location");
      setStatus("Current location set.", "success");
      setBusy(false);
    },
    (error) => {
      setStatus(error.message || "Unable to get current location.", "error");
      setBusy(false);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 30000,
      timeout: 10000,
    },
  );
}

async function buildRoute() {
  const targetMiles = getTargetMiles();

  if (!Number.isFinite(targetMiles) || targetMiles < 2) {
    setStatus("Distance must be at least 2 miles.", "error");
    return;
  }

  if (state.closureMode) {
    setClosureMode(false);
  }

  if (state.waypointMode) {
    setWaypointMode(false);
  }

  state.routeSeed += 1;
  const orsKey = elements.orsKeyInput.value.trim();
  const favorStrava = elements.favorStravaInput.checked;
  const stravaToken = elements.stravaTokenInput.value.trim();

  if (orsKey && isLikelyGoogleMapsKey(orsKey)) {
    clearRouteDisplay();
    setStatus(
      "That looks like a Google Maps key. Paste an openrouteservice API key for live routing.",
      "error",
    );
    return;
  }

  if (favorStrava && !orsKey) {
    clearRouteDisplay();
    setStatus(
      "Favoring Strava segments needs an openrouteservice key for live route candidates.",
      "error",
    );
    return;
  }

  if (favorStrava && !stravaToken) {
    clearRouteDisplay();
    setStatus("Paste a Strava access token before favoring segments.", "error");
    return;
  }

  const buildMessage =
    favorStrava
      ? "Finding Strava segments..."
      : orsKey &&
          (elements.avoidBacktracksInput.checked ||
            elements.familySafeInput.checked ||
            getAvoidRoadTerms().length)
        ? "Building route candidates..."
        : "Building route...";

  setBusy(true, buildMessage);

  try {
    const builtRoute = orsKey
      ? await buildOpenRouteServiceLoop(state.start, targetMiles, orsKey, {
          stravaToken,
        })
      : buildPreviewLoop(state.start, targetMiles);
    const route = applyStartDirectionPreference(builtRoute);

    route.driveToStart = await getDriveToStartEstimate(orsKey);
    drawRoute(route, { resetHistory: true });
    setStatus(createDisplayStatus(route), "success");
  } catch (error) {
    if (orsKey) {
      clearRouteDisplay();
      const isStravaError =
        error.isStrava || /strava|rate limit/i.test(String(error.message || ""));
      const failureText =
        favorStrava && isStravaError
          ? " Route build stopped before ORS candidate scoring."
          : " Live routing failed, so no preview route was shown.";

      setStatus(
        `${error.message}${failureText}`,
        "error",
      );
      return;
    }

    const fallbackRoute = applyStartDirectionPreference(
      buildPreviewLoop(state.start, targetMiles),
    );
    fallbackRoute.driveToStart = await getDriveToStartEstimate(orsKey);
    drawRoute(fallbackRoute, { resetHistory: true });
    setStatus(
      `${error.message} ${createDisplayStatus(fallbackRoute)}`,
      "error",
    );
  } finally {
    setBusy(false);
  }
}

async function geocodeAddress(query) {
  const orsKey = elements.orsKeyInput.value.trim();

  if (orsKey) {
    if (isLikelyGoogleMapsKey(orsKey)) {
      throw new Error(
        "That looks like a Google Maps key. Paste an openrouteservice API key.",
      );
    }

    const params = new URLSearchParams({
      api_key: orsKey,
      text: query,
      size: "1",
    });
    const response = await fetch(
      `https://api.openrouteservice.org/geocode/search?${params.toString()}`,
    );

    if (!response.ok) {
      throw new Error("Address lookup failed with openrouteservice.");
    }

    const data = await response.json();
    const feature = data.features?.[0];

    if (!feature) {
      throw new Error("No matching address found.");
    }

    const [lng, lat] = feature.geometry.coordinates;

    return {
      lat,
      lng,
      label: feature.properties?.label || query,
    };
  }

  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "1",
  });
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
  );

  if (!response.ok) {
    throw new Error("Address lookup failed.");
  }

  const [result] = await response.json();

  if (!result) {
    throw new Error("No matching address found.");
  }

  return {
    lat: Number(result.lat),
    lng: Number(result.lon),
    label: result.display_name || query,
  };
}

async function buildOpenRouteServiceLoop(start, targetMiles, apiKey, options = {}) {
  const preferences = {
    avoidBacktracks: elements.avoidBacktracksInput.checked,
    familySafe: elements.familySafeInput.checked,
    avoidTerms: getAvoidRoadTerms(),
    favorStrava: elements.favorStravaInput.checked,
    stravaSegments: [],
    stravaSearchBoxCount: 0,
    stravaSearchFromCache: false,
    stravaSearchStale: false,
    targetMeters: targetMiles * METERS_PER_MILE,
  };

  if (preferences.favorStrava) {
    const stravaDiscovery = await fetchNearbyStravaSegments(
      start,
      targetMiles,
      options.stravaToken,
    );
    preferences.stravaSegments = stravaDiscovery.segments;
    preferences.stravaSearchBoxCount = stravaDiscovery.boxCount;
    preferences.stravaSearchFromCache = Boolean(stravaDiscovery.fromCache);
    preferences.stravaSearchStale = Boolean(stravaDiscovery.stale);
    drawStravaSegments(preferences.stravaSegments);
    const sourceText = stravaDiscovery.fromCache
      ? stravaDiscovery.stale
        ? "cached stale"
        : "cached"
      : stravaDiscovery.limited
        ? "partial fresh"
      : "fresh";

    setStatus(
      `Found ${preferences.stravaSegments.length} Strava segment${
        preferences.stravaSegments.length === 1 ? "" : "s"
      } from ${preferences.stravaSearchBoxCount} ${sourceText} map search${
        preferences.stravaSearchBoxCount === 1 ? "" : "es"
      }. Building route candidates...`,
    );
  } else {
    clearStravaSegments();
  }

  if (state.waypoints.length) {
    const route = await fetchOpenRouteServiceWaypointLoop(
      start,
      targetMiles,
      apiKey,
      preferences,
    );

    route.quality = scoreRouteQuality(route, preferences);
    route.status = `Built loop through ${state.waypoints.length} manual waypoint${
      state.waypoints.length === 1 ? "" : "s"
    }.`;

    return route;
  }

  const needsScoring =
    preferences.avoidBacktracks ||
    preferences.familySafe ||
    preferences.avoidTerms.length > 0 ||
    preferences.favorStrava;
  const candidateCount = preferences.favorStrava
    ? getStravaCandidateCount(targetMiles)
    : needsScoring
      ? getCandidateCount(targetMiles)
      : 1;
  const candidates = [];
  let lastError = null;

  if (preferences.favorStrava && preferences.stravaSegments.length) {
    const anchorOffsets = [0, 1, 2];

    for (const offset of anchorOffsets) {
      try {
        const route = await fetchOpenRouteServiceStravaAnchorLoop(
          start,
          targetMiles,
          apiKey,
          preferences,
          offset,
        );

        if (route) {
          route.quality = scoreRouteQuality(route, preferences);
          candidates.push(route);
        }
      } catch (error) {
        lastError = error;
      }
    }
  }

  for (let index = 0; index < candidateCount; index += 1) {
    try {
      const seed = state.routeSeed + index * 101;
      const route = await fetchOpenRouteServiceLoop(
        start,
        targetMiles,
        apiKey,
        seed,
      );

      route.quality = scoreRouteQuality(route, preferences);
      candidates.push(route);
    } catch (error) {
      lastError = error;
    }
  }

  if (!candidates.length) {
    throw lastError || new Error("Live cycling route failed.");
  }

  const candidatePool = preferences.favorStrava
    ? selectStravaCandidatePool(candidates, preferences.targetMeters)
    : candidates;

  candidatePool.sort((a, b) => a.quality.score - b.quality.score);
  const route = candidatePool[0];

  route.status =
    candidateCount > 1
      ? createCandidateStatus(route, candidatePool.length, candidates.length)
      : "Live cycling route built.";

  return route;
}

async function fetchOpenRouteServiceLoop(start, targetMiles, apiKey, seed) {
  const targetMeters = Math.round(targetMiles * METERS_PER_MILE);
  const profile = elements.profileSelect.value;
  const fitness = Number(elements.fitnessSelect.value);
  const options = createOrsRoutingOptions(fitness);

  options.round_trip = {
    length: targetMeters,
    points: getRoundTripPointCount(targetMiles),
    seed,
  };

  const response = await fetch(
    `https://api.openrouteservice.org/v2/directions/${profile}/geojson`,
    {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        Accept: "application/json, application/geo+json",
      },
      body: JSON.stringify({
        coordinates: [[start.lng, start.lat]],
        elevation: true,
        instructions: true,
        extra_info: ["waytype", "suitability", "waycategory"],
        options,
      }),
    },
  );

  if (!response.ok) {
    const details = await readErrorMessage(response);
    throw new Error(details || "Live cycling route failed.");
  }

  return createRouteFromOrsGeojson(
    await response.json(),
    targetMiles,
    "Live cycling route built.",
  );
}

async function fetchOpenRouteServiceWaypointLoop(
  start,
  targetMiles,
  apiKey,
  preferences,
) {
  const profile = elements.profileSelect.value;
  const fitness = Number(elements.fitnessSelect.value);
  const options = createOrsRoutingOptions(fitness);
  const response = await fetch(
    `https://api.openrouteservice.org/v2/directions/${profile}/geojson`,
    {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        Accept: "application/json, application/geo+json",
      },
      body: JSON.stringify({
        coordinates: [
          [start.lng, start.lat],
          ...state.waypoints.map((waypoint) => [waypoint.lng, waypoint.lat]),
          [start.lng, start.lat],
        ],
        elevation: true,
        instructions: true,
        extra_info: ["waytype", "suitability", "waycategory"],
        options,
      }),
    },
  );

  if (!response.ok) {
    const details = await readErrorMessage(response);
    throw new Error(details || "Manual waypoint routing failed.");
  }

  const route = createRouteFromOrsGeojson(
    await response.json(),
    targetMiles,
    "Manual waypoint loop built.",
  );

  route.manualWaypoints = true;
  route.quality = scoreRouteQuality(route, preferences);

  return route;
}

async function fetchOpenRouteServiceStravaAnchorLoop(
  start,
  targetMiles,
  apiKey,
  preferences,
  offset,
) {
  const selectedSegments = selectStravaAnchorSegments(
    start,
    targetMiles,
    preferences.stravaSegments,
    offset,
  );

  if (selectedSegments.length < 2) return null;

  const coordinates = buildStravaAnchorCoordinates(start, selectedSegments);

  if (coordinates.length < 5) return null;

  const profile = elements.profileSelect.value;
  const fitness = Number(elements.fitnessSelect.value);
  const options = createOrsRoutingOptions(fitness);
  const response = await fetch(
    `https://api.openrouteservice.org/v2/directions/${profile}/geojson`,
    {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        Accept: "application/json, application/geo+json",
      },
      body: JSON.stringify({
        coordinates,
        elevation: true,
        instructions: true,
        extra_info: ["waytype", "suitability", "waycategory"],
        options,
      }),
    },
  );

  if (!response.ok) {
    const details = await readErrorMessage(response);
    throw new Error(details || "Strava anchor routing failed.");
  }

  const route = createRouteFromOrsGeojson(
    await response.json(),
    targetMiles,
    "Cohesive Strava loop built.",
  );

  route.stravaAnchorCount = selectedSegments.length;
  route.stravaAnchorSegmentIds = selectedSegments.map((segment) => segment.id);

  return route;
}

function selectStravaAnchorSegments(start, targetMiles, segments, offset) {
  const targetMeters = targetMiles * METERS_PER_MILE;
  const preferredRadiusMeters = targetMeters / (Math.PI * 2);
  const maxDistanceMeters = Math.min(Math.max(targetMeters * 0.58, 4500), 22000);
  const maxAnchorSegments = getStravaAnchorMaxSegments(targetMiles);
  const minAngularSpacing = 360 / (maxAnchorSegments + 1.4);
  const enrichedSegments = segments
    .map((segment) => enrichStravaAnchorSegment(start, segment, preferredRadiusMeters))
    .filter(
      (item) =>
        item &&
        item.distanceFromStart <= maxDistanceMeters &&
        item.endpointDistance >= item.segment.distanceMeters * 0.42,
    )
    .sort((a, b) => b.score - a.score);
  const selected = [];

  enrichedSegments.forEach((item) => {
    if (selected.length >= maxAnchorSegments) return;

    const overlaps = selected.some(
      (existing) =>
        angleDistanceDegrees(existing.angle, item.angle) < minAngularSpacing ||
        haversineMeters(existing.midpoint, item.midpoint) <
          STRAVA_ANCHOR_MIN_SPACING_METERS,
    );

    if (!overlaps) {
      selected.push(item);
    }
  });

  const ordered = selected
    .sort((a, b) => a.angle - b.angle)
    .map((item) => item.segment);

  if (ordered.length <= 1) return ordered;

  const rotation = offset % ordered.length;
  const rotated = [...ordered.slice(rotation), ...ordered.slice(0, rotation)];

  return offset % 2 === 1 ? rotated.reverse() : rotated;
}

function getStravaAnchorMaxSegments(targetMiles) {
  if (targetMiles <= 6) return 2;
  if (targetMiles <= 9) return 3;
  if (targetMiles <= 15) return 4;

  return STRAVA_ANCHOR_MAX_SEGMENTS;
}

function enrichStravaAnchorSegment(start, segment, preferredRadiusMeters) {
  if (!segment?.points?.length) return null;

  const first = segment.points[0];
  const last = segment.points[segment.points.length - 1];
  const midpoint = pointAtPolylineFraction(segment.points, 0.5);
  const distanceFromStart = haversineMeters(start, midpoint);
  const endpointDistance = haversineMeters(first, last);
  const radiusPenalty = Math.abs(distanceFromStart - preferredRadiusMeters) * 0.38;

  return {
    segment,
    midpoint,
    endpointDistance,
    distanceFromStart,
    angle: normalizeDegrees(bearingDegrees(start, midpoint)),
    score: segment.distanceMeters - radiusPenalty,
  };
}

function buildStravaAnchorCoordinates(start, segments) {
  const coordinates = [[start.lng, start.lat]];
  let previousPoint = start;

  segments.forEach((segment) => {
    const points = orientStravaSegmentPoints(previousPoint, segment.points);
    const anchors = createStravaSegmentAnchors(points, segment.distanceMeters);

    anchors.forEach((point) => {
      appendCoordinateIfDistinct(coordinates, point);
    });

    previousPoint = anchors[anchors.length - 1] || previousPoint;
  });

  appendCoordinateIfDistinct(coordinates, start, 20);

  return coordinates;
}

function orientStravaSegmentPoints(previousPoint, points) {
  const first = points[0];
  const last = points[points.length - 1];

  if (haversineMeters(previousPoint, last) < haversineMeters(previousPoint, first)) {
    return [...points].reverse();
  }

  return points;
}

function createStravaSegmentAnchors(points, distanceMeters) {
  const anchors = [points[0]];

  if (distanceMeters >= 700) {
    anchors.push(pointAtPolylineFraction(points, 0.5));
  }

  anchors.push(points[points.length - 1]);

  return anchors;
}

function appendCoordinateIfDistinct(coordinates, point, minDistanceMeters = 90) {
  const previous = coordinates[coordinates.length - 1];
  const previousPoint = { lng: previous[0], lat: previous[1] };

  if (haversineMeters(previousPoint, point) < minDistanceMeters) return;

  coordinates.push([point.lng, point.lat]);
}

function pointAtPolylineFraction(points, fraction) {
  const totalMeters = measureRoute(points);

  if (!points.length) return null;
  if (totalMeters <= 0) return points[0];

  return pointAtRouteDistance(points, totalMeters * fraction) || points[0];
}

async function fetchNearbyStravaSegments(start, targetMiles, accessToken) {
  const boundsList = createStravaExploreBounds(start, targetMiles);
  const cacheKey = createStravaSegmentCacheKey(start, targetMiles);
  const cachedDiscovery = readStravaSegmentCache(cacheKey);

  if (cachedDiscovery) {
    return {
      ...cachedDiscovery,
      fromCache: true,
      stale: false,
    };
  }

  const staleDiscovery = readStravaSegmentCache(cacheKey, {
    maxAgeMs: STRAVA_STALE_SEGMENT_CACHE_MS,
  });
  const segmentsById = new Map();
  let searchedBoxCount = 0;

  try {
    for (const bounds of boundsList) {
      const segments = await fetchStravaExploreBox(bounds, accessToken);

      searchedBoxCount += 1;

      segments.forEach((segment) => {
        const normalized = normalizeStravaSegment(segment);

        if (normalized) {
          segmentsById.set(normalized.id, normalized);
        }
      });

      if (
        searchedBoxCount >= getMinStravaExploreBoxes(targetMiles) &&
        segmentsById.size >= getStravaDiscoveryTargetSegmentCount(targetMiles)
      ) {
        break;
      }
    }
  } catch (error) {
    if (error.isStravaRateLimited && segmentsById.size) {
      const discovery = createStravaDiscovery(searchedBoxCount, segmentsById);

      writeStravaSegmentCache(cacheKey, discovery);

      return {
        ...discovery,
        fromCache: false,
        stale: false,
        limited: true,
      };
    }

    if ((error.isStravaRateLimited || error instanceof TypeError) && staleDiscovery) {
      return {
        ...staleDiscovery,
        fromCache: true,
        stale: true,
      };
    }

    if (error instanceof TypeError) {
      throw createStravaError(
        "Strava segment lookup failed. If the browser blocks Strava requests, this static setup may need a small proxy.",
      );
    }

    throw error;
  }

  const discovery = createStravaDiscovery(searchedBoxCount, segmentsById);

  writeStravaSegmentCache(cacheKey, discovery);

  return {
    ...discovery,
    fromCache: false,
    stale: false,
    limited: false,
  };
}

function createStravaDiscovery(boxCount, segmentsById) {
  return {
    boxCount,
    segments: [...segmentsById.values()].sort(
      (a, b) => b.distanceMeters - a.distanceMeters,
    ),
  };
}

async function fetchStravaExploreBox(bounds, accessToken) {
  const params = new URLSearchParams({
    bounds: bounds.join(","),
    activity_type: "riding",
  });
  const response = await fetch(
    `https://www.strava.com/api/v3/segments/explore?${params.toString()}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (response.status === 401 || response.status === 403) {
    throw createStravaError("Strava token was rejected or expired.");
  }

  if (response.status === 429) {
    throw createStravaError(
      "Strava rate limit exceeded. Wait for the 15-minute read window to reset or turn off Favor Strava segments.",
      {
        rateLimited: true,
      },
    );
  }

  if (!response.ok) {
    const details = await readErrorMessage(response);
    const message = details || "Strava segment lookup failed.";

    throw createStravaError(message, {
      rateLimited: /rate limit/i.test(message),
    });
  }

  const data = await response.json();

  return Array.isArray(data.segments) ? data.segments : [];
}

function createStravaExploreBounds(start, targetMiles) {
  const targetMeters = targetMiles * METERS_PER_MILE;
  const searchRadiusMeters = Math.min(
    Math.max(targetMeters * 0.42, 2600),
    22000,
  );
  const gridSize = targetMiles <= 10 ? 3 : 5;
  const offsets = createCenteredFactors(gridSize, gridSize === 3 ? 0.72 : 0.8);
  const halfSizeMeters = searchRadiusMeters * (gridSize === 3 ? 0.42 : 0.28);
  const bounds = [];

  offsets.forEach((eastFactor) => {
    offsets.forEach((northFactor) => {
      const east = eastFactor * searchRadiusMeters;
      const north = northFactor * searchRadiusMeters;
      const southwest = offsetCoordinate(
        start,
        east - halfSizeMeters,
        north - halfSizeMeters,
      );
      const northeast = offsetCoordinate(
        start,
        east + halfSizeMeters,
        north + halfSizeMeters,
      );

      bounds.push({
        distanceFromCenter: Math.hypot(eastFactor, northFactor),
        bounds: [
          roundCoordinate(clampLatitude(southwest.lat)),
          roundCoordinate(clampLongitude(southwest.lng)),
          roundCoordinate(clampLatitude(northeast.lat)),
          roundCoordinate(clampLongitude(northeast.lng)),
        ],
      });
    });
  });

  return bounds
    .sort((a, b) => a.distanceFromCenter - b.distanceFromCenter)
    .slice(0, STRAVA_MAX_EXPLORE_BOXES)
    .map((item) => item.bounds);
}

function getMinStravaExploreBoxes(targetMiles) {
  if (targetMiles <= 6) return 3;
  if (targetMiles <= 10) return 5;

  return 7;
}

function getStravaDiscoveryTargetSegmentCount(targetMiles) {
  if (targetMiles <= 6) return 18;
  if (targetMiles <= 10) return 24;
  if (targetMiles <= 15) return 32;

  return 40;
}

function createStravaSegmentCacheKey(start, targetMiles) {
  const latBucket = Math.round(Number(start.lat) * 100) / 100;
  const lngBucket = Math.round(Number(start.lng) * 100) / 100;
  const distanceBucket = Math.max(2, Math.round(Number(targetMiles)));

  return [
    "v2",
    latBucket.toFixed(2),
    lngBucket.toFixed(2),
    distanceBucket,
    STRAVA_MAX_EXPLORE_BOXES,
  ].join(":");
}

function readStravaSegmentCache(cacheKey, options = {}) {
  const cache = loadJson(STORAGE_KEYS.stravaSegmentCache) || {};
  const entry = cache[cacheKey];
  const maxAgeMs = options.maxAgeMs || STRAVA_SEGMENT_CACHE_MS;

  if (!entry || Date.now() - Number(entry.savedAt) > maxAgeMs) return null;

  const segments = Array.isArray(entry.segments)
    ? entry.segments.map(normalizeCachedStravaSegment).filter(Boolean)
    : [];

  return {
    boxCount: Number(entry.boxCount) || 0,
    segments,
  };
}

function writeStravaSegmentCache(cacheKey, discovery) {
  try {
    const cache = loadJson(STORAGE_KEYS.stravaSegmentCache) || {};

    cache[cacheKey] = {
      savedAt: Date.now(),
      boxCount: discovery.boxCount,
      segments: discovery.segments.map((segment) => ({
        id: segment.id,
        name: segment.name,
        distanceMeters: segment.distanceMeters,
        avgGrade: segment.avgGrade,
        starred: segment.starred,
        points: segment.points,
      })),
    };

    const entries = Object.entries(cache)
      .sort(([, a], [, b]) => Number(b.savedAt) - Number(a.savedAt))
      .slice(0, STRAVA_MAX_CACHE_ENTRIES);

    localStorage.setItem(
      STORAGE_KEYS.stravaSegmentCache,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {
    // Local storage can be full or disabled. Routing still works without cache.
  }
}

function normalizeCachedStravaSegment(segment) {
  if (!segment?.id || !Array.isArray(segment.points)) return null;

  const points = segment.points
    .map((point) => ({
      lat: Number(point.lat),
      lng: Number(point.lng),
    }))
    .filter((point) => isValidPoint(point));

  if (points.length < 2) return null;

  return {
    id: String(segment.id),
    name: segment.name || "Strava segment",
    distanceMeters: Number(segment.distanceMeters) || measureRoute(points),
    avgGrade: Number(segment.avgGrade) || 0,
    starred: Boolean(segment.starred),
    points,
  };
}

function createStravaError(message, options = {}) {
  const error = new Error(message);

  error.isStrava = true;
  error.isStravaRateLimited = Boolean(options.rateLimited);

  return error;
}

function createCenteredFactors(count, maxAbsValue) {
  if (count <= 1) return [0];

  const values = [];

  for (let index = 0; index < count; index += 1) {
    const ratio = index / (count - 1);

    values.push((ratio * 2 - 1) * maxAbsValue);
  }

  return values;
}

function normalizeStravaSegment(segment) {
  if (!segment?.id) return null;

  let points = decodeStravaPolyline(segment.points || "");

  if (points.length < 2) {
    points = [segment.start_latlng, segment.end_latlng]
      .filter(Array.isArray)
      .map(([lat, lng]) => ({ lat: Number(lat), lng: Number(lng) }))
      .filter((point) => isValidPoint(point));
  }

  if (points.length < 2) return null;

  const distanceMeters = Number(segment.distance) || measureRoute(points);

  return {
    id: String(segment.id),
    name: segment.name || "Strava segment",
    distanceMeters,
    avgGrade: Number(segment.avg_grade) || 0,
    starred: Boolean(segment.starred),
    points,
  };
}

function decodeStravaPolyline(encoded) {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    const decodedLat = decodePolylineValue(encoded, index);

    index = decodedLat.index;
    lat += decodedLat.value;

    if (index >= encoded.length) break;

    const decodedLng = decodePolylineValue(encoded, index);

    index = decodedLng.index;
    lng += decodedLng.value;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points.filter((point) => isValidPoint(point));
}

function decodePolylineValue(encoded, startIndex) {
  let result = 0;
  let shift = 0;
  let index = startIndex;
  let byte = 0;

  do {
    byte = encoded.charCodeAt(index) - 63;
    index += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20 && index < encoded.length);

  return {
    index,
    value: result & 1 ? ~(result >> 1) : result >> 1,
  };
}

function roundCoordinate(value) {
  return Number(value.toFixed(6));
}

function clampLatitude(value) {
  return Math.max(-89.9, Math.min(89.9, value));
}

function clampLongitude(value) {
  return Math.max(-180, Math.min(180, value));
}

function createOrsRoutingOptions(fitness) {
  const options = {
    avoid_features: ["steps", "ferries"],
    profile_params: {
      weightings: {
        steepness_difficulty: fitness,
      },
    },
  };

  if (state.closures.length) {
    options.avoid_polygons = buildAvoidPolygonsGeometry();
  }

  return options;
}

function createRouteFromOrsGeojson(geojson, targetMiles, status) {
  const feature = geojson.features?.[0];

  if (!feature?.geometry?.coordinates?.length) {
    throw new Error("No route geometry returned.");
  }

  const points = feature.geometry.coordinates.map(([lng, lat, ele]) => ({
    lat,
    lng,
    ele,
  }));
  const properties = feature.properties || {};
  const summary = properties.summary || {};
  const distanceMeters = summary.distance || measureRoute(points);

  return {
    name: createRouteName(targetMiles),
    points,
    extras: properties.extras || {},
    segments: properties.segments || [],
    distanceMeters,
    targetMeters: targetMiles * METERS_PER_MILE,
    durationSeconds: summary.duration || estimateRideSeconds(distanceMeters),
    source: "openrouteservice",
    status,
  };
}

async function getDriveToStartEstimate(apiKey) {
  const homeAddress = localStorage.getItem(STORAGE_KEYS.homeAddress);

  if (!homeAddress) {
    return { status: "no-home" };
  }

  if (!apiKey) {
    return { status: "no-key" };
  }

  try {
    const home = await getHomeLocation(homeAddress);
    const homeToStartMeters = haversineMeters(home, state.start);

    if (homeToStartMeters < 75) {
      return {
        status: "ok",
        distanceMeters: 0,
        durationSeconds: 0,
      };
    }

    return await fetchDriveToStart(home, state.start, apiKey);
  } catch (error) {
    return {
      status: "failed",
      message: error.message || "Drive estimate failed.",
    };
  }
}

async function getHomeLocation(homeAddress) {
  if (isValidPoint(state.homeLocation)) {
    return state.homeLocation;
  }

  const location = await geocodeAddress(homeAddress);

  state.homeLocation = {
    lat: location.lat,
    lng: location.lng,
    label: location.label || homeAddress,
    address: homeAddress,
  };
  saveHomeLocation();

  return state.homeLocation;
}

async function fetchDriveToStart(home, start, apiKey) {
  const response = await fetch(
    "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
    {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        Accept: "application/json, application/geo+json",
      },
      body: JSON.stringify({
        coordinates: [
          [home.lng, home.lat],
          [start.lng, start.lat],
        ],
        instructions: false,
      }),
    },
  );

  if (!response.ok) {
    const details = await readErrorMessage(response);
    throw new Error(details || "Drive estimate failed.");
  }

  const geojson = await response.json();
  const feature = geojson.features?.[0];
  const summary = feature?.properties?.summary;

  if (!summary) {
    throw new Error("No drive summary returned.");
  }

  return {
    status: "ok",
    distanceMeters: summary.distance || 0,
    durationSeconds: summary.duration || 0,
  };
}

function buildPreviewLoop(start, targetMiles) {
  const targetMeters = targetMiles * METERS_PER_MILE;
  const radiusMeters = targetMeters / (Math.PI * 2);
  const pointCount = 72;
  const points = [];

  for (let index = 0; index <= pointCount; index += 1) {
    const angle = (index / pointCount) * Math.PI * 2;
    const wobble =
      1 + 0.16 * Math.sin(angle * 3 + state.routeSeed) + 0.08 * Math.cos(angle * 5);
    const radius = radiusMeters * wobble;
    const east = Math.cos(angle) * radius;
    const north = Math.sin(angle) * radius;

    points.push(offsetCoordinate(start, east, north));
  }

  const distanceMeters = measureRoute(points);

  return {
    name: createRouteName(targetMiles),
    points,
    distanceMeters,
    targetMeters: targetMiles * METERS_PER_MILE,
    durationSeconds: estimateRideSeconds(distanceMeters),
    source: "preview",
    status: "Preview only, not real streets. Add an ORS key for live bike routing.",
  };
}

function clearRouteDisplay() {
  state.route = null;

  if (state.routeLayer) {
    state.routeLayer.remove();
    state.routeLayer = null;
  }

  if (state.spurLayer) {
    state.spurLayer.remove();
    state.spurLayer = null;
  }

  clearStravaSegments();
  state.routeHistory = [];
  elements.distanceOut.textContent = "--";
  elements.timeOut.textContent = "--";
  elements.driveOut.textContent = "--";
  elements.driveOut.title = "";
  elements.pointsOut.textContent = "--";
  elements.sourceBadge.textContent = "No route";
  elements.downloadButton.disabled = true;
  elements.downloadEnhancedButton.disabled = true;
  elements.downloadTcxButton.disabled = true;
  elements.shareButton.disabled = true;
  updateUndoButton();
}

function applyStartDirectionPreference(route) {
  if (
    route.manualWaypoints ||
    !elements.firstTurnRightInput.checked ||
    route.points.length < 5
  ) {
    return route;
  }

  const firstTurn = findFirstMeaningfulTurn(route.points);

  if (!firstTurn) {
    return route;
  }

  if (firstTurn.direction !== "left") {
    route.startDirection = firstTurn;
    return route;
  }

  const points = reverseLoopPoints(route.points);
  const distanceMeters = measureRoute(points);
  const durationSeconds =
    route.distanceMeters > 0
      ? route.durationSeconds * (distanceMeters / route.distanceMeters)
      : route.durationSeconds;
  const loop = scoreLoopQuality(points);
  const safety = route.quality?.safety || null;
  const strava = route.quality?.strava?.enabled
    ? scoreRouteStrava(
        { points },
        route.quality.strava.segments,
        route.quality.strava.searchBoxCount,
      )
    : route.quality?.strava || null;
  const distanceFit = scoreDistanceFit({
    distanceMeters,
    targetMeters: route.targetMeters,
  });
  const quality = route.quality
    ? {
        ...route.quality,
        score:
          loop.score +
          (safety?.score || 0) +
          (strava?.score || 0) +
          distanceFit.score,
        loop,
        strava,
        distanceFit,
      }
    : route.quality;

  return {
    ...route,
    points,
    distanceMeters,
    durationSeconds,
    quality,
    startDirection: findFirstMeaningfulTurn(points) || {
      direction: "right",
      degrees: 0,
    },
    status: `${route.status} Direction reversed for a right first turn.`,
  };
}

function reverseLoopPoints(points) {
  const originalStart = points[0];
  const reversed = points.map((point) => ({ ...point })).reverse();

  if (haversineMeters(reversed[0], originalStart) < 150) {
    reversed[0] = { ...reversed[0], lat: originalStart.lat, lng: originalStart.lng };
  }

  if (haversineMeters(reversed[reversed.length - 1], originalStart) < 150) {
    reversed[reversed.length - 1] = {
      ...reversed[reversed.length - 1],
      lat: originalStart.lat,
      lng: originalStart.lng,
    };
  }

  return reversed;
}

function findFirstMeaningfulTurn(points) {
  const totalMeters = measureRoute(points);
  const maxLookaheadMeters = Math.min(totalMeters * 0.35, 2200);
  const sampleSpacingMeters = 75;
  const samples = [];

  for (
    let distance = 0;
    distance <= maxLookaheadMeters;
    distance += sampleSpacingMeters
  ) {
    const point = pointAtRouteDistance(points, distance);

    if (point) samples.push(point);
  }

  if (samples.length < 4) return null;

  for (let index = 1; index < samples.length - 1; index += 1) {
    const inbound = bearingDegrees(samples[index - 1], samples[index]);
    const outbound = bearingDegrees(samples[index], samples[index + 1]);
    const degrees = signedAngleDegrees(inbound, outbound);
    const absDegrees = Math.abs(degrees);

    if (absDegrees >= 35 && absDegrees <= 150) {
      return {
        direction: degrees > 0 ? "right" : "left",
        degrees: absDegrees,
        distanceMeters: index * sampleSpacingMeters,
      };
    }
  }

  return null;
}

function pointAtRouteDistance(points, targetMeters) {
  if (!points.length) return null;
  if (targetMeters <= 0) return points[0];

  let walkedMeters = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentMeters = haversineMeters(start, end);

    if (segmentMeters <= 0) continue;

    if (walkedMeters + segmentMeters >= targetMeters) {
      const ratio = (targetMeters - walkedMeters) / segmentMeters;

      return {
        lat: start.lat + (end.lat - start.lat) * ratio,
        lng: start.lng + (end.lng - start.lng) * ratio,
      };
    }

    walkedMeters += segmentMeters;
  }

  return points[points.length - 1];
}

function drawStravaSegments(segments) {
  clearStravaSegments();

  if (!segments.length) return;

  state.stravaLayer = L.layerGroup().addTo(map);

  segments.forEach((segment) => {
    const latLngs = segment.points.map((point) => [point.lat, point.lng]);
    const layer = L.polyline(latLngs, {
      bubblingMouseEvents: false,
      color: "#fc4c02",
      dashArray: "4 7",
      lineCap: "round",
      lineJoin: "round",
      opacity: 0.24,
      weight: 3,
    }).addTo(state.stravaLayer);

    layer.bindTooltip(
      `Strava: ${escapeHtml(segment.name)} (${formatDistance(
        segment.distanceMeters,
      )})`,
      {
        direction: "top",
        sticky: true,
      },
    );
  });
}

function clearStravaSegments() {
  if (state.stravaLayer) {
    state.stravaLayer.remove();
    state.stravaLayer = null;
  }

  if (state.stravaMatchLayer) {
    state.stravaMatchLayer.remove();
    state.stravaMatchLayer = null;
  }
}

function drawMatchedStravaSegments(route) {
  if (state.stravaMatchLayer) {
    state.stravaMatchLayer.remove();
    state.stravaMatchLayer = null;
  }

  const matchedSections = route.quality?.strava?.matchedSections || [];

  if (!matchedSections.length) return;

  state.stravaMatchLayer = L.layerGroup().addTo(map);

  matchedSections.forEach((section) => {
    if (!section.points?.length) return;

    const layer = L.polyline(
      section.points.map((point) => [point.lat, point.lng]),
      {
        bubblingMouseEvents: false,
        color: "#fc4c02",
        opacity: 0.82,
        weight: 5,
        lineCap: "round",
        lineJoin: "round",
      },
    ).addTo(state.stravaMatchLayer);

    layer.bindTooltip(
      `Matched Strava: ${escapeHtml(
        section.segmentNames.join("; ") || "segment",
      )} (${formatDistance(section.meters)})`,
      {
        direction: "top",
        sticky: true,
      },
    );
  });
}

function drawRoute(route, options = {}) {
  if (options.resetHistory) {
    state.routeHistory = [];
  }

  state.route = route;

  if (state.routeLayer) {
    state.routeLayer.remove();
  }

  if (state.spurLayer) {
    state.spurLayer.remove();
    state.spurLayer = null;
  }

  const latLngs = route.points.map((point) => [point.lat, point.lng]);
  state.routeLayer = L.polyline(latLngs, {
    bubblingMouseEvents: false,
    color: route.source === "openrouteservice" ? "#176b58" : "#315f9e",
    weight: 6,
    opacity: 0.88,
    lineJoin: "round",
  }).addTo(map);

  map.fitBounds(state.routeLayer.getBounds(), {
    padding: [42, 42],
    maxZoom: 15,
  });

  elements.distanceOut.textContent = formatDistance(route.distanceMeters);
  elements.timeOut.textContent = formatDuration(route.durationSeconds);
  elements.driveOut.textContent = formatDriveEstimate(route.driveToStart);
  elements.driveOut.title = createDriveTooltip(route.driveToStart);
  elements.pointsOut.textContent = String(route.points.length);
  elements.sourceBadge.textContent = createSourceBadge(route);
  elements.downloadButton.disabled = false;
  elements.downloadEnhancedButton.disabled = false;
  elements.downloadTcxButton.disabled = false;
  elements.shareButton.disabled = false;
  updateUndoButton();
  drawMatchedStravaSegments(route);
  drawSpurCleanup(route);
}

function drawSpurCleanup(route) {
  const spurs = getRouteSpurs(route);

  route.cleanupSpurs = spurs;

  if (!spurs.length) return;

  state.spurLayer = L.layerGroup().addTo(map);

  spurs.forEach((spur, index) => {
    const points = route.points.slice(spur.start, spur.end + 1);

    if (points.length < 2) return;

    const layer = L.polyline(
      points.map((point) => [point.lat, point.lng]),
      {
        bubblingMouseEvents: false,
        color: "#d96c2c",
        opacity: 0.72,
        weight: 12,
        lineCap: "round",
        lineJoin: "round",
        className: "spur-cleanup-line",
      },
    ).addTo(state.spurLayer);

    layer.bindTooltip(`Remove spur ${index + 1}`, {
      direction: "top",
      sticky: true,
    });
    layer.on("click", (event) => {
      if (event.originalEvent) {
        L.DomEvent.stop(event.originalEvent);
      }
      removeRouteSpur(spur);
    });
  });
}

function getRouteSpurs(route) {
  const spurs = route.quality?.loop?.spurs || scoreSpurQuality(route.points).spurs;

  return [...spurs].sort((a, b) => b.score - a.score);
}

function createSourceBadge(route) {
  if (route.source !== "openrouteservice") return "Preview";
  if (route.quality?.strava?.enabled) return "ORS + Strava";

  return "Live route";
}

function createDisplayStatus(route) {
  const spurs = route.cleanupSpurs || getRouteSpurs(route);
  const driveText = createDriveStatusText(route.driveToStart);
  const stravaText = createStravaStatusText(route.quality?.strava);
  const waypointText = state.waypoints.length
    ? route.manualWaypoints
      ? ""
      : route.source === "openrouteservice"
        ? ` Using ${state.waypoints.length} manual waypoint${
            state.waypoints.length === 1 ? "" : "s"
          }.`
        : " Manual waypoints need an ORS key."
    : "";
  const closureText = state.closures.length
    ? route.source === "openrouteservice"
      ? ` Avoiding ${state.closures.length} marked closure area${
          state.closures.length === 1 ? "" : "s"
        }.`
      : " Marked closures need an ORS key."
    : "";

  if (!spurs.length) {
    return `${route.status}${driveText}${waypointText}${closureText}${stravaText}`;
  }

  return `${route.status}${driveText}${waypointText}${closureText}${stravaText} Click an orange spur to remove it before exporting.`;
}

function createStravaStatusText(strava) {
  if (!strava?.enabled) return "";

  const sourceText = strava.fromCache
    ? strava.stale
      ? " cached stale"
      : " cached"
    : "";

  if (!strava.segmentCount) {
    return ` No Strava riding segments found in ${strava.searchBoxCount || 0}${sourceText} map search${
      strava.searchBoxCount === 1 ? "" : "es"
    }.`;
  }

  if (!strava.matchedCount) {
    return ` Strava: checked ${strava.segmentCount} nearby segment${
      strava.segmentCount === 1 ? "" : "s"
    } from ${strava.searchBoxCount || 0}${sourceText} map search${
      strava.searchBoxCount === 1 ? "" : "es"
    }, no close route matches.`;
  }

  const segmentList = formatStravaSegmentList(strava.matchedSegments);
  const segmentText = segmentList ? `: ${segmentList}` : "";

  return ` Strava: matched ${strava.matchedCount} of ${strava.segmentCount} discovered segment${
    strava.segmentCount === 1 ? "" : "s"
  } (${formatDistance(strava.matchedMeters)} nearby)${segmentText}.`;
}

function formatStravaSegmentList(segments = []) {
  return segments
    .map((segment) => segment.name || `Segment ${segment.id}`)
    .filter(Boolean)
    .join("; ");
}

function removeRouteSpur(spur) {
  if (!state.route) return;

  const route = state.route;
  const start = Math.max(0, Math.min(spur.start, route.points.length - 1));
  const end = Math.max(0, Math.min(spur.end, route.points.length - 1));

  if (end - start < 2) return;

  const points = [
    ...route.points.slice(0, start + 1),
    ...route.points.slice(end).map((point) => ({ ...point })),
  ];

  if (points.length < 3) return;

  state.routeHistory.push(cloneRoute(route));

  const distanceMeters = measureRoute(points);
  const durationSeconds =
    route.distanceMeters > 0
      ? route.durationSeconds * (distanceMeters / route.distanceMeters)
      : estimateRideSeconds(distanceMeters);
  const loop = scoreLoopQuality(points);
  const safety = route.quality?.safety || {
    score: 0,
    avoidedRoadMeters: 0,
    highwayMeters: 0,
    lowSuitabilityMeters: 0,
    stateRoadMeters: 0,
  };
  const strava = route.quality?.strava?.enabled
    ? scoreRouteStrava(
        { points },
        route.quality.strava.segments,
        route.quality.strava.searchBoxCount,
      )
    : route.quality?.strava || {
        enabled: false,
        score: 0,
        segmentCount: 0,
        searchBoxCount: 0,
        matchedCount: 0,
        matchedMeters: 0,
        segments: [],
        matchedSegments: [],
        matchedSections: [],
      };
  const distanceFit = scoreDistanceFit({
    distanceMeters,
    targetMeters: route.targetMeters,
  });
  const editedRoute = {
    ...route,
    points,
    distanceMeters,
    durationSeconds,
    status: `Removed ${formatDistance(spur.meters)} spur from route.`,
    quality: {
      score:
        loop.score +
        (safety.score || 0) +
        (strava.score || 0) +
        distanceFit.score,
      loop,
      safety,
      strava,
      distanceFit,
    },
  };

  drawRoute(editedRoute, { resetHistory: false });
  setStatus(createDisplayStatus(editedRoute), "success");
}

function undoRouteEdit() {
  const previousRoute = state.routeHistory.pop();

  if (!previousRoute) return;

  drawRoute(previousRoute, { resetHistory: false });
  setStatus("Manual route edit undone.", "success");
}

function cloneRoute(route) {
  return {
    ...route,
    points: route.points.map((point) => ({ ...point })),
    quality: route.quality
      ? {
          ...route.quality,
          loop: route.quality.loop
            ? {
                ...route.quality.loop,
                spurs: route.quality.loop.spurs?.map((spur) => ({ ...spur })) || [],
              }
            : route.quality.loop,
          safety: route.quality.safety ? { ...route.quality.safety } : route.quality.safety,
          strava: route.quality.strava
            ? cloneStravaQuality(route.quality.strava)
            : route.quality.strava,
          distanceFit: route.quality.distanceFit
            ? { ...route.quality.distanceFit }
            : route.quality.distanceFit,
        }
      : route.quality,
    cleanupSpurs: route.cleanupSpurs?.map((spur) => ({ ...spur })) || [],
  };
}

function cloneStravaQuality(strava) {
  return {
    ...strava,
    segments: strava.segments?.map(cloneStravaSegment) || [],
    matchedSegments: strava.matchedSegments?.map(cloneStravaSegment) || [],
    matchedSections:
      strava.matchedSections?.map((section) => ({
        ...section,
        points: section.points?.map((point) => ({ ...point })) || [],
        segmentNames: [...(section.segmentNames || [])],
      })) || [],
  };
}

function cloneStravaSegment(segment) {
  return {
    ...segment,
    points: segment.points?.map((point) => ({ ...point })) || [],
  };
}

function formatDriveEstimate(estimate) {
  if (!estimate) return "--";

  if (estimate.status === "ok") {
    return formatDuration(estimate.durationSeconds);
  }

  if (estimate.status === "no-home") return "Save Home";
  if (estimate.status === "no-key") return "Need Key";

  return "--";
}

function createDriveTooltip(estimate) {
  if (!estimate) return "";

  if (estimate.status === "ok") {
    return `${formatDistance(estimate.distanceMeters)} drive from saved home`;
  }

  if (estimate.status === "no-home") return "Save Home to estimate drive time";
  if (estimate.status === "no-key") return "Add an ORS key to estimate drive time";

  return estimate.message || "Drive estimate unavailable";
}

function createDriveStatusText(estimate) {
  if (!estimate) return "";

  if (estimate.status === "ok") {
    return ` Drive from home: ${formatDuration(estimate.durationSeconds)} (${formatDistance(
      estimate.distanceMeters,
    )}).`;
  }

  if (estimate.status === "no-home") return " Save Home to see drive time.";
  if (estimate.status === "no-key") return " Add an ORS key for drive time.";

  return " Drive time unavailable.";
}

function updateUndoButton() {
  elements.undoEditButton.disabled = state.busy || !state.routeHistory.length;
}

function setWaypointMode(isActive) {
  state.waypointMode = Boolean(isActive);

  if (state.waypointMode && state.closureMode) {
    state.closureMode = false;
    updateClosureControls();
  }

  updateWaypointControls();

  if (state.waypointMode) {
    setStatus("Click preferred roads or paths to add manual waypoints.", "success");
  } else if (!state.busy) {
    setStatus("Waypoint marking off.");
  }
}

function addWaypoint(latlng) {
  state.waypoints.push({
    lat: Number(latlng.lat),
    lng: Number(latlng.lng),
  });
  saveWaypoints();
  renderWaypoints();
  updateWaypointControls();
  setStatus(
    `Waypoint ${state.waypoints.length} added. Build again to route through it.`,
    "success",
  );
}

function updateWaypoint(index, latlng) {
  state.waypoints[index] = {
    lat: Number(latlng.lat),
    lng: Number(latlng.lng),
  };
  saveWaypoints();
  setStatus("Waypoint moved. Build again to use the new position.", "success");
}

function removeWaypoint(index) {
  state.waypoints.splice(index, 1);
  saveWaypoints();
  renderWaypoints();
  updateWaypointControls();
  setStatus("Waypoint removed.", "success");
}

function clearWaypoints() {
  state.waypoints = [];
  saveWaypoints();
  renderWaypoints();
  setWaypointMode(false);
  updateWaypointControls();
  setStatus("Manual waypoints cleared.", "success");
}

function renderWaypoints() {
  if (!state.waypointLayer) return;

  state.waypointLayer.clearLayers();

  state.waypoints.forEach((waypoint, index) => {
    const marker = L.marker([waypoint.lat, waypoint.lng], {
      bubblingMouseEvents: false,
      draggable: true,
      icon: L.divIcon({
        className: "",
        html: `<span class="waypoint-marker">${index + 1}</span>`,
        iconAnchor: [14, 14],
        iconSize: [28, 28],
      }),
      title: `Waypoint ${index + 1}`,
    }).addTo(state.waypointLayer);

    marker.bindTooltip(`Drag or click to remove waypoint ${index + 1}`, {
      direction: "top",
      sticky: true,
    });
    marker.on("click", (event) => {
      if (event.originalEvent) {
        L.DomEvent.stop(event.originalEvent);
      }
      removeWaypoint(index);
    });
    marker.on("dragend", (event) => {
      updateWaypoint(index, event.target.getLatLng());
    });
  });
}

function updateWaypointControls() {
  elements.addWaypointButton.disabled = state.busy;
  elements.addWaypointButton.classList.toggle("is-active", state.waypointMode);
  elements.addWaypointButton.textContent = state.waypointMode
    ? "Click Map"
    : "Add Waypoint";
  elements.clearWaypointsButton.disabled = state.busy || !state.waypoints.length;
}

function setClosureMode(isActive) {
  state.closureMode = Boolean(isActive);

  if (state.closureMode && state.waypointMode) {
    state.waypointMode = false;
    updateWaypointControls();
  }

  updateClosureControls();

  if (state.closureMode) {
    setStatus("Click the closed road or bridge on the map.", "success");
  } else if (!state.busy) {
    setStatus("Closure marking off.");
  }
}

function addClosure(latlng) {
  const closure = {
    lat: Number(latlng.lat),
    lng: Number(latlng.lng),
    radiusMeters: CLOSURE_RADIUS_METERS,
  };

  state.closures.push(closure);
  saveClosures();
  renderClosures();
  updateClosureControls();
  setStatus(
    `Closure marked. Build again to avoid ${state.closures.length} closure area${
      state.closures.length === 1 ? "" : "s"
    }.`,
    "success",
  );
}

function removeClosure(index) {
  state.closures.splice(index, 1);
  saveClosures();
  renderClosures();
  updateClosureControls();
  setStatus("Closure removed.", "success");
}

function clearClosures() {
  state.closures = [];
  saveClosures();
  renderClosures();
  setClosureMode(false);
  updateClosureControls();
  setStatus("Closure areas cleared.", "success");
}

function renderClosures() {
  if (!state.closureLayer) return;

  state.closureLayer.clearLayers();

  state.closures.forEach((closure, index) => {
    const layer = L.circle([closure.lat, closure.lng], {
      bubblingMouseEvents: false,
      radius: closure.radiusMeters,
      color: "#b23b3b",
      fillColor: "#b23b3b",
      fillOpacity: 0.16,
      opacity: 0.9,
      weight: 2,
    }).addTo(state.closureLayer);

    layer.bindTooltip(`Remove closure ${index + 1}`, {
      direction: "top",
      sticky: true,
    });
    layer.on("click", (event) => {
      if (event.originalEvent) {
        L.DomEvent.stop(event.originalEvent);
      }
      removeClosure(index);
    });
  });
}

function updateClosureControls() {
  elements.markClosureButton.disabled = state.busy;
  elements.markClosureButton.classList.toggle("is-active", state.closureMode);
  elements.markClosureButton.textContent = state.closureMode
    ? "Click Map"
    : "Mark Closure";
  elements.clearClosuresButton.disabled = state.busy || !state.closures.length;
}

function saveClosures() {
  localStorage.setItem(STORAGE_KEYS.closures, JSON.stringify(state.closures));
}

function saveWaypoints() {
  localStorage.setItem(STORAGE_KEYS.waypoints, JSON.stringify(state.waypoints));
}

function loadWaypoints() {
  const waypoints = loadJson(STORAGE_KEYS.waypoints);

  return Array.isArray(waypoints)
    ? waypoints
        .map((waypoint) => ({
          lat: Number(waypoint.lat),
          lng: Number(waypoint.lng),
        }))
        .filter((waypoint) => isValidPoint(waypoint))
    : [];
}

function saveHomeLocation() {
  localStorage.setItem(STORAGE_KEYS.homeLocation, JSON.stringify(state.homeLocation));
}

function loadHomeLocation() {
  const home = loadJson(STORAGE_KEYS.homeLocation);

  return isValidPoint(home) ? home : null;
}

function isValidPoint(point) {
  return (
    point &&
    Number.isFinite(Number(point.lat)) &&
    Number.isFinite(Number(point.lng))
  );
}

function loadClosures() {
  const closures = loadJson(STORAGE_KEYS.closures);

  return Array.isArray(closures)
    ? closures
        .map((closure) => ({
          lat: Number(closure.lat),
          lng: Number(closure.lng),
          radiusMeters: Number(closure.radiusMeters) || CLOSURE_RADIUS_METERS,
        }))
        .filter(
          (closure) => Number.isFinite(closure.lat) && Number.isFinite(closure.lng),
        )
    : [];
}

function buildAvoidPolygonsGeometry() {
  const polygons = state.closures.map((closure) => [buildClosurePolygon(closure)]);

  if (polygons.length === 1) {
    return {
      type: "Polygon",
      coordinates: polygons[0],
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: polygons,
  };
}

function buildClosurePolygon(closure) {
  const sides = 24;
  const ring = [];

  for (let index = 0; index <= sides; index += 1) {
    const angle = (index / sides) * Math.PI * 2;
    const point = offsetCoordinate(
      closure,
      Math.cos(angle) * closure.radiusMeters,
      Math.sin(angle) * closure.radiusMeters,
    );

    ring.push([Number(point.lng.toFixed(7)), Number(point.lat.toFixed(7))]);
  }

  return ring;
}

function setStart(start, label, options = {}) {
  state.start = {
    lat: Number(start.lat),
    lng: Number(start.lng),
  };
  state.startLabel = label;

  localStorage.setItem(STORAGE_KEYS.lastStart, JSON.stringify(state.start));

  if (state.startMarker) {
    state.startMarker.setLatLng([state.start.lat, state.start.lng]);
  } else {
    state.startMarker = L.marker([state.start.lat, state.start.lng], {
      title: "Start",
    }).addTo(map);
  }

  state.startMarker.bindPopup(`<strong>Start</strong><br>${escapeHtml(label)}`);

  if (options.pan !== false) {
    map.setView([state.start.lat, state.start.lng], Math.max(map.getZoom(), 13));
  }
}

function getTargetMiles() {
  return Number(elements.customDistance.value);
}

function getRoundTripPointCount(targetMiles) {
  if (targetMiles <= 7) return 4;
  if (targetMiles <= 15) return 5;
  if (targetMiles <= 30) return 6;
  return 8;
}

function getCandidateCount(targetMiles) {
  if (targetMiles <= 7) return 12;
  if (targetMiles <= 15) return 16;
  return 20;
}

function getStravaCandidateCount(targetMiles) {
  if (targetMiles <= 7) return 18;
  if (targetMiles <= 15) return 24;
  return 30;
}

function selectStravaCandidatePool(candidates, targetMeters) {
  const maxSpurMeters = Math.max(160, targetMeters * 0.018);
  const maxReversedOverlapMeters = Math.max(220, targetMeters * 0.025);
  const distanceBand = getStravaDistanceBand(targetMeters);
  const onDistanceCandidates = candidates.filter(
    (route) =>
      route.distanceMeters >= distanceBand.minMeters &&
      route.distanceMeters <= distanceBand.maxMeters,
  );
  const distancePool = onDistanceCandidates.length
    ? onDistanceCandidates
    : getClosestDistanceCandidates(candidates, targetMeters);
  const cleanCandidates = distancePool.filter((route) => {
    const loop = route.quality?.loop;

    if (!loop) return true;

    return (
      loop.spurMeters <= maxSpurMeters &&
      loop.reversedOverlapMeters <= maxReversedOverlapMeters &&
      loop.uTurns <= 2
    );
  });

  return cleanCandidates.length ? cleanCandidates : distancePool;
}

function getStravaDistanceBand(targetMeters) {
  const underageMeters = Math.max(0.6 * METERS_PER_MILE, targetMeters * 0.18);
  const overageMeters = Math.max(0.8 * METERS_PER_MILE, targetMeters * 0.2);

  return {
    minMeters: Math.max(targetMeters - underageMeters, targetMeters * 0.55),
    maxMeters: targetMeters + overageMeters,
  };
}

function getClosestDistanceCandidates(candidates, targetMeters) {
  const sorted = [...candidates].sort(
    (a, b) =>
      Math.abs(a.distanceMeters - targetMeters) -
      Math.abs(b.distanceMeters - targetMeters),
  );
  const closestDifference = Math.abs(sorted[0]?.distanceMeters - targetMeters) || 0;

  return sorted.filter(
    (route) =>
      Math.abs(route.distanceMeters - targetMeters) <=
      closestDifference + STRAVA_DISTANCE_FALLBACK_WINDOW_METERS,
  );
}

function getAvoidRoadTerms() {
  return elements.avoidRoadsInput.value
    .split(",")
    .map((term) => normalizeRoadName(term))
    .filter(Boolean);
}

function createCandidateStatus(route, count, totalCount = count) {
  const strava = route.quality?.strava;

  if (strava?.enabled) {
    if (route.stravaAnchorCount) {
      return `Picked cohesive Strava loop of ${totalCount} options using ${route.stravaAnchorCount} ordered segment anchor${
        route.stravaAnchorCount === 1 ? "" : "s"
      }.`;
    }

    return count === totalCount
      ? `Picked Strava-friendly of ${totalCount} options.`
      : `Picked clean Strava-friendly loop from ${count} of ${totalCount} options.`;
  }

  const stateRoadMeters = route.quality?.safety?.stateRoadMeters || 0;
  const avoidedRoadMeters = route.quality?.safety?.avoidedRoadMeters || 0;

  if (avoidedRoadMeters > 0) {
    return `Picked safest of ${count} options. Avoid-list roads: ${formatDistance(
      avoidedRoadMeters,
    )}.`;
  }

  const spurMeters = route.quality?.loop?.spurMeters || 0;

  if (spurMeters > 0) {
    return `Picked cleanest of ${count} options. Spur-like sections: ${formatDistance(
      spurMeters,
    )}.`;
  }

  if (stateRoadMeters > 0) {
    return `Picked safest of ${count} options. Busy-road exposure: ${formatDistance(
      stateRoadMeters,
    )}.`;
  }

  return `Picked safest of ${count} options.`;
}

function scoreRouteQuality(route, preferences) {
  const loop = preferences.avoidBacktracks || preferences.favorStrava
    ? scoreLoopQuality(route.points)
    : {
        score: 0,
        spurCount: 0,
        spurMeters: 0,
        spurs: [],
        uTurns: 0,
        reversedOverlapMeters: 0,
      };
  const safety = scoreRoadSafety(route, preferences);
  const strava = preferences.favorStrava
    ? scoreRouteStrava(
        route,
        preferences.stravaSegments,
        preferences.stravaSearchBoxCount,
        {
          fromCache: preferences.stravaSearchFromCache,
          stale: preferences.stravaSearchStale,
        },
      )
    : {
        enabled: false,
        score: 0,
        segmentCount: 0,
        searchBoxCount: 0,
        matchedCount: 0,
        matchedMeters: 0,
        segments: [],
        matchedSegments: [],
        matchedSections: [],
      };
  const distanceFit = scoreDistanceFit(route, preferences);
  const loopScore = preferences.favorStrava
    ? loop.score * STRAVA_LOOP_SPUR_MULTIPLIER +
      loop.spurMeters * STRAVA_SPUR_METER_PENALTY
    : loop.score;

  return {
    score: loopScore + safety.score + strava.score + distanceFit.score,
    loop,
    safety,
    strava,
    distanceFit,
  };
}

function scoreDistanceFit(route, preferences = {}) {
  const targetMeters = preferences.targetMeters || route.targetMeters;

  if (!targetMeters) {
    return {
      score: 0,
      targetMeters: 0,
      differenceMeters: 0,
    };
  }

  const differenceMeters = Math.abs(route.distanceMeters - targetMeters);
  const overageMeters = Math.max(0, route.distanceMeters - targetMeters);
  const freeMeters = Math.max(0.25 * METERS_PER_MILE, targetMeters * 0.06);
  const penaltyMeters = Math.max(0, differenceMeters - freeMeters);
  const overagePenaltyMeters = Math.max(0, overageMeters - freeMeters);

  return {
    score: penaltyMeters * 4.5 + overagePenaltyMeters * 4,
    targetMeters,
    differenceMeters,
  };
}

function scoreRoadSafety(route, preferences) {
  const waytypeExtra = route.extras?.waytypes || route.extras?.waytype;
  const waycategoryExtra = route.extras?.waycategory;
  const suitabilityExtra = route.extras?.suitability;
  const avoidedRoadMeters = measureAvoidedRoadSteps(route, preferences.avoidTerms);
  let score = avoidedRoadMeters * 18;
  let stateRoadMeters = 0;
  let highwayMeters = 0;
  let lowSuitabilityMeters = 0;

  if (preferences.familySafe) {
    (waytypeExtra?.summary || []).forEach((item) => {
      const distance = Number(item.distance) || 0;
      const value = Number(item.value);

      if (value === 1) {
        stateRoadMeters += distance;
        score += distance * 7;
      } else if (value === 2) {
        score += distance * 1.2;
      } else if (value === 6) {
        score -= distance * 0.4;
      }
    });

    (waycategoryExtra?.summary || []).forEach((item) => {
      const distance = Number(item.distance) || 0;

      if ((Number(item.value) & 1) === 1) {
        highwayMeters += distance;
        score += distance * 12;
      }
    });

    (suitabilityExtra?.summary || []).forEach((item) => {
      const distance = Number(item.distance) || 0;
      const suitability = Number(item.value);

      if (suitability <= 4) {
        lowSuitabilityMeters += distance;
        score += distance * (6 - suitability);
      } else if (suitability >= 8) {
        score -= distance * 0.3;
      }
    });
  }

  return {
    score: Math.max(0, score),
    avoidedRoadMeters,
    highwayMeters,
    lowSuitabilityMeters,
    stateRoadMeters,
  };
}

function scoreRouteStrava(route, segments = [], searchBoxCount = 0, options = {}) {
  const availableSegments = Array.isArray(segments) ? segments : [];

  if (!availableSegments.length) {
    return {
      enabled: true,
      score: 0,
      segmentCount: 0,
      searchBoxCount,
      matchedCount: 0,
      matchedMeters: 0,
      segments: availableSegments,
      matchedSegments: [],
      matchedSections: [],
      fromCache: Boolean(options.fromCache),
      stale: Boolean(options.stale),
    };
  }

  const samples = sampleRoutePoints(route.points, STRAVA_ROUTE_SAMPLE_METERS);
  const rawMatches = [];
  const matchedMetersBySegmentId = new Map();

  samples.forEach((sample) => {
    const segmentId = findNearestStravaSegmentId(
      sample.point,
      availableSegments,
      STRAVA_SEGMENT_MATCH_METERS,
    );

    if (!segmentId) return;

    rawMatches.push({ ...sample, segmentId });
    matchedMetersBySegmentId.set(
      segmentId,
      (matchedMetersBySegmentId.get(segmentId) || 0) + sample.weightMeters,
    );
  });

  const validSegmentIds = new Set(
    [...matchedMetersBySegmentId.entries()]
      .filter(([, meters]) => meters >= STRAVA_MIN_SEGMENT_MATCH_METERS)
      .map(([segmentId]) => segmentId),
  );
  const validMatches = rawMatches.filter((match) =>
    validSegmentIds.has(match.segmentId),
  );
  const matchedMeters = validMatches.reduce(
    (total, match) => total + match.weightMeters,
    0,
  );

  const matchedSegments = availableSegments
    .filter((segment) => validSegmentIds.has(segment.id))
    .map((segment) => ({
      id: segment.id,
      name: segment.name,
      distanceMeters: segment.distanceMeters,
      matchedMeters: matchedMetersBySegmentId.get(segment.id) || 0,
    }));
  const matchedSections = buildStravaMatchedRouteSections(
    route.points,
    validMatches,
    availableSegments,
  );

  return {
    enabled: true,
    score:
      -matchedMeters * STRAVA_SCORE_PER_METER -
      matchedSegments.length * STRAVA_SCORE_PER_SEGMENT,
    segmentCount: availableSegments.length,
    searchBoxCount,
    matchedCount: matchedSegments.length,
    matchedMeters,
    segments: availableSegments,
    matchedSegments,
    matchedSections,
    fromCache: Boolean(options.fromCache),
    stale: Boolean(options.stale),
  };
}

function sampleRoutePoints(points, spacingMeters) {
  const totalMeters = measureRoute(points);
  const samples = [];

  if (!points.length || totalMeters <= 0) return samples;

  for (
    let distanceMeters = spacingMeters / 2;
    distanceMeters < totalMeters;
    distanceMeters += spacingMeters
  ) {
    const point = pointAtRouteDistance(points, distanceMeters);

    if (point) {
      samples.push({
        distanceMeters,
        point,
        weightMeters: Math.min(spacingMeters, totalMeters - distanceMeters),
      });
    }
  }

  return samples;
}

function buildStravaMatchedRouteSections(points, matches, segments) {
  if (!matches.length) return [];

  const segmentsById = new Map(segments.map((segment) => [segment.id, segment]));
  const sortedMatches = [...matches].sort(
    (a, b) => a.distanceMeters - b.distanceMeters,
  );
  const sections = [];
  let current = null;

  sortedMatches.forEach((match) => {
    const startDistance = Math.max(
      0,
      match.distanceMeters - match.weightMeters / 2,
    );
    const endDistance = match.distanceMeters + match.weightMeters / 2;
    const shouldContinue =
      current &&
      startDistance <= current.endDistance + STRAVA_ROUTE_SAMPLE_METERS * 1.4;

    if (!shouldContinue) {
      if (current) sections.push(current);

      current = {
        startDistance,
        endDistance,
        segmentIds: new Set([match.segmentId]),
      };
      return;
    }

    current.endDistance = Math.max(current.endDistance, endDistance);
    current.segmentIds.add(match.segmentId);
  });

  if (current) sections.push(current);

  return sections
    .map((section) => {
      const meters = section.endDistance - section.startDistance;

      if (meters < STRAVA_MIN_MATCH_SECTION_METERS) return null;

      const sectionSegments = [...section.segmentIds]
        .map((segmentId) => segmentsById.get(segmentId))
        .filter(Boolean);

      return {
        meters,
        points: sliceRouteByDistance(
          points,
          section.startDistance,
          section.endDistance,
        ),
        segmentNames: sectionSegments.map((segment) => segment.name),
      };
    })
    .filter((section) => section?.points?.length >= 2);
}

function sliceRouteByDistance(points, startMeters, endMeters) {
  const sliced = [];
  const start = pointAtRouteDistance(points, startMeters);
  const end = pointAtRouteDistance(points, endMeters);

  if (!start || !end) return sliced;

  sliced.push(start);

  const distances = buildCumulativeDistances(points);

  points.forEach((point, index) => {
    const distance = distances[index];

    if (distance > startMeters && distance < endMeters) {
      sliced.push(point);
    }
  });

  sliced.push(end);

  return sliced;
}

function findNearestStravaSegmentId(point, segments, maxDistanceMeters) {
  let bestSegmentId = null;
  let bestDistanceMeters = maxDistanceMeters;

  segments.forEach((segment) => {
    const distanceMeters = distanceToPolylineMeters(
      point,
      segment.points,
      bestDistanceMeters,
    );

    if (distanceMeters <= bestDistanceMeters) {
      bestDistanceMeters = distanceMeters;
      bestSegmentId = segment.id;
    }
  });

  return bestSegmentId;
}

function distanceToPolylineMeters(point, points, stopDistanceMeters = Infinity) {
  let bestDistanceMeters = Infinity;

  for (let index = 1; index < points.length; index += 1) {
    const distanceMeters = distancePointToSegmentMeters(
      point,
      points[index - 1],
      points[index],
    );

    if (distanceMeters < bestDistanceMeters) {
      bestDistanceMeters = distanceMeters;
    }

    if (bestDistanceMeters <= stopDistanceMeters) {
      return bestDistanceMeters;
    }
  }

  return bestDistanceMeters;
}

function distancePointToSegmentMeters(point, start, end) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng =
    metersPerDegreeLat * Math.cos((point.lat * Math.PI) / 180);
  const pointX = point.lng * metersPerDegreeLng;
  const pointY = point.lat * metersPerDegreeLat;
  const startX = start.lng * metersPerDegreeLng;
  const startY = start.lat * metersPerDegreeLat;
  const endX = end.lng * metersPerDegreeLng;
  const endY = end.lat * metersPerDegreeLat;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared <= 0) {
    return Math.hypot(pointX - startX, pointY - startY);
  }

  const ratio = Math.max(
    0,
    Math.min(1, ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared),
  );
  const projectedX = startX + ratio * deltaX;
  const projectedY = startY + ratio * deltaY;

  return Math.hypot(pointX - projectedX, pointY - projectedY);
}

function measureAvoidedRoadSteps(route, avoidTerms) {
  if (!avoidTerms.length) return 0;

  return route.segments
    .flatMap((segment) => segment.steps || [])
    .reduce((total, step) => {
      const stepName = normalizeRoadName(step.name || "");
      const isAvoided = avoidTerms.some((term) => stepName.includes(term));

      if (!isAvoided) return total;

      return total + (Number(step.distance) || measureStepDistance(route.points, step));
    }, 0);
}

function measureStepDistance(points, step) {
  const [startIndex, endIndex] = step.way_points || [];

  if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex)) return 0;

  return measureRoute(points.slice(startIndex, endIndex + 1));
}

function normalizeRoadName(value) {
  return String(value)
    .toLowerCase()
    .replace(/\broute\b/g, "rt")
    .replace(/\bhighway\b/g, "hwy")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreLoopQuality(points) {
  const segments = buildRouteSegments(points);
  const spur = scoreSpurQuality(points);
  let uTurns = 0;
  let reversedOverlapMeters = 0;
  const buckets = new Map();
  const cellSize = 0.00025;

  segments.forEach((segment, index) => {
    if (
      index > 0 &&
      segment.length > 20 &&
      segments[index - 1].length > 20 &&
      angleDistanceDegrees(segment.bearing, segments[index - 1].bearing) > 145
    ) {
      uTurns += 1;
    }

    const cell = getSegmentCell(segment.midpoint, cellSize);
    const neighbors = getNeighborCells(cell);

    neighbors.forEach((neighbor) => {
      const nearbySegments = buckets.get(neighbor) || [];

      nearbySegments.forEach((previous) => {
        if (Math.abs(previous.index - index) < 8) return;

        const isNearby = haversineMeters(previous.midpoint, segment.midpoint) < 35;
        const isReversed =
          angleDistanceDegrees(previous.bearing, segment.bearing) > 155;

        if (isNearby && isReversed) {
          reversedOverlapMeters += Math.min(previous.length, segment.length);
        }
      });
    });

    const key = `${cell.x}:${cell.y}`;
    const existing = buckets.get(key) || [];

    existing.push({ ...segment, index });
    buckets.set(key, existing);
  });

  return {
    score: reversedOverlapMeters + uTurns * 200 + spur.score,
    spurCount: spur.count,
    spurMeters: spur.meters,
    spurs: spur.spurs,
    uTurns,
    reversedOverlapMeters,
  };
}

function scoreSpurQuality(points) {
  const cumulativeDistances = buildCumulativeDistances(points);
  const candidates = [];
  const minPathMeters = 140;
  const maxPathMeters = 1800;

  for (let start = 0; start < points.length - 3; start += 1) {
    for (let end = start + 2; end < points.length; end += 1) {
      const pathMeters = cumulativeDistances[end] - cumulativeDistances[start];

      if (pathMeters < minPathMeters) continue;
      if (pathMeters > maxPathMeters) break;

      const endpointMeters = haversineMeters(points[start], points[end]);
      const returnLimit = Math.min(120, Math.max(35, pathMeters * 0.18));
      const progressRatio = pathMeters / Math.max(endpointMeters, 12);

      if (endpointMeters <= returnLimit && progressRatio >= 3.2) {
        const wastedMeters = pathMeters - endpointMeters;

        candidates.push({
          start,
          end,
          meters: pathMeters,
          score: wastedMeters * 9 + 800,
        });
      }
    }
  }

  const selected = selectNonOverlappingSpurs(candidates);
  const meters = selected.reduce((total, candidate) => total + candidate.meters, 0);
  const score = selected.reduce((total, candidate) => total + candidate.score, 0);

  return {
    count: selected.length,
    meters,
    score,
    spurs: selected,
  };
}

function buildCumulativeDistances(points) {
  const distances = [0];

  for (let index = 1; index < points.length; index += 1) {
    distances[index] =
      distances[index - 1] + haversineMeters(points[index - 1], points[index]);
  }

  return distances;
}

function selectNonOverlappingSpurs(candidates) {
  const selected = [];

  candidates
    .sort((a, b) => b.score - a.score)
    .forEach((candidate) => {
      const overlaps = selected.some(
        (existing) => candidate.start < existing.end && candidate.end > existing.start,
      );

      if (!overlaps) {
        selected.push(candidate);
      }
    });

  return selected;
}

function buildRouteSegments(points) {
  const segments = [];

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = haversineMeters(start, end);

    if (length < 8) continue;

    segments.push({
      bearing: bearingDegrees(start, end),
      length,
      midpoint: {
        lat: (start.lat + end.lat) / 2,
        lng: (start.lng + end.lng) / 2,
      },
    });
  }

  return segments;
}

function getSegmentCell(point, cellSize) {
  return {
    x: Math.floor(point.lng / cellSize),
    y: Math.floor(point.lat / cellSize),
  };
}

function getNeighborCells(cell) {
  const cells = [];

  for (let x = cell.x - 1; x <= cell.x + 1; x += 1) {
    for (let y = cell.y - 1; y <= cell.y + 1; y += 1) {
      cells.push(`${x}:${y}`);
    }
  }

  return cells;
}

function bearingDegrees(a, b) {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);

  return (Math.atan2(y, x) * 180) / Math.PI + 180;
}

function angleDistanceDegrees(a, b) {
  const difference = Math.abs(a - b) % 360;

  return difference > 180 ? 360 - difference : difference;
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function signedAngleDegrees(a, b) {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

function offsetCoordinate(origin, eastMeters, northMeters) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng =
    metersPerDegreeLat * Math.cos((origin.lat * Math.PI) / 180);

  return {
    lat: origin.lat + northMeters / metersPerDegreeLat,
    lng: origin.lng + eastMeters / metersPerDegreeLng,
  };
}

function measureRoute(points) {
  let meters = 0;

  for (let index = 1; index < points.length; index += 1) {
    meters += haversineMeters(points[index - 1], points[index]);
  }

  return meters;
}

function haversineMeters(a, b) {
  const earthRadius = 6371008.8;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const value =
    sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function estimateRideSeconds(distanceMeters) {
  const casualCyclingMetersPerSecond = 12 * METERS_PER_MILE / 3600;

  return distanceMeters / casualCyclingMetersPerSecond;
}

function createRouteName(targetMiles) {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");

  return `Bike${Math.round(targetMiles)} ${month}${day}-${hour}${minute}`;
}

function createGpx(route) {
  const name = escapeXml(route.name);
  const timedPoints = buildTimedPoints(route, new Date());
  const trackPoints = createGpxTrackPoints(timedPoints);

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Cycle Route Lab" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${name}</name>
    <time>${formatXmlTime(new Date())}</time>
  </metadata>
  <trk>
    <name>${name}</name>
    <type>cycling</type>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>
`;
}

function createEnhancedGpx(route) {
  const name = escapeXml(route.name);
  const timedPoints = buildTimedPoints(route, new Date());
  const firstPoint = timedPoints[0];
  const lastPoint = timedPoints[timedPoints.length - 1];
  const routePoints = timedPoints
    .map(
      (point) =>
        `    <rtept lat="${point.lat.toFixed(7)}" lon="${point.lng.toFixed(
          7,
        )}"><name>${point.index}</name></rtept>`,
    )
    .join("\n");
  const trackPoints = createGpxTrackPoints(timedPoints);

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Cycle Route Lab" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${name}</name>
    <desc>${formatDistance(route.distanceMeters)} cycling course from Cycle Route Lab</desc>
    <time>${formatXmlTime(new Date())}</time>
  </metadata>
  <wpt lat="${firstPoint.lat.toFixed(7)}" lon="${firstPoint.lng.toFixed(7)}">
    <name>Start</name>
    <type>Start</type>
  </wpt>
  <wpt lat="${lastPoint.lat.toFixed(7)}" lon="${lastPoint.lng.toFixed(7)}">
    <name>Finish</name>
    <type>Finish</type>
  </wpt>
  <rte>
    <name>${name}</name>
    <type>cycling</type>
${routePoints}
  </rte>
  <trk>
    <name>${name}</name>
    <type>cycling</type>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>
`;
}

function createGpxTrackPoints(timedPoints) {
  const trackPoints = timedPoints
    .map((point) => {
      const elevation =
        point.ele === undefined || point.ele === null
          ? ""
          : `<ele>${Number(point.ele).toFixed(1)}</ele>`;

      return `      <trkpt lat="${point.lat.toFixed(7)}" lon="${point.lng.toFixed(
        7,
      )}">${elevation}<time>${point.time}</time></trkpt>`;
    })
    .join("\n");

  return trackPoints;
}

function createTcx(route) {
  const name = escapeXml(route.name);
  const timedPoints = buildTimedPoints(route, new Date());
  const firstPoint = timedPoints[0];
  const lastPoint = timedPoints[timedPoints.length - 1];
  const points = timedPoints
    .map((point) => {
      const altitude = point.ele === undefined || point.ele === null ? 0 : point.ele;

      return `        <Trackpoint>
          <Time>${point.time}</Time>
          <Position>
            <LatitudeDegrees>${point.lat.toFixed(7)}</LatitudeDegrees>
            <LongitudeDegrees>${point.lng.toFixed(7)}</LongitudeDegrees>
          </Position>
          <AltitudeMeters>${Number(altitude).toFixed(1)}</AltitudeMeters>
          <DistanceMeters>${point.distance.toFixed(1)}</DistanceMeters>
        </Trackpoint>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">
  <Courses>
    <Course>
      <Name>${name}</Name>
      <Lap>
        <TotalTimeSeconds>${Math.round(route.durationSeconds)}</TotalTimeSeconds>
        <DistanceMeters>${route.distanceMeters.toFixed(1)}</DistanceMeters>
        <BeginPosition>
          <LatitudeDegrees>${firstPoint.lat.toFixed(7)}</LatitudeDegrees>
          <LongitudeDegrees>${firstPoint.lng.toFixed(7)}</LongitudeDegrees>
        </BeginPosition>
        <EndPosition>
          <LatitudeDegrees>${lastPoint.lat.toFixed(7)}</LatitudeDegrees>
          <LongitudeDegrees>${lastPoint.lng.toFixed(7)}</LongitudeDegrees>
        </EndPosition>
        <Intensity>Active</Intensity>
      </Lap>
      <Track>
${points}
      </Track>
      <Creator xsi:type="Application_t">
        <Name>Cycle Route Lab</Name>
        <Build>
          <Version>
            <VersionMajor>1</VersionMajor>
            <VersionMinor>0</VersionMinor>
            <BuildMajor>0</BuildMajor>
            <BuildMinor>0</BuildMinor>
          </Version>
        </Build>
        <LangID>en</LangID>
        <PartNumber>000-00000-00</PartNumber>
      </Creator>
    </Course>
  </Courses>
  <Author xsi:type="Application_t">
    <Name>Cycle Route Lab</Name>
    <Build>
      <Version>
        <VersionMajor>1</VersionMajor>
        <VersionMinor>0</VersionMinor>
        <BuildMajor>0</BuildMajor>
        <BuildMinor>0</BuildMinor>
      </Version>
    </Build>
    <LangID>en</LangID>
    <PartNumber>000-00000-00</PartNumber>
  </Author>
</TrainingCenterDatabase>
`;
}

function downloadGpx(route) {
  const file = createGpxFile(route);
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");

  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("Garmin GPX downloaded for Courses import.", "success");
}

function downloadEnhancedGpx(route) {
  const file = createEnhancedGpxFile(route);
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");

  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("Enhanced GPX downloaded for route apps.", "success");
}

function downloadTcx(route) {
  const file = createTcxFile(route);
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");

  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("TCX downloaded.", "success");
}

async function shareGpx(route) {
  const file = createGpxFile(route);

  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({
      title: route.name,
      text: "Cycling route GPX",
      files: [file],
    });
    return;
  }

  downloadGpx(route);
  setStatus("Sharing is not available here, so the GPX was downloaded.", "success");
}

function createGpxFile(route) {
  const safeName = createSafeFileName(route.name);

  return new File([createGpx(route)], `${safeName}.gpx`, {
    type: "application/gpx+xml",
  });
}

function createEnhancedGpxFile(route) {
  const safeName = `${createSafeFileName(route.name)}-enhanced`;

  return new File([createEnhancedGpx(route)], `${safeName}.gpx`, {
    type: "application/gpx+xml",
  });
}

function createTcxFile(route) {
  const safeName = createSafeFileName(route.name);

  return new File([createTcx(route)], `${safeName}.tcx`, {
    type: "application/vnd.garmin.tcx+xml",
  });
}

function buildTimedPoints(route, startTime) {
  let distance = 0;

  return route.points.map((point, index) => {
    if (index > 0) {
      distance += haversineMeters(route.points[index - 1], point);
    }

    const ratio = route.distanceMeters > 0 ? distance / route.distanceMeters : 0;
    const time = new Date(startTime.getTime() + route.durationSeconds * ratio * 1000);

    return {
      ...point,
      distance,
      index: index + 1,
      time: formatXmlTime(time),
    };
  });
}

function formatXmlTime(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function createSafeFileName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function isLikelyGoogleMapsKey(value) {
  return String(value).trim().startsWith("AIza");
}

function setBusy(isBusy, message) {
  state.busy = isBusy;
  elements.buildButton.disabled = isBusy;
  elements.searchButton.disabled = isBusy;
  elements.locationButton.disabled = isBusy;
  elements.saveHomeButton.disabled = isBusy;
  elements.useHomeButton.disabled = isBusy;
  elements.saveKeyButton.disabled = isBusy;
  elements.saveStravaKeyButton.disabled = isBusy;
  elements.firstTurnRightInput.disabled = isBusy;
  elements.favorStravaInput.disabled = isBusy;
  updateUndoButton();
  updateClosureControls();
  updateWaypointControls();

  if (message) {
    setStatus(message);
  }
}

function setStatus(message, type = "") {
  elements.statusText.textContent = message;
  elements.statusText.className = `status-line ${type}`.trim();
}

function formatDistance(meters) {
  const miles = meters / METERS_PER_MILE;

  return `${miles.toFixed(miles >= 10 ? 1 : 2)} mi`;
}

function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (!hours) {
    return `${minutes} min`;
  }

  return `${hours}h ${String(remainder).padStart(2, "0")}m`;
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function loadJson(key) {
  try {
    const value = localStorage.getItem(key);

    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

async function readErrorMessage(response) {
  try {
    const data = await response.json();

    return data.error?.message || data.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
