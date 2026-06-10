from __future__ import annotations

import base64
import io
import math
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional, Union


class GarminConfigError(RuntimeError):
    """Raised when Garmin credentials or dependencies are not available."""


class GarminCourseError(RuntimeError):
    """Raised when Garmin course creation fails."""


@dataclass(frozen=True)
class GarminCourseResult:
    course_id: Optional[Union[int, str]]
    course_name: str
    url: Optional[str]
    distance_meter: Optional[float]


_login_lock = threading.Lock()
_garmin_api: Optional[Any] = None


def upload_course_to_garmin(
    *,
    file_bytes: bytes,
    filename: str,
    course_name: str,
    content_type: str = "application/gpx+xml",
) -> GarminCourseResult:
    api = _get_garmin_api()
    imported = _import_course_file(api, file_bytes, filename, content_type)
    payload = _build_course_payload(api, imported, course_name)
    saved = _post_json(api, "/course-service/course", payload)

    course_id = saved.get("courseId")
    return GarminCourseResult(
        course_id=course_id,
        course_name=saved.get("courseName") or course_name,
        url=f"https://connect.garmin.com/modern/course/{course_id}"
        if course_id
        else None,
        distance_meter=saved.get("distanceMeter") or payload.get("distanceMeter"),
    )


def _get_garmin_api() -> Any:
    global _garmin_api

    with _login_lock:
        if _garmin_api is not None:
            return _garmin_api

        try:
            from garminconnect import Garmin
        except ImportError as error:
            raise GarminConfigError(
                "Garmin integration dependencies are not installed. "
                "Run: pip install -r requirements.txt"
            ) from error

        email = os.getenv("GARMIN_EMAIL")
        password = os.getenv("GARMIN_PASSWORD")
        tokenstore = (
            os.getenv("GARMIN_TOKENSTORE")
            or os.getenv("GARMINTOKENS")
            or _default_tokenstore()
        )
        tokenstore_path = Path(tokenstore).expanduser()
        tokenstore_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        _hydrate_tokenstore_from_env(tokenstore_path)

        api = Garmin(email, password)

        try:
            if _tokenstore_exists(api, tokenstore_path):
                api.login(tokenstore=str(tokenstore_path))
            else:
                _login_with_credentials(api, email, password)
                _dump_tokenstore(api, tokenstore_path)
        except Exception as error:
            if not email or not password:
                raise GarminConfigError(
                    "Set GARMIN_EMAIL and GARMIN_PASSWORD, or create a Garmin "
                    "token cache with tools/garmin_login.py."
                ) from None

            try:
                _login_with_credentials(api, email, password)
                _dump_tokenstore(api, tokenstore_path)
            except Exception as retry_error:
                raise GarminConfigError(
                    f"Garmin login failed: {retry_error}"
                ) from retry_error

        _garmin_api = api
        return api


def _default_tokenstore() -> str:
    hosted_markers = ("PORT", "APP_ID", "APP_DOMAIN", "APP_URL")

    if any(os.getenv(name) for name in hosted_markers):
        return "/tmp/rideloop-garmin-tokens"

    return ".private/garmin_tokens"


def _hydrate_tokenstore_from_env(tokenstore_path: Path) -> None:
    oauth1 = _read_secret_env("GARMIN_OAUTH1_JSON")
    oauth2 = _read_secret_env("GARMIN_OAUTH2_JSON")

    if not oauth1 or not oauth2:
        return

    tokenstore_path.mkdir(mode=0o700, parents=True, exist_ok=True)
    (tokenstore_path / "oauth1_token.json").write_text(oauth1, encoding="utf-8")
    (tokenstore_path / "oauth2_token.json").write_text(oauth2, encoding="utf-8")


def _read_secret_env(name: str) -> Optional[str]:
    encoded = os.getenv(f"{name}_B64")
    if encoded:
        return base64.b64decode(encoded).decode("utf-8")

    return os.getenv(name)


def _tokenstore_exists(api: Any, tokenstore_path: Path) -> bool:
    if hasattr(api, "garth") and not hasattr(api, "client"):
        return (
            tokenstore_path.is_dir()
            and (tokenstore_path / "oauth1_token.json").exists()
            and (tokenstore_path / "oauth2_token.json").exists()
        )

    return tokenstore_path.exists()


def _login_with_credentials(
    api: Any,
    email: Optional[str],
    password: Optional[str],
) -> None:
    if not email or not password:
        raise GarminConfigError(
            "Set GARMIN_EMAIL and GARMIN_PASSWORD, or create a Garmin token cache "
            "with tools/garmin_login.py."
        )

    api.login()


def _dump_tokenstore(api: Any, tokenstore_path: Path) -> None:
    if hasattr(api, "client") and hasattr(api.client, "dump"):
        api.client.dump(str(tokenstore_path))
        return

    if hasattr(api, "garth") and hasattr(api.garth, "dump"):
        tokenstore_path.mkdir(mode=0o700, parents=True, exist_ok=True)
        api.garth.dump(str(tokenstore_path))


def _import_course_file(
    api: Any,
    file_bytes: bytes,
    filename: str,
    content_type: str,
) -> dict[str, Any]:
    files = {
        "file": (
            filename,
            io.BytesIO(file_bytes),
            content_type or "application/octet-stream",
        )
    }
    headers = {
        "Accept": "application/json",
        "Origin": "https://connect.garmin.com",
        "Referer": "https://connect.garmin.com/modern/courses",
        "X-Requested-With": "XMLHttpRequest",
    }

    result = _post_files(api, "/course-service/course/import", files, headers)

    if not isinstance(result, dict) or not result.get("geoPoints"):
        raise GarminCourseError("Garmin did not return course geometry.")

    return result


def _build_course_payload(
    api: Any,
    imported: dict[str, Any],
    course_name: str,
) -> dict[str, Any]:
    geo_points = _normalize_geo_points(imported.get("geoPoints") or [])
    if len(geo_points) < 2:
        raise GarminCourseError("Imported Garmin course has too few points.")

    geo_points = _apply_elevation(api, geo_points)
    geo_points = _fill_distances(geo_points)
    distance_meter = geo_points[-1]["distance"]
    elevation_gain, elevation_loss = _measure_elevation_change(geo_points)
    user_profile_pk = _get_user_profile_pk(api)

    return {
        "activityTypePk": 10,
        "hasTurnDetectionDisabled": False,
        "geoPoints": geo_points,
        "courseLines": _build_course_lines(geo_points),
        "boundingBox": _build_bounding_box(geo_points),
        "coursePoints": _normalize_course_points(
            imported.get("coursePoints") or [],
            geo_points,
        ),
        "distanceMeter": distance_meter,
        "elevationGainMeter": elevation_gain,
        "elevationLossMeter": elevation_loss,
        "startPoint": {
            "longitude": geo_points[0]["longitude"],
            "latitude": geo_points[0]["latitude"],
            "timestamp": None,
            "elevation": geo_points[0].get("elevation"),
            "distance": geo_points[0].get("distance"),
        },
        "elapsedSeconds": None,
        "openStreetMap": False,
        "coordinateSystem": "WGS84",
        "rulePK": 2,
        "courseName": _clean_course_name(course_name),
        "matchedToSegments": False,
        "includeLaps": False,
        "hasPaceBand": False,
        "hasPowerGuide": False,
        "favorite": False,
        "userProfilePk": user_profile_pk,
        "sourceTypeId": 3,
    }


def _normalize_geo_points(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = []

    for point in points:
        latitude = _number(point.get("latitude"))
        longitude = _number(point.get("longitude"))

        if latitude is None or longitude is None:
            continue

        normalized.append(
            {
                "longitude": longitude,
                "latitude": latitude,
                "timestamp": None,
                "elevation": _number(point.get("elevation")),
                "distance": _number(point.get("distance")),
            }
        )

    return normalized


def _apply_elevation(api: Any, geo_points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    elevation_request = [
        [point["latitude"], point["longitude"], point.get("elevation")]
        for point in geo_points
    ]

    try:
        elevations = _post_json(
            api,
            "/course-service/course/elevation",
            elevation_request,
        )
    except Exception:
        return geo_points

    if not isinstance(elevations, list):
        return geo_points

    for point, elevated in zip(geo_points, elevations):
        if not isinstance(elevated, list) or len(elevated) < 3:
            continue

        elevation = _number(elevated[2])
        if elevation is not None:
            point["elevation"] = elevation

    return geo_points


def _fill_distances(geo_points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    distance = 0.0
    last = geo_points[0]
    distance = _number(last.get("distance")) or 0.0
    last["distance"] = distance

    for index in range(1, len(geo_points)):
        point = geo_points[index]
        provided = _number(point.get("distance"))

        if provided is not None and provided >= distance:
            distance = provided
        else:
            distance += _haversine_meters(last, point)

        point["distance"] = distance
        last = point

    return geo_points


def _measure_elevation_change(geo_points: list[dict[str, Any]]) -> tuple[float, float]:
    gain = 0.0
    loss = 0.0
    previous = _number(geo_points[0].get("elevation"))

    for point in geo_points[1:]:
        current = _number(point.get("elevation"))
        if current is None or previous is None:
            previous = current
            continue

        delta = current - previous
        if delta > 0:
            gain += delta
        else:
            loss += abs(delta)
        previous = current

    return gain, loss


def _build_course_lines(geo_points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    lines = []
    max_points = 90
    start = 0
    sort_order = 1

    while start < len(geo_points) - 1:
        end = min(start + max_points - 1, len(geo_points) - 1)
        segment = geo_points[start : end + 1]

        lines.append(
            {
                "points": None,
                "distanceInMeters": max(
                    0.0,
                    (segment[-1].get("distance") or 0.0)
                    - (segment[0].get("distance") or 0.0),
                ),
                "courseId": None,
                "sortOrder": sort_order,
                "numberOfPoints": len(segment),
                "bearing": _bearing_degrees(segment[0], segment[-1]),
                "coordinateSystem": "WGS84",
            }
        )

        if end >= len(geo_points) - 1:
            break

        start = end
        sort_order += 1

    return lines


def _build_bounding_box(geo_points: list[dict[str, Any]]) -> dict[str, Any]:
    latitudes = [point["latitude"] for point in geo_points]
    longitudes = [point["longitude"] for point in geo_points]

    return {
        "lowerLeft": {
            "latitude": min(latitudes),
            "longitude": min(longitudes),
        },
        "upperRight": {
            "latitude": max(latitudes),
            "longitude": max(longitudes),
        },
        "lowerLeftLatIsSet": True,
        "lowerLeftLongIsSet": True,
        "upperRightLatIsSet": True,
        "upperRightLongIsSet": True,
    }


def _normalize_course_points(
    course_points: list[dict[str, Any]],
    geo_points: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    normalized = []

    for course_point in course_points:
        latitude = _number(course_point.get("lat"))
        longitude = _number(course_point.get("lon"))
        if latitude is None or longitude is None:
            continue

        distance = _number(course_point.get("distance"))
        nearest = _nearest_geo_point(latitude, longitude, geo_points)

        normalized.append(
            {
                "coursePointId": None,
                "name": str(course_point.get("name") or "Course Point"),
                "coursePk": None,
                "coursePointType": course_point.get("coursePointType") or "GENERIC",
                "lon": longitude,
                "lat": latitude,
                "distance": distance
                if distance is not None
                else nearest.get("distance"),
                "elevation": _number(course_point.get("elevation"))
                if _number(course_point.get("elevation")) is not None
                else nearest.get("elevation"),
                "derivedElevation": None,
                "timestamp": course_point.get("timestamp") or 0,
                "createdDate": None,
                "modifiedDate": None,
                "uuid": None,
                "note": course_point.get("note"),
                "cutoffDuration": None,
                "restDuration": None,
            }
        )

    return normalized


def _nearest_geo_point(
    latitude: float,
    longitude: float,
    geo_points: list[dict[str, Any]],
) -> dict[str, Any]:
    target = {"latitude": latitude, "longitude": longitude}
    return min(geo_points, key=lambda point: _haversine_meters(target, point))


def _get_user_profile_pk(api: Any) -> Optional[int]:
    try:
        settings = api.connectapi("/userprofile-service/userprofile/user-settings/")
    except Exception:
        try:
            settings = api.connectapi("/userprofile-service/userprofile/user-settings")
        except Exception:
            return None

    value = settings.get("id") if isinstance(settings, dict) else None
    return int(value) if value is not None else None


def _post_json(api: Any, path: str, payload: Any) -> Any:
    response = _post_connectapi(api, path, json=payload)
    if response is None:
        raise GarminCourseError(f"Garmin returned an empty response for {path}.")
    return response


def _post_files(
    api: Any,
    path: str,
    files: dict[str, Any],
    headers: dict[str, str],
) -> Any:
    response = _post_connectapi(api, path, files=files, headers=headers)
    if response is None:
        raise GarminCourseError(f"Garmin returned an empty response for {path}.")
    return response


def _post_connectapi(api: Any, path: str, **kwargs: Any) -> Any:
    if hasattr(api, "client"):
        return api.client.post("connectapi", path, api=True, **kwargs)

    if hasattr(api, "garth"):
        response = api.garth.post("connectapi", path, api=True, **kwargs)
        return response.json() if response.content else None

    raise GarminCourseError("Installed Garmin client does not support POST requests.")


def _clean_course_name(value: str) -> str:
    name = " ".join(str(value or "RideLoop Course").split())
    return name[:80] or "RideLoop Course"


def _number(value: Any) -> Optional[float]:
    if value is None:
        return None

    try:
        result = float(value)
    except (TypeError, ValueError):
        return None

    if math.isnan(result) or math.isinf(result):
        return None

    return result


def _haversine_meters(a: dict[str, float], b: dict[str, float]) -> float:
    earth_radius = 6371008.8
    lat1 = math.radians(a["latitude"])
    lat2 = math.radians(b["latitude"])
    delta_lat = math.radians(b["latitude"] - a["latitude"])
    delta_lng = math.radians(b["longitude"] - a["longitude"])
    sin_lat = math.sin(delta_lat / 2)
    sin_lng = math.sin(delta_lng / 2)
    value = (
        sin_lat * sin_lat
        + math.cos(lat1) * math.cos(lat2) * sin_lng * sin_lng
    )

    return earth_radius * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def _bearing_degrees(a: dict[str, float], b: dict[str, float]) -> float:
    lat1 = math.radians(a["latitude"])
    lat2 = math.radians(b["latitude"])
    delta_lng = math.radians(b["longitude"] - a["longitude"])
    y = math.sin(delta_lng) * math.cos(lat2)
    x = (
        math.cos(lat1) * math.sin(lat2)
        - math.sin(lat1) * math.cos(lat2) * math.cos(delta_lng)
    )

    return (math.degrees(math.atan2(y, x)) + 360) % 360
