"""GIOP OCR service — extract meter serial and kWh reading from photos via PaddleOCR."""

import os
import tempfile
from functools import lru_cache
from typing import Any

import psycopg2
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from paddleocr import PaddleOCR
from PIL import Image

from ocr_parser import MeterExtraction, OcrLine, parse_meter_fields

load_dotenv()

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

SUPABASE_DB_URI = os.getenv("SUPABASE_DB_URI", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")

app = FastAPI(title="GIOP Meter OCR Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/jpg"}


@lru_cache(maxsize=1)
def get_ocr_engine() -> PaddleOCR:
    # PaddleOCR 3.x: show_log/use_angle_cls removed; enable_mkldnn=False avoids CPU OneDNN crash.
    return PaddleOCR(lang="en", enable_mkldnn=False)


def _parse_ocr_result(raw: Any) -> list[OcrLine]:
    lines: list[OcrLine] = []
    if not raw:
        return lines

    for page in raw:
        if isinstance(page, dict):
            texts = page.get("rec_texts") or []
            scores = page.get("rec_scores") or [1.0] * len(texts)
            for text, score in zip(texts, scores):
                if text:
                    lines.append(OcrLine(text=str(text), confidence=float(score)))
            continue

        # Legacy PaddleOCR 2.x nested list format
        if not page:
            continue
        for item in page:
            if not item or len(item) < 2:
                continue
            text, score = item[1][0], float(item[1][1])
            lines.append(OcrLine(text=text, confidence=score))

    return lines


def _run_ocr(image_bytes: bytes) -> list[OcrLine]:
    engine = get_ocr_engine()
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp.write(image_bytes)
        tmp_path = tmp.name

    try:
        # Normalize via Pillow (handles PNG/WebP uploads)
        with Image.open(tmp_path) as img:
            rgb = img.convert("RGB")
            rgb.save(tmp_path, format="JPEG")

        raw = engine.predict(tmp_path)
        return _parse_ocr_result(raw)
    finally:
        os.unlink(tmp_path)


def _lookup_meter_mrid(serial: str) -> str | None:
    conn = psycopg2.connect(SUPABASE_DB_URI)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT mrid::text FROM public.meters WHERE serial_number ILIKE %s LIMIT 1",
                (serial,),
            )
            row = cur.fetchone()
            return row[0] if row else None
    finally:
        conn.close()


def _extraction_response(ext: MeterExtraction) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "extracted_serial": ext.extracted_serial,
        "serial_confidence": ext.serial_confidence,
        "extracted_kwh": ext.extracted_kwh,
        "kwh_confidence": ext.kwh_confidence,
        "raw_lines": ext.raw_lines,
        "meter_mrid": None,
        "registry_match": False,
    }
    if ext.extracted_serial:
        mrid = _lookup_meter_mrid(ext.extracted_serial)
        if mrid:
            payload["meter_mrid"] = mrid
            payload["registry_match"] = True
    return payload


@app.get("/health")
def health():
    return {"status": "ok", "service": "giop-ocr"}


@app.post("/api/v1/meter/ocr")
async def meter_ocr(file: UploadFile = File(...)):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type: {file.content_type}. Use JPEG or PNG.",
        )

    image_bytes = await file.read()
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 10MB)")

    if len(image_bytes) < 100:
        raise HTTPException(status_code=400, detail="Empty or invalid image")

    try:
        lines = _run_ocr(image_bytes)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"OCR failed: {exc}") from exc

    if not lines:
        raise HTTPException(status_code=422, detail="No text detected in image")

    ext = parse_meter_fields(lines)
    if not ext.extracted_serial and ext.extracted_kwh is None:
        raise HTTPException(
            status_code=422,
            detail="Could not parse meter serial or kWh reading from detected text",
        )

    return _extraction_response(ext)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=5002, reload=True)
