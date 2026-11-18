from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np

from app.services import liveness_detector
from app.services.liveness_detector import (
    _evaluate_yaw_sequence,
    _video_duration_seconds,
)


class LivenessDetectorTests(unittest.TestCase):
    def test_video_duration_prefers_decoded_timestamps_to_inaccurate_fps(self):
        duration = _video_duration_seconds(180, 120, [0, 1000, 5967])
        self.assertAlmostEqual(duration, 5.967)

    def test_video_duration_falls_back_to_frame_rate_when_timestamps_are_invalid(self):
        duration = _video_duration_seconds(180, 30, [0, 1000, 900])
        self.assertEqual(duration, 6)

    def test_video_with_inaccurate_fps_metadata_can_still_pass_liveness(self):
        yaws = [0, 1, -1, 2, 8, 18, 22, 24, 19, 10, 4, 1, 0, -1, 1, 0]

        class FakeCapture:
            def __init__(self, path):
                self.path = path
                self.index = 0

            def isOpened(self):
                return True

            def get(self, prop):
                if prop == liveness_detector.cv2.CAP_PROP_FPS:
                    return 120
                if prop == liveness_detector.cv2.CAP_PROP_FRAME_COUNT:
                    return 180
                if prop == liveness_detector.cv2.CAP_PROP_POS_MSEC:
                    return self.index * 1000 / 30
                return 0

            def read(self):
                if self.index >= 180:
                    return False, None
                self.index += 1
                return True, np.zeros((16, 16, 3), dtype=np.uint8)

            def release(self):
                pass

        class FakeModels:
            models = {"landmark_3d_68": object()}

            def __init__(self):
                self.index = 0

            def get(self, frame):
                yaw = yaws[self.index]
                self.index += 1
                return [SimpleNamespace(pose=np.array([0, yaw, 0]) + frame[0, 0, 0])]

        with patch.object(liveness_detector, "is_ready", return_value=True), \
             patch.object(liveness_detector.cv2, "VideoCapture", side_effect=FakeCapture), \
             patch.object(liveness_detector.face_extractor, "face_app", FakeModels()):
            result = liveness_detector.verify_video(b"video", ".webm", "turn_left")

        self.assertTrue(result["liveness_confirmed"])
        self.assertEqual(result["challenge"], "turn_left")
        self.assertEqual(result["challenge_result"], "passed")
        self.assertEqual(result["face_detection_status"], "detected")
        self.assertEqual(result["face_detected_frames"], 16)
        self.assertEqual(result["sampled_frames"], 16)
        # JSON serialization fails on NumPy scalars, which surfaced as a 500 from the API.
        self.assertIsInstance(result["face_detected_frames"], int)
        self.assertIsInstance(result["sampled_frames"], int)

    def test_challenged_turn_and_return_confirms_liveness(self):
        yaws = [0, 1, -1, 2, 8, 18, 22, 24, 19, 10, 4, 1, 0, -1, 1, 0]
        self.assertEqual(_evaluate_yaw_sequence(yaws, "turn_left"), (True, None))

    def test_wrong_direction_does_not_confirm_liveness(self):
        yaws = [0, 1, -1, 2, 8, 18, 22, 24, 19, 10, 4, 1, 0, -1, 1, 0]
        confirmed, error = _evaluate_yaw_sequence(yaws, "turn_right")
        self.assertFalse(confirmed)
        self.assertIn("turn", error)

    def test_missing_return_to_center_does_not_confirm_liveness(self):
        yaws = [0, 1, -1, 2, 8, 18, 22, 24, 22, 21, 20, 19, 20, 21, 20, 19]
        confirmed, error = _evaluate_yaw_sequence(yaws, "turn_left")
        self.assertFalse(confirmed)
        self.assertIn("Return", error)

    def test_missing_or_ambiguous_faces_do_not_confirm_liveness(self):
        yaws = [0, 0, 0, None, None, None, None, None, None, None, None, None, 0, 0, 0, 0]
        confirmed, error = _evaluate_yaw_sequence(yaws, "turn_left")
        self.assertFalse(confirmed)
        self.assertIn("face visible", error)
