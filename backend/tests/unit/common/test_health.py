"""Unit tests for health check endpoints."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import SQLAlchemyError

from app.api.common.routers.health import (
    HEALTHY_STATUS,
    UNHEALTHY_STATUS,
    check_database,
    check_redis,
    perform_health_checks,
    router,
)
from app.core.runtime import AppServices


async def test_database_healthy() -> None:
    """Test healthy result when database verification succeeds."""
    with patch("app.api.common.routers.health.check_database_connection", new=AsyncMock()):
        result = await check_database()

    assert result["status"] == HEALTHY_STATUS
    assert result["component"] == "database"


async def test_database_connection_error() -> None:
    """Test unhealthy result when database verification raises."""
    with patch(
        "app.api.common.routers.health.check_database_connection",
        new=AsyncMock(side_effect=SQLAlchemyError("connection refused")),
    ):
        result = await check_database()

    assert result["status"] == UNHEALTHY_STATUS
    assert result["component"] == "database"
    assert result["error"] == "Database connection failed"


async def test_redis_healthy() -> None:
    """Test healthy result when Redis ping succeeds."""
    mock_redis = AsyncMock()
    request = MagicMock()
    request.app.state.services = AppServices(redis=mock_redis)

    with patch("app.api.common.routers.health.ping_redis", return_value=True):
        result = await check_redis(request)

    assert result["status"] == HEALTHY_STATUS
    assert result["component"] == "redis"


async def test_redis_ping_returns_false() -> None:
    """Test unhealthy result when ping returns False."""
    mock_redis = AsyncMock()
    request = MagicMock()
    request.app.state.services = AppServices(redis=mock_redis)

    with patch("app.api.common.routers.health.ping_redis", return_value=False):
        result = await check_redis(request)

    assert result["status"] == UNHEALTHY_STATUS
    assert result["component"] == "redis"
    assert "False" in result["error"]


async def test_redis_not_initialized() -> None:
    """Test unhealthy result when Redis client is not set."""
    request = MagicMock()
    request.app.state.services = AppServices()

    result = await check_redis(request)

    assert result["status"] == UNHEALTHY_STATUS
    assert result["component"] == "redis"
    assert "not initialized" in result["error"]


async def test_redis_connection_error() -> None:
    """Test unhealthy result when Redis raises an exception."""
    mock_redis = AsyncMock()
    request = MagicMock()
    request.app.state.services = AppServices(redis=mock_redis)

    with patch("app.api.common.routers.health.ping_redis", side_effect=OSError("connection refused")):
        result = await check_redis(request)

    assert result["status"] == UNHEALTHY_STATUS
    assert result["component"] == "redis"
    assert result["error"] == "Redis connection failed"


async def test_all_healthy() -> None:
    """Test that all checks pass through correctly."""
    request = MagicMock()
    healthy = {"status": HEALTHY_STATUS}

    with (
        patch("app.api.common.routers.health.check_database", return_value=healthy),
        patch("app.api.common.routers.health.check_redis", return_value=healthy),
    ):
        result = await perform_health_checks(request)

    assert result["database"]["status"] == HEALTHY_STATUS
    assert result["redis"]["status"] == HEALTHY_STATUS


async def test_one_unhealthy() -> None:
    """Test that an unhealthy check is included in results."""
    request = MagicMock()
    healthy = {"status": HEALTHY_STATUS}
    unhealthy = {"status": UNHEALTHY_STATUS, "error": "down"}

    with (
        patch("app.api.common.routers.health.check_database", return_value=healthy),
        patch("app.api.common.routers.health.check_redis", return_value=unhealthy),
    ):
        result = await perform_health_checks(request)

    assert result["database"]["status"] == HEALTHY_STATUS
    assert result["redis"]["status"] == UNHEALTHY_STATUS


async def _hang(*_args: object, **_kwargs: object) -> None:
    await asyncio.Event().wait()


async def test_database_check_times_out_instead_of_waiting() -> None:
    """A database that never answers is unhealthy after the readiness timeout, not the pool's."""
    with (
        patch("app.api.common.routers.health.READINESS_CHECK_TIMEOUT_SECONDS", 0.01),
        patch("app.api.common.routers.health.check_database_connection", new=_hang),
        patch("app.api.common.routers.health.logger"),
    ):
        result = await asyncio.wait_for(check_database(), timeout=1)

    assert result == {"component": "database", "status": UNHEALTHY_STATUS, "error": "Database connection failed"}


async def test_redis_check_times_out_instead_of_waiting() -> None:
    """A Redis that never answers is unhealthy after the readiness timeout."""
    request = MagicMock()
    request.app.state.services = AppServices(redis=AsyncMock())

    with (
        patch("app.api.common.routers.health.READINESS_CHECK_TIMEOUT_SECONDS", 0.01),
        patch("app.api.common.routers.health.ping_redis", new=_hang),
        patch("app.api.common.routers.health.logger"),
    ):
        result = await asyncio.wait_for(check_redis(request), timeout=1)

    assert result["status"] == UNHEALTHY_STATUS


def _probe_client() -> AsyncClient:
    app = FastAPI()
    app.include_router(router)
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_livez_and_readyz_are_served_and_the_old_paths_are_not() -> None:
    """The probes answer at /livez and /readyz; readiness is never cached and names no driver."""
    healthy = AsyncMock(return_value={"database": {"component": "database", "status": HEALTHY_STATUS}})
    with patch("app.api.common.routers.health.perform_health_checks", new=healthy):
        async with _probe_client() as client:
            live = await client.get("/livez")
            ready = await client.get("/readyz")
            old = [(await client.get(path)).status_code for path in ("/live", "/health")]

    assert (live.status_code, live.json()) == (200, {"status": "alive"})
    assert ready.status_code == 200
    assert ready.headers["cache-control"] == "no-store"
    assert "details" not in ready.json()["checks"]["database"]
    assert old == [404, 404]


async def test_readyz_answers_503_when_a_dependency_is_down() -> None:
    """One unhealthy dependency makes the instance not ready."""
    checks = {
        "database": {"component": "database", "status": HEALTHY_STATUS},
        "redis": {"component": "redis", "status": UNHEALTHY_STATUS, "error": "down"},
    }
    with patch("app.api.common.routers.health.perform_health_checks", new=AsyncMock(return_value=checks)):
        async with _probe_client() as client:
            response = await client.get("/readyz")

    assert response.status_code == 503
    assert response.json()["status"] == UNHEALTHY_STATUS
