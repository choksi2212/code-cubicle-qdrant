"""Middleware package for the FieldEdge sync API.

Exports the canonical list of middleware classes (registration order
matters — middlewares wrap each other from the outside in).
"""

from app.middleware.request_id import (
    REQUEST_ID_HEADER,
    RequestIdMiddleware,
    extract_request_id,
)

__all__ = [
    "REQUEST_ID_HEADER",
    "RequestIdMiddleware",
    "extract_request_id",
    "MIDDLEWARE_CLASSES",
]


# Register in the order they should wrap the request/response cycle
# (outermost first in this list; FastAPI applies the last-registered
# middleware as the outermost layer, so we keep the natural order here).
MIDDLEWARE_CLASSES: list[type] = [
    RequestIdMiddleware,
]
