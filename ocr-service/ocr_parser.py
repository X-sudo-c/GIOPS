"""Parse PaddleOCR lines into meter serial numbers and kWh readings."""

import re
from dataclasses import dataclass

# Ghana utility meter serial patterns (extend as needed)
SERIAL_PATTERNS = [
    re.compile(r"ECG[-\s]?(\d{6,12})", re.IGNORECASE),
    re.compile(r"NEDCO[-\s]?(\d{6,12})", re.IGNORECASE),
    re.compile(r"GRIDCO[-\s]?(\d{6,12})", re.IGNORECASE),
    re.compile(r"\b([A-Z]{2,5}[-\s]?\d{6,12})\b", re.IGNORECASE),
]

KWH_PATTERN = re.compile(r"(\d{1,6}(?:\.\d{1,3})?)\s*(?:kwh|kw\.?h|k\s*w\s*h)?", re.IGNORECASE)


@dataclass
class OcrLine:
    text: str
    confidence: float


@dataclass
class MeterExtraction:
    extracted_serial: str | None
    serial_confidence: float | None
    extracted_kwh: float | None
    kwh_confidence: float | None
    raw_lines: list[dict]


def _normalize_serial(match: re.Match) -> str:
    raw = match.group(0).upper().replace(" ", "-")
    if "-" not in raw and len(raw) > 3:
        # ECG12345678 -> ECG-12345678
        prefix = re.match(r"^([A-Z]+)", raw)
        if prefix:
            return f"{prefix.group(1)}-{raw[len(prefix.group(1)):]}"
    return raw


def parse_meter_fields(lines: list[OcrLine]) -> MeterExtraction:
    best_serial: tuple[str, float] | None = None
    serial_line_indices: set[int] = set()
    kwh_labeled: list[tuple[float, float]] = []
    kwh_decimal: list[tuple[float, float]] = []
    kwh_plain: list[tuple[float, float]] = []

    for idx, line in enumerate(lines):
        text = line.text.strip()
        if not text:
            continue

        for pattern in SERIAL_PATTERNS:
            m = pattern.search(text)
            if m:
                serial = _normalize_serial(m)
                if not best_serial or line.confidence > best_serial[1]:
                    best_serial = (serial, line.confidence)
                serial_line_indices.add(idx)

        if idx in serial_line_indices:
            continue

        has_kwh_label = bool(re.search(r"kwh|kw\.?h", text, re.IGNORECASE))

        for m in KWH_PATTERN.finditer(text):
            try:
                value = float(m.group(1))
                if not (0 < value < 1_000_000):
                    continue
                if has_kwh_label:
                    kwh_labeled.append((value, line.confidence))
                elif "." in m.group(1):
                    kwh_decimal.append((value, line.confidence))
                else:
                    kwh_plain.append((value, line.confidence))
            except ValueError:
                continue

        if re.fullmatch(r"\d{1,6}\.\d{1,3}", text):
            value = float(text)
            if 0 < value < 1_000_000:
                kwh_decimal.append((value, line.confidence))

    extracted_kwh = None
    kwh_confidence = None
    for bucket in (kwh_labeled, kwh_decimal, kwh_plain):
        if bucket:
            extracted_kwh, kwh_confidence = max(bucket, key=lambda x: x[0])
            break

    return MeterExtraction(
        extracted_serial=best_serial[0] if best_serial else None,
        serial_confidence=best_serial[1] if best_serial else None,
        extracted_kwh=extracted_kwh,
        kwh_confidence=kwh_confidence,
        raw_lines=[{"text": ln.text, "confidence": round(ln.confidence, 4)} for ln in lines],
    )
