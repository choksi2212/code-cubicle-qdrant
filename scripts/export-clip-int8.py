"""
Export CLIP-ViT-B/32 to ONNX with int8 quantization.

Output: apps/mobile/android/app/src/main/assets/models/clip-{vision,text}-int8.onnx

Each output model includes the projection + normalization so the output
is the final 512-dim L2-normalized embedding (no post-processing needed).

Run: python scripts/export-clip-int8.py
"""

import os
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
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

print("[1/4] Loading CLIP model + tokenizer from HuggingFace...")
from transformers import CLIPModel, CLIPProcessor  # noqa: E402

model_id = "openai/clip-vit-base-patch32"
model = CLIPModel.from_pretrained(model_id).eval()
processor = CLIPProcessor.from_pretrained(model_id)


# ─── Wrap with projection + L2 norm ─────────────────────────────────────────


class VisionEncoderWrapper(nn.Module):
    """Wraps CLIP vision model + projection + L2 normalization."""

    def __init__(self, clip: CLIPModel):
        super().__init__()
        self.vision_model = clip.vision_model
        self.visual_projection = clip.visual_projection

    def forward(self, pixel_values):
        # pooled output: [batch, 768] -> project to [batch, 512]
        vision_out = self.vision_model(pixel_values)
        pooled = vision_out.pooler_output  # [batch, 768]
        projected = self.visual_projection(pooled)  # [batch, 512]
        # L2 normalize
        return projected / projected.norm(dim=-1, keepdim=True)


class TextEncoderWrapper(nn.Module):
    """Wraps CLIP text model + projection + L2 normalization."""

    def __init__(self, clip: CLIPModel):
        super().__init__()
        self.text_model = clip.text_model
        self.text_projection = clip.text_projection

    def forward(self, input_ids, attention_mask):
        text_out = self.text_model(input_ids=input_ids, attention_mask=attention_mask)
        # Take EOS token (argmax of attention_mask is the EOS position)
        eos_pos = attention_mask.argmax(dim=-1)
        pooled = text_out.pooler_output  # already EOS-pooled by HF CLIP
        projected = self.text_projection(pooled)  # [batch, 512]
        return projected / projected.norm(dim=-1, keepdim=True)


# Quantization splits:
#   - inner.onnx = vision_model/text_model only (int8-compatible shapes)
#   - projection.onnx = projection + LN (kept in fp16; shapes infer cleanly)
# Combined at inference time by OnnxClipModule.


class VisionInner(nn.Module):
    """Just the vision_model for int8 quantization."""

    def __init__(self, clip: CLIPModel):
        super().__init__()
        self.vision_model = clip.vision_model

    def forward(self, pixel_values):
        return self.vision_model(pixel_values).pooler_output


class VisionProjection(nn.Module):
    """projection + LN, runs after the int8-quantized inner model."""

    def __init__(self, clip: CLIPModel):
        super().__init__()
        self.visual_projection = clip.visual_projection

    def forward(self, pooled):
        projected = self.visual_projection(pooled)
        return projected / projected.norm(dim=-1, keepdim=True)


class TextInner(nn.Module):
    """Just the text_model for int8 quantization."""

    def __init__(self, clip: CLIPModel):
        super().__init__()
        self.text_model = clip.text_model

    def forward(self, input_ids, attention_mask):
        return self.text_model(
            input_ids=input_ids, attention_mask=attention_mask
        ).pooler_output


class TextProjection(nn.Module):
    """projection + LN, runs after the int8-quantized inner model."""

    def __init__(self, clip: CLIPModel):
        super().__init__()
        self.text_projection = clip.text_projection

    def forward(self, pooled):
        projected = self.text_projection(pooled)
        return projected / projected.norm(dim=-1, keepdim=True)


vision_inner = VisionInner(model).eval()
vision_proj = VisionProjection(model).eval()
text_inner = TextInner(model).eval()
text_proj = TextProjection(model).eval()

print("[2/4] Exporting inner models + projections to ONNX...")

tmp_dir = REPO_ROOT / ".tmp_clip_export"
tmp_dir.mkdir(exist_ok=True)

# Export inner vision
vision_inner_out = tmp_dir / "vision_inner_fp32.onnx"
dummy_pixel = torch.randn(1, 3, 224, 224)
torch.onnx.export(
    vision_inner,
    dummy_pixel,
    str(vision_inner_out),
    input_names=["pixel_values"],
    output_names=["pooled"],
    dynamic_axes={"pixel_values": {0: "batch"}, "pooled": {0: "batch"}},
    opset_version=14,
)
print(f"   vision inner exported ({vision_inner_out.stat().st_size // 1024 // 1024} MB)")

# Export vision projection (kept in fp16)
vision_proj_out = tmp_dir / "vision_proj_fp16.onnx"
dummy_pooled = torch.randn(1, 768)
torch.onnx.export(
    vision_proj,
    dummy_pooled,
    str(vision_proj_out),
    input_names=["pooled"],
    output_names=["image_embeds"],
    dynamic_axes={"pooled": {0: "batch"}, "image_embeds": {0: "batch"}},
    opset_version=14,
)
print(f"   vision projection exported ({vision_proj_out.stat().st_size // 1024 // 1024} MB)")

# Export inner text
text_inner_out = tmp_dir / "text_inner_fp32.onnx"
dummy_ids = torch.zeros((1, 77), dtype=torch.long)
dummy_mask = torch.ones((1, 77), dtype=torch.long)
torch.onnx.export(
    text_inner,
    (dummy_ids, dummy_mask),
    str(text_inner_out),
    input_names=["input_ids", "attention_mask"],
    output_names=["pooled"],
    dynamic_axes={
        "input_ids": {0: "batch", 1: "sequence"},
        "attention_mask": {0: "batch", 1: "sequence"},
        "pooled": {0: "batch"},
    },
    opset_version=14,
)
print(f"   text inner exported ({text_inner_out.stat().st_size // 1024 // 1024} MB)")

# Export text projection
text_proj_out = tmp_dir / "text_proj_fp16.onnx"
dummy_pooled = torch.randn(1, 512)
torch.onnx.export(
    text_proj,
    dummy_pooled,
    str(text_proj_out),
    input_names=["pooled"],
    output_names=["text_embeds"],
    dynamic_axes={"pooled": {0: "batch"}, "text_embeds": {0: "batch"}},
    opset_version=14,
)
print(f"   text projection exported ({text_proj_out.stat().st_size // 1024 // 1024} MB)")

print("[3/4] Quantizing inner models to int8...")
from onnxruntime.quantization import quantize_dynamic, QuantType  # noqa: E402

vision_int8 = tmp_dir / "vision_int8.onnx"
text_int8 = tmp_dir / "text_int8.onnx"

quantize_dynamic(
    model_input=str(vision_inner_out),
    model_output=str(vision_int8),
    weight_type=QuantType.QInt8,
)
print(f"   vision inner int8: {vision_int8.stat().st_size // 1024 // 1024} MB")

quantize_dynamic(
    model_input=str(text_inner_out),
    model_output=str(text_int8),
    weight_type=QuantType.QInt8,
)
print(f"   text inner int8: {text_int8.stat().st_size // 1024 // 1024} MB")

print("[4/4] Copying to Android assets...")
shutil.copy(vision_int8, ASSETS_DIR / "clip-vision-int8.onnx")
shutil.copy(text_int8, ASSETS_DIR / "clip-text-int8.onnx")
shutil.copy(vision_proj_out, ASSETS_DIR / "clip-vision-proj-fp16.onnx")
shutil.copy(text_proj_out, ASSETS_DIR / "clip-text-proj-fp16.onnx")

shutil.rmtree(tmp_dir)

print(f"\n[OK] Exported to {ASSETS_DIR}")
for f in sorted(ASSETS_DIR.iterdir()):
    print(f"   {f.name}: {f.stat().st_size // 1024 // 1024} MB")

print("[4/4] Copying to Android assets...")
shutil.copy(vision_int8, ASSETS_DIR / "clip-vision-int8.onnx")
shutil.copy(text_int8, ASSETS_DIR / "clip-text-int8.onnx")

shutil.rmtree(tmp_dir)

print(f"\n[OK] Exported to {ASSETS_DIR}")
print(f"   vision: {(ASSETS_DIR / 'clip-vision-int8.onnx').stat().st_size // 1024 // 1024} MB")
print(f"   text:   {(ASSETS_DIR / 'clip-text-int8.onnx').stat().st_size // 1024 // 1024} MB")
