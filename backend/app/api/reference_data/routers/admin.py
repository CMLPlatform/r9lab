"""Admin reference-data router composition."""

from typing import TYPE_CHECKING, Annotated
from urllib.parse import unquote

from fastapi import Depends, Path, Request, Security

from app.api.auth.dependencies import CurrentActiveSuperUserDep, current_active_superuser
from app.api.common.audiences import AdminAPIRouter
from app.api.common.audit import AuditAction, AuditContext, audit_event
from app.api.reference_data.routers.admin_categories import router as category_router
from app.api.reference_data.routers.admin_materials import router as material_router
from app.api.reference_data.routers.admin_product_types import router as product_type_router
from app.api.reference_data.routers.admin_taxonomies import router as taxonomy_router
from app.core.cache import clear_cache_namespace
from app.core.config.models import CacheNamespace

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

_METHOD_ACTIONS = {"POST": AuditAction.CREATE, "PATCH": AuditAction.UPDATE, "PUT": AuditAction.UPDATE}
# Routes whose HTTP method does not say what they do to the data.
_ROUTE_ACTIONS = {"clear_cache_by_namespace": AuditAction.DELETE}


def _audit_target(path: str, path_params: dict[str, str]) -> tuple[str, str | None]:
    """Return the resource type and id a write under ``/admin/`` changed.

    Each path parameter belongs to the segment before it, and the target is the last such
    segment: ``/materials/7/images/<uuid>`` is the image, ``/materials/7/categories`` is the
    material's category links (no id). A segment that follows another without a parameter
    between them names an action on the first, so ``/cache/clear/<namespace>`` is the cache.
    """
    # Path parameters arrive in path order, so the next one expected is the only one to match.
    param_values = list(path_params.values())
    targets: list[list[str | None]] = []
    previous_was_literal = False
    for segment in unquote(path.partition("/admin/")[2]).split("/"):
        if param_values and segment == param_values[0]:
            targets[-1][1] = param_values.pop(0)
            previous_was_literal = False
        elif not previous_was_literal:
            targets.append([segment, None])
            previous_was_literal = True
    resource_type, resource_id = targets[-1]
    return str(resource_type), resource_id


async def audit_admin_mutation(request: Request, actor: CurrentActiveSuperUserDep) -> AsyncIterator[None]:
    """Write one audit event for every admin write that completes without an error.

    The code after ``yield`` does not run when the route raises, so refused writes are not
    recorded as done. Admin routes commit inside their body, so a failed commit raises
    there and leaves no event. The target is the resource the id in the path belongs to
    (see ``_audit_target``), with every path parameter, the parent's included, in the
    context. A create has no id in its path, so its event carries none.
    """
    yield
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    route_name = getattr(request.scope.get("route"), "name", None)
    resource_type, resource_id = _audit_target(request.url.path, request.path_params)
    audit_event(
        actor.id,
        _ROUTE_ACTIONS.get(route_name) or _METHOD_ACTIONS.get(request.method, AuditAction.DELETE),
        resource_type,
        resource_id,
        context=AuditContext(operation=route_name, path_params=dict(request.path_params) or None),
    )


router = AdminAPIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Security(current_active_superuser), Depends(audit_admin_mutation)],
)


@router.post("/cache/clear/{namespace}", summary="Clear cache by namespace")
async def clear_cache_by_namespace(
    namespace: Annotated[CacheNamespace, Path(description="Cache namespace to clear")],
) -> dict[str, str]:
    """Clear cached responses for a specific namespace."""
    await clear_cache_namespace(namespace)
    return {"status": "cleared", "namespace": namespace}


router.include_router(category_router)
router.include_router(taxonomy_router)
router.include_router(material_router)
router.include_router(product_type_router)
