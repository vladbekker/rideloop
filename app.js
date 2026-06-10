const METERS_PER_MILE = 1609.344;
const CLOSURE_RADIUS_METERS = 180;
const DEFAULT_CENTER = { lat: 40.73061, lng: -73.935242 };
const STORAGE_KEYS = {
  homeAddress: "cycle-route-lab.home-address",
  homeLocation: "cycle-route-lab.home-location",
  orsKey: "cycle-route-lab.ors-key",
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
  avoidRoadsInput: document.querySelector("#avoidRoadsInput"),
  markClosureButton: document.querySelector("#markClosureButton"),
  clearClosuresButton: document.querySelector("#clearClosuresButton"),
  addWaypointButton: document.querySelector("#addWaypointButton"),
  clearWaypointsButton: document.querySelector("#clearWaypointsButton"),
  orsKeyInput: document.querySelector("#orsKeyInput"),
  saveKeyButton: document.querySelector("#saveKeyButton"),
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

  if (orsKey && isLikelyGoogleMapsKey(orsKey)) {
    clearRouteDisplay();
    setStatus(
      "That looks like a Google Maps key. Paste an openrouteservice API key for live routing.",
      "error",
    );
    return;
  }

  const buildMessage =
    orsKey &&
    (elements.avoidBacktracksInput.checked ||
      elements.familySafeInput.checked ||
      getAvoidRoadTerms().length)
      ? "Building route candidates..."
      : "Building route...";

  setBusy(true, buildMessage);

  try {
    const builtRoute = orsKey
      ? await buildOpenRouteServiceLoop(state.start, targetMiles, orsKey)
      : buildPreviewLoop(state.start, targetMiles);
    const route = applyStartDirectionPreference(builtRoute);

    route.driveToStart = await getDriveToStartEstimate(orsKey);
    drawRoute(route, { resetHistory: true });
    setStatus(createDisplayStatus(route), "success");
  } catch (error) {
    if (orsKey) {
      clearRouteDisplay();
      setStatus(
        `${error.message} Live routing failed, so no preview route was shown.`,
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

async function buildOpenRouteServiceLoop(start, targetMiles, apiKey) {
  const preferences = {
    avoidBacktracks: elements.avoidBacktracksInput.checked,
    familySafe: elements.familySafeInput.checked,
    avoidTerms: getAvoidRoadTerms(),
  };

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
    preferences.avoidTerms.length > 0;
  const candidateCount = needsScoring ? getCandidateCount(targetMiles) : 1;
  const candidates = [];
  let lastError = null;

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

  candidates.sort((a, b) => a.quality.score - b.quality.score);
  const route = candidates[0];

  route.status =
    candidateCount > 1
      ? createCandidateStatus(route, candidates.length)
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
  const quality = route.quality
    ? {
        ...route.quality,
        score: loop.score + (safety?.score || 0),
        loop,
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
  elements.sourceBadge.textContent =
    route.source === "openrouteservice" ? "Live route" : "Preview";
  elements.downloadButton.disabled = false;
  elements.downloadEnhancedButton.disabled = false;
  elements.downloadTcxButton.disabled = false;
  elements.shareButton.disabled = false;
  updateUndoButton();
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

function createDisplayStatus(route) {
  const spurs = route.cleanupSpurs || getRouteSpurs(route);
  const driveText = createDriveStatusText(route.driveToStart);
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
    return `${route.status}${driveText}${waypointText}${closureText}`;
  }

  return `${route.status}${driveText}${waypointText}${closureText} Click an orange spur to remove it before exporting.`;
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
  const editedRoute = {
    ...route,
    points,
    distanceMeters,
    durationSeconds,
    status: `Removed ${formatDistance(spur.meters)} spur from route.`,
    quality: {
      score: loop.score + (safety.score || 0),
      loop,
      safety,
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
        }
      : route.quality,
    cleanupSpurs: route.cleanupSpurs?.map((spur) => ({ ...spur })) || [],
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

function getAvoidRoadTerms() {
  return elements.avoidRoadsInput.value
    .split(",")
    .map((term) => normalizeRoadName(term))
    .filter(Boolean);
}

function createCandidateStatus(route, count) {
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
  const loop = preferences.avoidBacktracks
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

  return {
    score: loop.score + safety.score,
    loop,
    safety,
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
  elements.firstTurnRightInput.disabled = isBusy;
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
