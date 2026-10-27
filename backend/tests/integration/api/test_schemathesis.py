"""Fuzz the public API from its own OpenAPI schema with Schemathesis.

The only pass over the route handlers, which mutmut skips. Requests go through the
in-process `api_client`, so they hit the test Postgres. `SCHEMATHESIS_MAX_EXAMPLES`
sets the examples per operation: small here, larger in the weekly Ops run.
"""

import os

# Annotations are imported at runtime: schemathesis evaluates the test signatures at import.
import pytest
import schemathesis
from fastapi import FastAPI
from httpx import AsyncClient  # noqa: TC002
from hypothesis import HealthCheck, settings
from schemathesis.checks import CheckFunction, not_a_server_error
from schemathesis.generation.case import Case  # noqa: TC002
from schemathesis.schemas import BaseSchema  # noqa: TC002
from schemathesis.specs.openapi.checks import response_schema_conformance
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.common.routers.openapi import build_public_openapi
from scripts.seed.factories.models import UserFactory

from .auth.shared import TEST_PASSWORD, hash_test_password, login_bearer

MAX_EXAMPLES = int(os.environ.get("SCHEMATHESIS_MAX_EXAMPLES", "5"))

# Each test is one pytest item covering every GET operation, so the suite's 60s limit
# is far too short; this one grows with the examples per operation.
pytestmark = [pytest.mark.api, pytest.mark.timeout(60 * MAX_EXAMPLES)]

CHECKS: list[CheckFunction] = [not_a_server_error, response_schema_conformance]
FUZZ_SETTINGS = settings(
    max_examples=MAX_EXAMPLES,
    deadline=None,
    # One api_client and database serve every example of the run.
    suppress_health_check=list(HealthCheck),
)


@pytest.fixture
def public_schema(test_app: FastAPI) -> BaseSchema:
    """The public schema, as `/openapi.public.json` serves it."""
    return schemathesis.openapi.from_dict(build_public_openapi(test_app))


# TODO: the OAuth callbacks trade any `code` with the real provider before checking
# `state`, and httpx-oauth answers 500 when the provider refuses it. Fuzz them once they
# check `state` first; until then they would also call github.com and google.com.
schema = (
    schemathesis.pytest.from_fixture("public_schema")
    .include(method="GET")
    .exclude(path_regex=r"^/v1/oauth/[^/]+/(token|session|associate)/callback$")
)


# as_transport_kwargs serializes for requests; these are the keys httpx's request() shares.
_HTTPX_REQUEST_ARGS = {"method", "url", "params", "headers", "json", "data", "content", "files"}


async def _call_and_validate(
    case: Case, client: AsyncClient, db_session: AsyncSession, headers: dict[str, str] | None = None
) -> None:
    kwargs = case.as_transport_kwargs(base_url=str(client.base_url), headers=headers)
    # httpx deprecates per-request cookies, so fuzzed cookie params go in the header.
    if cookies := kwargs.pop("cookies", None):
        kwargs["headers"] = {**kwargs["headers"], "Cookie": "; ".join(f"{k}={v}" for k, v in cookies.items())}
    # Every request shares one session; a savepoint keeps a refused statement from
    # aborting the transaction for all the requests after it.
    savepoint = await db_session.begin_nested()
    try:
        response = await client.request(**{k: v for k, v in kwargs.items() if k in _HTTPX_REQUEST_ARGS})
    finally:
        if savepoint.is_active:
            await savepoint.rollback()
    case.validate_response(response, checks=CHECKS)


@schema.parametrize()
@FUZZ_SETTINGS
async def test_schemathesis_anonymous_get(case: Case, api_client: AsyncClient, db_session: AsyncSession) -> None:
    """No GET route answers a guest with a 500 or a body its schema does not describe."""
    await _call_and_validate(case, api_client, db_session)


@pytest.fixture
async def bearer_headers(api_client: AsyncClient, db_session: AsyncSession) -> dict[str, str]:
    """Log a verified user in for real, so fastapi-users' own routes accept it too."""
    user = await UserFactory.create_async(
        db_session,
        email="fuzz@example.com",
        username="fuzz",
        is_active=True,
        is_verified=True,
        hashed_password=hash_test_password(TEST_PASSWORD),
    )
    token = (await login_bearer(api_client, email=user.email, password=TEST_PASSWORD))["access_token"]
    return {"Authorization": f"Bearer {token}"}


@schema.parametrize()
@FUZZ_SETTINGS
async def test_schemathesis_user_get(
    case: Case, api_client: AsyncClient, db_session: AsyncSession, bearer_headers: dict[str, str]
) -> None:
    """No GET route answers a logged-in user with a 500 or an undescribed body."""
    await _call_and_validate(case, api_client, db_session, bearer_headers)
