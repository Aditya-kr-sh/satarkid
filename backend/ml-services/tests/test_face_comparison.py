import io
import unittest
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import numpy as np
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers
from app.api.endpoints import face
from app.services import face_extractor


def upload():
    return UploadFile(io.BytesIO(b'image'), filename='portrait.png', headers=Headers({'content-type': 'image/png'}))


def detected_face():
    return SimpleNamespace(det_score=0.99, embedding=np.ones(512, dtype=np.float32), bbox=np.array([0, 0, 20, 20]))


class FaceComparisonTests(unittest.IsolatedAsyncioTestCase):
    async def test_no_face_is_unknown(self):
        with patch.object(face, 'is_ready', return_value=True), patch.object(face, '_detect', return_value=([], np.zeros((20, 20, 3)))):
            result = await face.compare_faces(upload(), uuid4(), 0.5)
        self.assertFalse(result['face_found'])
        self.assertIsNone(result['similarity_score'])
        self.assertIsNone(result['is_match'])

    async def test_detection_or_database_failure_is_not_no_face(self):
        for detection_error in (True, False):
            with patch.object(face, 'is_ready', return_value=True), \
                 patch.object(face, '_detect', side_effect=RuntimeError('model failed') if detection_error else None,
                              return_value=([detected_face()], np.zeros((20, 20, 3)))), \
                 patch.object(face.postgres, 'get_pool', AsyncMock(side_effect=RuntimeError('database failed'))):
                with self.assertRaises(HTTPException) as result:
                    await face.compare_faces(upload(), uuid4(), 0.5)
                self.assertEqual(result.exception.status_code, 503)

    async def test_threshold_boundary_and_missing_embedding(self):
        for score in (0.4999, 0.5, None):
            connection = SimpleNamespace(fetchrow=AsyncMock(return_value=None if score is None else {'similarity': score}))
            @asynccontextmanager
            async def acquire():
                yield connection
            pool = SimpleNamespace(acquire=acquire)
            with patch.object(face, 'is_ready', return_value=True), \
                 patch.object(face, '_detect', return_value=([detected_face()], np.zeros((20, 20, 3)))), \
                 patch.object(face.postgres, 'get_pool', AsyncMock(return_value=pool)):
                if score is None:
                    with self.assertRaises(HTTPException) as result:
                        await face.compare_faces(upload(), uuid4(), 0.5)
                    self.assertEqual(result.exception.status_code, 503)
                else:
                    result = await face.compare_faces(upload(), uuid4(), 0.5)
                    self.assertEqual(result['is_match'], score >= 0.5)

    async def test_failed_persistence_never_claims_embedding_saved(self):
        with patch.object(face_extractor.storage, 'upload_image', AsyncMock(return_value='local-image')), \
             patch.object(face_extractor, '_detect', return_value=([detected_face()], np.zeros((20, 20, 3), dtype=np.uint8))), \
             patch.object(face_extractor, '_find_duplicate', AsyncMock(return_value=None)), \
             patch.object(face_extractor, '_persist_face', AsyncMock(side_effect=RuntimeError('storage failed'))), \
             self.assertLogs(face_extractor.logger, level='ERROR'):
            result = await face_extractor.extract_and_save_face(b'image')
        self.assertFalse(result.success)
        self.assertFalse(result.embedding_saved)
