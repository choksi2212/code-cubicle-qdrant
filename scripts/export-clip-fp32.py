"""
Export CLIP-ViT-B/32 to ONNX (FP32 — real weights, no quantization).

Output: apps/mobile/android/app/src/main/assets/models/
          clip-vision.onnx   (vision encoder + projection + L2 norm, FP32)
          clip-text.onnx     (text encoder + projection + L2 norm, FP32)

This is the REAL inference path. Each model outputs the final 512-dim
L2-normalized embedding directly — no post-processing needed.

FP32 size: ~150MB per encoder = ~300MB total in APK. Acceptable for
the hackathon APK size; Day 5+ would switch to a smaller int8 model.

Run: python scripts/export-clip-fp32.py
"""

import shutil
import sys
from pathlib import Path

import torch
import torch.nn as nn

REPO_ROOT = Path(__file__).resolve().parents[1]
ASSETS_DIR = REPO_ROOT / "apps" / "mobile" / "android" / "app" / "src" / "main" / "assets" / "models"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

print("[1/4] Loading CLIP model...")
from transformers import CLIPModel  # noqa: E402

model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").eval()


class VisionEncoder(nn.Module):
    """Vision encoder + projection + L2 normalization in a single graph."""

    def __init__(self, clip: CLIPModel):
        super().__init__()
        self.vision_model = clip.vision_model
        self.visual_projection = clip.visual_projection

    def forward(self, pixel_values):
        out = self.vision_model(pixel_values)
        pooled = out.pooler_output
        projected = self.visual_projection(pooled)
        return projected / projected.norm(dim=-1, keepdim=True)


class TextEncoder(nn.Module):
    """Text encoder + projection + L2 normalization in a single graph."""

    def __init__(self, clip: CLIPModel):
        super().__init__()
        self.text_model = clip.text_model
        self.text_projection = clip.text_projection

    def forward(self, input_ids, attention_mask):
        out = self.text_model(input_ids=input_ids, attention_mask=attention_mask)
        pooled = out.pooler_output
        projected = self.text_projection(pooled)
        return projected / projected.norm(dim=-1, keepdim=True)


vision_enc = VisionEncoder(model).eval()
text_enc = TextEncoder(model).eval()

print("[2/4] Exporting to ONNX (FP32)...")
tmp_dir = REPO_ROOT / ".tmp_clip_export"
tmp_dir.mkdir(exist_ok=True)

# Vision
vision_out = tmp_dir / "vision.onnx"
torch.onnx.export(
    vision_enc,
    torch.randn(1, 3, 224, 224),
    str(vision_out),
    input_names=["pixel_values"],
    output_names=["image_embeds"],
    dynamic_axes={"pixel_values": {0: "batch"}, "image_embeds": {0: "batch"}},
    opset_version=14,
    external_data=False,
)
print(f"   vision exported ({vision_out.stat().st_size // 1024 // 1024} MB)")

# Text
text_out = tmp_dir / "text.onnx"
torch.onnx.export(
    text_enc,
    (torch.zeros((1, 77), dtype=torch.long), torch.ones((1, 77), dtype=torch.long)),
    str(text_out),
    input_names=["input_ids", "attention_mask"],
    output_names=["text_embeds"],
    dynamic_axes={
        "input_ids": {0: "batch", 1: "sequence"},
        "attention_mask": {0: "batch", 1: "sequence"},
        "text_embeds": {0: "batch"},
    },
    opset_version=14,
    external_data=False,
)
print(f"   text exported ({text_out.stat().st_size // 1024 // 1024} MB)")

print("[3/4] Copying to Android assets...")
shutil.copy(vision_out, ASSETS_DIR / "clip-vision.onnx")
shutil.copy(text_out, ASSETS_DIR / "clip-text.onnx")

shutil.rmtree(tmp_dir)

print("[4/4] Verifying outputs produce 512-dim embeddings...")
import onnxruntime as ort
import numpy as np

sess = ort.InferenceSession(str(ASSETS_DIR / "clip-text.onnx"),
                              providers=["CPUExecutionProvider"])
result = sess.run(None, {
    "input_ids": np.zeros((1, 77), dtype=np.int64),
    "attention_mask": np.ones((1, 77), dtype=np.int64),
})[0]
print(f"   text output shape: {result.shape}")
assert result.shape == (1, 512), "Expected 512-dim embedding"
norm = np.linalg.norm(result)
print(f"   L2 norm: {norm:.4f} (should be ~1.0 for L2-normalized)")
assert abs(norm - 1.0) < 0.01, "Output not L2-normalized"

sess = ort.InferenceSession(str(ASSETS_DIR / "clip-vision.onnx"),
                              providers=["CPUExecutionProvider"])
result = sess.run(None, {
    "pixel_values": np.random.randn(1, 3, 224, 224).astype(np.float32),
})[0]
print(f"   vision output shape: {result.shape}")
assert result.shape == (1, 512), "Expected 512-dim embedding"
print(f"   L2 norm: {np.linalg.norm(result):.4f}")

print("\n[OK] All checks pass. Real CLIP models ready for Android.")