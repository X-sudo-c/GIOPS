/**
 * GIOP sync-service API client
 */

const SYNC_BASE = import.meta.env.VITE_SYNC_URL || '/api/v1';
const OCR_BASE = import.meta.env.VITE_OCR_URL || '/ocr-api/api/v1';

export interface GiopTraceNode {
  mrid: string;
  name: string;
  type?: string[];
  connected: boolean;
  traced: boolean;
  validation?: string;
}

export interface GiopTraceEdge {
  mrid: string;
  source: string;
  target: string;
  phases?: string;
  voltage?: string;
  source_lon?: number;
  source_lat?: number;
  target_lon?: number;
  target_lat?: number;
}

export interface GiopTraceResponse {
  nodes: GiopTraceNode[];
  edges: GiopTraceEdge[];
  start_mrid: string;
  scope?: 'traced' | 'full';
  graph_totals?: { nodes: number; edges: number };
}

export interface GiopGraphChunkNode {
  mrid: string;
  name: string;
  lon: number;
  lat: number;
  validation?: string;
  connected: boolean;
  traced: boolean;
}

export interface GiopGraphChunkResponse {
  nodes: GiopGraphChunkNode[];
  edges: GiopTraceEdge[];
  bbox: { west: number; south: number; east: number; north: number };
  truncated: boolean;
  edges_truncated?: boolean;
  limit: number;
  edge_limit?: number;
}

export interface GiopStagingAsset {
  mrid: string;
  name?: string;
  validation?: string;
  nominal_voltage?: string;
  geom?: { type: string; coordinates: [number, number] } | null;
}

export interface GiopStagingResponse {
  assets: GiopStagingAsset[];
}

export interface GiopOcrResult {
  extracted_serial?: string;
  extracted_kwh?: number;
  meter_mrid?: string;
  serial_confidence?: number;
  kwh_confidence?: number;
  registry_match?: boolean;
  detail?: string;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = (err as { detail?: string }).detail || res.statusText;
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function getTrace(
  startMrid: string,
  scope: 'traced' | 'full' = 'traced',
): Promise<GiopTraceResponse> {
  const query = new URLSearchParams({ start_mrid: startMrid, scope });
  return fetchJson<GiopTraceResponse>(`${SYNC_BASE}/trace?${query}`);
}

export async function getGraphChunk(params: {
  west: number;
  south: number;
  east: number;
  north: number;
  limit?: number;
  startMrid?: string;
}): Promise<GiopGraphChunkResponse> {
  const query = new URLSearchParams({
    west: String(params.west),
    south: String(params.south),
    east: String(params.east),
    north: String(params.north),
    limit: String(params.limit ?? 2000),
  });
  if (params.startMrid) query.set('start_mrid', params.startMrid);
  return fetchJson<GiopGraphChunkResponse>(`${SYNC_BASE}/graph/chunk?${query}`);
}

export async function getStagingAssets(): Promise<GiopStagingAsset[]> {
  const data = await fetchJson<GiopStagingResponse>(`${SYNC_BASE}/assets/staging`);
  return data.assets ?? [];
}

export async function approveAsset(mrid: string): Promise<void> {
  await fetchJson(`${SYNC_BASE}/assets/${mrid}/validation`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ validation: 'APPROVED' }),
  });
}

export async function patchAssetName(mrid: string, name: string): Promise<void> {
  await fetchJson(`${SYNC_BASE}/assets/${mrid}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function patchAssetVoltage(
  mrid: string,
  nominalVoltage: string,
): Promise<void> {
  await fetchJson(`${SYNC_BASE}/assets/${mrid}/equipment`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nominal_voltage: nominalVoltage }),
  });
}

export async function repairTopology(targetMrid: string, radiusMeters = 50): Promise<unknown> {
  return fetchJson(`${SYNC_BASE}/topology/repair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_mrid: targetMrid, radius_meters: radiusMeters }),
  });
}

export async function submitMeterOcr(file: File): Promise<GiopOcrResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${OCR_BASE}/meter/ocr`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `OCR HTTP ${res.status}`);
  }
  return res.json() as Promise<GiopOcrResult>;
}

export async function submitTelemetry(meterMrid: string, activeEnergyKwh: number): Promise<unknown> {
  return fetchJson(`${SYNC_BASE}/telemetry/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meter_mrid: meterMrid, active_energy_kwh: activeEnergyKwh }),
  });
}

export interface GiopInspection {
  id: string;
  asset_mrid: string;
  ai_validation_status: string;
  evidence_photo_url?: string | null;
  inspected_at?: string | null;
}

export async function listInspections(assetMrid?: string): Promise<GiopInspection[]> {
  const query = assetMrid ? `?asset_mrid=${encodeURIComponent(assetMrid)}` : '';
  const data = await fetchJson<{ inspections: GiopInspection[] }>(`${SYNC_BASE}/inspections${query}`);
  return data.inspections ?? [];
}

export async function createInspection(params: {
  assetMrid: string;
  evidencePhotoUrl?: string;
  inspectorNotes?: string;
}): Promise<GiopInspection> {
  return fetchJson<GiopInspection>(`${SYNC_BASE}/inspections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      asset_mrid: params.assetMrid,
      evidence_photo_url: params.evidencePhotoUrl,
      inspector_notes: params.inspectorNotes,
    }),
  });
}

export const DEFAULT_START_MRID =
  import.meta.env.VITE_START_MRID || 'a0000000-0000-0000-0000-000000000001';

export interface GiopLineageEvent {
  id: number;
  target_mrid: string;
  source_type: string;
  action_type: string;
  operator_id?: string | null;
  provenance_ref?: string | null;
  before_state?: Record<string, unknown> | null;
  after_state?: Record<string, unknown> | null;
  created_at?: string | null;
}

export interface GiopConflictProposal {
  id: string;
  asset_mrid: string;
  asset_name?: string | null;
  offline_session_started_at?: string | null;
  server_updated_at?: string | null;
  proposed_payload?: Record<string, unknown>;
  status: string;
  created_at?: string | null;
}

export interface GiopDlqItem {
  id: string;
  source: string;
  payload: Record<string, unknown>;
  error_message: string;
  status: string;
  retry_count: number;
  created_at?: string | null;
}

export interface GiopHealthMetrics {
  status: 'green' | 'amber' | 'red';
  request_count: number;
  error_count: number;
  error_rate_pct: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  last_kafka_ingest_at?: number | null;
}

export interface GiopEnergyBalanceResult {
  id?: string | null;
  zone_key: string;
  period_start: string;
  period_end: string;
  energy_in_kwh: number;
  energy_out_kwh: number;
  variance_pct: number;
  anomaly_flag: boolean;
  meter_count?: number;
}

export async function getLineage(assetMrid: string, limit = 50): Promise<GiopLineageEvent[]> {
  const query = new URLSearchParams({ asset_mrid: assetMrid, limit: String(limit) });
  const data = await fetchJson<{ events: GiopLineageEvent[] }>(`${SYNC_BASE}/lineage?${query}`);
  return data.events ?? [];
}

export async function listConflicts(): Promise<GiopConflictProposal[]> {
  const data = await fetchJson<{ conflicts: GiopConflictProposal[] }>(`${SYNC_BASE}/conflicts`);
  return data.conflicts ?? [];
}

export async function resolveConflict(
  conflictId: string,
  resolution: 'master' | 'field' | 'discard',
): Promise<unknown> {
  return fetchJson(`${SYNC_BASE}/conflicts/${conflictId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolution }),
  });
}

export async function generateSchematic(mrid: string): Promise<string> {
  const res = await fetch(`${SYNC_BASE}/schematic/generate?mrid=${encodeURIComponent(mrid)}`);
  if (!res.ok) throw new Error(`Schematic HTTP ${res.status}`);
  return res.text();
}

export async function runEnergyBalance(params: {
  zoneKey: string;
  periodStart: string;
  periodEnd: string;
  nominalInjectionKwh?: number;
}): Promise<GiopEnergyBalanceResult> {
  return fetchJson<GiopEnergyBalanceResult>(`${SYNC_BASE}/analytics/energy-accounting/balance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      zone_key: params.zoneKey,
      period_start: params.periodStart,
      period_end: params.periodEnd,
      nominal_injection_kwh: params.nominalInjectionKwh,
    }),
  });
}

export async function listDlq(status = 'OPEN'): Promise<GiopDlqItem[]> {
  const data = await fetchJson<{ items: GiopDlqItem[] }>(`${SYNC_BASE}/dlq?status=${encodeURIComponent(status)}`);
  return data.items ?? [];
}

export async function retryDlq(dlqId: string): Promise<unknown> {
  return fetchJson(`${SYNC_BASE}/dlq/${dlqId}/retry`, { method: 'POST' });
}

export async function discardDlq(dlqId: string): Promise<unknown> {
  return fetchJson(`${SYNC_BASE}/dlq/${dlqId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'DISCARDED' }),
  });
}

export async function getHealthMetrics(): Promise<GiopHealthMetrics> {
  return fetchJson<GiopHealthMetrics>(`${SYNC_BASE}/health/metrics`);
}

// --- Operational modules (Phase 2) ---

export interface GiopContactCase {
  id: string;
  reference: string;
  channel: string;
  account_mrid?: string | null;
  classification: string;
  priority: number;
  status: string;
  assigned_to?: string | null;
  summary: string;
  notes?: string | null;
  created_at?: string | null;
  links?: Array<Record<string, string>>;
}

export interface GiopTroubleTicket {
  id: string;
  reference: string;
  source: string;
  ticket_type: string;
  severity: string;
  priority: number;
  status: string;
  assigned_to?: string | null;
  summary: string;
  resolution_code?: string | null;
  created_at?: string | null;
  links?: Array<Record<string, string>>;
}

export interface GiopWorkOrder {
  id: string;
  reference: string;
  work_type: string;
  priority: number;
  status: string;
  assigned_crew?: string | null;
  assigned_user?: string | null;
  summary: string;
  notes?: string | null;
  created_at?: string | null;
  links?: Array<Record<string, string>>;
}

export interface GiopOutage {
  id: string;
  reference: string;
  outage_type: string;
  status: string;
  started_at?: string | null;
  estimated_restoration_at?: string | null;
  restored_at?: string | null;
  affected_area?: string | null;
  feeder_id?: string | null;
  customers_affected: number;
  is_published: boolean;
  summary: string;
  links?: Array<Record<string, string>>;
}

export interface GiopRegulatoryMetrics {
  period_start: string;
  period_end: string;
  customer_base: number;
  outage_count: number;
  customer_minutes_interrupted: number;
  customers_affected_total: number;
  saidi_minutes: number;
  saifi_interruptions_per_customer: number;
  caidi_minutes: number;
  methodology_note?: string;
}

export async function listCases(status?: string): Promise<GiopContactCase[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  const data = await fetchJson<{ cases: GiopContactCase[] }>(`${SYNC_BASE}/cases${q}`);
  return data.cases ?? [];
}

export async function createCase(params: {
  channel: string;
  summary: string;
  classification?: string;
  priority?: number;
  account_mrid?: string;
  notes?: string;
}): Promise<GiopContactCase> {
  return fetchJson(`${SYNC_BASE}/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function convertCaseToTicket(caseId: string): Promise<GiopTroubleTicket> {
  return fetchJson(`${SYNC_BASE}/cases/${caseId}/convert-ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export async function convertCaseToWorkOrder(caseId: string): Promise<GiopWorkOrder> {
  return fetchJson(`${SYNC_BASE}/cases/${caseId}/convert-work-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assigned_user: 'tech.demo' }),
  });
}

export async function listTickets(status?: string): Promise<GiopTroubleTicket[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  const data = await fetchJson<{ tickets: GiopTroubleTicket[] }>(`${SYNC_BASE}/tickets${q}`);
  return data.tickets ?? [];
}

export async function patchTicket(
  ticketId: string,
  body: { status?: string; assigned_to?: string },
): Promise<GiopTroubleTicket> {
  return fetchJson(`${SYNC_BASE}/tickets/${ticketId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function listWorkOrders(status?: string): Promise<GiopWorkOrder[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  const data = await fetchJson<{ work_orders: GiopWorkOrder[] }>(`${SYNC_BASE}/work-orders${q}`);
  return data.work_orders ?? [];
}

export async function createWorkOrder(params: {
  summary: string;
  work_type?: string;
  assigned_user?: string;
  assigned_crew?: string;
}): Promise<GiopWorkOrder> {
  return fetchJson(`${SYNC_BASE}/work-orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function patchWorkOrder(
  workOrderId: string,
  body: { status?: string; assigned_user?: string },
): Promise<GiopWorkOrder> {
  return fetchJson(`${SYNC_BASE}/work-orders/${workOrderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function listOutages(publishedOnly = false): Promise<GiopOutage[]> {
  const q = publishedOnly ? '?published_only=true' : '';
  const data = await fetchJson<{ outages: GiopOutage[] }>(`${SYNC_BASE}/outages${q}`);
  return data.outages ?? [];
}

export async function createOutage(params: {
  summary: string;
  outage_type?: string;
  affected_area?: string;
  feeder_id?: string;
  customers_affected?: number;
  is_published?: boolean;
  create_ticket?: boolean;
}): Promise<GiopOutage> {
  return fetchJson(`${SYNC_BASE}/outages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function restoreOutage(outageId: string): Promise<GiopOutage> {
  return fetchJson(`${SYNC_BASE}/outages/${outageId}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export async function getRegulatoryMetrics(
  periodStart: string,
  periodEnd: string,
  customerBase = 10000,
): Promise<GiopRegulatoryMetrics> {
  const q = new URLSearchParams({
    period_start: periodStart,
    period_end: periodEnd,
    customer_base: String(customerBase),
  });
  return fetchJson<GiopRegulatoryMetrics>(`${SYNC_BASE}/regulatory/metrics?${q}`);
}

export async function generateRegulatoryReport(params: {
  periodStart: string;
  periodEnd: string;
  customerBase?: number;
}): Promise<{ id: string; metrics: GiopRegulatoryMetrics }> {
  return fetchJson(`${SYNC_BASE}/regulatory/reports/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      period_start: params.periodStart,
      period_end: params.periodEnd,
      customer_base: params.customerBase ?? 10000,
    }),
  });
}

function resolvePublicBaseUrl(raw: string | undefined, fallbackPath: string): string {
  const value = (raw || fallbackPath).replace(/\/$/, '');
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  const path = value.startsWith('/') ? value : `/${value}`;
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${path}`;
  }
  return `http://127.0.0.1:3001`;
}

/** Absolute base URL for Martin vector tiles (MapLibre workers reject relative paths). */
export const MARTIN_URL = resolvePublicBaseUrl(
  import.meta.env.VITE_MARTIN_URL,
  'http://127.0.0.1:3001',
);

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
