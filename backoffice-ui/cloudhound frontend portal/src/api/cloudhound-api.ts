/**
 * CloudHound Portal API Client
 * Typed HTTP client for CloudHound security portal endpoints
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

// ============================================================================
// Type Definitions
// ============================================================================

export type ScanChangeType = 'new' | 'changed' | 'resolved';

export interface CloudHoundFinding {
  id: string;
  finding_type: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  entity_type: string;
  entity_name: string;
  entity_arn: string;
  evidence: Record<string, unknown>;
  created_at: string;
  change_since_last_scan?: ScanChangeType;
  previous_severity?: string;
}

export interface CloudHoundScanDiffRow {
  id: string;
  change_type: ScanChangeType;
  finding_type: string;
  entity_name: string;
  fingerprint: string;
  previous_severity?: string | null;
  current_severity?: string | null;
  detail: Record<string, unknown>;
  created_at: string | null;
}

export interface CloudHoundScanDiffsResponse {
  result_id: string;
  scan_run_id: string | null;
  compare_to_result_id?: string;
  diff_counts: {
    new: number;
    changed: number;
    resolved: number;
  };
  previous_scan: {
    id: string;
    status: string;
    findings_count: number;
    started_at: string | null;
    completed_at: string | null;
  } | null;
  diffs: CloudHoundScanDiffRow[];
}

export interface CloudHoundRiskScore {
  id: string;
  entity_type: string;
  entity_name: string;
  entity_arn: string;
  score: number;
  risk_band?: 'critical' | 'high' | 'medium' | 'low';
  factors: Record<string, unknown>;
}

export interface CloudHoundRiskFilters {
  riskBands?: Array<'critical' | 'high' | 'medium' | 'low'>;
  minRiskScore?: number;
  riskLimit?: number;
}

export interface CloudHoundScanDiff {
  id: string;
  change_type: ScanChangeType;
  entity_type: string;
  entity_name: string;
  details: Record<string, unknown>;
}

export interface CloudHoundLaunchResultResponse {
  result_id: string;
  job_id: string;
  status: 'queued' | 'running' | 'pending' | 'success' | 'failed';
  current_step: string;
  progress_percent: number;
  findings: CloudHoundFinding[];
  risk_scores: CloudHoundRiskScore[];
  diff_counts?: {
    new: number;
    changed: number;
    resolved: number;
  };
  scan_diffs?: CloudHoundScanDiffRow[];
  diff_previous_scan?: CloudHoundScanDiffsResponse['previous_scan'];
  risk_summary?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    privilege_escalation_paths: number;
    external_trust_entities: number;
    high_value_targets: number;
    total: number;
  };
  scan_run?: {
    id: string;
    status: string;
    raw_s3_key: string;
    total_users: number;
    total_roles: number;
    total_policies: number;
    total_groups: number;
    findings_count: number;
    started_at: string | null;
    completed_at: string | null;
  } | null;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
}

export interface CloudHoundPortalGraphNode {
  id: string;
  label: string;
  name?: string;
  arn?: string;
  type: string;
  risk_level?: number;
  risk_band?: 'critical' | 'high' | 'medium' | 'low';
  risk_source?: string;
  graph_signal_level?: number;
  findings_risk_score?: number;
  findings_risk_band?: 'critical' | 'high' | 'medium' | 'low';
  properties?: Record<string, unknown> & {
    graph_signal_level?: number;
    findings_risk_score?: number;
    findings_risk_band?: 'critical' | 'high' | 'medium' | 'low';
  };
}

export interface CloudHoundPortalGraphEdge {
  id: string;
  source: string;
  target: string;
  relationship_type: string;
  properties?: Record<string, unknown>;
}

export interface CloudHoundPortalGraphResponse {
  configured: boolean;
  query_key: string;
  nodes: CloudHoundPortalGraphNode[];
  edges: CloudHoundPortalGraphEdge[];
  title?: string;
  metrics: {
    total_nodes?: number;
    total_edges?: number;
    high_risk_entities?: number;
    hvt_count?: number;
    external_trust_roles?: number;
    privilege_escalation_paths?: number;
    query_title?: string;
    query_mode?: string;
    note?: string;
  };
  detail?: string;
}

export interface CloudHoundGraphDirective {
  kind?: 'custom_query';
  query_key?: 'iam_topology' | 'privilege_escalation_paths' | 'hvt_entities' | 'external_trusts';
  label: string;
  title?: string;
  reason?: string;
  cypher?: string;
}

export interface CloudHoundPortalToolUser {
  id: string;
  cognito_user_id: string;
  email: string;
  is_active: boolean;
  is_admin: boolean;
  is_primary_admin: boolean;
  has_logged_in: boolean;
  is_logged_in: boolean;
  last_login_at: string | null;
  created_at: string | null;
}

interface CloudHoundPortalToolUsersResponse {
  users: CloudHoundPortalToolUser[];
  current_user: {
    id: string | null;
    is_admin: boolean;
  };
}

interface CloudHoundPortalToolUserUpsertResponse {
  user: CloudHoundPortalToolUser;
}

// ============================================================================
// Helper Functions
// ============================================================================

function readCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const prefix = `${name}=`;
  const cookies = document.cookie ? document.cookie.split(';') : [];
  for (const part of cookies) {
    const cookie = part.trim();
    if (cookie.startsWith(prefix)) {
      return decodeURIComponent(cookie.substring(prefix.length));
    }
  }
  return '';
}

function isUnsafeHttpMethod(method: string): boolean {
  const normalized = (method || 'GET').toUpperCase();
  return !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(normalized);
}

/** All portal calls send the CloudHound Cognito session cookie set by the backend OAuth callback. */
async function fetchFromAPI<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  const hasBody = options.body !== undefined && options.body !== null;
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  if (!headers.has('Content-Type') && hasBody && !isFormData) {
    headers.set('Content-Type', 'application/json');
  }

  if (isUnsafeHttpMethod(method)) {
    const csrfToken = readCookie('csrftoken');
    if (csrfToken && !headers.has('X-CSRFToken')) {
      headers.set('X-CSRFToken', csrfToken);
    }
  }

  const response = await fetch(url, {
    ...options,
    method,
    credentials: 'include',
    headers,
  });

  // Session expired or not authenticated — signal App to show login
  if (response.status === 401) {
    window.dispatchEvent(new Event('ch:unauthenticated'));
    throw new Error('Session expired. Please sign in again.');
  }

  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? '';
    let errorMessage = response.statusText;
    if (contentType.includes('application/json')) {
      try {
        const errorData = await response.json();
        errorMessage = errorData.detail || errorData.message || response.statusText;
      } catch {
        errorMessage = response.statusText;
      }
    }
    throw new Error(`API Error [${response.status}]: ${errorMessage}`);
  }

  return response.json() as Promise<T>;
}

// ============================================================================
// API Methods
// ============================================================================

export interface CloudHoundAccount {
  id: string;           // UUID — pass this as selected_aws_account_id
  name: string;
  aws_account_id: string;  // 12-digit AWS account number (display only)
  role_arn: string;
  is_admin: boolean;
  is_primary_admin: boolean;
}

/**
 * List all CustomerAccount records owned by the logged-in admin.
 */
export async function getCloudHoundAccounts(): Promise<CloudHoundAccount[]> {
  const payload = await fetchFromAPI<{ accounts: CloudHoundAccount[] }>(
    '/cloudhound/portal/accounts/',
  );
  return payload.accounts ?? [];
}

/**
 * Get latest CloudHound scan result for admin's selected AWS account
 */
export async function getCloudHoundLatestResult(
  params: {
    selectedAwsAccountId: string;
    filters?: CloudHoundRiskFilters;
  },
): Promise<CloudHoundLaunchResultResponse> {
  const query = new URLSearchParams({
    selected_aws_account_id: params.selectedAwsAccountId,
  });

  const riskBands = params.filters?.riskBands ?? [];
  if (riskBands.length > 0) {
    query.set('risk_bands', riskBands.join(','));
  }

  if (typeof params.filters?.minRiskScore === 'number') {
    query.set('min_risk_score', String(params.filters.minRiskScore));
  }

  if (typeof params.filters?.riskLimit === 'number') {
    query.set('risk_limit', String(params.filters.riskLimit));
  }

  return fetchFromAPI<CloudHoundLaunchResultResponse>(
    `/cloudhound/portal/latest-result/?${query.toString()}`,
  );
}

/**
 * Get scan diff rows for the latest (or specified) launch result.
 */
export async function getCloudHoundScanDiffs(params: {
  selectedAwsAccountId: string;
  resultId?: string;
  compareToResultId?: string;
}): Promise<CloudHoundScanDiffsResponse> {
  const query = new URLSearchParams({
    selected_aws_account_id: params.selectedAwsAccountId,
  });
  if (params.resultId) {
    query.set('result_id', params.resultId);
  }
  if (params.compareToResultId) {
    query.set('compare_to_result_id', params.compareToResultId);
  }
  return fetchFromAPI<CloudHoundScanDiffsResponse>(
    `/cloudhound/portal/scan-diffs/?${query.toString()}`,
  );
}

/**
 * Get graph data for CloudHound portal
 * query_key can be: 'iam_topology', 'privilege_escalation_paths', 'hvt_entities', 'external_trusts'
 */
export async function getCloudHoundGraph(params: {
  selectedAwsAccountId: string;
  queryKey: string;
}): Promise<CloudHoundPortalGraphResponse> {
  const queryString = new URLSearchParams({
    selected_aws_account_id: params.selectedAwsAccountId,
    query_key: params.queryKey,
  }).toString();

  return fetchFromAPI<CloudHoundPortalGraphResponse>(
    `/cloudhound/portal/graph/?${queryString}`,
  );
}

export async function executeCloudHoundGraphQuery(params: {
  selectedAwsAccountId: string;
  cypher: string;
  title?: string;
}): Promise<CloudHoundPortalGraphResponse> {
  return fetchFromAPI<CloudHoundPortalGraphResponse>(
    '/cloudhound/portal/graph/execute/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selected_aws_account_id: params.selectedAwsAccountId,
        cypher: params.cypher,
        title: params.title ?? '',
      }),
    },
  );
}

export interface CloudHoundToolUsersResult {
  users: CloudHoundPortalToolUser[];
  currentUserId: string | null;
  currentUserIsAdmin: boolean;
}

/**
 * Get list of tool users for admin's selected AWS account
 */
export async function getCloudHoundToolUsers(
  selectedAwsAccountId: string,
): Promise<CloudHoundToolUsersResult> {
  const payload = await fetchFromAPI<CloudHoundPortalToolUsersResponse>(
    `/cloudhound/portal/tool-users/?selected_aws_account_id=${encodeURIComponent(selectedAwsAccountId)}`,
  );
  return {
    users: payload.users || [],
    currentUserId: payload.current_user?.id ?? null,
    currentUserIsAdmin: payload.current_user?.is_admin ?? false,
  };
}

/**
 * Add a new tool user to the admin's selected AWS account
 */
export async function addCloudHoundToolUser(params: {
  selectedAwsAccountId: string;
  email: string;
  firstName?: string;
  lastName?: string;
}): Promise<CloudHoundPortalToolUser> {
  const payload = await fetchFromAPI<CloudHoundPortalToolUserUpsertResponse>(
    `/cloudhound/portal/tool-users/`,
    {
      method: 'POST',
      body: JSON.stringify({
        selected_aws_account_id: params.selectedAwsAccountId,
        email: params.email,
        first_name: params.firstName || '',
        last_name: params.lastName || '',
      }),
    },
  );

  return payload.user;
}

/**
 * Remove (deactivate) a tool user from the admin's selected AWS account
 */
export async function deleteCloudHoundToolUser(params: {
  selectedAwsAccountId: string;
  userId: string;
}): Promise<void> {
  const query = new URLSearchParams({
    selected_aws_account_id: params.selectedAwsAccountId,
    user_id: params.userId,
  }).toString();

  await fetchFromAPI<{ detail: string }>(
    `/cloudhound/portal/tool-users/?${query}`,
    {
      method: 'DELETE',
    },
  );
}

/**
 * Deactivate a tool user (blocks login and notifications)
 */
export async function deactivateCloudHoundToolUser(params: {
  selectedAwsAccountId: string;
  userId: string;
}): Promise<CloudHoundPortalToolUser> {
  const query = new URLSearchParams({
    selected_aws_account_id: params.selectedAwsAccountId,
    user_id: params.userId,
  }).toString();

  const payload = await fetchFromAPI<CloudHoundPortalToolUserUpsertResponse>(
    `/cloudhound/portal/tool-users/?${query}`,
    {
      method: 'PATCH',
    },
  );

  return payload.user;
}

/**
 * Set admin role for a tool user
 */
export async function setCloudHoundToolUserAdmin(params: {
  selectedAwsAccountId: string;
  userId: string;
  isAdmin: boolean;
}): Promise<CloudHoundPortalToolUser> {
  const query = new URLSearchParams({
    selected_aws_account_id: params.selectedAwsAccountId,
    user_id: params.userId,
    action: 'admin',
    is_admin: params.isAdmin ? 'true' : 'false',
  }).toString();

  const payload = await fetchFromAPI<CloudHoundPortalToolUserUpsertResponse>(
    `/cloudhound/portal/tool-users/?${query}`,
    {
      method: 'PATCH',
    },
  );

  return payload.user;
}

/**
 * Perform IAM action on graph entity (admin only)
 */
export interface IAMActionResponse {
  action: string;
  entity_arn: string;
  status: string;
  error?: string;
  preview_summary?: string;
  preview_items?: string[];
  removed_principals?: string[];
  removed_principal_count?: number;
  warning?: string;
  graph_sync?: string;
}

export async function performIAMGraphAction(params: {
  selectedAwsAccountId: string;
  action: 'disable_user' | 'delete_user' | 'detach_policy' | 'restrict_external_trust';
  entityArn: string;
  entityName?: string;
  entityType?: string;
  policyName?: string;
  dryRun?: boolean;
}): Promise<IAMActionResponse> {
  const query = new URLSearchParams({
    selected_aws_account_id: params.selectedAwsAccountId,
  }).toString();

  const body: Record<string, string> = {
    action: params.action,
    entity_arn: params.entityArn,
  };

  if (params.entityName) body.entity_name = params.entityName;
  if (params.entityType) body.entity_type = params.entityType;
  if (params.policyName) body.policy_name = params.policyName;
  if (params.dryRun) body.dry_run = 'true';

  return fetchFromAPI<IAMActionResponse>(
    `/cloudhound/portal/iam-action/?${query}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

/**
 * Find path between two IAM entities
 */
export interface CloudHoundPathFindingResponse {
  found: boolean;
  path: {
    nodes: CloudHoundPortalGraphNode[];
    edges: CloudHoundPortalGraphEdge[];
  };
  message: string;
}

export async function findCloudHoundPath(params: {
  selectedAwsAccountId: string;
  sourceArn: string;
  targetArn: string;
}): Promise<CloudHoundPathFindingResponse> {
  const query = new URLSearchParams({
    selected_aws_account_id: params.selectedAwsAccountId,
  }).toString();

  return fetchFromAPI<CloudHoundPathFindingResponse>(
    `/cloudhound/portal/find-path/?${query}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_arn: params.sourceArn,
        target_arn: params.targetArn,
      }),
    },
  );
}

/**
 * CloudHound AI chat
 */
export interface CloudHoundAIChatResponse {
  response: string;
  key_findings: string[];
  recommended_actions: string[];
  graph_directive?: CloudHoundGraphDirective;
  remediation_proposals?: Array<{
    proposal_id: string;
    title: string;
    description: string;
    action: 'detach_policy' | 'restrict_external_trust';
    entity_arn: string;
    entity_name: string;
    entity_type: 'User' | 'Role' | 'Group';
    policy_arn?: string;
    policy_name?: string;
    requires_confirmation: boolean;
  }>;
  evidence?: {
    account_id?: string;
    tools_used?: string[];
    graph_summary?: {
      node_count?: number;
      edge_count?: number;
      component_count?: number;
      largest_component_size?: number;
      high_risk_count?: number;
      hvt_count?: number;
      external_trust_count?: number;
      privileged_node_count?: number;
    };
    top_risk_entities?: Array<{
      entity_name?: string;
      entity_type?: string;
      score?: number;
    }>;
  };
  evidence_summary?: string;
  graph_context?: {
    node_count?: number;
    edge_count?: number;
    high_risk_count?: number;
    hvt_count?: number;
  };
  /** Present when the agentic tool-calling brain handled the request. */
  agent?: {
    provider?: string;
    model?: string;
    iterations?: number;
    tools_used?: string[];
    /** True when Auto mode picked the provider (vs. pinned single-provider). */
    auto?: boolean;
    /** Each entry is one provider attempt - last entry has status='ok' on success. */
    fallback_chain?: Array<{
      provider: string;
      model: string;
      status: 'ok' | 'error';
      error?: string;
    }>;
  } | null;
  account_id?: string;
  message?: string;
}

export async function chatWithCloudHoundAI(params: {
  selectedAwsAccountId: string;
  message: string;
  conversationContext?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Current graph view key (e.g. iam_topology, privilege_escalation_paths) so the AI reasons over what the user is actually looking at. */
  queryKey?: string;
  /** ARN of the node the user is focused on, when asking about a specific entity. */
  focusEntityArn?: string;
  /** ARNs currently visible in the graph viewport, to scope the AI's reasoning. */
  visibleEntityArns?: string[];
}): Promise<CloudHoundAIChatResponse> {
  return fetchFromAPI<CloudHoundAIChatResponse>(
    '/cloudhound/ai/chat/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selected_aws_account_id: params.selectedAwsAccountId,
        message: params.message,
        conversation_context: params.conversationContext ?? [],
        query_key: params.queryKey,
        focus_entity_arn: params.focusEntityArn,
        visible_entity_arns: params.visibleEntityArns,
      }),
    },
  );
}

export interface CloudHoundPolicyDocumentResponse {
  policy_arn: string;
  policy_name: string;
  default_version_id: string;
  document: Record<string, unknown>;
  update_date?: string;
  is_attachable?: boolean;
}

export async function getCloudHoundPolicyDocument(params: {
  selectedAwsAccountId: string;
  policyArn?: string;
  policyName?: string;
}): Promise<CloudHoundPolicyDocumentResponse> {
  const query = new URLSearchParams({
    selected_aws_account_id: params.selectedAwsAccountId,
  });
  if (params.policyArn) {
    query.set('policy_arn', params.policyArn);
  }
  if (params.policyName) {
    query.set('policy_name', params.policyName);
  }
  return fetchFromAPI<CloudHoundPolicyDocumentResponse>(`/cloudhound/ai/policy-document/?${query.toString()}`);
}

// ============================================================================
// Portal enhancements — triage, history, config
// ============================================================================

export type FindingTriageStatus = 'new' | 'acknowledged' | 'investigating' | 'resolved';

export interface FindingTriageResponse {
  statuses: Record<string, FindingTriageStatus>;
  counts: Record<FindingTriageStatus, number>;
}

export async function getCloudHoundFindingTriage(
  selectedAwsAccountId: string,
): Promise<FindingTriageResponse> {
  const query = new URLSearchParams({ selected_aws_account_id: selectedAwsAccountId }).toString();
  return fetchFromAPI<FindingTriageResponse>(`/cloudhound/portal/finding-triage/?${query}`);
}

export async function updateCloudHoundFindingTriage(params: {
  selectedAwsAccountId: string;
  findingId: string;
  status: FindingTriageStatus;
}): Promise<{ finding_id: string; status: FindingTriageStatus; updated_at: string | null }> {
  return fetchFromAPI(`/cloudhound/portal/finding-triage/`, {
    method: 'PATCH',
    body: JSON.stringify({
      selected_aws_account_id: params.selectedAwsAccountId,
      finding_id: params.findingId,
      status: params.status,
    }),
  });
}

export interface ScanHistorySeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface ScanHistoryDiffCounts {
  new: number;
  changed: number;
  resolved: number;
}

export interface ScanHistoryEntry {
  result_id: string;
  job_id: string;
  status: string;
  findings_count: number;
  critical_count: number;
  severity_counts: ScanHistorySeverityCounts;
  diff_counts: ScanHistoryDiffCounts | null;
  completed_at: string | null;
  started_at: string | null;
  error_message?: string | null;
}

export async function getCloudHoundScanHistory(
  selectedAwsAccountId: string,
  limit = 8,
): Promise<ScanHistoryEntry[]> {
  const query = new URLSearchParams({
    selected_aws_account_id: selectedAwsAccountId,
    limit: String(limit),
  }).toString();
  const payload = await fetchFromAPI<{ history: ScanHistoryEntry[] }>(
    `/cloudhound/portal/scan-history/?${query}`,
  );
  return payload.history ?? [];
}

export interface PortalAccountConfig {
  account: {
    id: string;
    name: string;
    aws_account_id: string;
    notification_email: string;
    has_slack_webhook: boolean;
  };
  schedule: {
    interval: string;
    interval_label: string;
    is_active: boolean;
    next_run_at: string | null;
    cron_expression: string;
  } | null;
  integrations: {
    neo4j_configured: boolean;
    github_connected: boolean;
    cognito_connected: boolean;
  };
}

export async function getCloudHoundAccountConfig(
  selectedAwsAccountId: string,
): Promise<PortalAccountConfig> {
  const query = new URLSearchParams({ selected_aws_account_id: selectedAwsAccountId }).toString();
  return fetchFromAPI<PortalAccountConfig>(`/cloudhound/portal/account-config/?${query}`);
}

export async function getGitHubStatus(): Promise<{ connected: boolean }> {
  try {
    const res = await fetch(`${API_BASE_URL}/cloudhound/github/status/`, { credentials: 'include' });
    if (!res.ok) return { connected: false };
    const data = await res.json();
    return { connected: Boolean(data?.connected ?? data?.authenticated) };
  } catch {
    return { connected: false };
  }
}

export function getGitHubLoginUrl(): string {
  return `${API_BASE_URL}/cloudhound/github/login-url/`;
}
