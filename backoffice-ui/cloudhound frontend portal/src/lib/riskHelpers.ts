import type { CloudHoundRiskScore } from '../api/cloudhound-api';

/**
 * Display-only helpers for risk scores.
 *
 * Risk scoring itself is owned exclusively by the backend
 * (`cf_solutions_backend/.../managers/risk_scorer.py`). The backend persists
 * and backfills per-entity scores in `serialize_launch_result_payload`, so the
 * frontend only ever filters/summarizes the scores it is given — it never
 * computes them.
 */

export function filterRiskScores(
  risks: CloudHoundRiskScore[],
  selectedBand: 'all' | 'critical' | 'high' | 'medium' | 'low',
  minScore: number,
): CloudHoundRiskScore[] {
  let filtered = risks;
  if (selectedBand !== 'all') {
    filtered = filtered.filter((risk) => (risk.risk_band || 'low') === selectedBand);
  }
  if (minScore > 0) {
    filtered = filtered.filter((risk) => Number(risk.score) >= minScore);
  }
  return filtered;
}
