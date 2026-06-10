# Cycle Route Lab

A lightweight web prototype for building cyclist-friendly loop routes and exporting GPX/TCX course files for Garmin Connect.

## Tools

This repo has one primary tool and one paused experiment:

- **ORS Garmin Tool:** the primary OpenStreetMap/openrouteservice route builder and Garmin GPX/TCX exporter.
- **Google Route Tool:** a separate experiment in `google/`; currently paused because Google bicycle routing kept creating awkward spur routes.

## How it works

- Set a start point by address, browser location, saved home address, or a map click.
- Pick a target distance such as 5, 10, or 20 miles.
- Generate routes with the road-bike profile.
- Add an openrouteservice API key for live bicycle routing.
- The live routing key must be an openrouteservice key, not a Google Maps key.
- Export the generated route as a `.gpx` or `.tcx` file.
- Send the generated Garmin GPX directly to Garmin Connect as a private course
  when the local Garmin backend is running.
- Save your home address to show estimated ORS drive time from home to the selected ride start when an ORS key is available.
- Keep **Avoid out-and-backs** on to score several route candidates and choose the one with less backtracking and fewer spur-like sections.
- Keep **Family-safe roads** on to penalize state roads, highways, and low-suitability segments. Add names like `NJ-34` to **Avoid Roads** for an extra penalty.
- Keep **First turn right** on to reverse the loop direction when the exported route would otherwise begin with a left turn.
- Use **Add Waypoint** to drop preferred roads or paths. With an ORS key, the next route is rebuilt through those numbered waypoints and back to the start.
- With the safety filters on, the ORS tool now searches deeper by default: 12 candidates for short routes, 16 for mid-length routes, and 20 for longer routes.
- If a route still has spur-like sections, they are highlighted in orange. Click an orange section to trim it before exporting, and use **Undo Edit** if needed.
- Use **Mark Closure** to click a temporary road closure on the map. The app saves marked closures in this browser and sends those blocked areas to openrouteservice as avoid polygons when building the next route.

Without an openrouteservice key, the app draws a preview loop so the UI can still be tested.

## Run locally

Primary ORS Garmin tool:

```bash
python3 -m http.server 5173
```

Then open:

```text
http://localhost:5173
```

Private Garmin upload backend:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export GARMIN_EMAIL="you@example.com"
export GARMIN_PASSWORD="your-garmin-password"
export GARMIN_TOKENSTORE=".private/garmin_tokens"
python tools/garmin_login.py
uvicorn server:app --reload --port 5173
```

Then open:

```text
http://localhost:5173
```

Use **Send to Garmin** after building a route. The backend uploads the same
conservative Garmin GPX file to Garmin Connect's private Courses flow and saves
the returned course. Garmin credentials and cached tokens stay on the server and
are ignored by git.

### DigitalOcean App Platform

For App Platform, deploy RideLoop as a **Web Service**, not a Static Site. A
Static Site can serve the map UI, but it cannot run the private Garmin API
endpoint.

The included `Procfile` starts the service with:

```bash
uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080}
```

DigitalOcean lets you add env vars after the app is created: open the app, go to
**Settings**, click the web service component, find **Environment Variables**,
click **Edit**, then **Add environment variable**. Use runtime scope and encrypt
secret values.

Simplest App Platform variables:

```text
GARMIN_EMAIL=you@example.com
GARMIN_PASSWORD=your-garmin-password
GARMIN_TOKENSTORE=/tmp/rideloop-garmin-tokens
```

Safer token-based App Platform variables:

```bash
source .venv/bin/activate
python tools/garmin_login.py
python tools/garmin_token_env.py
```

Paste the printed values into App Platform as encrypted runtime variables:

```text
GARMIN_TOKENSTORE=/tmp/rideloop-garmin-tokens
GARMIN_OAUTH1_JSON_B64=...
GARMIN_OAUTH2_JSON_B64=...
```

With token variables, you usually do not need to store `GARMIN_PASSWORD` in
DigitalOcean.

## Deploy

See [DEPLOY.md](DEPLOY.md) for DigitalOcean Droplet deployment steps.

## Garmin

Garmin Connect has two upload flows:

- **Courses:** Training & Planning > Courses > Import. Use this for planned routes and Garmin Edge navigation.
- **Activities:** Cloud icon > Import Data. Use this for completed ride recordings from a Garmin device.

For an Edge 1040 route, use **Courses > Import**. If Garmin Connect rejects the upload, connect the Edge 1040 over USB and copy the `.gpx` or `.tcx` file into `Garmin/NewFiles`, then eject the device so it can process the file into a course.

The **Garmin GPX** export is intentionally conservative because Garmin Connect's course importer is picky. **Enhanced GPX** adds waypoints and route points for apps that handle richer GPX files.

The **Send to Garmin** button uses an unofficial personal integration discovered
from Garmin Connect's own web course-import flow. It is not Garmin's commercial
Courses API, so it may need maintenance if Garmin changes private endpoints.

## Paused Google Route Tool

The Google experiment is still in `google/`, but it is not the recommended path right now.

The Google Maps key is saved only in browser local storage. Keep the key restricted in Google Cloud Console to your allowed HTTP referrers, such as `http://localhost:5174/*`.

The Google tool is intentionally separate from the Garmin export workflow. It uses Google Maps JavaScript DirectionsService with `BICYCLING` travel mode and the Google bicycling layer. It is for comparing Google bicycle routing behavior without mixing Google route geometry into the ORS/OSM Garmin files.

The default Google mode is **Manual anchors**. Set the start by address or location, click a few real through-road anchor points on the map, then build the route. This avoids asking Google to invent a loop from random hidden waypoints, which often creates cul-de-sac spurs.

**Auto prototype** is still available for comparison. Keep **Reject spur routes** on for cycling loops. Auto mode will sample extra candidates and reject routes with detected waypoint backtracks. If it cannot find a clean route, it hides the route instead of showing a bad one.

Auto mode uses the start as one corner of the selected shape. For a triangle, it generates two additional perimeter anchors; for a box, it generates three additional perimeter anchors. Google then connects those anchors with `BICYCLING` directions.
# rideloop
