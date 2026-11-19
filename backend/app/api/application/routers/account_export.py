"""The account archive route, ``GET /users/me/export``.

It shares ``/users/me`` with ``auth.routers.users`` but lives here: the archive reads
products, media and cameras, which ``auth`` may not import.
"""

from fastapi import Security
from fastapi.responses import StreamingResponse

from app.api.application.account_export import archive_filename, load_account_archive, stream_account_archive
from app.api.auth.dependencies import CurrentActiveUserDep, current_active_user
from app.api.auth.services.rate_limiter import API_ACCOUNT_EXPORT_RATE_LIMIT_DEPENDENCY
from app.api.common.audiences import PublicAPIRouter
from app.api.common.routers.dependencies import AsyncSessionDep

router = PublicAPIRouter(prefix="/users", tags=["users"], dependencies=[Security(current_active_user)])


@router.get(
    "/me/export",
    summary="Download all your data as a ZIP archive",
    response_class=StreamingResponse,
    responses={
        200: {"content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}}},
        413: {"description": "The account has more products and components than one archive takes."},
    },
    dependencies=[API_ACCOUNT_EXPORT_RATE_LIMIT_DEPENDENCY],
)
async def export_own_account(user: CurrentActiveUserDep, session: AsyncSessionDep) -> StreamingResponse:
    """Download your account details, every product you own and their photos and files, as one ZIP.

    The archive holds ``account.json``, ``products.json``, ``products.csv`` (the same
    formats as ``/products/export``, capped at 50,000 products and components together
    instead of its caps), ``revisions.json``,
    ``images/`` and ``files/``, grouped by product id. Uploads the server cannot read are listed in
    ``missing-files.txt`` instead. The archive is built while it downloads, so its size
    is not known in advance and an interrupted download starts over.
    """
    archive = await load_account_archive(session, user)
    # The stream reads only the loaded archive. The yield dependency would keep the session,
    # and its pooled connection idle in a transaction, open until the last byte is sent.
    await session.close()
    return StreamingResponse(
        stream_account_archive(archive),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{archive_filename(user)}"'},
    )
