"""
Seed Qdrant Cloud with REAL CLIP embeddings (not hash placeholders).

Uses openai/clip-vit-base-patch32 to embed each seed description, then
uploads to the central Qdrant cluster. Replaces the placeholder seed
script with a real semantic embedding pipeline.

Run: python scripts/seed-with-real-clip.py
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv  # type: ignore
from qdrant_client import QdrantClient
from qdrant_client.http import models

REPO_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(REPO_ROOT / ".env")

QDRANT_URL = os.environ["QDRANT_URL"]
QDRANT_API_KEY = os.environ["QDRANT_API_KEY"]
COLLECTION = "field_edge_central"

print("[1/4] Loading real CLIP model...")
import torch
from transformers import CLIPModel, CLIPProcessor

model_id = "openai/clip-vit-base-patch32"
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"   device={device}")
model = CLIPModel.from_pretrained(model_id).to(device).eval()
processor = CLIPProcessor.from_pretrained(model_id)


def real_clip_embed(text: str) -> list[float]:
    """Real CLIP text embedding (512-dim, L2-normalized)."""
    inputs = processor(text=[text], return_tensors="pt", padding=True).to(device)
    with torch.no_grad():
        feats = model.get_text_features(**inputs)
    feats = feats / feats.norm(dim=-1, keepdim=True)  # L2 normalize (CLIP convention)
    return feats[0].cpu().tolist()


def real_clip_embed_image(image_path: str) -> list[float]:
    """Real CLIP image embedding (512-dim, L2-normalized)."""
    from PIL import Image
    img = Image.open(image_path).convert("RGB")
    inputs = processor(images=img, return_tensors="pt").to(device)
    with torch.no_grad():
        feats = model.get_image_features(**inputs)
    feats = feats / feats.norm(dim=-1, keepdim=True)
    return feats[0].cpu().tolist()


print("[2/4] Connecting to Qdrant Cloud...")
client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)

# Reset collection (drop + recreate) for clean seed
try:
    client.delete_collection(COLLECTION)
    print(f"   Deleted existing collection {COLLECTION}")
except Exception as e:
    print(f"   (no existing collection: {e})")

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
print(f"   Created collection {COLLECTION}")

for field in ("project_id", "device_id"):
    client.create_payload_index(
        collection_name=COLLECTION,
        field_name=field,
        field_schema=models.PayloadSchemaType.KEYWORD,
    )

print("[3/4] Generating real CLIP embeddings for seed descriptions...")

from datetime import datetime, timezone
from uuid import uuid4

seed_descriptions = [
    ("river-study", "a polluted river with plastic trash along the banks",
     ["river", "pollution", "trash", "plastic"]),
    ("river-study", "a pristine river with fish swimming in clear water",
     ["river", "fish", "habitat", "clean"]),
    ("river-study", "river water quality monitoring equipment",
     ["river", "water", "monitoring"]),
    ("forest-survey", "dense forest canopy with tall trees",
     ["forest", "canopy", "trees"]),
    ("forest-survey", "rare tree species identified in the forest",
     ["forest", "tree", "species", "biodiversity"]),
    ("forest-survey", "deadfall and decomposing logs on forest floor",
     ["forest", "deadfall", "decomposition"]),
    ("urban-infra", "damaged road surface with potholes",
     ["urban", "road", "damage", "potholes"]),
    ("urban-infra", "bridge inspection showing structural details",
     ["urban", "bridge", "inspection"]),
    ("urban-infra", "building facade with weathering and damage",
     ["urban", "building", "facade"]),
    ("wildlife-tracker", "animal tracks in mud showing mammal passage",
     ["wildlife", "tracks", "mammal"]),
    ("wildlife-tracker", "bird nest in tree with eggs",
     ["wildlife", "bird", "nest", "eggs"]),
    ("wildlife-tracker", "animal scat found along trail",
     ["wildlife", "scat", "trail"]),
]

points = []
now = datetime.now(timezone.utc)
for i, (project_id, desc, tags) in enumerate(seed_descriptions):
    pid = uuid4().hex
    vector = real_clip_embed(desc)
    captured_at = now.replace(minute=(now.minute - i) % 60)
    payload = {
        "schema_version": 1,
        "photo_id": pid,
        "device_id": "real-clip-seed",
        "captured_at": captured_at.isoformat(),
        "lat": 13.45 + (hash(desc) % 100) / 1000.0,
        "lng": 75.12 + (hash(project_id) % 100) / 1000.0,
        "gps_status": "ok",
        "project_id": project_id,
        "file_path": f"{project_id}/real-clip-seed/{pid}.jpg",
        "embedding_status": "ok",
        "cloudinary_public_id": None,
        "cloudinary_tags": tags,
        "cloudinary_objects": [],
        "cloudinary_ocr_text": None,
        "synced_at": now.isoformat(),
        "local_updated_at": captured_at.isoformat(),
        "vector_checksum": f"sha256:real-clip:{pid}",
    }
    points.append(models.PointStruct(id=pid, vector=vector, payload=payload))
    print(f"   [{i+1}/{len(seed_descriptions)}] {project_id}: {desc[:60]}...")

# Upload
print("[4/4] Uploading to Qdrant Cloud...")
client.upsert(collection_name=COLLECTION, points=points, wait=True)
info = client.get_collection(collection_name=COLLECTION)
print(f"[OK] {info.points_count} points uploaded, status: {info.status}")

# Smoke test
print("\n[*] Smoke test: query 'polluted river' (real CLIP text embedding)")
qvec = real_clip_embed("polluted river with garbage")
results = client.query_points(
    collection_name=COLLECTION,
    query=qvec,
    limit=3,
    with_payload=True,
)
for h in results.points:
    print(
        f"   - score={h.score:.4f}  "
        f"project={h.payload.get('project_id')}  "
        f"tags={h.payload.get('cloudinary_tags')}"
    )

print("\n[OK] Real CLIP seed complete. The Qdrant Cloud cluster now has real semantic embeddings.")
