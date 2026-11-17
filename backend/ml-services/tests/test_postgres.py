import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.database import postgres


class DatabasePoolTests(unittest.IsolatedAsyncioTestCase):
    async def test_pool_retries_after_startup_connection_failure(self):
        pool = object()
        with patch.object(postgres, "db_pool", None), \
             patch.object(postgres, "_pool_init_lock", asyncio.Lock()), \
             patch.object(postgres, "get_db_pool", AsyncMock(return_value=pool)) as connect:
            results = await asyncio.gather(
                postgres.get_pool(),
                postgres.get_pool(),
                postgres.get_pool(),
            )

        self.assertEqual(results, [pool, pool, pool])
        connect.assert_awaited_once()
