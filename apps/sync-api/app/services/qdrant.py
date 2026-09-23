"""Qdrant client wrapper for the central cluster."""

from typing import Any

from loguru import logger
from qdrant_client import QdrantClient
from qdrant_client.http import models

from app.config import settings


def get_client() -> QdrantClient:
    """Get or create the central Qdrant client."""
    return QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
    )


def ensure_collection(client: QdrantClient, name: str) -> None:
    """Create the field_edge_central collection if it doesn't exist."""
    try:
        client.create_collection(
            collection_name=name,
            vectors_config=models.VectorParams(
                size=512,
                distance=models.Distance.COSINE,
            ),
            quantization_config=models.ScalarQuantization(
                quantile=0.99,
                always_ram=False,
            ),
        )
        logger.info(f"Created collection {name}")
    except Exception as e:
        if "already exists" in str(e).lower() or "409" in str(e):
            logger.debug(f"Collection {name} already exists")
        else:
            logger.warning(f"Collection create failed (may be benign): {e}")

    # Ensure required payload indexes exist (datetime index needed for sync cursor)
    for field_name, schema in [
        ("project_id", models.PayloadSchemaType.KEYWORD),
        ("device_id", models.PayloadSchemaType.KEYWORD),
        ("local_updated_at", models.PayloadSchemaType.DATETIME),
    ]:
        try:
            client.create_payload_index(
                collection_name=name,
                field_name=field_name,
                field_schema=schema,
            )
        except Exception as e:
            if "already exists" in str(e).lower():
                logger.debug(f"Index on {field_name} already exists")
            else:
                logger.debug(f"Index on {field_name}: {e}")


def upsert_point(client: QdrantClient, collection: str, point_id: str, vector: list[float], payload: dict[str, Any]) -> None:
    """Upsert a single point into the central cluster."""
    client.upsert(
        collection_name=collection,
        points=[
            models.PointStruct(
                id=point_id,
                vector=vector,
                payload=payload,
            )
        ],
        wait=True,
    )


def retrieve_point(client: QdrantClient, collection: str, point_id: str) -> dict[str, Any] | None:
    """Retrieve a single point from the central cluster. Returns None if not found."""
    try:
        records = client.retrieve(collection_name=collection, ids=[point_id])
        if not records:
            return None
        return {
            "id": records[0].id,
            "vector": records[0].vector,
            "payload": records[0].payload,
        }
    except Exception as e:
        logger.warning(f"retrieve failed for {point_id}: {e}")
        return None


def scroll_points(client: QdrantClient, collection: str, since_iso: str, limit: int = 100) -> tuple[list[dict[str, Any]], str | None]:
    """Scroll points updated after `since_iso`. Returns (points, next_cursor)."""
    from qdrant_client.http import models

    records, next_offset = client.scroll(
        collection_name=collection,
        scroll_filter=models.Filter(
            must=[
                models.FieldCondition(
                    key="local_updated_at",
                    range=models.DatetimeRange(
                        gt=since_iso,
                    ),
                )
            ]
        ),
        limit=limit,
        with_payload=True,
    )

    points = [
        {
            "id": str(p.id),
            "vector": [],  # scroll returns no vectors in 1.19; use retrieve for vectors
            "payload": p.payload,
        }
        for p in records
    ]
    return points, next_offset


def collection_count(client: QdrantClient, collection: str) -> int | None:
    """Return the point count for the collection, or None on error."""
    try:
        info = client.get_collection(collection_name=collection)
        return info.points_count
    except Exception as e:
        logger.warning(f"collection_count failed: {e}")
        return None
