"""
Seed the real Qdrant Cloud cluster with demo data.

Uses deterministic placeholder embeddings (consistent with the mobile app)
so search works end-to-end without a CLIP model file in the APK.

Run:
  python apps/mobile/scripts/seed-qdrant-cloud.py

Requires:
  QDRANT_URL and QDRANT_API_KEY in .env (already filled with your cluster)
"""

import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv  # type: ignore
from qdrant_client import QdrantClient
from qdrant_client.http import models

# Load .env from repo root
load_dotenv(Path(__file__).resolve().parents[3] / ".env")

QDRANT_URL = os.environ["QDRANT_URL"]
QDRANT_API_KEY = os.environ["QDRANT_API_KEY"]
COLLECTION = "field_edge_central"

PROJECTS = [
    {"id": "river-study", "name": "River Study"},
    {"id": "forest-survey", "name": "Forest Survey"},
    {"id": "urban-infra", "name": "Urban Infrastructure"},
    {"id": "wildlife-tracker", "name": "Wildlife Tracker"},
]

# Deterministic placeholder embedder — same algorithm as the mobile app.
# Mirrors apps/mobile/src/embedding/clip.ts → embedPlaceholder()
def placeholder_embed(seed: str, dim: int = 512) -> list[float]:
    h = abs(hash(seed)) & 0xFFFFFFFF
    vec: list[float] = []
    s = h
    for _ in range(dim):
        s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
        vec.append(((s / 0xFFFFFFFF) - 0.5) * 0.1)
    norm = sum(v * v for v in vec) ** 0.5 or 1.0
    return [v / norm for v in vec]


def make_payload(photo_id: str, project_id: str, tags: list[str], ts_offset_min: int) -> dict:
    captured_at = datetime.now(timezone.utc).replace(microsecond=0)
    captured_at = captured_at.replace(minute=(captured_at.minute - ts_offset_min) % 60)
    return {
        "schema_version": 1,
        "photo_id": photo_id,
        "device_id": "demo-seed",
        "captured_at": captured_at.isoformat(),
        "lat": 13.45 + (hash(photo_id) % 100) / 1000.0,
        "lng": 75.12 + (hash(project_id) % 100) / 1000.0,
        "gps_status": "ok",
        "project_id": project_id,
        "file_path": f"{project_id}/demo-seed/{photo_id}.jpg",
        "embedding_status": "ok",
        "enrichment_id": None,
        "enrichment_tags": tags,
        "enrichment_objects": [],
        "enrichment_text": None,
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "local_updated_at": captured_at.isoformat(),
        "vector_checksum": f"sha256:demo:{photo_id}",
    }


def main():
    print(f"[+] Connecting to Qdrant: {QDRANT_URL[:50]}...")
    client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)

    # 1. Create collection if missing
    try:
        client.create_collection(
            collection_name=COLLECTION,
            vectors_config=models.VectorParams(
                size=512,
                distance=models.Distance.COSINE,
            ),
            quantization_config=models.ScalarQuantization(
                scalar=models.ScalarQuantizationConfig(
                    type=models.ScalarType.INT8,
                    quantile=0.99,
                    always_ram=False,
                ),
            ),
        )
        print(f"[+] Created collection {COLLECTION}")
    except Exception as e:
        if "already exists" in str(e).lower() or "409" in str(e):
            print(f"[i] Collection {COLLECTION} already exists")
        else:
            print(f"[!] Create collection failed: {e}")
            sys.exit(1)

    # 2. Create payload indexes
    for field in ("project_id", "device_id"):
        try:
            client.create_payload_index(
                collection_name=COLLECTION,
                field_name=field,
                field_schema=models.PayloadSchemaType.KEYWORD,
            )
        except Exception:
            pass  # already exists

    # 3. Generate + upload seed points
    print("[*] Generating seed points...")
    points: list[models.PointStruct] = []
    photo_id = 0
    seed_descriptions = [
        ("river-study", "river pollution trash", ["river", "pollution", "trash"]),
        ("river-study", "river fish habitat", ["river", "fish", "habitat"]),
        ("river-study", "river water quality", ["river", "water"]),
        ("forest-survey", "forest canopy density", ["forest", "canopy"]),
        ("forest-survey", "forest tree species", ["forest", "tree"]),
        ("forest-survey", "forest deadfall", ["forest", "deadfall"]),
        ("urban-infra", "urban road damage", ["urban", "road"]),
        ("urban-infra", "urban bridge inspection", ["urban", "bridge"]),
        ("urban-infra", "urban building facade", ["urban", "building"]),
        ("wildlife-tracker", "wildlife mammal tracks", ["wildlife", "tracks"]),
        ("wildlife-tracker", "wildlife bird nest", ["wildlife", "bird"]),
        ("wildlife-tracker", "wildlife scat", ["wildlife", "scat"]),
    ]

    for project_id, desc, tags in seed_descriptions:
        photo_id += 1
        pid = uuid4().hex  # Qdrant Cloud requires UUIDs or uints, not arbitrary strings
        # Use the description as the seed for the deterministic embedder
        vector = placeholder_embed(f"{project_id}:{desc}")
        payload = make_payload(pid, project_id, tags, ts_offset_min=photo_id)
        points.append(
            models.PointStruct(
                id=pid,
                vector=vector,
                payload=payload,
            )
        )

    # Upload in batches of 100
    for i in range(0, len(points), 100):
        batch = points[i:i + 100]
        client.upsert(
            collection_name=COLLECTION,
            points=batch,
            wait=True,
        )
    print(f"[+] Uploaded {len(points)} seed points to {COLLECTION}")

    # 4. Verify
    info = client.get_collection(collection_name=COLLECTION)
    print(f"[i] Collection stats: {info.points_count} points, status: {info.status}")

    # 5. Smoke-test a query
    print("\n[*] Smoke test: query 'river pollution'")
    qvec = placeholder_embed("river-study:river pollution trash")
    results = client.query_points(
        collection_name=COLLECTION,
        query=qvec,
        limit=5,
        with_payload=True,
    )
    print(f"   Found {len(results.points)} results:")
    for h in results.points[:5]:
        print(
            f"   - {h.id}  score={h.score:.4f}  "
            f"project={h.payload.get('project_id')}  "
            f"tags={h.payload.get('enrichment_tags')}"
        )

    print("\n[OK] Seed complete.")


if __name__ == "__main__":
    main()
