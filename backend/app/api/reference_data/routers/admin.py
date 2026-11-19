"""Admin reference-data router composition."""

from typing import TYPE_CHECKING, Annotated

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


async def audit_admin_mutation(request: Request, actor: CurrentActiveSuperUserDep) -> AsyncIterator[None]:
    """Write one audit event for every admin write that completes without an error.

    The code after ``yield`` does not run when the route raises, so refused writes are not
    recorded as done. A create has no id in its path, so its event carries none.
    """
    yield
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    route_name = getattr(request.scope.get("route"), "name", None)
    # "/v1/admin/materials/7/images" -> "materials"
    resource_type = request.url.path.partition("/admin/")[2].split("/", 1)[0]
    audit_event(
        actor.id,
        _ROUTE_ACTIONS.get(route_name) or _METHOD_ACTIONS.get(request.method, AuditAction.DELETE),
        resource_type,
        next(iter(request.path_params.values()), None),
        context=AuditContext(operation=route_name),
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
