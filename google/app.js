const METERS_PER_MILE = 1609.344;
const DEFAULT_CENTER = { lat: 40.381, lng: -74.2 };
const STORAGE_KEYS = {
  googleKey: "cycle-route-google.key",
  lastStart: "cycle-route-google.last-start",
};

const elements = {
  routeForm: document.querySelector("#routeForm"),
  googleKeyInput: document.querySelector("#googleKeyInput"),
  loadMapButton: document.querySelector("#loadMapButton"),
  originInput: document.querySelector("#originInput"),
  searchButton: document.querySelector("#searchButton"),
  locationButton: document.querySelector("#locationButton"),
  customDistance: document.querySelector("#customDistance"),
  distancePresets: [...document.querySelectorAll("[name='distancePreset']")],
  routeModeSelect: document.querySelector("#routeModeSelect"),
  candidateSelect: document.querySelector("#candidateSelect"),
  loopShapeSelect: document.querySelector("#loopShapeSelect"),
  clearAnchorsButton: document.querySelector("#clearAnchorsButton"),
  avoidHighwaysInput: document.querySelector("#avoidHighwaysInput"),
  rejectSpursInput: document.querySelector("#rejectSpursInput"),
  buildButton: document.querySelector("#buildButton"),
  statusText: document.querySelector("#statusText"),
  distanceOut: document.querySelector("#distanceOut"),
  timeOut: document.querySelector("#timeOut"),
  spursOut: document.querySelector("#spursOut"),
  anchorsOut: document.querySelector("#anchorsOut"),
  map: document.querySelector("#map"),
};

const state = {
  start: loadJson(STORAGE_KEYS.lastStart) || DEFAULT_CENTER,
  routeSeed: Math.floor(Math.random() * 9000) + 1000,
  map: null,
  marker: null,
  geocoder: null,
  directionsService: null,
  directionsRenderer: null,
  bikeLayer: null,
  anchorMarkers: [],
  anchors: [],
  scriptPromise: null,
  busy: false,
};

elements.googleKeyInput.value = localStorage.getItem(STORAGE_KEYS.googleKey) || "";

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

elements.loadMapButton.addEventListener("click", async () => {
  await ensureGoogleMap();
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

elements.clearAnchorsButton.addEventListener("click", () => {
  clearAnchors();
  clearRouteDisplay();
  resetRouteReadout();
  setStatus("Route anchors cleared.", "success");
});

elements.routeModeSelect.addEventListener("change", () => {
  syncModeControls();
  clearRouteDisplay();
  resetRouteReadout();
  setStatus(
    elements.routeModeSelect.value === "manual"
      ? "Manual anchor mode ready."
      : "Auto prototype mode ready.",
    "success",
  );
});

elements.routeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await buildGoogleRoute();
});

syncModeControls();
updateAnchorReadout();

async function ensureGoogleMap() {
  const apiKey = elements.googleKeyInput.value.trim();

  if (!apiKey) {
    setStatus("Paste a Google Maps key first.", "error");
    return false;
  }

  localStorage.setItem(STORAGE_KEYS.googleKey, apiKey);

  if (!window.google?.maps) {
    setBusy(true, "Loading Google Maps...");
    try {
      await loadGoogleMaps(apiKey);
    } catch (error) {
      setStatus(error.message || "Google Maps failed to load.", "error");
      setBusy(false);
      return false;
    }
  }

  if (!state.map) {
    initMap();
  }

  setBusy(false);
  setStatus("Google map ready.", "success");
  return true;
}

function loadGoogleMaps(apiKey) {
  if (state.scriptPromise) {
    return state.scriptPromise;
  }

  state.scriptPromise = new Promise((resolve, reject) => {
    const callbackName = "initGoogleCycleRouteLab";
    const script = document.createElement("script");

    window[callbackName] = () => {
      resolve();
      delete window[callbackName];
    };

    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey,
    )}&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      state.scriptPromise = null;
      reject(new Error("Google Maps failed to load."));
    };

    document.head.append(script);
  });

  return state.scriptPromise;
}

function initMap() {
  state.map = new google.maps.Map(elements.map, {
    center: state.start,
    zoom: 12,
    mapTypeId: "roadmap",
    fullscreenControl: false,
    streetViewControl: false,
  });
  state.geocoder = new google.maps.Geocoder();
  state.directionsService = new google.maps.DirectionsService();
  state.directionsRenderer = new google.maps.DirectionsRenderer({
    map: state.map,
    preserveViewport: false,
    suppressMarkers: true,
    polylineOptions: {
      strokeColor: "#176b58",
      strokeOpacity: 0.92,
      strokeWeight: 6,
    },
  });
  state.bikeLayer = new google.maps.BicyclingLayer();
  state.bikeLayer.setMap(state.map);
  syncStartMarker();

  state.map.addListener("click", (event) => {
    if (elements.routeModeSelect.value === "manual") {
      addAnchor({
        lat: event.latLng.lat(),
        lng: event.latLng.lng(),
      });
      setStatus("Anchor added.", "success");
      return;
    }

    setStart({ lat: event.latLng.lat(), lng: event.latLng.lng() });
    setStatus("Start point updated.", "success");
  });
}

async function findOrigin() {
  const ready = await ensureGoogleMap();
  const query = elements.originInput.value.trim();

  if (!ready) return;

  if (!query) {
    setStatus("Enter an address or place.", "error");
    return;
  }

  setBusy(true, "Finding start point...");

  try {
    const result = await geocode(query);
    const location = result.geometry.location;

    setStart({ lat: location.lat(), lng: location.lng() });
    setStatus("Start point found.", "success");
  } catch (error) {
    setStatus(error.message || "No matching address found.", "error");
  } finally {
    setBusy(false);
  }
}

function geocode(address) {
  return new Promise((resolve, reject) => {
    state.geocoder.geocode({ address }, (results, status) => {
      if (status === "OK" && results?.[0]) {
        resolve(results[0]);
      } else {
        reject(new Error(`Geocoding failed: ${status}`));
      }
    });
  });
}

function useCurrentLocation() {
  if (!navigator.geolocation) {
    setStatus("Location is not available in this browser.", "error");
    return;
  }

  setBusy(true, "Getting current location...");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      setStart({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      });
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

async function buildGoogleRoute() {
  const ready = await ensureGoogleMap();
  const targetMiles = Number(elements.customDistance.value);

  if (!ready) return;

  if (!Number.isFinite(targetMiles) || targetMiles < 2) {
    setStatus("Distance must be at least 2 miles.", "error");
    return;
  }

  const isManual = elements.routeModeSelect.value === "manual";
  const candidateCount = isManual ? 1 : Number(elements.candidateSelect.value);
  const rejectSpurs = elements.rejectSpursInput.checked;
  const maxAttempts = isManual
    ? 1
    : rejectSpurs
      ? Math.min(30, candidateCount * 3)
      : candidateCount;
  const candidates = [];
  const rejected = [];

  if (isManual && state.anchors.length < 2) {
    setStatus("Manual mode needs at least 2 map anchors.", "error");
    return;
  }

  state.routeSeed += 1;
  setBusy(
    true,
    isManual
      ? "Building anchored Google route..."
      : "Building no-spur Google route candidates...",
  );

  for (let index = 0; index < maxAttempts; index += 1) {
    try {
      const waypoints = isManual
        ? state.anchors
        : createLoopWaypoints(state.start, targetMiles, state.routeSeed + index * 137);
      const result = await requestGoogleDirections(waypoints);
      const route = parseGoogleRoute(result);

      route.score = scoreGoogleRoute(route, targetMiles);
      route.result = result;

      if (rejectSpurs && route.loop.spurCount > 0) {
        rejected.push(route);
      } else {
        candidates.push(route);
      }

      if (rejectSpurs && candidates.length >= candidateCount) {
        break;
      }
    } catch (error) {
      console.warn(error);
    }
  }

  setBusy(false);

  if (!candidates.length && !rejected.length) {
    setStatus("Google could not build a cycling route here.", "error");
    clearRouteDisplay();
    resetRouteReadout();
    return;
  }

  if (rejectSpurs && !candidates.length) {
    clearRouteDisplay();
    rejected.sort((a, b) => a.score - b.score);
    const best = rejected[0];

    elements.distanceOut.textContent = formatDistance(best.distanceMeters);
    elements.timeOut.textContent = formatDuration(best.durationSeconds);
    elements.spursOut.textContent = `${best.loop.spurCount} / ${formatDistance(
      best.loop.spurMeters,
    )}`;
    setStatus(
      isManual
        ? "The selected anchors still create a spur. Move or remove the problem anchor."
        : `No clean no-spur Google route found after ${maxAttempts} attempts. Route hidden; switch to Manual anchors.`,
      "error",
    );
    return;
  }

  const pool = candidates.length ? candidates : rejected;

  pool.sort((a, b) => a.score - b.score);
  renderGoogleRoute(pool[0], {
    attempts: maxAttempts,
    cleanCount: candidates.length,
    rejectedCount: rejected.length,
    manual: isManual,
    strict: rejectSpurs,
  });
}

function requestGoogleDirections(waypoints) {
  return new Promise((resolve, reject) => {
    state.directionsService.route(
      {
        origin: state.start,
        destination: state.start,
        waypoints: waypoints.map((location) => ({ location, stopover: false })),
        travelMode: google.maps.TravelMode.BICYCLING,
        avoidHighways: elements.avoidHighwaysInput.checked,
        optimizeWaypoints: false,
      },
      (result, status) => {
        if (status === "OK" && result) {
          resolve(result);
        } else {
          reject(new Error(`Directions failed: ${status}`));
        }
      },
    );
  });
}

function addAnchor(anchor) {
  state.anchors.push({
    lat: Number(anchor.lat),
    lng: Number(anchor.lng),
  });

  if (state.map) {
    const marker = new google.maps.Marker({
      map: state.map,
      position: anchor,
      label: String(state.anchors.length),
      title: `Anchor ${state.anchors.length}`,
    });

    state.anchorMarkers.push(marker);
  }

  updateAnchorReadout();
}

function clearAnchors() {
  state.anchorMarkers.forEach((marker) => marker.setMap(null));
  state.anchorMarkers = [];
  state.anchors = [];
  updateAnchorReadout();
}

function updateAnchorReadout() {
  elements.anchorsOut.textContent = String(state.anchors.length);
  syncModeControls();
}

function createLoopWaypoints(start, targetMiles, seed) {
  const shape = elements.loopShapeSelect.value;
  const targetMeters = targetMiles * METERS_PER_MILE;
  const baseBearing = seededNumber(seed) * 360;
  const turn = seededNumber(seed + 17) > 0.5 ? 1 : -1;

  if (shape === "triangle") {
    const sideMeters = targetMeters / 3;
    const first = destinationPoint(start, baseBearing, sideMeters);
    const second = destinationPoint(start, baseBearing + turn * 60, sideMeters);

    return [first, second];
  }

  const aspect = 0.72 + seededNumber(seed + 29) * 0.56;
  const widthMeters = (targetMeters * aspect) / (2 * (aspect + 1));
  const heightMeters = targetMeters / (2 * (aspect + 1));
  const first = destinationPoint(start, baseBearing, widthMeters);
  const third = destinationPoint(start, baseBearing + turn * 90, heightMeters);
  const second = destinationPoint(first, baseBearing + turn * 90, heightMeters);

  return [first, second, third];
}

function parseGoogleRoute(result) {
  const route = result.routes[0];
  const leg = route.legs.reduce(
    (total, item) => ({
      distance: total.distance + (item.distance?.value || 0),
      duration: total.duration + (item.duration?.value || 0),
    }),
    { distance: 0, duration: 0 },
  );
  const points = getDetailedRoutePoints(route);
  const loop = scoreLoopQuality(points);
  const boundary = scoreWaypointBoundarySpurs(getDetailedLegPoints(route));

  loop.score += boundary.score;
  loop.spurCount += boundary.count;
  loop.spurMeters += boundary.meters;
  loop.waypointSpurCount = boundary.count;

  return {
    distanceMeters: leg.distance,
    durationSeconds: leg.duration,
    loop,
    points,
  };
}

function getDetailedLegPoints(route) {
  return route.legs.map((leg) => {
    const points = [];

    leg.steps.forEach((step) => {
      (step.path || []).forEach((point) => {
        const next = {
          lat: point.lat(),
          lng: point.lng(),
        };
        const previous = points[points.length - 1];

        if (
          !previous ||
          Math.abs(previous.lat - next.lat) > 0.000001 ||
          Math.abs(previous.lng - next.lng) > 0.000001
        ) {
          points.push(next);
        }
      });
    });

    return points;
  });
}

function getDetailedRoutePoints(route) {
  const points = [];

  route.legs.forEach((leg) => {
    leg.steps.forEach((step) => {
      (step.path || []).forEach((point) => {
        const next = {
          lat: point.lat(),
          lng: point.lng(),
        };
        const previous = points[points.length - 1];

        if (
          !previous ||
          Math.abs(previous.lat - next.lat) > 0.000001 ||
          Math.abs(previous.lng - next.lng) > 0.000001
        ) {
          points.push(next);
        }
      });
    });
  });

  return points.length
    ? points
    : route.overview_path.map((point) => ({
        lat: point.lat(),
        lng: point.lng(),
      }));
}

function scoreGoogleRoute(route, targetMiles) {
  const targetMeters = targetMiles * METERS_PER_MILE;
  const distanceMiss = Math.abs(route.distanceMeters - targetMeters);

  return distanceMiss * 1.1 + route.loop.score * 4;
}

function renderGoogleRoute(route, result) {
  state.directionsRenderer.setDirections(route.result);
  elements.distanceOut.textContent = formatDistance(route.distanceMeters);
  elements.timeOut.textContent = formatDuration(route.durationSeconds);
  elements.spursOut.textContent = route.loop.spurCount
    ? `${route.loop.spurCount} / ${formatDistance(route.loop.spurMeters)}`
    : "0";

  if (route.loop.spurCount) {
    setStatus(
      result.manual
        ? "Anchored route has a spur section; move or remove that anchor if it feels wrong."
        : `No clean route found after ${result.attempts} attempts. Showing least-bad candidate; try Triangle or Build again.`,
      "error",
    );
    return;
  }

  setStatus(
    result.manual
      ? "Anchored Google bicycle route built."
      : `Clean route picked from ${result.cleanCount} no-spur Google bicycle options.`,
    "success",
  );
}

function clearRouteDisplay() {
  if (state.directionsRenderer) {
    state.directionsRenderer.setDirections({ routes: [] });
  }
}

function resetRouteReadout() {
  elements.distanceOut.textContent = "--";
  elements.timeOut.textContent = "--";
  elements.spursOut.textContent = "--";
}

function setStart(start) {
  state.start = {
    lat: Number(start.lat),
    lng: Number(start.lng),
  };

  localStorage.setItem(STORAGE_KEYS.lastStart, JSON.stringify(state.start));

  if (state.map) {
    state.map.setCenter(state.start);
    syncStartMarker();
    clearRouteDisplay();
    resetRouteReadout();
  }
}

function syncStartMarker() {
  if (!state.map) return;

  if (state.marker) {
    state.marker.setPosition(state.start);
    return;
  }

  state.marker = new google.maps.Marker({
    map: state.map,
    position: state.start,
    draggable: true,
    label: "S",
    title: "Start",
  });

  state.marker.addListener("dragend", (event) => {
    setStart({
      lat: event.latLng.lat(),
      lng: event.latLng.lng(),
    });
    setStatus("Start point updated.", "success");
  });
}

function scoreLoopQuality(points) {
  const spur = scoreSpurQuality(points);
  let uTurns = 0;
  const segments = buildRouteSegments(points);

  segments.forEach((segment, index) => {
    if (
      index > 0 &&
      segment.length > 20 &&
      segments[index - 1].length > 20 &&
      angleDistanceDegrees(segment.bearing, segments[index - 1].bearing) > 145
    ) {
      uTurns += 1;
    }
  });

  return {
    score: spur.score + uTurns * 250,
    spurCount: spur.count,
    spurMeters: spur.meters,
    uTurns,
  };
}

function scoreSpurQuality(points) {
  const cumulativeDistances = buildCumulativeDistances(points);
  const candidates = [];

  for (let start = 0; start < points.length - 3; start += 1) {
    for (let end = start + 2; end < points.length; end += 1) {
      const pathMeters = cumulativeDistances[end] - cumulativeDistances[start];

      if (pathMeters < 70) continue;
      if (pathMeters > 2200) break;

      const endpointMeters = haversineMeters(points[start], points[end]);
      const returnLimit = Math.min(150, Math.max(25, pathMeters * 0.2));
      const progressRatio = pathMeters / Math.max(endpointMeters, 12);

      if (endpointMeters <= returnLimit && progressRatio >= 2.4) {
        candidates.push({
          start,
          end,
          meters: pathMeters,
          score: (pathMeters - endpointMeters) * 14 + 1400,
        });
      }
    }
  }

  const selected = selectNonOverlappingSpurs(candidates);

  return {
    count: selected.length,
    meters: selected.reduce((total, item) => total + item.meters, 0),
    score: selected.reduce((total, item) => total + item.score, 0),
  };
}

function scoreWaypointBoundarySpurs(legPointSets) {
  let count = 0;
  let meters = 0;

  for (let index = 0; index < legPointSets.length - 1; index += 1) {
    const inbound = legPointSets[index];
    const outbound = legPointSets[index + 1];
    const inboundBearing = bearingNearEnd(inbound, 60);
    const outboundBearing = bearingNearStart(outbound, 60);

    if (inboundBearing === null || outboundBearing === null) continue;

    const angle = angleDistanceDegrees(inboundBearing, outboundBearing);
    const before = pointAtDistanceFromEnd(inbound, 120);
    const after = pointAtDistanceFromStart(outbound, 120);
    const sameCorridor = before && after && haversineMeters(before, after) < 75;

    if (angle > 155 || (angle > 130 && sameCorridor)) {
      count += 1;
      meters += 240;
    }
  }

  return {
    count,
    meters,
    score: count * 5000 + meters * 8,
  };
}

function bearingNearEnd(points, minDistance) {
  if (points.length < 2) return null;

  const end = points[points.length - 1];

  for (let index = points.length - 2; index >= 0; index -= 1) {
    if (haversineMeters(points[index], end) >= minDistance) {
      return bearingDegrees(points[index], end);
    }
  }

  return bearingDegrees(points[points.length - 2], end);
}

function bearingNearStart(points, minDistance) {
  if (points.length < 2) return null;

  const start = points[0];

  for (let index = 1; index < points.length; index += 1) {
    if (haversineMeters(start, points[index]) >= minDistance) {
      return bearingDegrees(start, points[index]);
    }
  }

  return bearingDegrees(start, points[1]);
}

function pointAtDistanceFromEnd(points, targetMeters) {
  let distance = 0;

  for (let index = points.length - 1; index > 0; index -= 1) {
    const segment = haversineMeters(points[index], points[index - 1]);

    distance += segment;

    if (distance >= targetMeters) {
      return points[index - 1];
    }
  }

  return points[0] || null;
}

function pointAtDistanceFromStart(points, targetMeters) {
  let distance = 0;

  for (let index = 1; index < points.length; index += 1) {
    const segment = haversineMeters(points[index - 1], points[index]);

    distance += segment;

    if (distance >= targetMeters) {
      return points[index];
    }
  }

  return points[points.length - 1] || null;
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
    });
  }

  return segments;
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

      if (!overlaps) selected.push(candidate);
    });

  return selected;
}

function destinationPoint(origin, bearing, distanceMeters) {
  const earthRadius = 6371008.8;
  const angularDistance = distanceMeters / earthRadius;
  const bearingRad = toRadians(bearing);
  const lat1 = toRadians(origin.lat);
  const lng1 = toRadians(origin.lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRad),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    lat: (lat2 * 180) / Math.PI,
    lng: (((lng2 * 180) / Math.PI + 540) % 360) - 180,
  };
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

function seededNumber(seed) {
  const value = Math.sin(seed * 999.91) * 10000;

  return value - Math.floor(value);
}

function formatDistance(meters) {
  const miles = meters / METERS_PER_MILE;

  return `${miles.toFixed(miles >= 10 ? 1 : 2)} mi`;
}

function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (!hours) return `${minutes} min`;

  return `${hours}h ${String(remainder).padStart(2, "0")}m`;
}

function setBusy(isBusy, message) {
  state.busy = isBusy;
  elements.buildButton.disabled = isBusy;
  elements.loadMapButton.disabled = isBusy;
  elements.searchButton.disabled = isBusy;
  elements.locationButton.disabled = isBusy;
  elements.routeModeSelect.disabled = isBusy;
  syncModeControls();

  if (message) setStatus(message);
}

function syncModeControls() {
  const isManual = elements.routeModeSelect.value === "manual";

  elements.candidateSelect.disabled = state.busy || isManual;
  elements.loopShapeSelect.disabled = state.busy || isManual;
  elements.clearAnchorsButton.disabled =
    state.busy || !isManual || !state.anchors.length;
}

function setStatus(message, type = "") {
  elements.statusText.textContent = message;
  elements.statusText.className = `status-line ${type}`.trim();
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
