from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from garmin_course import (
    GarminConfigError,
    GarminCourseError,
    upload_course_to_garmin,
)


ROOT = Path(__file__).resolve().parent
MAX_COURSE_BYTES = 2 * 1024 * 1024

app = FastAPI(title="RideLoop")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/garmin/course")
async def send_garmin_course(
    file: UploadFile = File(...),
    course_name: str = Form("RideLoop Course"),
) -> dict[str, object]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing course file.")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Course file was empty.")

    if len(file_bytes) > MAX_COURSE_BYTES:
        raise HTTPException(status_code=413, detail="Course file is too large.")

    try:
        result = upload_course_to_garmin(
            file_bytes=file_bytes,
            filename=file.filename,
            course_name=course_name,
            content_type=file.content_type or "application/gpx+xml",
        )
    except GarminConfigError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except GarminCourseError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"Garmin course upload failed: {error}",
        ) from error

    return {
        "status": "ok",
        "courseId": result.course_id,
        "courseName": result.course_name,
        "url": result.url,
        "distanceMeter": result.distance_meter,
    }


@app.get("/")
@app.get("/index.html")
def index() -> FileResponse:
    return FileResponse(ROOT / "index.html")


@app.get("/app.js")
def app_js() -> FileResponse:
    return FileResponse(ROOT / "app.js", media_type="application/javascript")


@app.get("/styles.css")
def styles_css() -> FileResponse:
    return FileResponse(ROOT / "styles.css", media_type="text/css")


app.mount("/google", StaticFiles(directory=ROOT / "google", html=True), name="google")

