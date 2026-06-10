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

## Deploy

See [DEPLOY.md](DEPLOY.md) for DigitalOcean Droplet deployment steps.

## Garmin

Garmin Connect has two upload flows:

- **Courses:** Training & Planning > Courses > Import. Use this for planned routes and Garmin Edge navigation.
- **Activities:** Cloud icon > Import Data. Use this for completed ride recordings from a Garmin device.

For an Edge 1040 route, use **Courses > Import**. If Garmin Connect rejects the upload, connect the Edge 1040 over USB and copy the `.gpx` or `.tcx` file into `Garmin/NewFiles`, then eject the device so it can process the file into a course.

The **Garmin GPX** export is intentionally conservative because Garmin Connect's course importer is picky. **Enhanced GPX** adds waypoints and route points for apps that handle richer GPX files.

## Paused Google Route Tool

The Google experiment is still in `google/`, but it is not the recommended path right now.

The Google Maps key is saved only in browser local storage. Keep the key restricted in Google Cloud Console to your allowed HTTP referrers, such as `http://localhost:5174/*`.

The Google tool is intentionally separate from the Garmin export workflow. It uses Google Maps JavaScript DirectionsService with `BICYCLING` travel mode and the Google bicycling layer. It is for comparing Google bicycle routing behavior without mixing Google route geometry into the ORS/OSM Garmin files.

The default Google mode is **Manual anchors**. Set the start by address or location, click a few real through-road anchor points on the map, then build the route. This avoids asking Google to invent a loop from random hidden waypoints, which often creates cul-de-sac spurs.

**Auto prototype** is still available for comparison. Keep **Reject spur routes** on for cycling loops. Auto mode will sample extra candidates and reject routes with detected waypoint backtracks. If it cannot find a clean route, it hides the route instead of showing a bad one.

Auto mode uses the start as one corner of the selected shape. For a triangle, it generates two additional perimeter anchors; for a box, it generates three additional perimeter anchors. Google then connects those anchors with `BICYCLING` directions.
# rideloop
