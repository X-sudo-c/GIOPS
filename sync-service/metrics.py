"""In-process request metrics for APM widget (FR-018)."""

from __future__ import annotations

import statistics
import time
from collections import deque
from threading import Lock

_lock = Lock()
_latencies_ms: deque[float] = deque(maxlen=500)
_error_count = 0
_request_count = 0
_last_kafka_ingest_at: float | None = None


def record_request(duration_ms: float, is_error: bool = False) -> None:
    global _error_count, _request_count
    with _lock:
        _latencies_ms.append(duration_ms)
        _request_count += 1
        if is_error:
            _error_count += 1


def record_kafka_ingest() -> None:
    global _last_kafka_ingest_at
    with _lock:
        _last_kafka_ingest_at = time.time()


def snapshot() -> dict:
    with _lock:
        samples = list(_latencies_ms)
        total = _request_count
        errors = _error_count
        kafka_at = _last_kafka_ingest_at

    p50 = statistics.median(samples) if samples else 0.0
    p95 = 0.0
    if len(samples) >= 2:
        sorted_samples = sorted(samples)
        idx = min(len(sorted_samples) - 1, int(len(sorted_samples) * 0.95))
        p95 = sorted_samples[idx]
    elif samples:
        p95 = samples[0]

    error_rate = (errors / total * 100.0) if total else 0.0
    status = "green"
    if p95 > 500 or error_rate > 5:
        status = "red"
    elif p95 > 200 or error_rate > 1:
        status = "amber"

    return {
        "status": status,
        "request_count": total,
        "error_count": errors,
        "error_rate_pct": round(error_rate, 2),
        "latency_p50_ms": round(p50, 2),
        "latency_p95_ms": round(p95, 2),
        "last_kafka_ingest_at": kafka_at,
    }
