"""Unit tests for the RPi camera WebSocket router."""

import asyncio
import re
import secrets
import time
from types import SimpleNamespace
from typing import TYPE_CHECKING, TypedDict
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import jwt
import pytest
from jwt import InvalidTokenError

from app.api.common.rate_limiting import RateLimitExceededError, rate_limit_bucket_key
from app.api.plugins.r9cam.device_assertion import (
    ASSERTION_AUDIENCE,
    MAX_ASSERTION_TTL_SECONDS,
)
from app.api.plugins.r9cam.device_assertion import (
    verify_device_assertion as _verify_device_assertion,
)
from app.api.plugins.r9cam.websocket.router import (
    _authenticate,
    _heartbeat_loop,
    _receive_loop,
    _RelayWebSocketSession,
    camera_websocket_connect,
)
from app.core.runtime import RequiredServiceUnavailableError
from tests.fixtures.device_assertion import make_keypair, sign_assertion

if TYPE_CHECKING:
    from cryptography.hazmat.primitives.asymmetric import ec


async def test_connect_rejects_browser_origin_before_auth_lookup() -> None:
    """The device-only relay should reject browser-origin WebSocket handshakes."""
    websocket = MagicMock()
    websocket.headers = {"origin": "https://evil.example"}
    websocket.client = SimpleNamespace(host="203.0.113.10")
    websocket.close = AsyncMock()
    websocket.accept = AsyncMock()
    camera_id = uuid4()

    with patch("app.api.plugins.r9cam.websocket.router._authenticate", new=AsyncMock()) as authenticate:
        await camera_websocket_connect(websocket, camera_id)

    websocket.close.assert_awaited_once_with(
        code=1008,
        reason="Browser-origin WebSocket clients are not allowed.",
    )
    websocket.accept.assert_not_awaited()
    authenticate.assert_not_awaited()


async def test_connect_logs_unexpected_background_task_failure() -> None:
    """A background task (relay listener/heartbeat) that fails unexpectedly must be logged.

    ``asyncio.gather(..., return_exceptions=True)`` swallows exceptions unless the
    caller inspects the results; a silent failure here would hide a broken relay
    listener until someone noticed cameras stopped responding.
    """
    websocket = MagicMock()
    websocket.headers = {}
    websocket.client = SimpleNamespace(host="203.0.113.10")
    websocket.accept = AsyncMock()
    camera_id = uuid4()

    manager = MagicMock()
    manager.register = AsyncMock()
    manager.unregister = MagicMock(return_value=False)
    redis = AsyncMock()

    async def _failing_relay_listener(*_args: object, **_kwargs: object) -> None:
        msg = "boom"
        raise ValueError(msg)

    async def _hang_forever(*_args: object, **_kwargs: object) -> None:
        await asyncio.Event().wait()

    async def _noop_receive_loop(*_args: object, **_kwargs: object) -> None:
        # Yield control so the scheduled relay-listener/heartbeat tasks actually get
        # to run (and the fake listener gets to raise) before this returns and the
        # cleanup path cancels them.
        await asyncio.sleep(0)

    with (
        patch("app.api.plugins.r9cam.websocket.router._authenticate", new=AsyncMock(return_value=MagicMock())),
        patch("app.api.plugins.r9cam.websocket.router.get_connection_manager", return_value=manager),
        patch("app.api.plugins.r9cam.websocket.router.require_connection_redis", return_value=redis),
        patch("app.api.plugins.r9cam.websocket.router._receive_loop", new=_noop_receive_loop),
        patch("app.api.plugins.r9cam.websocket.router.run_relay_listener", new=_failing_relay_listener),
        patch("app.api.plugins.r9cam.websocket.router._heartbeat_loop", new=_hang_forever),
        patch("app.api.plugins.r9cam.websocket.router.mark_camera_offline", new=AsyncMock()),
        patch("app.api.plugins.r9cam.websocket.router.logger") as mock_logger,
    ):
        await camera_websocket_connect(websocket, camera_id)

    logged_unexpected = [
        call for call in mock_logger.error.call_args_list if isinstance(call.kwargs.get("exc_info"), ValueError)
    ]
    assert len(logged_unexpected) == 1
    assert str(camera_id) in logged_unexpected[0].args


async def test_connect_keeps_the_credential_the_camera_authenticated_with() -> None:
    """The session holds the camera's relay key, which each heartbeat re-check compares against.

    Without it the first re-check sees a differing key and closes every tunnel with 1008.
    """
    websocket = MagicMock()
    websocket.headers = {}
    websocket.client = SimpleNamespace(host="203.0.113.10")
    websocket.accept = AsyncMock()
    manager = MagicMock()
    manager.register = AsyncMock()
    manager.unregister = MagicMock(return_value=False)
    jwk = {"kty": "EC", "crv": "P-256", "x": "x-coordinate", "y": "y-coordinate"}
    camera = SimpleNamespace(relay_key_id="cam-key-1", relay_public_key_jwk=jwk)
    sessions: list[_RelayWebSocketSession] = []

    async def _record_session(_websocket: object, session: _RelayWebSocketSession) -> None:
        sessions.append(session)

    async def _hang_forever(*_args: object, **_kwargs: object) -> None:
        await asyncio.Event().wait()

    with (
        patch("app.api.plugins.r9cam.websocket.router._authenticate", new=AsyncMock(return_value=camera)),
        patch("app.api.plugins.r9cam.websocket.router.get_connection_manager", return_value=manager),
        patch("app.api.plugins.r9cam.websocket.router.require_connection_redis", return_value=AsyncMock()),
        patch("app.api.plugins.r9cam.websocket.router._receive_loop", new=_record_session),
        patch("app.api.plugins.r9cam.websocket.router.run_relay_listener", new=_hang_forever),
        patch("app.api.plugins.r9cam.websocket.router._heartbeat_loop", new=_hang_forever),
        patch("app.api.plugins.r9cam.websocket.router.mark_camera_offline", new=AsyncMock()),
    ):
        await camera_websocket_connect(websocket, uuid4())

    assert [(s.relay_key_id, s.relay_public_key_jwk) for s in sessions] == [("cam-key-1", jwk)]


async def test_session_text_frame_sanitizes_camera_id_in_log() -> None:
    """Invalid JSON logging should neutralize line breaks in camera IDs."""
    camera_id = uuid4()
    manager = MagicMock(spec=[])
    session = _RelayWebSocketSession(camera_id=camera_id, manager=manager, redis=AsyncMock(), last_pong_at=0.0)

    with patch("app.api.plugins.r9cam.websocket.router.logger") as mock_logger:
        await session.handle_text_frame("{not-json")

    assert not session.pending_binary_responses
    assert session.last_pong_at == 0.0
    mock_logger.warning.assert_called_once_with("Camera %s sent invalid JSON, ignoring.", str(camera_id))


async def test_session_text_frame_ignores_malformed_response_envelope() -> None:
    """Malformed response envelopes should not tear down the receive loop."""
    camera_id = uuid4()
    manager = MagicMock()
    session = _RelayWebSocketSession(camera_id=camera_id, manager=manager, redis=AsyncMock(), last_pong_at=0.0)

    with patch("app.api.plugins.r9cam.websocket.router.logger") as mock_logger:
        await session.handle_text_frame('{"type":"response","id":"msg-1","status":"not-an-int"}')

    assert not session.pending_binary_responses
    assert session.last_pong_at == 0.0
    manager.resolve_json.assert_not_called()
    mock_logger.warning.assert_called_once_with(
        "Camera %s sent malformed response envelope, ignoring.",
        str(camera_id),
    )


async def test_session_text_frame_ignores_non_object_json() -> None:
    """Valid JSON text frames that are not objects should be ignored."""
    camera_id = uuid4()
    manager = MagicMock()
    session = _RelayWebSocketSession(camera_id=camera_id, manager=manager, redis=AsyncMock(), last_pong_at=0.0)

    await session.handle_text_frame('["response"]')

    assert not session.pending_binary_responses
    assert session.last_pong_at == 0.0
    manager.resolve_json.assert_not_called()


async def test_authenticate_sanitizes_client_ip_when_blocked() -> None:
    """Blocked auth logging should use the safe IP bucket rather than the raw IP."""
    websocket = MagicMock()
    websocket.headers = {}
    websocket.client = SimpleNamespace(host="203.0.113.10\nFORGED")
    websocket.close = AsyncMock()
    camera_id = uuid4()

    with (
        patch("app.api.plugins.r9cam.websocket.router.limiter") as mock_limiter,
        patch("app.api.plugins.r9cam.websocket.router.logger") as mock_logger,
    ):
        mock_limiter.ahit_key = AsyncMock(side_effect=RateLimitExceededError)
        result = await _authenticate(websocket, camera_id)

    assert result is None
    websocket.close.assert_awaited_once()
    mock_logger.warning.assert_called_once_with(
        "WebSocket auth bucket %s for camera %s blocked by rate limit.",
        rate_limit_bucket_key("r9cam:ws-auth:ip", "203.0.113.10\nFORGED"),
        str(camera_id),
    )
    assert "203.0.113.10" not in str(mock_logger.warning.call_args)


async def test_authenticate_enforces_redis_backed_rate_limit_before_auth_lookup() -> None:
    """WebSocket auth attempts should use the shared limiter so limits work across workers."""
    websocket = MagicMock()
    websocket.headers = {}
    websocket.client = SimpleNamespace(host="203.0.113.10")
    websocket.close = AsyncMock()
    camera_id = uuid4()

    with patch("app.api.plugins.r9cam.websocket.router.limiter", create=True) as mock_limiter:
        mock_limiter.ahit_key = AsyncMock()
        result = await _authenticate(websocket, camera_id)

    assert result is None
    mock_limiter.ahit_key.assert_any_await(
        "10/minute",
        rate_limit_bucket_key("r9cam:ws-auth:ip", "203.0.113.10"),
    )
    mock_limiter.ahit_key.assert_any_await(
        "10/minute",
        rate_limit_bucket_key("r9cam:ws-auth:camera", str(camera_id)),
    )


async def test_heartbeat_loop_sanitizes_camera_id_on_timeout() -> None:
    """Heartbeat timeout logging should neutralize line breaks in camera IDs."""
    websocket = MagicMock()
    websocket.close = AsyncMock()
    websocket.send_text = AsyncMock()
    camera_id = uuid4()
    session = _RelayWebSocketSession(camera_id=camera_id, manager=MagicMock(), redis=AsyncMock(), last_pong_at=0.0)

    with (
        patch("app.api.plugins.r9cam.websocket.router.asyncio.sleep", new=AsyncMock()),
        patch("app.api.plugins.r9cam.websocket.router.monotonic", return_value=91.0),
        patch("app.api.plugins.r9cam.websocket.router.logger") as mock_logger,
    ):
        await _heartbeat_loop(websocket, session)

    websocket.close.assert_awaited_once_with(code=1001)
    mock_logger.warning.assert_called_once_with(
        "Camera %s heartbeat timeout (%.0fs since last pong); closing.",
        str(camera_id),
        91.0,
    )


_RELAY_JWK = {"kty": "EC", "crv": "P-256", "x": "x-1", "y": "y-1"}


def _authorised_camera(**changes: object) -> SimpleNamespace:
    camera = SimpleNamespace(
        credential_is_active=True,
        relay_key_id="key-1",
        relay_public_key_jwk=dict(_RELAY_JWK),
        owner=SimpleNamespace(is_active=True, is_verified=True),
    )
    for name, value in changes.items():
        setattr(camera, name, value)
    return camera


def _heartbeat_session() -> _RelayWebSocketSession:
    return _RelayWebSocketSession(
        camera_id=uuid4(),
        manager=MagicMock(),
        redis=AsyncMock(),
        relay_key_id="key-1",
        relay_public_key_jwk=dict(_RELAY_JWK),
        last_pong_at=0.0,
    )


@pytest.mark.parametrize(
    "camera",
    [
        None,
        _authorised_camera(credential_is_active=False),
        _authorised_camera(relay_key_id="key-2"),
        _authorised_camera(relay_public_key_jwk={**_RELAY_JWK, "x": "x-2"}),
        _authorised_camera(owner=SimpleNamespace(is_active=False, is_verified=True)),
        _authorised_camera(owner=SimpleNamespace(is_active=True, is_verified=False)),
    ],
    ids=["deleted", "revoked", "key-id-rotated", "key-rotated", "owner-inactive", "owner-unverified"],
)
async def test_heartbeat_closes_a_socket_the_camera_may_no_longer_hold(camera: SimpleNamespace | None) -> None:
    """A tunnel opened before a revoke, rotation, delete or owner change closes on the next tick."""
    websocket = MagicMock()
    websocket.close = AsyncMock()
    websocket.send_text = AsyncMock()

    with (
        patch(f"{_ROUTER}.asyncio.sleep", new=AsyncMock()),
        patch(f"{_ROUTER}.monotonic", return_value=1.0),
        patch(f"{_ROUTER}._get_camera", new=AsyncMock(return_value=camera)),
    ):
        await _heartbeat_loop(websocket, _heartbeat_session())

    websocket.close.assert_awaited_once_with(code=_WS_POLICY_VIOLATION, reason="Camera no longer authorised.")
    websocket.send_text.assert_not_awaited()


async def _hang(*_args: object, **_kwargs: object) -> None:
    await asyncio.Event().wait()


async def test_heartbeat_keeps_the_socket_after_one_failed_re_check() -> None:
    """A single database error keeps the tunnel and still pings; a success resets the count."""
    websocket = MagicMock()
    websocket.close = AsyncMock()
    websocket.send_text = AsyncMock()
    lookups = [OSError("db down"), _authorised_camera(), OSError("db down")]

    with (
        patch(f"{_ROUTER}.asyncio.sleep", new=AsyncMock(side_effect=[None, None, None, asyncio.CancelledError])),
        patch(f"{_ROUTER}.monotonic", return_value=1.0),
        patch(f"{_ROUTER}._get_camera", new=AsyncMock(side_effect=lookups)),
        patch(f"{_ROUTER}.logger"),
        pytest.raises(asyncio.CancelledError),
    ):
        await _heartbeat_loop(websocket, _heartbeat_session())

    websocket.close.assert_not_awaited()
    assert websocket.send_text.await_count == 3


@pytest.mark.parametrize("failure", ["error", "timeout"])
async def test_heartbeat_closes_with_1011_after_two_failed_re_checks(failure: str) -> None:
    """Two failed re-checks in a row, a timeout included, close with 1011 rather than a policy close."""
    websocket = MagicMock()
    websocket.close = AsyncMock()
    websocket.send_text = AsyncMock()
    lookup = AsyncMock(side_effect=OSError("db down")) if failure == "error" else _hang

    with (
        patch(f"{_ROUTER}.asyncio.sleep", new=AsyncMock()),
        patch(f"{_ROUTER}.monotonic", return_value=1.0),
        patch(f"{_ROUTER}._RECHECK_TIMEOUT", 0.01),
        patch(f"{_ROUTER}._get_camera", new=lookup),
        patch(f"{_ROUTER}.logger"),
    ):
        await asyncio.wait_for(_heartbeat_loop(websocket, _heartbeat_session()), timeout=2)

    websocket.close.assert_awaited_once_with(code=_WS_INTERNAL_ERROR, reason="Authorisation check unavailable.")
    websocket.send_text.assert_awaited_once()


async def test_heartbeat_keeps_pinging_a_camera_that_is_still_authorised() -> None:
    """An unchanged camera keeps its socket and gets its ping."""
    websocket = MagicMock()
    websocket.close = AsyncMock()
    websocket.send_text = AsyncMock()

    with (
        patch(f"{_ROUTER}.asyncio.sleep", new=AsyncMock(side_effect=[None, asyncio.CancelledError])),
        patch(f"{_ROUTER}.monotonic", return_value=1.0),
        patch(f"{_ROUTER}._get_camera", new=AsyncMock(return_value=_authorised_camera())),
        pytest.raises(asyncio.CancelledError),
    ):
        await _heartbeat_loop(websocket, _heartbeat_session())

    websocket.close.assert_not_awaited()
    websocket.send_text.assert_awaited_once()


async def test_receive_loop_closes_on_oversized_text_frame(monkeypatch: pytest.MonkeyPatch) -> None:
    """Oversized WebSocket text frames should close before JSON parsing or dispatch."""
    monkeypatch.setattr(
        "app.api.plugins.r9cam.websocket.router.RELAY_WS_TEXT_FRAME_LIMIT_BYTES",
        8,
    )
    websocket = AsyncMock()
    websocket.receive = AsyncMock(
        side_effect=[
            {"type": "websocket.receive", "text": "x" * 9},
            {"type": "websocket.disconnect"},
        ]
    )
    websocket.close = AsyncMock()

    await _receive_loop(websocket, _RelayWebSocketSession(camera_id=uuid4(), manager=MagicMock(), redis=AsyncMock()))

    websocket.close.assert_awaited_once()


async def test_receive_loop_accepts_binary_frames_within_the_limit() -> None:
    """A binary frame under the app-level cap is passed through, not closed."""
    websocket = AsyncMock()
    websocket.receive = AsyncMock(
        side_effect=[
            {"type": "websocket.receive", "bytes": b"x" * 9},
            {"type": "websocket.disconnect"},
        ]
    )
    websocket.close = AsyncMock()

    await _receive_loop(websocket, _RelayWebSocketSession(camera_id=uuid4(), manager=MagicMock(), redis=AsyncMock()))

    websocket.close.assert_not_awaited()


async def test_receive_loop_closes_on_oversized_binary_frame(monkeypatch: pytest.MonkeyPatch) -> None:
    """Oversized binary frames are capped at the app level, mirroring the text-frame limit."""
    monkeypatch.setattr(
        "app.api.plugins.r9cam.websocket.router.settings.r9cam_ws_binary_frame_limit_bytes",
        8,
    )
    websocket = AsyncMock()
    websocket.receive = AsyncMock(
        side_effect=[
            {"type": "websocket.receive", "bytes": b"x" * 9},
            {"type": "websocket.disconnect"},
        ]
    )
    websocket.close = AsyncMock()

    await _receive_loop(websocket, _RelayWebSocketSession(camera_id=uuid4(), manager=MagicMock(), redis=AsyncMock()))

    websocket.close.assert_awaited_once()


async def test_session_updates_last_pong_at_from_pong_frame() -> None:
    """The receive session should own heartbeat timestamp updates."""
    manager = MagicMock()
    session = _RelayWebSocketSession(camera_id=uuid4(), manager=manager, redis=AsyncMock(), last_pong_at=1.0)

    with patch("app.api.plugins.r9cam.websocket.router.monotonic", return_value=123.0):
        await session.handle_text_frame('{"type":"pong"}')

    assert session.last_pong_at == 123.0


async def test_session_pairs_binary_frame_with_pending_response() -> None:
    """The receive session should pair a binary frame with its pending JSON response."""
    manager = MagicMock()
    session = _RelayWebSocketSession(camera_id=uuid4(), manager=manager, redis=AsyncMock())
    await session.handle_text_frame('{"type":"response","id":"msg-1","status":200,"has_binary":true}')

    session.handle_binary_frame(b"payload")

    manager.resolve_json.assert_called_once_with(
        session.camera_id,
        "msg-1",
        {
            "id": "msg-1",
            "type": "response",
            "status": 200,
            "content_type": None,
            "has_binary": True,
            "data": None,
        },
        b"payload",
    )
    assert not session.pending_binary_responses


async def test_session_pairs_pipelined_binary_responses_in_order() -> None:
    """Two pipelined binary responses should pair with their headers FIFO."""
    manager = MagicMock()
    session = _RelayWebSocketSession(camera_id=uuid4(), manager=manager, redis=AsyncMock())
    await session.handle_text_frame('{"type":"response","id":"msg-1","status":200,"has_binary":true}')
    await session.handle_text_frame('{"type":"response","id":"msg-2","status":200,"has_binary":true}')
    # A non-binary response in between must not drop the pending binary headers.
    await session.handle_text_frame('{"type":"response","id":"msg-3","status":200}')

    session.handle_binary_frame(b"first")
    session.handle_binary_frame(b"second")

    resolved = [(call.args[1], call.args[3]) for call in manager.resolve_json.call_args_list]
    assert resolved == [("msg-3", None), ("msg-1", b"first"), ("msg-2", b"second")]
    assert not session.pending_binary_responses


async def test_pending_binary_responses_are_bounded() -> None:
    """A device flagging has_binary without sending the frame cannot grow memory unbounded."""
    session = _RelayWebSocketSession(camera_id=uuid4(), manager=MagicMock(), redis=AsyncMock())
    for i in range(500):
        await session.handle_text_frame(f'{{"type":"response","id":"msg-{i}","status":200,"has_binary":true}}')
    assert len(session.pending_binary_responses) == 64


# ── Device assertion verification ────────────────────────────────────────────

_AUD = ASSERTION_AUDIENCE


def _make_camera(key_id: str, public_jwk: dict) -> MagicMock:
    """Build a camera stub with the given credential fields."""
    camera = MagicMock()
    camera.id = uuid4()
    camera.relay_key_id = key_id
    camera.relay_public_key_jwk = public_jwk
    camera.credential_is_active = True
    return camera


async def test_accepts_valid_assertion() -> None:
    """A well-formed signed assertion should be accepted."""
    key_id = "key-1"
    private_key, jwk = make_keypair()
    camera = _make_camera(key_id, jwk)
    redis = AsyncMock()
    redis.set = AsyncMock(return_value=True)  # nx=True → not a replay

    assertion = sign_assertion(private_key, str(camera.id), key_id)
    payload = await _verify_device_assertion(assertion, camera, redis)

    assert payload["sub"] == f"camera:{camera.id}"
    assert payload["kid"] == key_id


@pytest.fixture
def device_assertion() -> tuple[ec.EllipticCurvePrivateKey, MagicMock, AsyncMock]:
    """The key pair, camera and redis stub every assertion-rejection test needs."""
    private_key, jwk = make_keypair()
    return private_key, _make_camera("key-1", jwk), AsyncMock()


class _ClaimOverrides(TypedDict, total=False):
    """The subset of ``_make_assertion``'s keyword claims a test case can override."""

    aud: str
    exp_offset: int
    iss: str
    sub: str
    omit_claims: set[str]


@pytest.mark.parametrize(
    ("kid", "claims", "match"),
    [
        pytest.param(
            "key-1",
            {"exp_offset": MAX_ASSERTION_TTL_SECONDS + 60},
            "Assertion lifetime exceeds allowed maximum",
            id="lifetime-over-cap",
        ),
        pytest.param("key-1", {"exp_offset": -10}, "Signature has expired", id="expired"),
        pytest.param("key-1", {"aud": "wrong-audience"}, "Audience doesn't match", id="wrong-audience"),
        pytest.param(
            "key-1",
            {"sub": f"camera:{uuid4()}"},
            "Assertion subject does not match camera",
            id="wrong-subject",
        ),
        pytest.param("key-1", {"omit_claims": {"iss"}}, 'missing the "iss" claim', id="missing-issuer"),
        pytest.param(
            "key-1",
            {"iss": f"camera:{uuid4()}"},
            "Assertion issuer does not match camera",
            id="wrong-issuer",
        ),
        pytest.param("wrong-kid", {}, "Assertion key id does not match camera credential", id="wrong-kid"),
    ],
)
async def test_rejects_assertion_with_bad_claim(
    device_assertion: tuple[ec.EllipticCurvePrivateKey, MagicMock, AsyncMock],
    kid: str,
    claims: _ClaimOverrides,
    match: str,
) -> None:
    """Each malformed or mis-scoped claim should be rejected, naming its own reason."""
    private_key, camera, redis = device_assertion

    assertion = sign_assertion(private_key, str(camera.id), kid, **claims)
    with pytest.raises(jwt.InvalidTokenError, match=re.escape(match)):
        await _verify_device_assertion(assertion, camera, redis)


async def test_rejects_invalid_signature() -> None:
    """An assertion signed by a different key should be rejected."""
    key_id = "key-1"
    _private_key, jwk = make_keypair()
    camera = _make_camera(key_id, jwk)
    redis = AsyncMock()

    # Sign with a completely different private key; won't match the stored public jwk
    wrong_key, _ = make_keypair()
    assertion = sign_assertion(wrong_key, str(camera.id), key_id)
    with pytest.raises(jwt.InvalidTokenError):
        await _verify_device_assertion(assertion, camera, redis)


async def test_rejects_replayed_jti() -> None:
    """A replayed jti (Redis already has it) should be rejected."""
    key_id = "key-1"
    private_key, jwk = make_keypair()
    camera = _make_camera(key_id, jwk)
    redis = AsyncMock()
    redis.set = AsyncMock(return_value=None)  # nx=True but key exists → None

    assertion = sign_assertion(private_key, str(camera.id), key_id)
    with pytest.raises(jwt.InvalidTokenError, match="replay"):
        await _verify_device_assertion(assertion, camera, redis)


async def test_rejects_unsupported_algorithm() -> None:
    """An assertion signed with HS256 instead of ES256 should be rejected."""
    key_id = "key-1"
    _private_key, jwk = make_keypair()
    camera = _make_camera(key_id, jwk)
    redis = AsyncMock()

    now = int(time.time())
    hs256_assertion = jwt.encode(
        {
            "sub": f"camera:{camera.id}",
            "aud": _AUD,
            "iat": now,
            "nbf": now,
            "exp": now + 120,
            "jti": secrets.token_urlsafe(24),
        },
        "some-random-thirty-two-bit-hmac-secret",
        algorithm="HS256",
        headers={"kid": key_id},
    )
    with pytest.raises(jwt.InvalidTokenError, match="algorithm"):
        await _verify_device_assertion(hs256_assertion, camera, redis)


_ROUTER = "app.api.plugins.r9cam.websocket.router"
_WS_POLICY_VIOLATION = 1008
_WS_INTERNAL_ERROR = 1011


def _authenticating_websocket() -> MagicMock:
    """A websocket that carries an assertion and passes the auth rate limit."""
    websocket = MagicMock()
    websocket.headers = {"Authorization": "Bearer an.assertion.value"}
    websocket.client = SimpleNamespace(host="203.0.113.10")
    websocket.close = AsyncMock()
    return websocket


@pytest.fixture
def relay_auth_patches():  # noqa: ANN201  # pytest fixture returning a context manager stack
    """Patch the collaborators ``_authenticate`` reaches past the rate limiter."""
    with (
        patch(f"{_ROUTER}.limiter") as limiter_mock,
        patch(f"{_ROUTER}._get_camera", new=AsyncMock()) as get_camera,
        patch(f"{_ROUTER}.require_connection_redis") as require_redis,
        patch(f"{_ROUTER}.verify_device_assertion", new=AsyncMock()) as verify_assertion,
        patch(f"{_ROUTER}.mark_camera_online", new=AsyncMock()) as mark_online,
    ):
        limiter_mock.ahit_key = AsyncMock()
        get_camera.return_value = SimpleNamespace(
            credential_is_active=True,
            relay_key_id="key-1",
            owner=SimpleNamespace(is_active=True, is_verified=True),
        )
        verify_assertion.return_value = {"kid": "key-1"}
        yield SimpleNamespace(
            get_camera=get_camera,
            require_redis=require_redis,
            verify_assertion=verify_assertion,
            mark_online=mark_online,
        )


async def test_authenticate_rejects_an_unknown_camera(relay_auth_patches) -> None:
    """A camera id with no row must not open a relay connection."""
    relay_auth_patches.get_camera.return_value = None
    websocket = _authenticating_websocket()

    assert await _authenticate(websocket, uuid4()) is None
    websocket.close.assert_awaited_once_with(code=_WS_POLICY_VIOLATION, reason="Authentication failed.")
    relay_auth_patches.verify_assertion.assert_not_awaited()


async def test_authenticate_rejects_a_camera_whose_credential_is_no_longer_active(relay_auth_patches) -> None:
    """Revoking a camera's credential must stop it reconnecting, even with a valid assertion.

    The assertion is signed by a key the device still holds, so the credential
    status is the only thing standing between a revoked Pi and a live relay.
    """
    relay_auth_patches.get_camera.return_value = SimpleNamespace(credential_is_active=False, relay_key_id="key-1")
    websocket = _authenticating_websocket()

    assert await _authenticate(websocket, uuid4()) is None
    websocket.close.assert_awaited_once_with(code=_WS_POLICY_VIOLATION, reason="Authentication failed.")
    relay_auth_patches.verify_assertion.assert_not_awaited()


@pytest.mark.parametrize("owner_flag", ["is_active", "is_verified"])
async def test_authenticate_rejects_a_camera_whose_owner_is_inactive_or_unverified(
    relay_auth_patches, owner_flag: str
) -> None:
    """A camera acts for its owner, so a deactivated or unverified owner's camera must not connect."""
    setattr(relay_auth_patches.get_camera.return_value.owner, owner_flag, False)
    websocket = _authenticating_websocket()

    assert await _authenticate(websocket, uuid4()) is None
    websocket.close.assert_awaited_once_with(code=_WS_POLICY_VIOLATION, reason="Authentication failed.")
    relay_auth_patches.verify_assertion.assert_not_awaited()


async def test_authenticate_fails_closed_when_redis_is_unavailable(relay_auth_patches) -> None:
    """Replay protection needs Redis, so losing it must reject rather than skip the check."""
    relay_auth_patches.require_redis.side_effect = RequiredServiceUnavailableError("redis")
    websocket = _authenticating_websocket()

    assert await _authenticate(websocket, uuid4()) is None
    websocket.close.assert_awaited_once_with(code=_WS_INTERNAL_ERROR, reason="Authentication service unavailable.")
    relay_auth_patches.verify_assertion.assert_not_awaited()


async def test_authenticate_rejects_an_invalid_assertion(relay_auth_patches) -> None:
    """A rejected assertion must close the socket rather than fall through to accept."""
    relay_auth_patches.verify_assertion.side_effect = InvalidTokenError("expired")
    websocket = _authenticating_websocket()

    assert await _authenticate(websocket, uuid4()) is None
    websocket.close.assert_awaited_once_with(code=_WS_POLICY_VIOLATION, reason="Authentication failed.")
    relay_auth_patches.mark_online.assert_not_awaited()


async def test_authenticate_accepts_a_valid_assertion_and_marks_the_camera_online(relay_auth_patches) -> None:
    """The success path admits the device and records it as online."""
    websocket = _authenticating_websocket()
    camera_id = uuid4()

    assert await _authenticate(websocket, camera_id) is relay_auth_patches.get_camera.return_value
    websocket.close.assert_not_awaited()
    relay_auth_patches.mark_online.assert_awaited_once()
    assert relay_auth_patches.mark_online.await_args.args[1] == camera_id
