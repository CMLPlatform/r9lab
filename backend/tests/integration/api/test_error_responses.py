"""Integration tests for HTTP error response shapes.

pytestmark = pytest.mark.api
Verifies that authentication failures, authorisation failures, missing
resources, and invalid payloads all return the expected status codes and
response bodies.
"""

from typing import TYPE_CHECKING

import pytest
from fastapi import FastAPI, HTTPException, status
from httpx import ASGITransport, AsyncClient

from app.api.auth.dependencies import current_active_superuser
from app.core.http_headers import SENSITIVE_CACHE_CONTROL
from scripts.seed.factories.models import UserFactory
from tests.fixtures.client import override_authenticated_user

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    from sqlalchemy.ext.asyncio import AsyncSession


async def test_create_product_without_auth_returns_401(api_client: AsyncClient) -> None:
    """POST /products requires a verified user; anonymous request → 401."""
    response = await api_client.post("/v1/products", json={})
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


async def test_get_me_without_auth_returns_401_with_detail(api_client: AsyncClient) -> None:
    """GET /users/me requires authentication and returns the standard error shape."""
    response = await api_client.get("/v1/users/me")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED
    assert response.headers["cache-control"] == SENSITIVE_CACHE_CONTROL
    body = response.json()
    assert "detail" in body


@pytest.fixture
async def regular_user_client(
    api_client: AsyncClient,
    db_session: AsyncSession,
    test_app: FastAPI,
) -> AsyncGenerator[AsyncClient]:
    """Authenticated client for a non-superuser.

    Overrides current_active_superuser to raise 403, simulating what
    FastAPI-Users does when a verified-but-not-superuser hits a superuser
    endpoint.
    """

    def raise_forbidden() -> None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    user = await UserFactory.create_async(session=db_session, is_superuser=False, is_active=True)
    with override_authenticated_user(test_app, user, optional=False):
        test_app.dependency_overrides[current_active_superuser] = raise_forbidden
        yield api_client
        test_app.dependency_overrides.pop(current_active_superuser, None)


async def test_admin_taxonomy_create_as_regular_user_returns_403(regular_user_client: AsyncClient) -> None:
    """POST /admin/taxonomies is superuser-only; regular user → 403 with the standard error shape."""
    data = {"name": "Forbidden Taxonomy", "version": "v1", "domains": ["materials"]}
    response = await regular_user_client.post("/v1/admin/taxonomies", json=data)
    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.headers["cache-control"] == SENSITIVE_CACHE_CONTROL
    assert "detail" in response.json()


async def test_get_nonexistent_taxonomy_returns_404_with_detail(api_client_light: AsyncClient) -> None:
    """GET /taxonomies/{id} with an id that does not exist returns the standard error shape."""
    response = await api_client_light.get("/v1/taxonomies/999999")
    assert response.status_code == status.HTTP_404_NOT_FOUND
    body = response.json()
    assert "detail" in body


async def test_unhandled_exception_returns_generic_problem_details(test_app: FastAPI) -> None:
    """Unhandled runtime errors are not exposed to clients."""

    @test_app.get("/test/unhandled-error")
    async def raise_unhandled_error() -> None:
        message = "database password leaked in stack trace"
        raise RuntimeError(message)

    async with AsyncClient(
        transport=ASGITransport(app=test_app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        response = await client.get("/test/unhandled-error")

    assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.headers["cache-control"] == SENSITIVE_CACHE_CONTROL
    body = response.json()
    assert body["detail"] == "Internal server error"
    assert body["code"] == "RuntimeError"
    assert "database password" not in response.text


async def test_overlong_search_returns_422(api_client_light: AsyncClient) -> None:
    """A free-text search past the length bound is refused as input, not a 500."""
    response = await api_client_light.get("/v1/taxonomies", params={"search": "x" * 101})
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert "at most 100 characters" in response.text


async def test_nul_byte_in_filter_returns_400(api_client_light: AsyncClient) -> None:
    """Postgres refuses NUL in text; a filter value carrying one is the client's error."""
    response = await api_client_light.get("/v1/taxonomies", params={"name[ilike]": "a\x00b"})
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert response.json()["detail"] == "Text values must not contain NUL characters"


async def test_id_past_int32_range_returns_400(api_client_light: AsyncClient) -> None:
    """An id no int32 column can hold is refused as input, not a 500."""
    response = await api_client_light.get(f"/v1/taxonomies/{2**31}")
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert response.json()["detail"] == "A value in the request is out of range"
