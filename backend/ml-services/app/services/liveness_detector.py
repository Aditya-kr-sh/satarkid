"""Active head-turn liveness checks using the configured InsightFace landmarks."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Literal

import cv2
import numpy as np

from app.core.config import settings
from app.services import face_extractor

Challenge = Literal["turn_left", "turn_right"]
MAX_DURATION_SECONDS = 10
MAX_FRAME_COUNT = 1200
SAMPLE_COUNT = 16


def _video_duration_seconds(
    frame_count: int, fps: float, timestamps_ms: list[float]
) -> float | None:
    """Prefer decoded presentation timestamps over unreliable container metadata."""
    if len(timestamps_ms) >= 2 and all(np.isfinite(timestamp) for timestamp in timestamps_ms):
        if all(
            current >= previous
            for previous, current in zip(timestamps_ms, timestamps_ms[1:])
        ):
            duration = (timestamps_ms[-1] - timestamps_ms[0]) / 1000
            if duration > 0:
                return duration

    if frame_count > 0 and np.isfinite(fps) and fps >= 5:
        return frame_count / fps
    return None


def is_ready() -> bool:
    """Return whether the configured face pack includes the 3D pose model."""
    models = face_extractor.face_app
    return (
        face_extractor.is_ready()
        and models is not None
        and "landmark_3d_68" in models.models
    )


def _evaluate_yaw_sequence(
    yaws: list[float | None], challenge: Challenge
) -> tuple[bool, str | None]:
    """Require a centered start, challenged turn, and centered return."""
    if len(yaws) < 8:
        return False, "Keep one face visible throughout the liveness check."

    valid_yaws = [yaw for yaw in yaws if yaw is not None and np.isfinite(yaw)]
    if len(valid_yaws) < 12 or any(yaw is None for yaw in (*yaws[:3], *yaws[-3:])):
        return False, "Keep one face visible throughout the liveness check."

    baseline = float(np.median(yaws[:3]))
    if abs(baseline) > 25 or any(abs(float(yaw) - baseline) > 8 for yaw in yaws[:3]):
        return False, "Face the camera before starting the liveness check."

    direction = 1 if challenge == "turn_left" else -1
    turn_index = next(
        (
            index
            for index in range(3, len(yaws) - 3)
            if yaws[index] is not None
            and direction * (float(yaws[index]) - baseline) >= 16
        ),
        None,
    )
    if turn_index is None:
        return False, "The requested head turn was not detected. Please try again."

    if turn_index > len(yaws) - 6 or any(
        abs(float(yaw) - baseline) > 12 for yaw in yaws[-3:]
    ):
        return False, "Return to face the camera after turning, then try again."

    return True, None


def verify_video(
    video_bytes: bytes, suffix: str, challenge: Challenge
) -> dict[str, bool | str | int | None]:
    """Decode a short clip and verify the server-issued head-turn challenge."""
    if not is_ready():
        raise RuntimeError("The 3D face landmark model is unavailable.")
    if not video_bytes or len(video_bytes) > settings.MAX_UPLOAD_MB * 1024 * 1024:
        return {"liveness_confirmed": False, "error": "The video is empty or too large."}

    temp_path: str | None = None
    capture = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_file:
            temp_file.write(video_bytes)
            temp_path = temp_file.name

        capture = cv2.VideoCapture(temp_path)
        if not capture.isOpened():
            return {"liveness_confirmed": False, "error": "The video could not be read."}

        fps = float(capture.get(cv2.CAP_PROP_FPS))
        frame_count = 0
        timestamps_ms: list[float] = []
        while frame_count <= MAX_FRAME_COUNT:
            ok, _ = capture.read()
            if not ok:
                break
            frame_count += 1
            timestamps_ms.append(float(capture.get(cv2.CAP_PROP_POS_MSEC)))

        capture.release()
        capture = None
        duration = _video_duration_seconds(frame_count, fps, timestamps_ms)
        if (
            frame_count < SAMPLE_COUNT
            or frame_count > MAX_FRAME_COUNT
            or duration is None
            or duration < 3
            or duration > MAX_DURATION_SECONDS
        ):
            return {
                "liveness_confirmed": False,
                "error": "Record a steady liveness video for three to ten seconds.",
            }

        indexes = set(
            np.linspace(0, frame_count - 1, SAMPLE_COUNT, dtype=int).tolist()
        )
        capture = cv2.VideoCapture(temp_path)
        if not capture.isOpened():
            return {"liveness_confirmed": False, "error": "The video could not be read."}

        yaws: list[float | None] = []
        models = face_extractor.face_app
        if models is None:
            raise RuntimeError("The 3D face landmark model is unavailable.")

        for index in range(frame_count):
            ok, frame = capture.read()
            if not ok:
                break
            if index not in indexes:
                continue
            height, width = frame.shape[:2]
            if width > 640:
                frame = cv2.resize(frame, (640, round(height * 640 / width)))
            faces = models.get(frame)
            if len(faces) != 1 or faces[0].pose is None:
                yaws.append(None)
                continue
            yaw = float(faces[0].pose[1])
            yaws.append(yaw if np.isfinite(yaw) else None)

        if len(yaws) < SAMPLE_COUNT:
            return {"liveness_confirmed": False, "error": "The video could not be fully read."}

        confirmed, error = _evaluate_yaw_sequence(yaws, challenge)
        face_detected_frames = int(
            sum(yaw is not None and np.isfinite(yaw) for yaw in yaws)
        )
        return {
            "liveness_confirmed": confirmed,
            "error": error,
            "challenge": challenge,
            "challenge_result": "passed" if confirmed else "failed",
            "face_detection_status": (
                "detected" if face_detected_frames == len(yaws)
                else "partial" if face_detected_frames
                else "not_detected"
            ),
            "face_detected_frames": face_detected_frames,
            "sampled_frames": int(len(yaws)),
        }
    finally:
        if capture is not None:
            capture.release()
        if temp_path is not None:
            Path(temp_path).unlink(missing_ok=True)
