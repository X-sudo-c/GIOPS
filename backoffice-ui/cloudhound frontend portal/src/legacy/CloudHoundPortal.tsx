/**
 * CloudHound Security Portal Component
 * Professional security operations center with real-time monitoring
 */

import { useState, useEffect, useRef } from 'react';
import {
  getCloudHoundLatestResult,
  getCloudHoundGraph,
  executeCloudHoundGraphQuery,
  getCloudHoundToolUsers,
  chatWithCloudHoundAI,
  performIAMGraphAction,
  type IAMActionResponse,
  addCloudHoundToolUser,
  deactivateCloudHoundToolUser,
  deleteCloudHoundToolUser,
  setCloudHoundToolUserAdmin,
  getCloudHoundAccounts,
  getCloudHoundScanHistory,
  type CloudHoundAccount,
  type CloudHoundLaunchResultResponse,
  type CloudHoundPortalGraphResponse,
  type CloudHoundPortalToolUser,
  type CloudHoundFinding,
  type CloudHoundRiskScore,
  type CloudHoundAIChatResponse,
  type CloudHoundGraphDirective,
  type ScanHistoryEntry,
} from '../api/cloudhound-api';
import { AlertCircle, CheckCircle, Clock, TrendingUp, Users, AlertTriangle, Plus, Mail, Activity, ChevronDown, ChevronUp, ExternalLink, X, Sun, Moon, Sparkles, Bot, Network } from 'lucide-react';
import { CloudHoundGraphCanvas } from './CloudHoundGraphCanvas';
import { AssistantRichText } from './AssistantRichText';
import { ScanHistoryTrend } from './ScanHistoryTrend';
import { ScanCompareModal } from './ScanCompareModal';
import { useToasts, ToastStack } from './Toast';
import {
  readRouteFromLocation,
  writeRouteToLocation,
  subscribeToRouteChanges,
  type PortalTab as RoutePortalTab,
} from '../lib/portalRouting';

// ============================================================================
// Types
// ============================================================================

interface FormState {
  email: string;
  firstName: string;
  lastName: string;
}

interface IncidentState {
  [findingId: string]: {
    expanded: boolean;
    acknowledged: boolean;
    status: 'new' | 'investigating' | 'acknowledged' | 'resolved';
  };
}

interface RiskReferenceLink {
  label: string;
  url: string;
}

type AssistantEvidence = NonNullable<CloudHoundAIChatResponse['evidence']>;
type AssistantProposal = NonNullable<CloudHoundAIChatResponse['remediation_proposals']>[number];

interface AssistantAgentMeta {
  provider?: string;
  model?: string;
  iterations?: number;
  toolsUsed?: string[];
  auto?: boolean;
  fallbackChain?: Array<{
    provider: string;
    model: string;
    status: 'ok' | 'error';
    error?: string;
  }>;
}

interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  findings?: string[];
  actions?: string[];
  suggestionPrompts?: string[];
  modeSuggestions?: Array<{ mode: 'graph' | 'graph_chat'; label: string }>;
  evidence?: AssistantEvidence;
  evidenceSummary?: string;
  remediationProposals?: AssistantProposal[];
  agent?: AssistantAgentMeta;
}

interface GraphAiAssistRequest {
  nodeId: string;
  nodeTitle: string;
  prompt: string;
}

interface GraphAiNodeSession {
  messages: AssistantMessage[];
  draft: string;
  contextPrompt: string;
  nodeTitle: string;
  lastInstruction: string;
}

interface GraphAiOverlaySession {
  messages: AssistantMessage[];
  draft: string;
  contextPrompt: string;
  nodeTitle: string;
  lastInstruction: string;
}

type AssistantAccountSessions = Record<string, { messages: AssistantMessage[]; draft: string }>;

type GraphAiMode = 'node' | 'graph' | 'graph_chat';

type LocalGraphIntent =
  | 'focus_hvt'
  | 'focus_external_trust'
  | 'focus_dangerous_policy'
  | 'focus_roles_connected_dangerous_policy'
  | 'focus_dangerous_zone_hops'
  | 'focus_high_risk'
  | 'focus_privilege_escalation'
  | 'focus_connection_path'
  | 'focus_group_entities'
  | 'restore_full_view';

interface LocalGraphDirective {
  intent: LocalGraphIntent;
  includeNeighbors?: boolean;
  neighborHops?: 1 | 2 | 3;
  minRiskScore?: number;
  maxNodes?: number;
  sourceNodeQuery?: string;
  targetNodeQuery?: string;
  groupQuery?: string;
  reason?: string;
}

interface ProposalReviewState {
  proposal: AssistantProposal;
  summary: string;
  items: string[];
  warning?: string;
}

function stripEvidenceBlock(content: string, evidenceSummary?: string): string {
  if (!content) return content;
  if (evidenceSummary && content.endsWith(evidenceSummary)) {
    return content.slice(0, content.length - evidenceSummary.length).trimEnd();
  }

  const marker = '\n\nEvidence used:';
  const markerIndex = content.indexOf(marker);
  if (markerIndex >= 0) {
    return content.slice(0, markerIndex).trimEnd();
  }

  return content;
}

// ============================================================================
// UI Components
// ============================================================================

const Card: React.FC<{
  children: React.ReactNode;
  className?: string;
  isLightMode?: boolean;
}> = ({ children, className = '', isLightMode = false }) => (
  <div className={`${isLightMode ? 'bg-white border border-slate-200 shadow-[0_8px_22px_rgba(15,23,42,0.08)]' : 'bg-[#141a23] border border-[#2a3345]/75 shadow-[0_8px_22px_rgba(0,0,0,0.35)]'} rounded-lg p-5 ${className}`}>
    {children}
  </div>
);

const Badge: React.FC<{
  label: string;
  variant?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  isLightMode?: boolean;
}> = ({ label, variant = 'info', isLightMode = false }) => {
  const classes = {
    critical: isLightMode ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-red-950/70 text-red-300 border border-red-800/70',
    high: isLightMode ? 'bg-orange-50 text-orange-700 border border-orange-200' : 'bg-orange-950/70 text-orange-300 border border-orange-800/70',
    medium: isLightMode ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-amber-950/70 text-amber-300 border border-amber-800/70',
    low: isLightMode ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/70',
    info: isLightMode ? 'bg-slate-50 text-slate-700 border border-slate-200' : 'bg-slate-900/80 text-slate-300 border border-slate-700/70',
  };

  return (
    <span className={`px-2.5 py-0.5 rounded text-xs font-semibold ${classes[variant]}`}>
      {label}
    </span>
  );
};

const Alert: React.FC<{
  title: string;
  description?: string;
  type?: 'error' | 'warning' | 'info' | 'success';
  isLightMode?: boolean;
}> = ({ title, description, type = 'info', isLightMode = false }) => {
  const classes = {
    error: isLightMode ? 'bg-red-50 border-red-200 text-red-700' : 'bg-red-950/20 border-red-800/60 text-red-300',
    warning: isLightMode ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-amber-950/20 border-amber-800/60 text-amber-300',
    info: isLightMode ? 'bg-sky-50 border-sky-200 text-sky-700' : 'bg-sky-950/20 border-sky-800/60 text-sky-300',
    success: isLightMode ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-emerald-950/20 border-emerald-800/60 text-emerald-300',
  };

  const icons = {
    error: <AlertCircle className="w-5 h-5" />,
    warning: <AlertTriangle className="w-5 h-5" />,
    info: <Activity className="w-5 h-5" />,
    success: <CheckCircle className="w-5 h-5" />,
  };

  return (
    <div className={`border rounded-lg p-4 flex gap-3 ${classes[type]}`}>
      <div className="flex-shrink-0 mt-0.5">{icons[type]}</div>
      <div>
        <p className="font-semibold text-sm">{title}</p>
        {description && <p className="text-xs mt-1 opacity-80">{description}</p>}
      </div>
    </div>
  );
}

const AssistantEvidencePanel: React.FC<{
  evidence: AssistantEvidence;
  isLightMode?: boolean;
}> = ({ evidence, isLightMode = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const graphSummary = evidence.graph_summary || {};
  const statCards = [
    { label: 'Nodes', value: graphSummary.node_count ?? 0 },
    { label: 'Edges', value: graphSummary.edge_count ?? 0 },
    { label: 'Components', value: graphSummary.component_count ?? 0 },
    { label: 'High Risk', value: graphSummary.high_risk_count ?? 0 },
  ];
  const evidenceCount = evidence.top_risk_entities?.length ?? 0;

  return (
    <div className={`mt-3 rounded-xl border ${isLightMode ? 'border-slate-300 bg-white/80' : 'border-sky-400/20 bg-[#0d1624]/90'} p-3`}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1 text-left transition ${isLightMode ? 'text-slate-700 hover:text-slate-900' : 'text-slate-200 hover:text-white'}`}
        aria-expanded={isOpen}
      >
        <div className="min-w-0">
          <p className={`text-[11px] uppercase tracking-[0.24em] ${isLightMode ? 'text-slate-600' : 'text-sky-200/80'}`}>Evidence</p>
          <p className={`mt-1 text-xs ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>
            {graphSummary.node_count ?? 0} nodes, {graphSummary.edge_count ?? 0} edges, {evidenceCount} top-risk entities
          </p>
        </div>
        <div className="flex items-center gap-2">
          {evidence.account_id && (
            <span className={`hidden rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.2em] md:inline-flex ${isLightMode ? 'border-slate-300 bg-slate-100 text-slate-700' : 'border-sky-400/20 bg-sky-500/10 text-sky-100'}`}>
              {evidence.account_id}
            </span>
          )}
          {isOpen ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
        </div>
      </button>

      {isOpen && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {statCards.map((item) => (
              <div key={item.label} className={`rounded-lg border px-3 py-2 ${isLightMode ? 'border-slate-200 bg-slate-50' : 'border-white/8 bg-white/5'}`}>
                <p className={`text-[10px] uppercase tracking-[0.2em] ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>{item.label}</p>
                <p className={`mt-1 text-lg font-light ${isLightMode ? 'text-slate-900' : 'text-slate-50'}`}>{item.value}</p>
              </div>
            ))}
          </div>

          {evidence.tools_used && evidence.tools_used.length > 0 && (
            <div className="mt-3">
              <p className={`text-[11px] uppercase tracking-widest mb-2 ${isLightMode ? 'text-slate-500' : 'text-[#8fa0bb]'}`}>Tools Used</p>
              <div className="flex flex-wrap gap-2">
                {evidence.tools_used.map((tool) => (
                  <span
                    key={tool}
                    className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${isLightMode ? 'border-slate-300 bg-slate-100 text-slate-700' : 'border-[#334159] bg-[#111925] text-[#c9d4e8]'}`}
                  >
                    {tool.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {evidence.top_risk_entities && evidence.top_risk_entities.length > 0 && (
            <div className="mt-3">
              <p className={`text-[11px] uppercase tracking-widest mb-2 ${isLightMode ? 'text-slate-500' : 'text-[#8fa0bb]'}`}>Top Risk Evidence</p>
              <div className="space-y-2">
                {evidence.top_risk_entities.slice(0, 3).map((item) => (
                  <div
                    key={`${item.entity_name}-${item.entity_type}`}
                    className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${isLightMode ? 'border-slate-200 bg-slate-50' : 'border-white/8 bg-white/5'}`}
                  >
                    <div className="min-w-0">
                      <p className={`truncate text-sm ${isLightMode ? 'text-slate-900' : 'text-slate-100'}`}>{item.entity_name || 'Unknown entity'}</p>
                      <p className={`text-[11px] uppercase tracking-[0.18em] ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>{item.entity_type || 'unknown'}</p>
                    </div>
                    <div className={`shrink-0 text-sm font-light ${isLightMode ? 'text-rose-700' : 'text-rose-300'}`}>
                      {(item.score ?? 0).toFixed(1)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const ProposalReviewDialog: React.FC<{
  review: ProposalReviewState;
  isApplying: boolean;
  isLightMode?: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}> = ({ review, isApplying, isLightMode = false, onClose, onConfirm }) => {
  const { proposal, summary, items, warning } = review;
  const isTrustRestriction = proposal.action === 'restrict_external_trust';
  const scopeLabel = isTrustRestriction
    ? `${proposal.entity_type} ${proposal.entity_name}`
    : `${proposal.entity_type} ${proposal.entity_name} <- ${proposal.policy_name}`;
  const impactItems = items.length > 0
    ? items
    : isTrustRestriction
      ? [
          'Remove AWS principals that belong to other AWS accounts.',
          'Preserve same-account principals and leave non-AWS principals untouched.',
          'Refuse the action if it would wipe out the role trust policy entirely.',
        ]
      : [
          'Detach the selected managed policy from the target principal.',
          'Reduce inherited permissions coming from that policy attachment.',
          'Sync the graph projection after the IAM change is applied.',
        ];

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/72 px-4 backdrop-blur-sm">
      <div className={`w-full max-w-2xl rounded-2xl border p-5 shadow-[0_24px_80px_rgba(15,23,42,0.5)] ${isLightMode ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-700 bg-slate-950 text-slate-100'}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className={`text-[11px] uppercase tracking-[0.24em] ${isLightMode ? 'text-slate-500' : 'text-sky-300/75'}`}>Review AI Remediation</p>
            <h3 className="mt-1 text-lg font-semibold">{proposal.title}</h3>
            <p className={`mt-2 text-sm leading-6 ${isLightMode ? 'text-slate-600' : 'text-slate-300'}`}>{summary}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isApplying}
            className={`rounded-full border px-3 py-1 text-xs transition ${isLightMode ? 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:text-slate-400' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-white disabled:text-slate-500'}`}
          >
            Close
          </button>
        </div>

        <div className={`mt-4 rounded-xl border p-4 ${isLightMode ? 'border-slate-200 bg-slate-50' : 'border-slate-800 bg-slate-900/80'}`}>
          <p className={`text-[11px] uppercase tracking-[0.2em] ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>Target</p>
          <p className="mt-1 text-sm font-medium">{scopeLabel}</p>
          <p className={`mt-3 text-[11px] uppercase tracking-[0.2em] ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>Action</p>
          <p className="mt-1 text-sm font-medium">{proposal.action.replace(/_/g, ' ')}</p>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
          <div className={`rounded-xl border p-4 ${isLightMode ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900/60'}`}>
            <p className={`text-[11px] uppercase tracking-[0.2em] ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>Planned Changes</p>
            <ul className={`mt-3 ml-5 list-disc space-y-2 text-sm leading-6 ${isLightMode ? 'text-slate-700' : 'text-slate-200'}`}>
              {impactItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <div className={`rounded-xl border p-4 ${isLightMode ? 'border-amber-200 bg-amber-50' : 'border-amber-500/25 bg-amber-500/10'}`}>
            <p className={`text-[11px] uppercase tracking-[0.2em] ${isLightMode ? 'text-amber-700' : 'text-amber-200/80'}`}>Operator Check</p>
            <p className={`mt-3 text-sm leading-6 ${isLightMode ? 'text-amber-900' : 'text-amber-100'}`}>
              {warning || 'Confirm this change matches the intended least-privilege outcome for the selected account. This action applies directly to AWS IAM.'}
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isApplying}
            className={`rounded-lg border px-4 py-2 text-sm transition ${isLightMode ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-white disabled:text-slate-500'}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isApplying}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition ${isLightMode ? 'bg-slate-900 hover:bg-slate-700 disabled:bg-slate-400' : 'bg-orange-500 hover:bg-orange-400 disabled:bg-slate-700'} disabled:cursor-not-allowed`}
          >
            {isApplying ? 'Applying...' : 'Confirm and Apply'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Main Portal Component
// ============================================================================

interface CloudHoundPortalProps {
  loggedInUserName?: string;
  onLogout?: () => void | Promise<void>;
}

type PortalTab = 'results' | 'graph' | 'assistant' | 'access';
const ACTIVE_TAB_STORAGE_KEY = 'cloudhound.portal.activeTab.v1';
const THEME_STORAGE_KEY = 'cloudhound.portal.theme.v1';
const AI_ASSISTANT_SESSIONS_STORAGE_KEY = 'cloudhound.portal.aiAssistantSessions.v1';
const GRAPH_AI_NODE_SESSIONS_STORAGE_KEY = 'cloudhound.portal.graphAiNodeSessions.v1';
const GRAPH_AI_OVERLAY_SESSIONS_STORAGE_KEY = 'cloudhound.portal.graphAiOverlaySessions.v1';
const MIN_THINKING_BUBBLE_MS = 450;

function readSavedPortalTab(): PortalTab {
  if (typeof window === 'undefined') return 'results';
  try {
    const raw = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    if (raw === 'graph' || raw === 'access' || raw === 'results' || raw === 'assistant') return raw;
    return 'results';
  } catch {
    return 'results';
  }
}

function readSavedPortalTheme(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light') return true;
    if (raw === 'dark') return false;
  } catch {
    // Ignore storage failures and fall back to system preference.
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ?? false;
}

function readSavedJson<T>(storageKey: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export const CloudHoundPortal: React.FC<CloudHoundPortalProps> = ({ loggedInUserName, onLogout }) => {
  // State
  const [selectedAwsAccountId, setSelectedAwsAccountId] = useState<string>('');
  const [accountList, setAccountList] = useState<CloudHoundAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState<boolean>(true);
  const [latestResult, setLatestResult] = useState<CloudHoundLaunchResultResponse | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanHistoryEntry[]>([]);
  const [scanHistoryLoading, setScanHistoryLoading] = useState<boolean>(false);
  const [graph, setGraph] = useState<CloudHoundPortalGraphResponse | null>(null);
  const [insightGraph, setInsightGraph] = useState<CloudHoundPortalGraphResponse | null>(null);
  const [toolUsers, setToolUsers] = useState<CloudHoundPortalToolUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PortalTab>(() => readSavedPortalTab());
  const [isLightMode, setIsLightMode] = useState<boolean>(() => readSavedPortalTheme());
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [selectedRiskBand, setSelectedRiskBand] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all');
  const [minRiskScore, setMinRiskScore] = useState<number>(0);
  const [selectedRiskEntity, setSelectedRiskEntity] = useState<CloudHoundRiskScore | null>(null);
  const [isRiskDrawerOpen, setIsRiskDrawerOpen] = useState<boolean>(false);
  const [selectedGraphQuery, setSelectedGraphQuery] = useState<string>('iam_topology');
  const [activeGraphDirective, setActiveGraphDirective] = useState<CloudHoundGraphDirective | null>(null);
  const [graphSnapshot, setGraphSnapshot] = useState<CloudHoundPortalGraphResponse | null>(null);
  const [activeAccessSection, setActiveAccessSection] = useState<'users' | 'configuration' | 'integrations'>('users');
  const [formState, setFormState] = useState<FormState>({ email: '', firstName: '', lastName: '' });
  const [loading, setLoading] = useState<boolean>(false);
  const [isAddingUser, setIsAddingUser] = useState<boolean>(false);
  const [actingUserId, setActingUserId] = useState<string>('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [aiMessages, setAiMessages] = useState<AssistantMessage[]>([]);
  const [assistantSessionsByAccount, setAssistantSessionsByAccount] = useState<AssistantAccountSessions>(() =>
    readSavedJson<AssistantAccountSessions>(AI_ASSISTANT_SESSIONS_STORAGE_KEY, {})
  );
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [copilotOpen, setCopilotOpen] = useState<boolean>(false);
  const [copilotDraft, setCopilotDraft] = useState<string>('');
  const [focusNodeArn, setFocusNodeArn] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState<boolean>(false);
  const { toasts, showToast, dismissToast } = useToasts();
  const [graphAiOpen, setGraphAiOpen] = useState<boolean>(false);
  const [graphAiMode, setGraphAiMode] = useState<GraphAiMode>('node');
  const [graphAiNodeId, setGraphAiNodeId] = useState<string | null>(null);
  const [graphAiNodeTitle, setGraphAiNodeTitle] = useState<string>('');
  const [graphAiContextPrompt, setGraphAiContextPrompt] = useState<string>('');
  const [graphAiDraft, setGraphAiDraft] = useState<string>('');
  const [graphAiMessages, setGraphAiMessages] = useState<AssistantMessage[]>([]);
  const [graphAiLastInstruction, setGraphAiLastInstruction] = useState<string>('');
  const [graphAiLoading, setGraphAiLoading] = useState<boolean>(false);
  const [graphAiNodeSessions, setGraphAiNodeSessions] = useState<Record<string, GraphAiNodeSession>>(() =>
    readSavedJson<Record<string, GraphAiNodeSession>>(GRAPH_AI_NODE_SESSIONS_STORAGE_KEY, {})
  );
  const [graphAiOverlaySessions, setGraphAiOverlaySessions] = useState<Record<string, GraphAiOverlaySession>>(() =>
    readSavedJson<Record<string, GraphAiOverlaySession>>(GRAPH_AI_OVERLAY_SESSIONS_STORAGE_KEY, {})
  );
  const [applyingProposalId, setApplyingProposalId] = useState<string>('');
  const [reviewingProposalId, setReviewingProposalId] = useState<string>('');
  const [proposalReview, setProposalReview] = useState<ProposalReviewState | null>(null);
  const [appliedProposalIds, setAppliedProposalIds] = useState<Set<string>>(new Set());
  const [incidentStates, setIncidentStates] = useState<IncidentState>({});
  const riskDrawerCloseTimer = useRef<number | null>(null);
  const selectedAccount = accountList.find((account) => account.id === selectedAwsAccountId);
  const canAccessControl = Boolean(selectedAccount?.is_admin);
  const isGraphOverlayMode = graphAiOpen && (graphAiMode === 'graph' || graphAiMode === 'graph_chat');
  const accountRoleLabel = selectedAccount?.is_primary_admin
    ? 'Main Admin'
    : selectedAccount?.is_admin
      ? 'Admin'
      : 'Member';
  const accountRoleInitial = accountRoleLabel.charAt(0).toUpperCase();
  
  // Graph tab should rely on account-level role (always available), not tool-users tab state.
  const currentUserIsAdmin = Boolean(selectedAccount?.is_admin);

  const goToSection = (tab: PortalTab, accessSection?: 'users' | 'configuration' | 'integrations') => {
    setActiveTab(tab);
    if (accessSection) {
      setActiveAccessSection(accessSection);
    }
  };

  const buildGraphAiNodeSessionKey = (nodeId: string) => `${selectedAwsAccountId || 'no-account'}::${nodeId}`;
  const buildGraphAiOverlaySessionKey = (mode: 'graph' | 'graph_chat') => `${selectedAwsAccountId || 'no-account'}::${mode}`;

  useEffect(() => {
    if (!selectedAwsAccountId) return;
    const saved = assistantSessionsByAccount[selectedAwsAccountId];
    setAiMessages(saved?.messages || []);
    setAiPrompt(saved?.draft || '');
  }, [selectedAwsAccountId]);

  useEffect(() => {
    if (!selectedAwsAccountId) return;
    setAssistantSessionsByAccount((prev) => ({
      ...prev,
      [selectedAwsAccountId]: {
        messages: aiMessages,
        draft: aiPrompt,
      },
    }));
  }, [selectedAwsAccountId, aiMessages, aiPrompt]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(AI_ASSISTANT_SESSIONS_STORAGE_KEY, JSON.stringify(assistantSessionsByAccount));
    } catch {
      // Ignore storage failures.
    }
  }, [assistantSessionsByAccount]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(GRAPH_AI_NODE_SESSIONS_STORAGE_KEY, JSON.stringify(graphAiNodeSessions));
    } catch {
      // Ignore storage failures.
    }
  }, [graphAiNodeSessions]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(GRAPH_AI_OVERLAY_SESSIONS_STORAGE_KEY, JSON.stringify(graphAiOverlaySessions));
    } catch {
      // Ignore storage failures.
    }
  }, [graphAiOverlaySessions]);

  const loadSelectedGraph = async (
    accountId: string,
    queryKey: string,
    directive?: CloudHoundGraphDirective | null,
  ): Promise<CloudHoundPortalGraphResponse> => {
    if (queryKey === 'ai_query' && directive?.cypher) {
      return executeCloudHoundGraphQuery({
        selectedAwsAccountId: accountId,
        cypher: directive.cypher,
        title: directive.title || directive.label,
      });
    }

    return getCloudHoundGraph({
      selectedAwsAccountId: accountId,
      queryKey,
    });
  };

  const selectGraphQuery = (queryKey: string) => {
    setActiveGraphDirective(null);
    setSelectedGraphQuery(queryKey);
  };

  const refreshGraphSnapshots = async () => {
    if (!selectedAwsAccountId) return;
    try {
      const [topologyGraph, activeGraph] = await Promise.all([
        getCloudHoundGraph({
          selectedAwsAccountId,
          queryKey: 'iam_topology',
        }),
        loadSelectedGraph(selectedAwsAccountId, selectedGraphQuery, activeGraphDirective),
      ]);
      setInsightGraph(topologyGraph);
      setGraph(activeGraph);
      setGraphSnapshot(activeGraph);
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        graph: err instanceof Error ? err.message : 'Failed to refresh graph after IAM action.',
      }));
    }
  };

  const buildProposalReviewState = (proposal: AssistantProposal, response: IAMActionResponse): ProposalReviewState => ({
    proposal,
    summary: response.preview_summary || proposal.description,
    items: response.preview_items || [],
    warning: response.warning,
  });

  const closeProposalReview = () => {
    setProposalReview(null);
    setReviewingProposalId('');
  };

  const executeAiProposal = async (proposal: AssistantProposal) => {
    if (!selectedAwsAccountId || applyingProposalId) return;
    setApplyingProposalId(proposal.proposal_id);
    try {
      await performIAMGraphAction({
        selectedAwsAccountId,
        action: proposal.action,
        entityArn: proposal.entity_arn,
        entityName: proposal.entity_name,
        entityType: proposal.entity_type,
        policyName: proposal.policy_arn,
      });
      setAppliedProposalIds((prev) => new Set(prev).add(proposal.proposal_id));
      setSuccessMessage(`Applied AI proposal: ${proposal.title}`);
      closeProposalReview();
      await refreshGraphSnapshots();
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        ai: err instanceof Error ? err.message : 'Failed to apply AI proposal.',
      }));
    } finally {
      setApplyingProposalId('');
    }
  };

  const applyAiProposal = async (proposal: AssistantProposal) => {
    if (!selectedAwsAccountId || applyingProposalId || reviewingProposalId) return;
    if (!proposal.requires_confirmation) {
      await executeAiProposal(proposal);
      return;
    }

    setReviewingProposalId(proposal.proposal_id);
    try {
      const preview = await performIAMGraphAction({
        selectedAwsAccountId,
        action: proposal.action,
        entityArn: proposal.entity_arn,
        entityName: proposal.entity_name,
        entityType: proposal.entity_type,
        policyName: proposal.policy_arn,
        dryRun: true,
      });
      setProposalReview(buildProposalReviewState(proposal, preview));
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        ai: err instanceof Error ? err.message : 'Failed to preview AI proposal.',
      }));
      setReviewingProposalId('');
    }
  };

  const buildAssistantReplyMessage = (response: CloudHoundAIChatResponse): AssistantMessage => ({
    role: 'assistant',
    content: stripEvidenceBlock(response.response || 'No response returned from assistant.', response.evidence_summary),
    findings: response.key_findings || [],
    actions: response.recommended_actions || [],
    evidence: response.evidence,
    evidenceSummary: response.evidence_summary,
    remediationProposals: response.remediation_proposals || [],
    agent: response.agent
      ? {
          provider: response.agent.provider,
          model: response.agent.model,
          iterations: response.agent.iterations,
          toolsUsed: response.agent.tools_used || [],
          auto: response.agent.auto,
          fallbackChain: response.agent.fallback_chain,
        }
      : undefined,
  });

  const ALLOWED_GRAPH_QUERY_KEYS = new Set([
    'iam_topology',
    'privilege_escalation_paths',
    'hvt_entities',
    'external_trusts',
  ]);

  const ensureAccountScopedCypher = (cypher: string): string => {
    const prepared = (cypher || '').trim();
    if (!prepared) return prepared;
    if (prepared.includes('$account_id')) return prepared;

    const returnMatch = prepared.match(/\bRETURN\b/i);
    if (!returnMatch || typeof returnMatch.index !== 'number') {
      return prepared;
    }

    const beforeReturn = prepared.slice(0, returnMatch.index).trimEnd();
    const afterReturn = prepared.slice(returnMatch.index);

    const aliasMatch = beforeReturn.match(/\b(?:OPTIONAL\s+)?MATCH\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/i);
    const alias = aliasMatch?.[1] || 'n';
    const scopeClause = `${alias}.account_id = $account_id`;
    const hasWhereClause = /\bWHERE\b/i.test(beforeReturn);

    if (hasWhereClause) {
      return `${beforeReturn} AND ${scopeClause} ${afterReturn}`.trim();
    }

    return `${beforeReturn} WHERE ${scopeClause} ${afterReturn}`.trim();
  };

  const extractCypherFromText = (value?: string | null): string | null => {
    const text = (value || '').trim();
    if (!text) return null;

    const fencedMatch = text.match(/```(?:cypher)?\s*([\s\S]*?)```/i);
    const candidate = (fencedMatch?.[1] || text).trim();
    if (!candidate) return null;

    // Basic safety gate for graph-query intent.
    const normalized = candidate.toLowerCase();
    if (!normalized.includes('match') || !normalized.includes('return')) {
      return null;
    }

    // Keep payload bounded to avoid accidentally applying huge generated text.
    return ensureAccountScopedCypher(candidate.slice(0, 4000));
  };

  const resolveGraphDirectiveFromResponse = (response: CloudHoundAIChatResponse): CloudHoundGraphDirective | null => {
    const directive = response.graph_directive;
    if (directive?.cypher || directive?.query_key) {
      return directive;
    }

    const fallbackCypher = extractCypherFromText(response.response);
    if (!fallbackCypher) {
      return null;
    }

    return {
      kind: 'custom_query',
      label: 'AI generated custom graph query',
      title: 'AI focused graph view',
      reason: 'Applied Cypher query parsed from assistant response.',
      cypher: fallbackCypher,
    };
  };

  const applyGraphDirective = (directive: CloudHoundGraphDirective | null): boolean => {
    if (!directive) return false;

    if (directive.cypher) {
      const scopedCypher = ensureAccountScopedCypher(directive.cypher);
      setActiveGraphDirective({ ...directive, cypher: scopedCypher });
      setSelectedGraphQuery('ai_query');
      setActiveTab('graph');
      setSuccessMessage(directive.reason || `Graph updated: ${directive.label}`);
      return true;
    }

    if (directive.query_key && ALLOWED_GRAPH_QUERY_KEYS.has(directive.query_key)) {
      setActiveGraphDirective(null);
      setSelectedGraphQuery(directive.query_key);
      setActiveTab('graph');
      setSuccessMessage(directive.reason || `Graph updated: ${directive.label}`);
      return true;
    }

    return false;
  };

  const sendAiPrompt = async ({
    displayPrompt,
    requestPrompt,
    currentMessages,
    setMessages,
    setLoading,
    clearDraft,
  }: {
    displayPrompt: string;
    requestPrompt?: string;
    currentMessages: AssistantMessage[];
    setMessages: React.Dispatch<React.SetStateAction<AssistantMessage[]>>;
    setLoading: React.Dispatch<React.SetStateAction<boolean>>;
    clearDraft: () => void;
  }) => {
    const visiblePrompt = displayPrompt.trim();
    const actualPrompt = (requestPrompt || displayPrompt).trim();
    if (!visiblePrompt || !actualPrompt || !selectedAwsAccountId) return;
    const startedAt = Date.now();

    const nextMessages = [...currentMessages, { role: 'user' as const, content: visiblePrompt }];
    setMessages(nextMessages);
    clearDraft();
    setLoading(true);

    try {
      const visibleEntityArns = (graph?.nodes || [])
        .map((node) => (typeof node.arn === 'string' ? node.arn : ''))
        .filter((arn): arn is string => Boolean(arn))
        .slice(0, 200);

      const response = await chatWithCloudHoundAI({
        selectedAwsAccountId,
        message: actualPrompt,
        conversationContext: nextMessages.map((item) => ({ role: item.role, content: item.content })),
        queryKey: selectedGraphQuery === 'ai_query' ? undefined : selectedGraphQuery,
        focusEntityArn: focusNodeArn || undefined,
        visibleEntityArns,
      });

      applyGraphDirective(resolveGraphDirectiveFromResponse(response));

      setMessages((prev) => [...prev, buildAssistantReplyMessage(response)]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: err instanceof Error ? err.message : 'Failed to get AI response.',
        },
      ]);
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_THINKING_BUBBLE_MS) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, MIN_THINKING_BUBBLE_MS - elapsed);
        });
      }
      setLoading(false);
    }
  };

  const runAiPrompt = async (prompt: string) => {
    if (aiLoading) return;
    await sendAiPrompt({
      displayPrompt: prompt,
      currentMessages: aiMessages,
      setMessages: setAiMessages,
      setLoading: setAiLoading,
      clearDraft: () => setAiPrompt(''),
    });
  };

  const viewInTopology = (entityArn: string, graphQuery = 'iam_topology') => {
    if (!entityArn) return;
    setFocusNodeArn(entityArn);
    setSelectedGraphQuery(graphQuery);
    setActiveGraphDirective(null);
    goToSection('graph');
    writeRouteToLocation({
      tab: 'graph',
      accountId: selectedAwsAccountId || undefined,
      graphQuery,
      focusArn: entityArn,
    }, true);
    showToast('Opened entity in IAM topology.', 'info');
  };

  const askAiAboutEntity = (prompt: string) => {
    setCopilotDraft(prompt);
    setCopilotOpen(true);
    if (activeTab === 'graph') {
      openGraphAiMode();
      setGraphAiDraft(prompt);
    } else {
      goToSection('assistant');
      setAiPrompt(prompt);
    }
  };

  const isLikelyConversationPrompt = (prompt: string) => {
    const text = (prompt || '').trim().toLowerCase();
    if (!text) return false;
    if (text.includes('?')) return true;
    const starters = ['what', 'why', 'how', 'which', 'who', 'when', 'where', 'explain', 'analyze', 'compare', 'summarize', 'tell me'];
    return starters.some((starter) => text.startsWith(starter));
  };

  const switchGraphAiMode = (mode: 'graph' | 'graph_chat') => {
    if (graphAiMode === 'graph' || graphAiMode === 'graph_chat') {
      const currentSessionKey = buildGraphAiOverlaySessionKey(graphAiMode);
      setGraphAiOverlaySessions((prev) => ({
        ...prev,
        [currentSessionKey]: {
          messages: graphAiMessages,
          draft: graphAiDraft,
          contextPrompt: graphAiContextPrompt,
          nodeTitle: graphAiNodeTitle,
          lastInstruction: graphAiLastInstruction,
        },
      }));
    }

    const nextSession = graphAiOverlaySessions[buildGraphAiOverlaySessionKey(mode)];
    setGraphAiMode(mode);
    if (nextSession) {
      setGraphAiMessages(nextSession.messages);
      setGraphAiDraft(nextSession.draft);
      setGraphAiContextPrompt(nextSession.contextPrompt);
      setGraphAiNodeTitle(nextSession.nodeTitle);
      setGraphAiLastInstruction(nextSession.lastInstruction);
    }
    setErrors((prev) => ({ ...prev, ai: '' }));
    if (mode === 'graph_chat') {
      if (!nextSession) {
        setGraphAiNodeTitle('Graph AI conversation mode');
      }
      setSuccessMessage('Graph AI conversation mode enabled. Ask follow-up questions about the current graph.');
    } else {
      if (!nextSession) {
        setGraphAiNodeTitle('Graph AI mode');
      }
      setSuccessMessage('Graph AI instruction mode enabled. Ask for direct graph transformations.');
    }
  };

  const submitGraphAiPrompt = async () => {
    if (graphAiLoading) return;
    const visiblePrompt = graphAiDraft.trim();
    if (!visiblePrompt || !graphAiContextPrompt) return;

    if (graphAiMode === 'graph') {
      setGraphAiDraft('');
      setGraphAiLoading(true);
      const startedAt = Date.now();
      setGraphAiLastInstruction(visiblePrompt);
      try {
        if (isLikelyConversationPrompt(visiblePrompt)) {
          setGraphAiMessages([
            {
              role: 'assistant',
              content: 'That looks like an analysis question. Do you want to switch to Graph AI conversation mode so I can answer with context and follow-ups?',
              findings: ['Instruction mode is best for commands like "show only ..." or "focus on ...".', 'Conversation mode is best for question-and-answer analysis.'],
              modeSuggestions: [{ mode: 'graph_chat', label: 'Switch To Conversation Mode' }],
            },
          ]);
          return;
        }

        const localDeterministicTransform = applyLocalGraphInstruction(visiblePrompt);
        if (localDeterministicTransform?.didUpdateGraph) {
          setGraph(localDeterministicTransform.graph);
          setSuccessMessage('Applied deterministic graph transform from local risk and topology signals.');
          setErrors((prev) => ({ ...prev, ai: '' }));
          setGraphAiMessages([
            {
              role: 'assistant',
              content: localDeterministicTransform.summary,
              findings: localDeterministicTransform.findings,
              suggestionPrompts: localDeterministicTransform.suggestionPrompts,
            },
          ]);
          return;
        }

        const visibleEntityArns = (graph?.nodes || [])
          .map((node) => (typeof node.arn === 'string' ? node.arn : ''))
          .filter((arn): arn is string => Boolean(arn))
          .slice(0, 200);

        // Agent-first graph mode: ask backend AI to produce a graph directive before
        // using local deterministic transforms.
        const response = await chatWithCloudHoundAI({
          selectedAwsAccountId,
          message:
            `${graphAiContextPrompt}\n\n` +
            `Instruction for this graph view: ${visiblePrompt}\n\n` +
            'Graph transform mode: return a graph_directive (query_key or cypher) when possible. Keep prose minimal and action-oriented.',
          conversationContext: [],
          queryKey: selectedGraphQuery === 'ai_query' ? undefined : selectedGraphQuery,
          focusEntityArn: focusNodeArn || undefined,
          visibleEntityArns,
        });

        const directiveToApply = resolveGraphDirectiveFromResponse(response);
        const appliedDirective = applyGraphDirective(directiveToApply);

        if (appliedDirective) {
          setErrors((prev) => ({ ...prev, ai: '' }));
          setGraphAiMessages([
            {
              role: 'assistant',
              content:
                directiveToApply?.reason
                || directiveToApply?.label
                || response.response
                || 'Applied AI graph directive.',
              findings: response.key_findings || [],
              agent: response.agent
                ? {
                    provider: response.agent.provider,
                    model: response.agent.model,
                    iterations: response.agent.iterations,
                    toolsUsed: response.agent.tools_used || [],
                    auto: response.agent.auto,
                    fallbackChain: response.agent.fallback_chain,
                  }
                : undefined,
            },
          ]);
          return;
        }

        const localTransform = applyLocalGraphInstruction(visiblePrompt);
        if (localTransform) {
          if (localTransform.didUpdateGraph) {
            setGraph(localTransform.graph);
            setSuccessMessage('Applied local fallback graph transform (no backend directive returned).');
            setErrors((prev) => ({ ...prev, ai: '' }));
          } else {
            setErrors((prev) => ({ ...prev, ai: '' }));
            setSuccessMessage('Graph AI needs a bit more specificity before updating the view.');
          }
          setGraphAiMessages([
            {
              role: 'assistant',
              content: localTransform.summary,
              findings: localTransform.didUpdateGraph
                ? ['Backend AI returned analysis without a graph directive, so local fallback was applied.', ...localTransform.findings]
                : localTransform.findings,
              suggestionPrompts: localTransform.suggestionPrompts,
              agent: response.agent
                ? {
                    provider: response.agent.provider,
                    model: response.agent.model,
                    iterations: response.agent.iterations,
                    toolsUsed: response.agent.tools_used || [],
                    auto: response.agent.auto,
                    fallbackChain: response.agent.fallback_chain,
                  }
                : undefined,
            },
          ]);
          return;
        }

        setErrors((prev) => ({
          ...prev,
          ai: 'AI returned analysis but no executable graph directive, and no local fallback matched. Try a concrete graph command (for example: "show high-risk entities" or "focus on roles connected to dangerous policies").',
        }));

        setGraphAiMessages([
          {
            role: 'assistant',
            content: response.graph_directive?.reason
              || response.graph_directive?.label
              || response.response
              || 'AI analyzed the request but did not return a graph directive.',
            findings: response.key_findings || [],
            agent: response.agent
              ? {
                  provider: response.agent.provider,
                  model: response.agent.model,
                  iterations: response.agent.iterations,
                  toolsUsed: response.agent.tools_used || [],
                  auto: response.agent.auto,
                  fallbackChain: response.agent.fallback_chain,
                }
              : undefined,
          },
        ]);
      } catch (err) {
        setGraphAiMessages([
          {
            role: 'assistant',
            content: err instanceof Error ? err.message : 'Failed to get AI response.',
          },
        ]);
      } finally {
        const elapsed = Date.now() - startedAt;
        if (elapsed < MIN_THINKING_BUBBLE_MS) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, MIN_THINKING_BUBBLE_MS - elapsed);
          });
        }
        setGraphAiLoading(false);
      }
      return;
    }

    if (graphAiMode === 'graph_chat') {
      const requestPrompt = `${visiblePrompt}\n\n---\n${graphAiContextPrompt}`;
      await sendAiPrompt({
        displayPrompt: visiblePrompt,
        requestPrompt,
        currentMessages: graphAiMessages,
        setMessages: setGraphAiMessages,
        setLoading: setGraphAiLoading,
        clearDraft: () => setGraphAiDraft(''),
      });
      return;
    }

    const requestPrompt = `${visiblePrompt}\n\n---\n${graphAiContextPrompt}`;

    await sendAiPrompt({
      displayPrompt: visiblePrompt,
      requestPrompt,
      currentMessages: graphAiMessages,
      setMessages: setGraphAiMessages,
      setLoading: setGraphAiLoading,
      clearDraft: () => setGraphAiDraft(''),
    });
  };

  const handleGraphAiAssist = (request: GraphAiAssistRequest) => {
    const sessionKey = buildGraphAiNodeSessionKey(request.nodeId);
    const previousSession = graphAiNodeSessions[sessionKey];
    setErrors((prev) => ({ ...prev, ai: '' }));
    setGraphAiMode('node');
    setGraphAiLastInstruction(previousSession?.lastInstruction || '');
    setGraphAiNodeId(request.nodeId);
    setGraphAiNodeTitle(previousSession?.nodeTitle || request.nodeTitle);
    setGraphAiContextPrompt(previousSession?.contextPrompt || request.prompt);
    setGraphAiDraft(previousSession?.draft || '');
    setGraphAiMessages(
      previousSession?.messages?.length
        ? previousSession.messages
        : [
            {
              role: 'assistant',
              content: `I am focused on ${request.nodeTitle}. Ask about this node's permissions, exposure, or a safe remediation path.`,
            },
          ],
    );
    setGraphAiOpen(true);
  };

  const closeGraphAiAssist = () => {
    if (graphAiMode === 'node' && graphAiNodeId) {
      const sessionKey = buildGraphAiNodeSessionKey(graphAiNodeId);
      setGraphAiNodeSessions((prev) => ({
        ...prev,
        [sessionKey]: {
          messages: graphAiMessages,
          draft: graphAiDraft,
          contextPrompt: graphAiContextPrompt,
          nodeTitle: graphAiNodeTitle,
          lastInstruction: graphAiLastInstruction,
        },
      }));
    } else if (graphAiMode === 'graph' || graphAiMode === 'graph_chat') {
      const sessionKey = buildGraphAiOverlaySessionKey(graphAiMode);
      setGraphAiOverlaySessions((prev) => ({
        ...prev,
        [sessionKey]: {
          messages: graphAiMessages,
          draft: graphAiDraft,
          contextPrompt: graphAiContextPrompt,
          nodeTitle: graphAiNodeTitle,
          lastInstruction: graphAiLastInstruction,
        },
      }));
    }
    setGraphAiOpen(false);
    setGraphAiMode('node');
    setGraphAiNodeId(null);
    setGraphAiNodeTitle('');
    setGraphAiContextPrompt('');
    setGraphAiDraft('');
    setGraphAiMessages([]);
    setGraphAiLastInstruction('');
    setGraphAiLoading(false);
  };

  useEffect(() => {
    if (graphAiMode !== 'node' || !graphAiNodeId) return;
    const sessionKey = buildGraphAiNodeSessionKey(graphAiNodeId);
    setGraphAiNodeSessions((prev) => ({
      ...prev,
      [sessionKey]: {
        messages: graphAiMessages,
        draft: graphAiDraft,
        contextPrompt: graphAiContextPrompt,
        nodeTitle: graphAiNodeTitle,
        lastInstruction: graphAiLastInstruction,
      },
    }));
  }, [
    graphAiMode,
    graphAiNodeId,
    graphAiMessages,
    graphAiDraft,
    graphAiContextPrompt,
    graphAiNodeTitle,
    graphAiLastInstruction,
    selectedAwsAccountId,
  ]);

  useEffect(() => {
    if (graphAiMode !== 'graph' && graphAiMode !== 'graph_chat') return;
    const sessionKey = buildGraphAiOverlaySessionKey(graphAiMode);
    setGraphAiOverlaySessions((prev) => ({
      ...prev,
      [sessionKey]: {
        messages: graphAiMessages,
        draft: graphAiDraft,
        contextPrompt: graphAiContextPrompt,
        nodeTitle: graphAiNodeTitle,
        lastInstruction: graphAiLastInstruction,
      },
    }));
  }, [
    graphAiMode,
    graphAiMessages,
    graphAiDraft,
    graphAiContextPrompt,
    graphAiNodeTitle,
    graphAiLastInstruction,
    selectedAwsAccountId,
  ]);

  const openGraphAiMode = () => {
    if (graphAiMode === 'graph_chat') {
      const conversationKey = buildGraphAiOverlaySessionKey('graph_chat');
      setGraphAiOverlaySessions((prev) => ({
        ...prev,
        [conversationKey]: {
          messages: graphAiMessages,
          draft: graphAiDraft,
          contextPrompt: graphAiContextPrompt,
          nodeTitle: graphAiNodeTitle,
          lastInstruction: graphAiLastInstruction,
        },
      }));
    }
    setErrors((prev) => ({ ...prev, ai: '' }));
    const sessionKey = buildGraphAiOverlaySessionKey('graph');
    const previousSession = graphAiOverlaySessions[sessionKey];
    setGraphAiMode('graph');
    setGraphAiNodeId(null);
    setGraphAiNodeTitle(previousSession?.nodeTitle || 'Graph AI mode');
    setGraphAiContextPrompt(
      previousSession?.contextPrompt
      || (`Analyze the currently visible CloudHound IAM graph view. Current graph query key: ${graph?.query_key || selectedGraphQuery}. ` +
        `Graph title: ${graph?.title || activeGraphDirective?.title || 'Current graph view'}. ` +
        `Visible nodes: ${graph?.nodes.length || 0}. Visible edges: ${graph?.edges.length || 0}. ` +
        `Answer questions about attack paths, risky clusters, suspicious trusts, dangerous permissions, and what should be investigated next.`)
    );
    setGraphAiDraft(previousSession?.draft || '');
    setGraphAiMessages(previousSession?.messages || []);
    setGraphAiLastInstruction(previousSession?.lastInstruction || '');
    setGraphAiOpen(true);
    setSuccessMessage('Graph AI mode opened.');
  };

  const applyLocalGraphInstruction = (instruction: string): {
    graph: CloudHoundPortalGraphResponse;
    summary: string;
    findings: string[];
    didUpdateGraph: boolean;
    suggestionPrompts?: string[];
  } | null => {
    const source = graphSnapshot || graph;
    if (!source || !Array.isArray(source.nodes) || !Array.isArray(source.edges) || !source.nodes.length) {
      return null;
    }

    const normalizeQueryText = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const cleanEntityQuery = (value: string) => value
      .replace(/^["'`\s]+|["'`\s]+$/g, '')
      .replace(/^(the\s+)?(node|entity|group)\s+/i, '')
      .replace(/\s+(is|are)\s+connected.*$/i, '')
      .replace(/[?.!,;:]+$/g, '')
      .trim();
    const isGroupNode = (node: { type?: string; label?: string }) => `${node.type || ''} ${node.label || ''}`.toLowerCase().includes('group');

    const parseDirective = (raw: string): LocalGraphDirective | null => {
      const text = (raw || '').trim();
      if (!text) return null;

      const parseObject = (candidate: string): Record<string, unknown> | null => {
        try {
          const parsed = JSON.parse(candidate);
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null;
        } catch {
          return null;
        }
      };

      const parsedDirect = parseObject(text);
      if (parsedDirect) return parsedDirect as unknown as LocalGraphDirective;

      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const parsedBlock = parseObject(match[0]);
      return parsedBlock ? (parsedBlock as unknown as LocalGraphDirective) : null;
    };

    const inferDirective = (raw: string): LocalGraphDirective | null => {
      const q = raw.toLowerCase();

      const quoted = Array.from(raw.matchAll(/["']([^"']+)["']/g))
        .map((match) => cleanEntityQuery(match[1]))
        .filter(Boolean);

      if (
        q.includes('connected')
        || q.includes('connection between')
        || q.includes('path between')
        || q.includes('how') && q.includes('connected')
      ) {
        let sourceNodeQuery = '';
        let targetNodeQuery = '';

        if (quoted.length >= 2) {
          [sourceNodeQuery, targetNodeQuery] = [quoted[0], quoted[1]];
        } else {
          const pairMatch = raw.match(/(?:between|from)\s+(.+?)\s+(?:and|to)\s+(.+?)(?:$|\?|\.)/i)
            || raw.match(/(?:node|entity)\s+(.+?)\s+(?:and|to)\s+(?:node|entity)\s+(.+?)(?:$|\?|\.)/i);
          if (pairMatch) {
            sourceNodeQuery = cleanEntityQuery(pairMatch[1]);
            targetNodeQuery = cleanEntityQuery(pairMatch[2]);
          }
        }

        if (sourceNodeQuery && targetNodeQuery) {
          return {
            intent: 'focus_connection_path',
            sourceNodeQuery,
            targetNodeQuery,
          };
        }
      }

      if (
        q.includes('group')
        && (
          q.includes('entities in this group')
          || q.includes('members in this group')
          || q.includes('this group only')
          || q.includes('in this group only')
          || q.includes('entities in group')
          || q.includes('members of group')
        )
      ) {
        const quotedGroup = quoted[0] || '';
        if (quotedGroup) {
          return { intent: 'focus_group_entities', groupQuery: quotedGroup };
        }

        const groupMatch = raw.match(/group\s+(.+?)\s*(?:only|$|\?|\.)/i);
        const groupQuery = groupMatch ? cleanEntityQuery(groupMatch[1]) : '';
        return {
          intent: 'focus_group_entities',
          groupQuery: groupQuery || '__this_group__',
        };
      }

      if (
        (q.includes('role') || q.includes('roles'))
        && (
          q.includes('dangerous policy')
          || q.includes('dangerous policies')
          || q.includes('connected to dangerous')
          || q.includes('with dangerous polic')
          || q.includes('administratoraccess')
        )
      ) {
        return { intent: 'focus_roles_connected_dangerous_policy' };
      }

      if (
        q.includes('dangerous zone')
        || q.includes('danger zone')
        || q.includes('most dangerous zone')
        || q.includes('blast radius')
        || q.includes('dangerous cluster')
        || q.includes('most dangerous entity')
        || q.includes('most dangerous entities')
        || q.includes('riskiest entity')
        || q.includes('riskiest entities')
        || q.includes('highest risk entity')
        || q.includes('highest risk entities')
      ) {
        const hopsMatch = q.match(/(?:up\s*to\s*)?(\d+)\s*hops?/i);
        const defaultHopCount =
          q.includes('most dangerous entity')
          || q.includes('most dangerous entities')
          || q.includes('riskiest entity')
          || q.includes('riskiest entities')
          || q.includes('highest risk entity')
          || q.includes('highest risk entities')
            ? 1
            : 2;
        const parsedHop = hopsMatch ? Number(hopsMatch[1]) : defaultHopCount;
        const neighborHops = parsedHop >= 3 ? 3 : parsedHop <= 1 ? 1 : 2;
        return {
          intent: 'focus_dangerous_zone_hops',
          includeNeighbors: true,
          neighborHops,
        };
      }

      if (['reset', 'restore', 'full graph', 'full topology', 'show all nodes', 'clear filters'].some((term) => q.includes(term))) {
        return { intent: 'restore_full_view' };
      }
      if (
        q.includes('privilege escalation')
        || q.includes('escalation path')
        || q.includes('dangerous path')
        || q.includes('dangerous paths')
        || q.includes('most dangerous path')
        || q.includes('most dangerous paths')
        || q.includes('attack path')
        || q.includes('attack paths')
      ) {
        return { intent: 'focus_privilege_escalation', includeNeighbors: true, neighborHops: 1 };
      }
      if (q.includes('external trust') || q.includes('cross-account') || q.includes('cross account')) {
        return { intent: 'focus_external_trust', includeNeighbors: true, neighborHops: 1 };
      }
      if (
        q.includes('dangerous policy')
        || q.includes('dangerous policies')
        || q.includes('wildcard')
        || q.includes('privilege-escalation-capable')
      ) {
        return { intent: 'focus_dangerous_policy', includeNeighbors: true, neighborHops: 1 };
      }
      if (q.includes('high-value') || q.includes('high value') || q.includes('hvt')) {
        return { intent: 'focus_hvt', includeNeighbors: true, neighborHops: 1 };
      }
      if (q.includes('high risk') || q.includes('critical risk') || q.includes('risky cluster') || q.includes('most risky')) {
        return { intent: 'focus_high_risk', includeNeighbors: true, neighborHops: 1, minRiskScore: 70 };
      }
      return null;
    };

    const validateDirective = (candidate: LocalGraphDirective | null): LocalGraphDirective | null => {
      if (!candidate || typeof candidate !== 'object') return null;
      const intent = String(candidate.intent || '').trim() as LocalGraphIntent;
      const allowedIntents: LocalGraphIntent[] = [
        'focus_hvt',
        'focus_external_trust',
        'focus_dangerous_policy',
        'focus_roles_connected_dangerous_policy',
        'focus_dangerous_zone_hops',
        'focus_high_risk',
        'focus_privilege_escalation',
        'focus_connection_path',
        'focus_group_entities',
        'restore_full_view',
      ];
      if (!allowedIntents.includes(intent)) return null;

      const includeNeighbors = candidate.includeNeighbors !== false;
      const parsedNeighborHops = Number(candidate.neighborHops);
      const neighborHops = parsedNeighborHops >= 3 ? 3 : parsedNeighborHops === 2 ? 2 : 1;
      const minRiskScore = Number.isFinite(Number(candidate.minRiskScore))
        ? Math.max(0, Math.min(100, Number(candidate.minRiskScore)))
        : 70;
      const maxNodes = Number.isFinite(Number(candidate.maxNodes))
        ? Math.max(50, Math.min(2500, Number(candidate.maxNodes)))
        : 1200;

      const sourceNodeQuery = typeof candidate.sourceNodeQuery === 'string' ? cleanEntityQuery(candidate.sourceNodeQuery) : '';
      const targetNodeQuery = typeof candidate.targetNodeQuery === 'string' ? cleanEntityQuery(candidate.targetNodeQuery) : '';
      const groupQuery = typeof candidate.groupQuery === 'string' ? cleanEntityQuery(candidate.groupQuery) : '';

      if (intent === 'focus_connection_path' && (!sourceNodeQuery || !targetNodeQuery)) {
        return null;
      }

      return {
        intent,
        includeNeighbors,
        neighborHops,
        minRiskScore,
        maxNodes,
        sourceNodeQuery,
        targetNodeQuery,
        groupQuery,
        reason: typeof candidate.reason === 'string' ? candidate.reason : undefined,
      };
    };

    const directive = validateDirective(parseDirective(instruction) || inferDirective(instruction));
    if (!directive) return null;

    const resolveNodeCandidates = (
      query: string,
      candidates: Array<(typeof source.nodes)[number]> = source.nodes,
    ) => {
      const normalizedQuery = normalizeQueryText(query);
      if (!normalizedQuery) return [] as Array<{ node: (typeof source.nodes)[number]; score: number }>;

      const matched: Array<{ node: (typeof source.nodes)[number]; score: number }> = [];

      candidates.forEach((node) => {
        const fields = [
          node.name,
          node.label,
          node.arn,
          node.id,
        ].filter(Boolean).map((value) => String(value));
        const normalizedFields = fields.map((value) => normalizeQueryText(value));

        let score = 0;
        normalizedFields.forEach((field) => {
          if (!field) return;
          if (field === normalizedQuery) score = Math.max(score, 1000);
          else if (field.startsWith(normalizedQuery)) score = Math.max(score, 700);
          else if (field.includes(normalizedQuery)) score = Math.max(score, 500);
        });

        const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
        if (queryTokens.length) {
          const tokenHits = queryTokens.reduce((hits, token) => (
            normalizedFields.some((field) => field.includes(token)) ? hits + 1 : hits
          ), 0);
          if (tokenHits === queryTokens.length) {
            score = Math.max(score, 320 + tokenHits * 30);
          }
        }

        if (score >= 320) {
          matched.push({ node, score });
        }
      });

      return matched.sort((a, b) => b.score - a.score);
    };

    const resolveNodeByQuery = (
      query: string,
      candidates: Array<(typeof source.nodes)[number]> = source.nodes,
    ) => {
      const matches = resolveNodeCandidates(query, candidates);
      if (!matches.length) {
        return { status: 'not_found' as const, node: null, matches: [] as Array<(typeof source.nodes)[number]> };
      }

      const top = matches[0];
      const nearPeers = matches.filter((entry) => entry.score >= top.score - 120).slice(0, 5);
      if (nearPeers.length > 1) {
        return { status: 'ambiguous' as const, node: null, matches: nearPeers.map((entry) => entry.node) };
      }

      return { status: 'ok' as const, node: top.node, matches: [top.node] };
    };

    if (directive.intent === 'restore_full_view') {
      return {
        graph: {
          ...source,
          metrics: {
            ...(source.metrics || {}),
            query_mode: 'local_ai_transform',
            note: 'Restored the full currently loaded graph view.',
          },
        },
        summary: 'Restored the full graph currently loaded in the browser.',
        findings: [],
        didUpdateGraph: true,
      };
    }

    if (directive.intent === 'focus_connection_path') {
      const sourceResolution = resolveNodeByQuery(directive.sourceNodeQuery || '');
      const targetResolution = resolveNodeByQuery(directive.targetNodeQuery || '');
      const unresolved: string[] = [];
      const ambiguityHints: string[] = [];
      const nodePromptLabel = (node: (typeof source.nodes)[number]) => node.arn || node.name || node.label || node.id;

      const formatCandidates = (items: Array<(typeof source.nodes)[number]>) => items
        .slice(0, 5)
        .map((node) => node.name || node.label || node.arn || node.id)
        .join(', ');

      if (sourceResolution.status !== 'ok') {
        if (sourceResolution.status === 'ambiguous') {
          ambiguityHints.push(`Source "${directive.sourceNodeQuery}" matched multiple nodes: ${formatCandidates(sourceResolution.matches)}.`);
        } else {
          unresolved.push(`Could not find source node "${directive.sourceNodeQuery}" in the current graph.`);
        }
      }
      if (targetResolution.status !== 'ok') {
        if (targetResolution.status === 'ambiguous') {
          ambiguityHints.push(`Target "${directive.targetNodeQuery}" matched multiple nodes: ${formatCandidates(targetResolution.matches)}.`);
        } else {
          unresolved.push(`Could not find target node "${directive.targetNodeQuery}" in the current graph.`);
        }
      }

      if (ambiguityHints.length || unresolved.length) {
        const suggestionPrompts: string[] = [];
        if (sourceResolution.status === 'ambiguous' && targetResolution.status === 'ok' && targetResolution.node) {
          sourceResolution.matches.slice(0, 5).forEach((node) => {
            suggestionPrompts.push(`show me how "${nodePromptLabel(node)}" and "${nodePromptLabel(targetResolution.node as (typeof source.nodes)[number])}" are connected`);
          });
        }
        if (targetResolution.status === 'ambiguous' && sourceResolution.status === 'ok' && sourceResolution.node) {
          targetResolution.matches.slice(0, 5).forEach((node) => {
            suggestionPrompts.push(`show me how "${nodePromptLabel(sourceResolution.node as (typeof source.nodes)[number])}" and "${nodePromptLabel(node)}" are connected`);
          });
        }
        if (sourceResolution.status === 'ambiguous' && targetResolution.status === 'ambiguous') {
          const left = sourceResolution.matches.slice(0, 2);
          const right = targetResolution.matches.slice(0, 2);
          left.forEach((srcNode) => {
            right.forEach((tgtNode) => {
              suggestionPrompts.push(`show me how "${nodePromptLabel(srcNode)}" and "${nodePromptLabel(tgtNode)}" are connected`);
            });
          });
        }

        return {
          graph: source,
          summary: 'I need a more specific node name before tracing a path.',
          findings: [...ambiguityHints, ...unresolved, 'Try using quotes with full names or ARNs, for example: show me how "arn:aws:iam::123456789012:user/Alice" and "ProdRole" are connected.'],
          didUpdateGraph: false,
          suggestionPrompts: Array.from(new Set(suggestionPrompts)).slice(0, 6),
        };
      }

      const sourceNode = sourceResolution.node;
      const targetNode = targetResolution.node;
      if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) {
        return {
          graph: source,
          summary: 'I need two different nodes to compute a connection path.',
          findings: ['Choose two distinct entities and try again.'],
          didUpdateGraph: false,
        };
      }

      const graphAdjacency = new Map<string, Array<{ id: string; edgeIndex: number }>>();
      source.edges.forEach((edge, index) => {
        if (!graphAdjacency.has(edge.source)) graphAdjacency.set(edge.source, []);
        if (!graphAdjacency.has(edge.target)) graphAdjacency.set(edge.target, []);
        graphAdjacency.get(edge.source)?.push({ id: edge.target, edgeIndex: index });
        graphAdjacency.get(edge.target)?.push({ id: edge.source, edgeIndex: index });
      });

      const queue: string[] = [sourceNode.id];
      const visited = new Set<string>([sourceNode.id]);
      const parent = new Map<string, { prev: string; edgeIndex: number }>();

      while (queue.length) {
        const current = queue.shift();
        if (!current) break;
        if (current === targetNode.id) break;

        const neighbors = graphAdjacency.get(current) || [];
        neighbors.forEach(({ id: nextId, edgeIndex }) => {
          if (visited.has(nextId)) return;
          visited.add(nextId);
          parent.set(nextId, { prev: current, edgeIndex });
          queue.push(nextId);
        });
      }

      if (!visited.has(targetNode.id)) {
        return {
          graph: source,
          summary: `No visible path found between ${sourceNode.name || sourceNode.label || sourceNode.id} and ${targetNode.name || targetNode.label || targetNode.id}.`,
          findings: ['Try restoring full view first, then rerun the connection request.'],
          didUpdateGraph: false,
        };
      }

      const keepNodeIds = new Set<string>([targetNode.id]);
      const keepEdgeIndexes = new Set<number>();
      let cursor = targetNode.id;
      while (cursor !== sourceNode.id) {
        const prev = parent.get(cursor);
        if (!prev) break;
        keepNodeIds.add(prev.prev);
        keepEdgeIndexes.add(prev.edgeIndex);
        cursor = prev.prev;
      }

      const nodes = source.nodes.filter((node) => keepNodeIds.has(node.id));
      const edges = source.edges.filter((_, index) => keepEdgeIndexes.has(index));

      return {
        graph: {
          ...source,
          query_key: 'local_ai_query',
          title: 'Local AI transform',
          nodes,
          edges,
          metrics: {
            ...(source.metrics || {}),
            total_nodes: nodes.length,
            total_edges: edges.length,
            query_title: 'Local AI transform',
            query_mode: 'local_ai_transform',
            note: directive.reason || `Local directive applied: ${directive.intent}`,
          },
        },
        summary: `Found a local path between ${sourceNode.name || sourceNode.label || sourceNode.id} and ${targetNode.name || targetNode.label || targetNode.id}.`,
        findings: [`Kept ${nodes.length} nodes and ${edges.length} edges on the shortest visible path.`],
        didUpdateGraph: true,
      };
    }

    if (directive.intent === 'focus_group_entities') {
      const groupNodes = source.nodes.filter((node) => isGroupNode(node));
      let groupNode: (typeof source.nodes)[number] | null = null;
      const requestedGroup = directive.groupQuery || '';

      if (requestedGroup && requestedGroup !== '__this_group__') {
        const resolution = resolveNodeByQuery(requestedGroup, groupNodes);
        if (resolution.status === 'ambiguous') {
          const suggestionPrompts = resolution.matches
            .slice(0, 5)
            .map((node) => `show entities in group "${node.arn || node.name || node.label || node.id}" only`);
          return {
            graph: source,
            summary: 'I found multiple matching groups. Please pick one.',
            findings: [
              `Group "${requestedGroup}" matched: ${resolution.matches
                .slice(0, 5)
                .map((node) => node.name || node.label || node.arn || node.id)
                .join(', ')}`,
              'Try again with the exact group name or ARN in quotes.',
            ],
            didUpdateGraph: false,
            suggestionPrompts,
          };
        }
        groupNode = resolution.node;
      } else {
        const focusedGroup = source.nodes.find((node) => (
          (focusNodeArn && ((node.arn || '').toLowerCase() === focusNodeArn.toLowerCase() || node.id.toLowerCase() === focusNodeArn.toLowerCase()))
          || (graphAiNodeId && node.id === graphAiNodeId)
        ) && isGroupNode(node));
        groupNode = focusedGroup || (groupNodes.length === 1 ? groupNodes[0] : null);
      }

      if (!groupNode) {
        const suggestionPrompts = groupNodes
          .slice(0, 5)
          .map((node) => `show entities in group "${node.arn || node.name || node.label || node.id}" only`);
        return {
          graph: source,
          summary: 'I could not identify a target group in the current graph.',
          findings: ['Try: show entities in group "ExactGroupName" only.'],
          didUpdateGraph: false,
          suggestionPrompts,
        };
      }

      const keepNodeIds = new Set<string>([groupNode.id]);
      const keepEdgeIds = new Set<string>();
      source.edges.forEach((edge, index) => {
        const rel = String(edge.relationship_type || '').toUpperCase();
        const touchesGroup = edge.source === groupNode.id || edge.target === groupNode.id;
        const isGroupMembership = rel.includes('MEMBER') || rel.includes('GROUP');
        if (!touchesGroup || !isGroupMembership) return;

        keepNodeIds.add(edge.source);
        keepNodeIds.add(edge.target);
        keepEdgeIds.add(String(edge.id || index));
      });

      if (keepNodeIds.size <= 1) {
        return {
          graph: source,
          summary: `No visible group-membership entities were found for ${groupNode.name || groupNode.label || groupNode.id}.`,
          findings: ['Try restoring full view first, then run this instruction again.'],
          didUpdateGraph: false,
        };
      }

      const nodes = source.nodes.filter((node) => keepNodeIds.has(node.id));
      const edges = source.edges.filter((edge, index) => keepEdgeIds.has(String(edge.id || index)));

      return {
        graph: {
          ...source,
          query_key: 'local_ai_query',
          title: 'Local AI transform',
          nodes,
          edges,
          metrics: {
            ...(source.metrics || {}),
            total_nodes: nodes.length,
            total_edges: edges.length,
            query_title: 'Local AI transform',
            query_mode: 'local_ai_transform',
            note: directive.reason || `Local directive applied: ${directive.intent}`,
          },
        },
        summary: `Focused on ${groupNode.name || groupNode.label || groupNode.id} and its visible group membership entities.`,
        findings: [`Kept ${nodes.length} nodes and ${edges.length} membership edges for the selected group context.`],
        didUpdateGraph: true,
      };
    }

    if (directive.intent === 'focus_roles_connected_dangerous_policy') {
      const roleNodeIds = new Set(
        source.nodes
          .filter((node) => `${node.type || ''} ${node.label || ''}`.toLowerCase().includes('role'))
          .map((node) => node.id),
      );

      const dangerousPolicyNodeIds = new Set<string>();
      source.nodes.forEach((node) => {
        const props = node.properties || {};
        const nodeType = `${node.type || ''} ${node.label || ''}`.toLowerCase();
        const policySummary = props.policy_summary && typeof props.policy_summary === 'object'
          ? (props.policy_summary as { has_wildcard_actions?: boolean })
          : undefined;

        const nameText = `${node.name || ''} ${node.label || ''} ${node.arn || ''}`.toLowerCase();
        const looksLikeAdminAccess =
          nameText.includes('administratoraccess')
          || nameText.includes('admin access')
          || nameText.includes('fullaccess')
          || nameText.includes('poweruseraccess');

        const policyActions = Array.isArray(props.policy_actions)
          ? props.policy_actions.map((value) => String(value).toLowerCase())
          : [];
        const hasWildcardAction = policyActions.some((action) => action === '*' || action.endsWith(':*'));
        const hasSensitiveIamAction = policyActions.some((action) => (
          action.includes('iam:passrole')
          || action.includes('iam:createrole')
          || action.includes('iam:attachrolepolicy')
          || action.includes('iam:putrolepolicy')
          || action.includes('iam:setdefaultpolicyversion')
          || action.includes('iam:createpolicyversion')
        ));

        const riskScore = Number(node.risk_level || props.findings_risk_score || 0);
        const isDangerousBySignal = props.dangerous_policy === true;
        const isDangerousByHeuristic =
          looksLikeAdminAccess
          || hasSensitiveIamAction
          || (hasWildcardAction && (policySummary?.has_wildcard_actions === true || riskScore >= 70));

        if (nodeType.includes('policy') && (isDangerousBySignal || isDangerousByHeuristic)) {
          dangerousPolicyNodeIds.add(node.id);
        }
      });

      const keepNodeIds = new Set<string>();
      const keepEdgeIds = new Set<string>();
      source.edges.forEach((edge, index) => {
        const rel = String(edge.relationship_type || '').toUpperCase();
        const policyToRole = dangerousPolicyNodeIds.has(edge.source) && roleNodeIds.has(edge.target);
        const roleToPolicy = dangerousPolicyNodeIds.has(edge.target) && roleNodeIds.has(edge.source);
        const isPolicyAttachment = rel.includes('ATTACH') || rel.includes('POLICY') || rel.includes('GRANT');
        if (!(policyToRole || roleToPolicy) || !isPolicyAttachment) return;

        keepNodeIds.add(edge.source);
        keepNodeIds.add(edge.target);
        keepEdgeIds.add(String(edge.id || index));
      });

      if (!keepNodeIds.size) {
        return {
          graph: source,
          summary: 'No role-to-dangerous-policy attachments are visible in the current graph view.',
          findings: ['Try restoring full view, then rerun: "focus on roles connected to dangerous policies".'],
          didUpdateGraph: false,
        };
      }

      const nodes = source.nodes.filter((node) => keepNodeIds.has(node.id));
      const edges = source.edges.filter((edge, index) => keepEdgeIds.has(String(edge.id || index)));
      const keptRoles = nodes.filter((node) => `${node.type || ''} ${node.label || ''}`.toLowerCase().includes('role')).length;
      const keptPolicies = nodes.filter((node) => `${node.type || ''} ${node.label || ''}`.toLowerCase().includes('policy')).length;

      return {
        graph: {
          ...source,
          query_key: 'local_ai_query',
          title: 'Local AI transform',
          nodes,
          edges,
          metrics: {
            ...(source.metrics || {}),
            total_nodes: nodes.length,
            total_edges: edges.length,
            query_title: 'Local AI transform',
            query_mode: 'local_ai_transform',
            note: directive.reason || `Local directive applied: ${directive.intent}`,
          },
        },
        summary: `Focused on roles connected to dangerous policies in the current graph (${nodes.length} nodes / ${edges.length} edges).`,
        findings: [
          `Kept ${keptRoles} roles and ${keptPolicies} dangerous policy nodes connected by attachment edges.`,
          'Dangerous policies are inferred from explicit risk signals, Administrator/FullAccess-style names, or sensitive IAM actions.',
        ],
        didUpdateGraph: true,
      };
    }

    if (directive.intent === 'focus_dangerous_zone_hops') {
      const adjacency = new Map<string, Set<string>>();
      source.edges.forEach((edge) => {
        if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
        if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
        adjacency.get(edge.source)?.add(edge.target);
        adjacency.get(edge.target)?.add(edge.source);
      });

      const scoredNodes = source.nodes.map((node) => {
        const props = node.properties || {};
        const riskLevel = Number(node.risk_level || props.findings_risk_score || 0);
        const riskBand = String(node.risk_band || props.findings_risk_band || '').toLowerCase();
        const isHvt = props.is_hvt === true;
        const trustExternal = props.trust_external === true;
        const dangerousPolicy = props.dangerous_policy === true;
        const typeText = `${node.type || ''} ${node.label || ''}`.toLowerCase();
        const isRole = typeText.includes('role');
        const score =
          riskLevel
          + (riskBand === 'critical' ? 34 : riskBand === 'high' ? 22 : 0)
          + (isHvt ? 26 : 0)
          + (trustExternal ? 18 : 0)
          + (dangerousPolicy ? 20 : 0)
          + (isRole ? 8 : 0);
        return { node, score, riskLevel, isRole };
      });

      const center = scoredNodes.sort((a, b) => b.score - a.score)[0]?.node;
      if (!center) {
        return null;
      }

      const maxHops = directive.neighborHops || 2;
      const visited = new Set<string>([center.id]);
      const distance = new Map<string, number>([[center.id, 0]]);
      const queue: string[] = [center.id];

      while (queue.length) {
        const current = queue.shift();
        if (!current) break;
        const currentDistance = distance.get(current) || 0;
        if (currentDistance >= maxHops) continue;
        (adjacency.get(current) || new Set<string>()).forEach((next) => {
          if (visited.has(next)) return;
          visited.add(next);
          distance.set(next, currentDistance + 1);
          queue.push(next);
        });
      }

      const rankedVisited = source.nodes
        .filter((node) => visited.has(node.id))
        .map((node) => {
          const props = node.properties || {};
          const riskLevel = Number(node.risk_level || props.findings_risk_score || 0);
          return {
            node,
            dist: distance.get(node.id) ?? 99,
            riskLevel,
          };
        })
        .sort((a, b) => {
          if (a.dist !== b.dist) return a.dist - b.dist;
          return b.riskLevel - a.riskLevel;
        });

      const cappedIds = new Set(
        rankedVisited
          .slice(0, Math.max(80, Math.min(directive.maxNodes || 1200, 1400)))
          .map((entry) => entry.node.id),
      );
      cappedIds.add(center.id);

      const nodes = source.nodes.filter((node) => cappedIds.has(node.id));
      const nodeIdSet = new Set(nodes.map((node) => node.id));
      const edges = source.edges.filter((edge) => nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target));

      return {
        graph: {
          ...source,
          query_key: 'local_ai_query',
          title: 'Local AI transform',
          nodes,
          edges,
          metrics: {
            ...(source.metrics || {}),
            total_nodes: nodes.length,
            total_edges: edges.length,
            query_title: 'Local AI transform',
            query_mode: 'local_ai_transform',
            note: directive.reason || `Local directive applied: ${directive.intent}`,
          },
        },
        summary: `Focused on the most dangerous zone around ${center.name || center.label || center.id} and kept up to ${maxHops} hops (${nodes.length} nodes / ${edges.length} edges).`,
        findings: [
          `Center selected from local risk signals: ${center.name || center.label || center.id}.`,
          `Included entities within ${maxHops} hop${maxHops > 1 ? 's' : ''} from that center.`,
        ],
        didUpdateGraph: true,
      };
    }

    const riskyBands = new Set(['critical', 'high']);
    const seedIds = new Set<string>();
    let usedPrivilegeEscalationHeuristic = false;

    source.nodes.forEach((node) => {
      const props = node.properties || {};
      const riskBand = String(node.risk_band || props.findings_risk_band || '').toLowerCase();
      const riskLevel = Number(node.risk_level || props.findings_risk_score || 0);
      const isHvt = props.is_hvt === true;
      const trustExternal = props.trust_external === true;
      const dangerousPolicy = props.dangerous_policy === true;
      const wildcardFlags = props.policy_summary && typeof props.policy_summary === 'object'
        ? (props.policy_summary as { has_wildcard_actions?: boolean; has_wildcard_resources?: boolean })
        : undefined;

      if (directive.intent === 'focus_hvt' && isHvt) seedIds.add(node.id);
      if (directive.intent === 'focus_external_trust' && trustExternal) seedIds.add(node.id);
      if (directive.intent === 'focus_dangerous_policy' && (dangerousPolicy || wildcardFlags?.has_wildcard_actions || wildcardFlags?.has_wildcard_resources)) {
        seedIds.add(node.id);
      }
      if (directive.intent === 'focus_high_risk' && (riskyBands.has(riskBand) || riskLevel >= (directive.minRiskScore || 70))) {
        seedIds.add(node.id);
      }
    });

    if (directive.intent === 'focus_privilege_escalation') {
      source.edges.forEach((edge) => {
        const props = edge.properties || {};
        if (props.is_privilege_escalation === true) {
          seedIds.add(edge.source);
          seedIds.add(edge.target);
        }
      });

      // Some datasets do not carry explicit is_privilege_escalation edge flags.
      // Fall back to a local heuristic so the graph never collapses to empty.
      if (!seedIds.size) {
        usedPrivilegeEscalationHeuristic = true;

        const rankedRiskyNodes = source.nodes
          .map((node) => {
            const props = node.properties || {};
            const riskBand = String(node.risk_band || props.findings_risk_band || '').toLowerCase();
            const riskLevel = Number(node.risk_level || props.findings_risk_score || 0);
            const isHvt = props.is_hvt === true;
            const trustExternal = props.trust_external === true;
            const dangerousPolicy = props.dangerous_policy === true;
            const score =
              riskLevel
              + (riskyBands.has(riskBand) ? 30 : 0)
              + (isHvt ? 28 : 0)
              + (trustExternal ? 20 : 0)
              + (dangerousPolicy ? 22 : 0);
            return { node, score, isHvt, trustExternal, dangerousPolicy };
          })
          .filter((entry) => entry.score >= 70 || entry.isHvt || entry.trustExternal || entry.dangerousPolicy)
          .sort((a, b) => b.score - a.score)
          .slice(0, 12);

        rankedRiskyNodes.forEach((entry) => seedIds.add(entry.node.id));

        source.edges.forEach((edge) => {
          const rel = String(edge.relationship_type || '').toUpperCase();
          const isPathLike =
            rel.includes('ASSUME')
            || rel.includes('TRUST')
            || rel.includes('HAS_POLICY')
            || rel.includes('ATTACHED')
            || rel.includes('MEMBER_OF')
            || rel.includes('GRANTS');
          if (isPathLike && (seedIds.has(edge.source) || seedIds.has(edge.target))) {
            seedIds.add(edge.source);
            seedIds.add(edge.target);
          }
        });
      }
    }

    if (!seedIds.size) return null;

    const adjacency = new Map<string, Set<string>>();
    source.edges.forEach((edge) => {
      if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
      if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
      adjacency.get(edge.source)?.add(edge.target);
      adjacency.get(edge.target)?.add(edge.source);
    });

    const keepIds = new Set(seedIds);
    if (directive.includeNeighbors) {
      let frontier = new Set(seedIds);
      for (let hop = 0; hop < (directive.neighborHops || 1); hop += 1) {
        const next = new Set<string>();
        frontier.forEach((nodeId) => {
          const neighbors = adjacency.get(nodeId) || new Set<string>();
          neighbors.forEach((neighbor) => {
            if (!keepIds.has(neighbor)) {
              keepIds.add(neighbor);
              next.add(neighbor);
            }
          });
        });
        frontier = next;
        if (!frontier.size) break;
      }
    }

    const weightedNodes = source.nodes
      .filter((node) => keepIds.has(node.id))
      .map((node) => {
        const props = node.properties || {};
        const risk = Number(node.risk_level || props.findings_risk_score || 0);
        return { node, risk, isSeed: seedIds.has(node.id) };
      })
      .sort((a, b) => {
        if (a.isSeed !== b.isSeed) return a.isSeed ? -1 : 1;
        return b.risk - a.risk;
      });

    const limitedNodeIds = new Set(weightedNodes.slice(0, directive.maxNodes || 1200).map((entry) => entry.node.id));
    const nodes = source.nodes.filter((node) => limitedNodeIds.has(node.id));
    const nodeIdSet = new Set(nodes.map((node) => node.id));
    const edges = source.edges.filter((edge) => nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target));

    const metrics = {
      ...(source.metrics || {}),
      total_nodes: nodes.length,
      total_edges: edges.length,
      query_title: 'Local AI transform',
      query_mode: 'local_ai_transform',
      note: directive.reason || `Local directive applied: ${directive.intent}`,
    };

    const findingMap: Record<LocalGraphIntent, string> = {
      focus_hvt: 'Focused on high-value targets and adjacent entities.',
      focus_external_trust: 'Focused on external trust relationships in the visible graph.',
      focus_dangerous_policy: 'Focused on dangerous or wildcard policy signals.',
      focus_roles_connected_dangerous_policy: 'Focused on roles attached to dangerous policies in the visible graph.',
      focus_dangerous_zone_hops: `Focused on the most dangerous zone and kept up to ${directive.neighborHops || 2} hops.`,
      focus_high_risk: `Focused on entities at or above risk score ${Math.round(directive.minRiskScore || 70)}.`,
      focus_privilege_escalation: 'Focused on privilege-escalation paths and adjacent entities.',
      focus_connection_path: 'Focused on the shortest visible connection path between the requested nodes.',
      focus_group_entities: 'Focused on entities connected to the selected group via membership relationships.',
      restore_full_view: 'Restored the full currently loaded graph view.',
    };

    const findings = [findingMap[directive.intent]];
    if (directive.intent === 'focus_privilege_escalation' && usedPrivilegeEscalationHeuristic) {
      findings.push('No explicit escalation edge flags were present, so a local risk/trust/policy path heuristic was applied.');
    }

    return {
      graph: {
        ...source,
        query_key: 'local_ai_query',
        title: 'Local AI transform',
        nodes,
        edges,
        metrics,
      },
      summary: `Applied local directive ${directive.intent} and kept ${nodes.length} nodes / ${edges.length} edges in view.`,
      findings,
      didUpdateGraph: true,
    };
  };

  const submitAiPrompt = async (event: React.FormEvent) => {
    event.preventDefault();
    await runAiPrompt(aiPrompt);
  };

  // =========================================================================
  // Effects
  // =========================================================================

  useEffect(() => {
    const loadAccounts = async () => {
      setAccountsLoading(true);
      try {
        const accounts = await getCloudHoundAccounts();
        setAccountList(accounts);
        if (accounts.length > 0) {
          const route = readRouteFromLocation();
          const matched = route.accountId
            ? accounts.find((account) => account.id === route.accountId)
            : undefined;
          setSelectedAwsAccountId(matched?.id || accounts[0].id);
        }
      } catch (err) {
        setErrors((prev) => ({
          ...prev,
          accounts: err instanceof Error ? err.message : 'Failed to load accounts',
        }));
      } finally {
        setAccountsLoading(false);
      }
    };
    loadAccounts();
  }, []);

  // Restore portal state from the URL hash on load (deep links) and keep
  // reacting to back/forward navigation. Only adopt the hash route when a hash
  // is actually present so a plain load still respects the last-used tab.
  useEffect(() => {
    const hasHash = Boolean(window.location.hash.replace(/^#/, ''));
    if (hasHash) {
      const route = readRouteFromLocation();
      setActiveTab(route.tab);
      if (route.accessSection) setActiveAccessSection(route.accessSection);
      if (route.graphQuery) setSelectedGraphQuery(route.graphQuery);
      if (route.focusArn) setFocusNodeArn(route.focusArn);
    }

    return subscribeToRouteChanges(() => {
      const next = readRouteFromLocation();
      setActiveTab(next.tab);
      if (next.accessSection) setActiveAccessSection(next.accessSection);
      if (next.graphQuery) setSelectedGraphQuery(next.graphQuery);
      if (next.focusArn) setFocusNodeArn(next.focusArn);
      if (next.accountId) setSelectedAwsAccountId(next.accountId);
    });
  }, []);

  // Mirror the active portal state into the URL hash so it is shareable and
  // survives reloads. Uses replaceState so it never spams browser history.
  useEffect(() => {
    if (!selectedAwsAccountId) return;
    writeRouteToLocation({
      tab: activeTab as RoutePortalTab,
      accountId: selectedAwsAccountId,
      graphQuery: activeTab === 'graph' ? selectedGraphQuery : undefined,
      focusArn: activeTab === 'graph' ? focusNodeArn || undefined : undefined,
      accessSection: activeTab === 'access' ? activeAccessSection : undefined,
    }, true);
  }, [activeTab, selectedAwsAccountId, selectedGraphQuery, focusNodeArn, activeAccessSection]);

  useEffect(() => {
    if (!selectedAwsAccountId) return;

    const loadLatestResult = async () => {
      setLoading(true);
      setErrors({});
      try {
        const result = await getCloudHoundLatestResult({
          selectedAwsAccountId,
          filters: {
            riskBands: selectedRiskBand === 'all' ? undefined : [selectedRiskBand],
            minRiskScore: minRiskScore > 0 ? minRiskScore : undefined,
            riskLimit: 200,
          },
        });
        setLatestResult(result);
      } catch (err) {
        setErrors({
          results: err instanceof Error ? err.message : 'Failed to load results',
        });
      } finally {
        setLoading(false);
      }
    };

    loadLatestResult();
  }, [selectedAwsAccountId, selectedRiskBand, minRiskScore]);

  useEffect(() => {
    if (!selectedAwsAccountId) {
      setScanHistory([]);
      return;
    }
    let cancelled = false;
    const loadScanHistory = async () => {
      setScanHistoryLoading(true);
      try {
        const history = await getCloudHoundScanHistory(selectedAwsAccountId, 12);
        if (!cancelled) setScanHistory(history);
      } catch (err) {
        if (!cancelled) setScanHistory([]);
      } finally {
        if (!cancelled) setScanHistoryLoading(false);
      }
    };
    loadScanHistory();
    return () => {
      cancelled = true;
    };
  }, [selectedAwsAccountId, latestResult?.scan_run?.id, latestResult?.status]);

  useEffect(() => {
    if (!selectedAwsAccountId) return;

    const loadInsightGraph = async () => {
      try {
        const graphData = await getCloudHoundGraph({
          selectedAwsAccountId,
          queryKey: 'iam_topology',
        });
        setInsightGraph(graphData);
      } catch {
        setInsightGraph(null);
      }
    };

    loadInsightGraph();
  }, [selectedAwsAccountId]);

  useEffect(() => {
    if (!selectedAwsAccountId) return;

    const loadGraph = async () => {
      setLoading(true);
      setErrors({});
      try {
        const graphData = await loadSelectedGraph(selectedAwsAccountId, selectedGraphQuery, activeGraphDirective);
        setGraph(graphData);
        setGraphSnapshot(graphData);
      } catch (err) {
        setErrors({
          graph: err instanceof Error ? err.message : 'Failed to load graph',
        });
      } finally {
        setLoading(false);
      }
    };

    if (activeTab === 'graph') {
      loadGraph();
    }
  }, [activeTab, selectedAwsAccountId, selectedGraphQuery, activeGraphDirective]);

  useEffect(() => {
    if (!selectedAwsAccountId) return;

    const loadToolUsers = async () => {
      setLoading(true);
      setErrors({});
      try {
        const result = await getCloudHoundToolUsers(selectedAwsAccountId);
        setToolUsers(result.users);
        setCurrentUserId(result.currentUserId);
      } catch (err) {
        setErrors({
          users: err instanceof Error ? err.message : 'Failed to load users',
        });
      } finally {
        setLoading(false);
      }
    };

    if (activeTab === 'access') {
      loadToolUsers();
    }
  }, [activeTab, selectedAwsAccountId]);

  useEffect(() => {
    if (activeTab === 'access' && !canAccessControl) {
      setActiveTab('results');
      setErrors((prev) => ({
        ...prev,
        users: 'Only admins can access Access Control.',
      }));
    }
  }, [activeTab, canAccessControl]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
    } catch {
      // Ignore storage failures and keep UI responsive.
    }
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, isLightMode ? 'light' : 'dark');
    } catch {
      // Ignore storage failures and keep UI responsive.
    }
  }, [isLightMode]);

  useEffect(() => {
    return () => {
      if (riskDrawerCloseTimer.current !== null) {
        window.clearTimeout(riskDrawerCloseTimer.current);
      }
    };
  }, []);

  // =========================================================================
  // Handlers
  // =========================================================================

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage('');
    setErrors((prev) => ({ ...prev, form: '', users: '' }));

    if (!formState.email) {
      setErrors({ form: 'Email is required' });
      return;
    }

    setIsAddingUser(true);
    try {
      const addedUser = await addCloudHoundToolUser({
        selectedAwsAccountId,
        email: formState.email,
        firstName: formState.firstName,
        lastName: formState.lastName,
      });

      setSuccessMessage(`User ${formState.email} added and invite sent.`);
      setToolUsers((prev) => {
        const withoutSame = prev.filter((user) => user.id !== addedUser.id);
        return [addedUser, ...withoutSame];
      });
      setFormState({ email: '', firstName: '', lastName: '' });

      const result = await getCloudHoundToolUsers(selectedAwsAccountId);
      setToolUsers(result.users);
      setCurrentUserId(result.currentUserId);
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'Failed to add user',
      });
    } finally {
      setIsAddingUser(false);
    }
  };

  const handleDeactivateUser = async (userId: string, email: string) => {
    setSuccessMessage('');
    setErrors((prev) => ({ ...prev, users: '' }));
    setActingUserId(userId);
    try {
      await deactivateCloudHoundToolUser({
        selectedAwsAccountId,
        userId,
      });

      setSuccessMessage(`User ${email} deactivated successfully`);
      const result = await getCloudHoundToolUsers(selectedAwsAccountId);
      setToolUsers(result.users);
      setCurrentUserId(result.currentUserId);
    } catch (err) {
      setErrors({
        users: err instanceof Error ? err.message : 'Failed to deactivate user',
      });
    } finally {
      setActingUserId('');
    }
  };

  const handleDeleteUser = async (userId: string, email: string) => {
    setSuccessMessage('');
    setErrors((prev) => ({ ...prev, users: '' }));
    setActingUserId(userId);
    try {
      await deleteCloudHoundToolUser({
        selectedAwsAccountId,
        userId,
      });

      setSuccessMessage(`User ${email} deleted successfully`);
      const result = await getCloudHoundToolUsers(selectedAwsAccountId);
      setToolUsers(result.users);
      setCurrentUserId(result.currentUserId);
    } catch (err) {
      setErrors({
        users: err instanceof Error ? err.message : 'Failed to delete user',
      });
    } finally {
      setActingUserId('');
    }
  };

  const handleSetAdminRole = async (userId: string, email: string, isAdmin: boolean) => {
    setSuccessMessage('');
    setErrors((prev) => ({ ...prev, users: '' }));
    setActingUserId(userId);
    try {
      await setCloudHoundToolUserAdmin({
        selectedAwsAccountId,
        userId,
        isAdmin,
      });

      setSuccessMessage(isAdmin ? `User ${email} promoted to admin` : `User ${email} removed from admin role`);
      const result = await getCloudHoundToolUsers(selectedAwsAccountId);
      setToolUsers(result.users);
      setCurrentUserId(result.currentUserId);
    } catch (err) {
      setErrors({
        users: err instanceof Error ? err.message : 'Failed to update admin role',
      });
    } finally {
      setActingUserId('');
    }
  };

  const formatLastLogin = (value: string | null): string => {
    if (!value) return 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleString();
  };

  const getSeverityStats = () => {
    if (!latestResult) {
      return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    }
    return latestResult.findings.reduce(
      (acc, finding) => {
        acc[finding.severity] += 1;
        return acc;
      },
      { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    );
  };

  const getFilteredFindings = (): CloudHoundFinding[] => {
    if (!latestResult) return [];
    if (selectedSeverity === 'all') return latestResult.findings.slice(0, 12);
    return latestResult.findings.filter((f) => f.severity === selectedSeverity).slice(0, 12);
  };

  const getRiskEntities = (): CloudHoundRiskScore[] => {
    if (!latestResult) return [];
    return latestResult.risk_scores;
  };

  const openRiskDrawer = (risk: CloudHoundRiskScore) => {
    if (riskDrawerCloseTimer.current !== null) {
      window.clearTimeout(riskDrawerCloseTimer.current);
      riskDrawerCloseTimer.current = null;
    }
    setSelectedRiskEntity(risk);
    setIsRiskDrawerOpen(false);
    window.requestAnimationFrame(() => setIsRiskDrawerOpen(true));
  };

  const closeRiskDrawer = () => {
    setIsRiskDrawerOpen(false);
    if (riskDrawerCloseTimer.current !== null) {
      window.clearTimeout(riskDrawerCloseTimer.current);
    }
    riskDrawerCloseTimer.current = window.setTimeout(() => {
      setSelectedRiskEntity(null);
      riskDrawerCloseTimer.current = null;
    }, 240);
  };

  const getRiskReferenceLinks = (risk: CloudHoundRiskScore): RiskReferenceLink[] => {
    const factors = (risk.factors || {}) as Record<string, unknown>;
    const links: RiskReferenceLink[] = [
      {
        label: 'AWS IAM best practices',
        url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html',
      },
      {
        label: 'AWS IAM policy evaluation logic',
        url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html',
      },
    ];

    if (factors.has_cross_account_trust === true || factors.exposure_factor === 1.25) {
      links.push(
        {
          label: 'AWS IAM role trust policies',
          url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_terms-and-concepts.html#trusted-principal',
        },
        {
          label: 'MITRE ATT&CK: Valid Accounts - Cloud Accounts',
          url: 'https://attack.mitre.org/techniques/T1078/004/',
        },
      );
    }

    if ((factors.privilege_escalation_paths as number | undefined) || (factors.path_bonus as number | undefined)) {
      links.push(
        {
          label: 'MITRE ATT&CK: Additional Cloud Roles',
          url: 'https://attack.mitre.org/techniques/T1098/003/',
        },
        {
          label: 'MITRE ATT&CK: Account Manipulation',
          url: 'https://attack.mitre.org/techniques/T1098/',
        },
      );
    }

    if (factors.is_hvt === true) {
      links.push({
        label: 'AWS Security best practices for high-value identities',
        url: 'https://docs.aws.amazon.com/whitepapers/latest/aws-security-incident-response-guide/identifying-the-attack-surface.html',
      });
    }

    return links;
  };

  const getRiskEntityInsightLines = (risk: CloudHoundRiskScore): string[] => {
    const factors = (risk.factors || {}) as Record<string, unknown>;
    const lines: string[] = [];

    lines.push(`Score ${Number(risk.score).toFixed(1)} places this entity in the ${(risk.risk_band || 'low').toUpperCase()} band.`);

    if (typeof factors.base_score === 'number') {
      lines.push(`Base score from unique finding types: ${Number(factors.base_score).toFixed(1)}.`);
    }

    if (typeof factors.repeat_bonus === 'number' && factors.repeat_bonus > 0) {
      lines.push(`Repeated finding types add ${Number(factors.repeat_bonus).toFixed(1)} extra pressure, which usually means the same weakness appears on multiple edges or resources.`);
    }

    if (typeof factors.path_bonus === 'number' && factors.path_bonus > 0) {
      lines.push(`Privilege-escalation context adds ${Number(factors.path_bonus).toFixed(1)}. This is the part that makes the entity operationally dangerous, not just noisy.`);
    }

    if (typeof factors.blast_bonus === 'number' && factors.blast_bonus > 0) {
      lines.push(`Blast-radius pressure adds ${Number(factors.blast_bonus).toFixed(1)} because this entity can impact more than one trust boundary or asset class.`);
    }

    if (factors.is_hvt === true) {
      lines.push('The entity is tagged as high-value target, so compromise is more likely to matter operationally.');
    }

    if (factors.has_cross_account_trust === true) {
      lines.push('Cross-account trust is enabled, which makes lateral movement and trust-boundary abuse more practical.');
    }

    return lines;
  };

  const getRiskEntityRecommendations = (risk: CloudHoundRiskScore): string[] => {
    const factors = (risk.factors || {}) as Record<string, unknown>;
    const recs: string[] = [];

    if (risk.risk_band === 'critical') {
      recs.push('Contain or disable the path immediately if this entity is reachable from a low-privilege principal.');
    }

    if (factors.privilege_escalation_paths) {
      recs.push('Remove or scope down permissions that allow role creation, policy attachment, or trust-policy modification.');
    }

    if (factors.has_cross_account_trust === true) {
      recs.push('Restrict the trust policy to explicit principals and conditions such as aws:PrincipalOrgID or ExternalId where appropriate.');
    }

    if (factors.is_hvt === true) {
      recs.push('Treat this as a crown-jewel path: validate MFA, session duration, and break-glass access controls.');
    }

    recs.push('Verify the finding in IAM Topology, then confirm whether the permission is actually needed for business use.');

    return recs;
  };

  const selectedRiskEntityLinks = selectedRiskEntity ? getRiskReferenceLinks(selectedRiskEntity) : [];
  const selectedRiskEntityInsights = selectedRiskEntity ? getRiskEntityInsightLines(selectedRiskEntity) : [];
  const selectedRiskEntityRecommendations = selectedRiskEntity ? getRiskEntityRecommendations(selectedRiskEntity) : [];

  const severityStats = getSeverityStats();

  const allRiskEntities: CloudHoundRiskScore[] = latestResult?.risk_scores ?? [];
  const summary = latestResult?.risk_summary;
  const insightGraphNodes = insightGraph?.nodes ?? [];
  const insightGraphMetrics = insightGraph?.metrics;

  const graphRiskBandCounts = insightGraphNodes.reduce(
    (acc, node) => {
      const riskLevel = Number(node.findings_risk_score ?? node.properties?.findings_risk_score ?? node.risk_level ?? 0);
      const band = String(node.findings_risk_band ?? node.properties?.findings_risk_band ?? node.risk_band ?? '').toLowerCase();
      if (riskLevel <= 0) return acc;
      if (band === 'critical' || band === 'high' || band === 'medium' || band === 'low') {
        acc[band] += 1;
        acc.total += 1;
      }
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  );

  const criticalEntityCount = graphRiskBandCounts.total > 0 ? graphRiskBandCounts.critical : summary?.critical || allRiskEntities.filter((risk) => risk.risk_band === 'critical').length;

  const highEntityCount = graphRiskBandCounts.total > 0 ? graphRiskBandCounts.high : summary?.high || allRiskEntities.filter((risk) => risk.risk_band === 'high').length;

  const mediumEntityCount = graphRiskBandCounts.total > 0 ? graphRiskBandCounts.medium : summary?.medium || allRiskEntities.filter((risk) => risk.risk_band === 'medium').length;

  const lowEntityCount = graphRiskBandCounts.total > 0 ? graphRiskBandCounts.low : summary?.low || allRiskEntities.filter((risk) => risk.risk_band === 'low').length;

  const externalTrustEntityCount = insightGraphMetrics?.external_trust_roles ?? summary?.external_trust_entities ?? insightGraphNodes.filter((node) => {
    const properties = (node.properties || {}) as Record<string, unknown>;
    return properties.trust_external === true;
  }).length;

  const privilegeEscPathCount = insightGraphMetrics?.privilege_escalation_paths ?? summary?.privilege_escalation_paths ?? (latestResult?.risk_scores ?? []).filter((risk) => {
    const factors = (risk.factors || {}) as Record<string, unknown>;
    const pathCount = Number(factors.privilege_escalation_paths ?? 0);
    const pathBonus = Number(factors.path_bonus ?? 0);
    return pathCount > 0 || pathBonus > 0;
  }).length;

  const findingTypeCounts = (latestResult?.findings ?? []).reduce((acc, finding) => {
    acc[finding.finding_type] = (acc[finding.finding_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const topFindingType = Object.entries(findingTypeCounts).sort((a, b) => b[1] - a[1])[0];

  const practicalActions = [
    criticalEntityCount > 0
      ? `Prioritize containment for ${criticalEntityCount} critical-risk ${criticalEntityCount === 1 ? 'entity' : 'entities'} (start with top score in High-Risk Entities).`
      : '',
    privilegeEscPathCount > 0
      ? `Review ${privilegeEscPathCount} privilege-escalation ${privilegeEscPathCount === 1 ? 'path' : 'paths'} in IAM Topology and remove attach/create role capabilities where unnecessary.`
      : '',
    externalTrustEntityCount > 0
      ? `Validate cross-account trust on ${externalTrustEntityCount} ${externalTrustEntityCount === 1 ? 'entity' : 'entities'} and restrict principals to explicit account IDs/conditions.`
      : '',
    severityStats.critical > 0
      ? `Create immediate response tickets for ${severityStats.critical} critical findings and assign owners before the next scan cycle.`
      : '',
    topFindingType
      ? `Most frequent issue is ${topFindingType[0]} (${topFindingType[1]} findings) - address this pattern first to reduce alert volume fastest.`
      : '',
  ].filter(Boolean) as string[];

  const totalRiskFindings =
    severityStats.critical +
    severityStats.high +
    severityStats.medium +
    severityStats.low +
    severityStats.info;
  const riskSegments = [
    { key: 'critical', label: 'Critical', value: severityStats.critical, color: '#ef4444' },
    { key: 'high', label: 'High', value: severityStats.high, color: '#f97316' },
    { key: 'medium', label: 'Medium', value: severityStats.medium, color: '#f59e0b' },
    { key: 'low', label: 'Low', value: severityStats.low, color: '#22c55e' },
    { key: 'info', label: 'Info', value: severityStats.info, color: '#64748b' },
  ];

  const donutRadius = 46;
  const donutCircumference = 2 * Math.PI * donutRadius;
  let dashOffset = 0;
  const donutSlices = riskSegments.map((segment) => {
    const proportion = totalRiskFindings > 0 ? segment.value / totalRiskFindings : 0;
    const segmentLength = proportion * donutCircumference;
    const slice = {
      ...segment,
      segmentLength,
      dashOffset,
      percentage: proportion * 100,
    };
    dashOffset -= segmentLength;
    return slice;
  });

  // =========================================================================
  // Render
  // =========================================================================

  return (
    <div className={`h-screen overflow-hidden flex ${isLightMode ? 'bg-slate-50 text-slate-900' : 'bg-[#0a0f18] text-[#e8edf6]'}`}>
      {/* Sidebar */}
      <div className={`w-64 shrink-0 border-r flex flex-col overflow-hidden ${isLightMode ? 'border-slate-200 bg-white' : 'border-[#283246]/75 bg-[#0f141d]'}`}>
        {/* Branding */}
        <div className={`px-6 border-b flex items-center min-h-[74px] ${isLightMode ? 'border-slate-200 bg-white' : 'border-[#283246]/75 bg-[#0b111b]'}`}>
          <img src={isLightMode ? '/cloudhound_wordmark_black.png' : '/cloudhound_wordmark_white.png'} alt="CloudHound" className="h-6 w-auto max-w-[150px] opacity-95" />
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-6 pt-7 pb-4 space-y-1.5">
          <p className={`text-xs font-light uppercase tracking-widest mb-3 ${isLightMode ? 'text-slate-700' : 'text-[#93a0b8]'}`}>Navigation</p>
          <button
            type="button"
            onClick={() => goToSection('results')}
            className={`block w-full px-3 py-1.5 text-left text-sm font-light border-l-2 rounded-r transition-colors ${
              activeTab === 'results'
                ? (isLightMode ? 'text-slate-900 border-slate-700 bg-slate-100' : 'text-[#f2f6fd] border-[#526482] bg-[#1a2230]')
                : (isLightMode ? 'text-slate-700 border-transparent hover:text-slate-900 hover:bg-slate-100' : 'text-[#a7b4ca] border-transparent hover:text-[#f2f6fd] hover:bg-[#1a2230]')
            }`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => goToSection('results')}
            className={`block w-full px-3 py-1.5 text-left text-sm font-light border-l-2 rounded-r transition-colors ${
              activeTab === 'results'
                ? (isLightMode ? 'text-slate-900 border-slate-700 bg-slate-100' : 'text-[#f2f6fd] border-[#526482] bg-[#1a2230]')
                : (isLightMode ? 'text-slate-700 border-transparent hover:text-slate-900 hover:bg-slate-100' : 'text-[#a7b4ca] border-transparent hover:text-[#f2f6fd] hover:bg-[#1a2230]')
            }`}
          >
            Incidents
          </button>
          <button
            type="button"
            onClick={() => goToSection('graph')}
            className={`block w-full px-3 py-1.5 text-left text-sm font-light border-l-2 rounded-r transition-colors ${
              activeTab === 'graph'
                ? (isLightMode ? 'text-slate-900 border-slate-700 bg-slate-100' : 'text-[#f2f6fd] border-[#526482] bg-[#1a2230]')
                : (isLightMode ? 'text-slate-700 border-transparent hover:text-slate-900 hover:bg-slate-100' : 'text-[#a7b4ca] border-transparent hover:text-[#f2f6fd] hover:bg-[#1a2230]')
            }`}
          >
            Topology
          </button>
          <button
            type="button"
            onClick={() => goToSection('access', 'users')}
            className={`block w-full px-3 py-1.5 text-left text-sm font-light border-l-2 rounded-r transition-colors ${
              activeTab === 'access'
                ? (isLightMode ? 'text-slate-900 border-slate-700 bg-slate-100' : 'text-[#f2f6fd] border-[#526482] bg-[#1a2230]')
                : (isLightMode ? 'text-slate-700 border-transparent hover:text-slate-900 hover:bg-slate-100' : 'text-[#a7b4ca] border-transparent hover:text-[#f2f6fd] hover:bg-[#1a2230]')
            }`}
          >
            Users
          </button>
        </nav>

        {/* Settings */}
        <div className={`px-6 py-3 border-t space-y-1.5 ${isLightMode ? 'border-slate-200' : 'border-[#283246]/75'}`}>
          <p className={`text-xs font-light uppercase tracking-widest mb-3 ${isLightMode ? 'text-slate-700' : 'text-[#93a0b8]'}`}>Settings</p>
          <button
            type="button"
            onClick={() => goToSection('access', 'configuration')}
            className={`block w-full px-3 py-1.5 text-left text-sm font-light rounded transition-colors ${
              activeTab === 'access' && activeAccessSection === 'configuration'
                ? (isLightMode ? 'text-slate-900 bg-slate-100' : 'text-[#f2f6fd] bg-[#1a2230]')
                : (isLightMode ? 'text-slate-700 hover:text-slate-900 hover:bg-slate-100' : 'text-[#a7b4ca] hover:text-[#f2f6fd] hover:bg-[#1a2230]')
            }`}
          >
            Configuration
          </button>
          <button
            type="button"
            onClick={() => goToSection('access', 'integrations')}
            className={`block w-full px-3 py-1.5 text-left text-sm font-light rounded transition-colors ${
              activeTab === 'access' && activeAccessSection === 'integrations'
                ? (isLightMode ? 'text-slate-900 bg-slate-100' : 'text-[#f2f6fd] bg-[#1a2230]')
                : (isLightMode ? 'text-slate-700 hover:text-slate-900 hover:bg-slate-100' : 'text-[#a7b4ca] hover:text-[#f2f6fd] hover:bg-[#1a2230]')
            }`}
          >
            Integrations
          </button>
          <button
            onClick={() => onLogout?.()}
            className={`w-full px-3 py-1.5 text-sm font-light rounded transition-colors text-left ${isLightMode ? 'text-slate-700 hover:text-slate-900 hover:bg-slate-100' : 'text-[#a7b4ca] hover:text-[#f2f6fd] hover:bg-[#1a2230]'}`}
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className={`flex-1 min-w-0 flex flex-col ${isLightMode ? 'bg-slate-50' : 'bg-[#0a0f18]'}`}>
        <div className={`sticky top-0 z-30 backdrop-blur-sm border-b ${isLightMode ? 'bg-slate-100/95 border-slate-200 shadow-[0_8px_20px_rgba(15,23,42,0.06)]' : 'bg-[#0f141d]/95 border-[#2a3447]/75 shadow-[0_8px_20px_rgba(0,0,0,0.32)]'}`}>
          <div className="px-7 pt-3 pb-2">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className={`text-xl font-light tracking-wide ${isLightMode ? 'text-slate-900' : 'text-[#eaf0fa]'}`}>Security Dashboard</h2>
                <p className={`text-xs mt-1 ${isLightMode ? 'text-slate-500' : 'text-[#a8b4ca]'}`}>Real-time threat monitoring and incident response</p>
              </div>
              <div className="flex items-center gap-6">
                <button
                  type="button"
                  onClick={() => setIsLightMode((mode) => !mode)}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition ${isLightMode ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100' : 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'}`}
                  aria-label={isLightMode ? 'Switch to dark mode' : 'Switch to light mode'}
                  title={isLightMode ? 'Switch to dark mode' : 'Switch to light mode'}
                >
                  {isLightMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                </button>
                {selectedAwsAccountId && (
                  <div className="text-right">
                    <p className={`text-xs ${isLightMode ? 'text-slate-500' : 'text-[#a8b4ca]'}`}>Active Account</p>
                    <p className={`text-sm font-light ${isLightMode ? 'text-slate-900' : 'text-[#e8edf6]'}`}>{loggedInUserName || 'Signed in user'}</p>
                  </div>
                )}
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded border ${isLightMode ? 'border-slate-300 bg-slate-50' : 'border-[#3a465e] bg-[#121926]'}`}>
                  <div className="w-7 h-7 bg-gradient-to-br from-orange-500 to-amber-600 rounded flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-light text-white">{accountRoleInitial}</span>
                  </div>
                  <div className="text-left leading-tight">
                    <p className={`text-sm ${isLightMode ? 'text-slate-900' : 'text-[#e9eef8]'}`}>{accountRoleLabel}</p>
                    <p className={`text-[11px] ${isLightMode ? 'text-slate-500' : 'text-[#9aa7bd]'}`}>{canAccessControl ? 'authenticated' : 'read-only'}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-end justify-between gap-6">
              <div className="min-w-0">
                <label className={`text-xs font-light uppercase tracking-widest block mb-2 ${isLightMode ? 'text-slate-500' : 'text-[#9eabc2]'}`}>AWS Account</label>
                {accountsLoading ? (
                  <div className={`text-sm ${isLightMode ? 'text-slate-500' : 'text-[#a8b4ca]'}`}>Loading accounts...</div>
                ) : accountList.length === 0 ? (
                  <div className={`text-sm ${isLightMode ? 'text-slate-500' : 'text-[#a8b4ca]'}`}>No accounts found</div>
                ) : (
                  <select
                    value={selectedAwsAccountId}
                    onChange={(e) => setSelectedAwsAccountId(e.target.value)}
                    className={`px-4 py-2 rounded focus:outline-none focus:ring-1 focus:border-transparent font-light text-sm w-64 ${isLightMode ? 'bg-white border border-slate-300 text-slate-900 focus:ring-slate-400' : 'bg-[#121926] border border-[#3a465e] text-[#e7edf8] focus:ring-[#4a5b79]'}`}
                  >
                    {accountList.map((account) => (
                      <option key={account.id} value={account.id} className={isLightMode ? 'bg-white' : 'bg-slate-950'}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex shrink-0">
                {([
                  { id: 'results', label: 'Scan Results', icon: TrendingUp },
                  { id: 'graph', label: 'IAM Topology', icon: AlertTriangle },
                  { id: 'assistant', label: 'AI Assistant', icon: Activity },
                  { id: 'access', label: 'Access Control', icon: Users },
                ] as Array<{ id: PortalTab; label: string; icon: typeof TrendingUp }>).filter((tab) => tab.id !== 'access' || canAccessControl).map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`w-[172px] flex items-center justify-center gap-2 px-0 py-2 font-light text-sm tracking-wide uppercase border-b-2 transition-all ${
                        activeTab === tab.id
                          ? (isLightMode ? 'text-slate-900 border-b-orange-500' : 'text-[#f2f6fd] border-b-orange-500')
                          : (isLightMode ? 'text-slate-500 border-b-transparent hover:text-slate-900' : 'text-[#9eabc2] border-b-transparent hover:text-[#e8edf6]')
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Tab Content */}
        <div className={`flex-1 min-h-0 overflow-auto ${isLightMode ? 'bg-slate-50' : 'bg-[#0a0f18]'}`}>
          {/* Tab 1: Scan Results */}
          {activeTab === 'results' && (
            <div className="px-7 py-6">
            <div className="space-y-6">
              {errors.results && (
                <Alert title="Error loading results" description={errors.results} type="error" isLightMode={isLightMode} />
              )}

              {loading && (
                <div className="flex flex-col items-center justify-center py-16">
                  <Clock className={`w-16 h-16 animate-spin mb-4 ${isLightMode ? 'text-slate-400' : 'text-[#7e8fae]'}`} />
                  <p className={isLightMode ? 'text-slate-500' : 'text-slate-400'}>Loading scan results...</p>
                </div>
              )}

              {latestResult && !loading && (
                <>
                  {/* Status Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <Card isLightMode={isLightMode}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className={`text-xs font-light mb-2 tracking-widest ${isLightMode ? 'text-slate-600' : 'text-[#afbbd1]'}`}>Status</p>
                          <p className={`text-3xl font-light capitalize ${isLightMode ? 'text-slate-900' : 'text-[#eef3fb]'}`}>{latestResult.status}</p>
                        </div>
                        {latestResult.status === 'success' && (
                          <CheckCircle className="w-12 h-12 text-emerald-400 opacity-45" />
                        )}
                        {latestResult.status === 'running' && (
                          <Clock className={`w-12 h-12 opacity-45 animate-spin ${isLightMode ? 'text-slate-400' : 'text-[#9badcb]'}`} />
                        )}
                      </div>
                    </Card>

                    <Card isLightMode={isLightMode}>
                      <div>
                        <p className={`text-xs font-light mb-4 tracking-widest ${isLightMode ? 'text-slate-600' : 'text-[#afbbd1]'}`}>Analysis Progress</p>
                        <div className={`w-full rounded h-2 mb-3 border overflow-hidden ${isLightMode ? 'bg-slate-200 border-slate-300' : 'bg-[#1a2230] border-[#3a465e]'}`}>
                          <div
                            className="bg-orange-500 h-2 rounded transition-all duration-300 shadow-[0_0_10px_rgba(251,146,60,0.35)]"
                            style={{ width: `${latestResult.progress_percent}%` }}
                          />
                        </div>
                        <p className={`text-2xl font-light ${isLightMode ? 'text-slate-900' : 'text-[#eef3fb]'}`}>{latestResult.progress_percent}%</p>
                      </div>
                    </Card>

                    <Card isLightMode={isLightMode}>
                      <div>
                        <p className={`text-xs font-light mb-2 tracking-widest ${isLightMode ? 'text-slate-600' : 'text-[#afbbd1]'}`}>Threats Detected</p>
                        <p className={`text-3xl font-light ${isLightMode ? 'text-rose-600' : 'text-rose-400'}`}>{latestResult.scan_run?.findings_count ?? latestResult.findings.length}</p>
                        <p className={`text-xs mt-1 ${isLightMode ? 'text-slate-500' : 'text-[#92a0b8]'}`}>security findings</p>
                      </div>
                    </Card>
                  </div>

                  {/* Scan history trend */}
                  <div className="mb-8">
                    <ScanHistoryTrend
                      history={scanHistory}
                      isLightMode={isLightMode}
                      loading={scanHistoryLoading}
                      latestResultId={latestResult.scan_run?.id ?? null}
                      latestFindings={latestResult.findings}
                      onCompareScans={() => setCompareOpen(true)}
                    />
                  </div>

                  {/* Insight Summary */}
                  <Card isLightMode={isLightMode}>
                    <div className="mb-4 flex items-center justify-between gap-4">
                      <p className={`text-xs font-light uppercase tracking-widest ${isLightMode ? 'text-slate-700' : 'text-[#c8d2e4]'}`}>Actionable Insights</p>
                      <p className={`text-[11px] ${isLightMode ? 'text-slate-500' : 'text-[#8fa0bb]'}`}>Prioritized from current scan context</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
                      <div className={`rounded border px-3 py-3 ${isLightMode ? 'border-slate-300 bg-slate-100' : 'border-[#364258] bg-[#171e2a]'}`}>
                        <p className={`text-[11px] uppercase tracking-widest ${isLightMode ? 'text-slate-600' : 'text-[#8fa0bb]'}`}>Critical entities</p>
                        <p className={`text-xl font-light mt-1 ${isLightMode ? 'text-slate-900' : 'text-[#eef3fb]'}`}>{criticalEntityCount}</p>
                      </div>
                      <div className={`rounded border px-3 py-3 ${isLightMode ? 'border-slate-300 bg-slate-100' : 'border-[#364258] bg-[#171e2a]'}`}>
                        <p className={`text-[11px] uppercase tracking-widest ${isLightMode ? 'text-slate-600' : 'text-[#8fa0bb]'}`}>High entities</p>
                        <p className={`text-xl font-light mt-1 ${isLightMode ? 'text-slate-900' : 'text-[#eef3fb]'}`}>{highEntityCount}</p>
                      </div>
                      <div className={`rounded border px-3 py-3 ${isLightMode ? 'border-slate-300 bg-slate-100' : 'border-[#364258] bg-[#171e2a]'}`}>
                        <p className={`text-[11px] uppercase tracking-widest ${isLightMode ? 'text-slate-600' : 'text-[#8fa0bb]'}`}>Priv-esc paths</p>
                        <p className={`text-xl font-light mt-1 ${isLightMode ? 'text-slate-900' : 'text-[#eef3fb]'}`}>{privilegeEscPathCount}</p>
                      </div>
                      <div className={`rounded border px-3 py-3 ${isLightMode ? 'border-slate-300 bg-slate-100' : 'border-[#364258] bg-[#171e2a]'}`}>
                        <p className={`text-[11px] uppercase tracking-widest ${isLightMode ? 'text-slate-600' : 'text-[#8fa0bb]'}`}>External trust</p>
                        <p className={`text-xl font-light mt-1 ${isLightMode ? 'text-slate-900' : 'text-[#eef3fb]'}`}>{externalTrustEntityCount}</p>
                      </div>
                    </div>

                    <div className={`rounded border px-4 py-3 ${isLightMode ? 'border-slate-300 bg-slate-100' : 'border-[#364258] bg-[#171e2a]'}`}>
                      <p className={`text-[11px] uppercase tracking-widest mb-2 ${isLightMode ? 'text-slate-700' : 'text-[#9fb0c9]'}`}>Recommended next actions</p>
                      {practicalActions.length > 0 ? (
                        <ul className="space-y-2">
                          {practicalActions.slice(0, 5).map((item, idx) => (
                            <li key={`${idx}-${item.slice(0, 24)}`} className={`text-sm flex gap-2 ${isLightMode ? 'text-slate-800' : 'text-[#d7e0ef]'}`}>
                              <span className={isLightMode ? 'text-slate-500' : 'text-[#8fa0bb]'}>{idx + 1}.</span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className={`text-sm ${isLightMode ? 'text-slate-600' : 'text-[#a8b4ca]'}`}>No urgent recommendations generated for this scan.</p>
                      )}
                      <p className="text-[11px] text-[#8fa0bb] mt-3">
                        Entity risk distribution: C {criticalEntityCount} / H {highEntityCount} / M {mediumEntityCount} / L {lowEntityCount}
                      </p>
                    </div>
                  </Card>

                  {/* High-Risk Entities */}
                  <Card isLightMode={isLightMode}>
                    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                      <p className={`text-xs font-light uppercase tracking-widest ${isLightMode ? 'text-slate-700' : 'text-[#c8d2e4]'}`}>
                        High-Risk Entities ({getRiskEntities().length})
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-light text-[#9fb0c9] uppercase tracking-widest">Band</span>
                        {['all', 'critical', 'high', 'medium', 'low'].map((band) => (
                          <button
                            key={band}
                            type="button"
                            onClick={() => setSelectedRiskBand(band as typeof selectedRiskBand)}
                            className={`px-2 py-1 text-xs font-light rounded transition-all border ${
                              selectedRiskBand === band
                                  ? (isLightMode ? 'bg-slate-300 text-slate-900 border-slate-400' : 'bg-[#1e2736] text-[#eaf0fa] border-[#4a5874]')
                                  : (isLightMode ? 'bg-slate-200 text-slate-700 border-slate-300 hover:border-slate-400 hover:text-slate-900' : 'bg-[#171d28] text-[#a8b4ca] border-[#38445c] hover:border-[#4a5874] hover:text-[#eaf0fa]')
                            }`}
                          >
                            {band === 'all' ? 'All' : band.charAt(0).toUpperCase() + band.slice(1)}
                          </button>
                        ))}
                          <span className={`ml-3 text-[11px] font-light uppercase tracking-widest ${isLightMode ? 'text-slate-600' : 'text-[#9fb0c9]'}`}>Min score</span>
                        {[
                          { value: 0, label: 'Lowest' },
                          { value: 40, label: 'Low' },
                          { value: 70, label: 'High' },
                          { value: 85, label: 'Critical' },
                        ].map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setMinRiskScore(option.value)}
                            className={`px-2 py-1 text-xs font-light rounded transition-all border ${
                              minRiskScore === option.value
                                  ? (isLightMode ? 'bg-slate-300 text-slate-900 border-slate-400' : 'bg-[#1e2736] text-[#eaf0fa] border-[#4a5874]')
                                  : (isLightMode ? 'bg-slate-200 text-slate-700 border-slate-300 hover:border-slate-400 hover:text-slate-900' : 'bg-[#171d28] text-[#a8b4ca] border-[#38445c] hover:border-[#4a5874] hover:text-[#eaf0fa]')
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {getRiskEntities().map((risk) => (
                        <button
                          key={risk.id}
                          type="button"
                          onClick={() => openRiskDrawer(risk)}
                            className={`w-full border text-left px-4 py-3 transition-all ${isLightMode ? 'bg-slate-100' : 'bg-[#171e2a]'} ${
                            selectedRiskEntity?.id === risk.id
                              ? 'border-sky-500/70 shadow-[0_0_0_1px_rgba(56,189,248,0.35)]'
                                : (isLightMode ? 'border-slate-300 hover:border-slate-400' : 'border-[#364258] hover:border-[#4b5b78]')
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <p className={`text-sm truncate ${isLightMode ? 'text-slate-900' : 'text-slate-100'}`}>{risk.entity_name || risk.entity_arn}</p>
                                <p className={`text-xs mt-1 ${isLightMode ? 'text-slate-600' : 'text-[#a8b4ca]'}`}>
                                {risk.entity_type} • {risk.entity_arn || 'No ARN'}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                                <p className={`text-lg font-light ${isLightMode ? 'text-slate-900' : 'text-[#eef3fb]'}`}>{Number(risk.score).toFixed(1)}</p>
                              <Badge
                                label={(risk.risk_band || 'low').toUpperCase()}
                                variant={(risk.risk_band || 'low') as 'critical' | 'high' | 'medium' | 'low'}
                                isLightMode={isLightMode}
                              />
                            </div>
                          </div>
                        </button>
                      ))}
                      {getRiskEntities().length === 0 && (
                          <div className={`border px-4 py-6 text-sm ${isLightMode ? 'border-slate-300 bg-slate-100 text-slate-600' : 'border-[#364258] bg-[#171e2a] text-[#a8b4ca]'}`}>
                          No entities match the selected risk filters.
                        </div>
                      )}
                    </div>
                  </Card>

                  {selectedRiskEntity && (
                    <>
                      <div
                        className={`fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] transition-opacity duration-240 ${
                          isRiskDrawerOpen ? 'opacity-100' : 'opacity-0'
                        }`}
                        onClick={closeRiskDrawer}
                        aria-hidden="true"
                      />
                      <aside
                        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col ${
                          isLightMode
                            ? 'border-l border-slate-300 bg-white shadow-[0_0_48px_rgba(15,23,42,0.15)] backdrop-blur-xl'
                            : 'border-l border-sky-500/20 bg-[#0b1018]/98 shadow-[0_0_48px_rgba(15,23,42,0.7)] backdrop-blur-xl'
                        } transition-transform duration-240 ${
                          isRiskDrawerOpen ? 'translate-x-0' : 'translate-x-full'
                        }`}
                      >
                        <div className={`flex items-start justify-between gap-4 border-b ${isLightMode ? 'border-slate-200' : 'border-white/10'} px-5 py-4`}>
                          <div className="min-w-0">
                            <p className={`text-[11px] uppercase tracking-[0.24em] ${isLightMode ? 'text-sky-600' : 'text-sky-300/80'}`}>Risk insight</p>
                            <h3 className={`mt-1 truncate text-lg font-light ${isLightMode ? 'text-slate-900' : 'text-slate-50'}`}>
                              {selectedRiskEntity.entity_name || selectedRiskEntity.entity_arn || 'Selected entity'}
                            </h3>
                            <p className={`text-xs ${isLightMode ? 'text-slate-600' : 'text-slate-400'}`}>
                              {selectedRiskEntity.entity_type || 'entity'} • {selectedRiskEntity.entity_arn || 'No ARN'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={closeRiskDrawer}
                            className={`rounded-full border ${isLightMode ? 'border-slate-300 bg-slate-100 text-slate-700 hover:border-sky-400 hover:bg-sky-100 hover:text-sky-700' : 'border-white/10 bg-white/5 text-slate-200 hover:border-sky-400/50 hover:bg-sky-500/10 hover:text-white'} p-2 transition`}
                            aria-label="Close insight drawer"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="flex-1 overflow-y-auto px-5 py-4">
                          <div className={`mb-4 flex items-center justify-between gap-3 rounded-xl border ${isLightMode ? 'border-slate-300 bg-slate-100' : 'border-white/10 bg-white/5'} px-4 py-3`}>
                            <div>
                              <p className={`text-[11px] uppercase tracking-[0.24em] ${isLightMode ? 'text-slate-600' : 'text-slate-400'}`}>Score</p>
                              <p className={`text-3xl font-light ${isLightMode ? 'text-slate-900' : 'text-slate-50'}`}>{Number(selectedRiskEntity.score).toFixed(1)}</p>
                            </div>
                            <Badge
                              label={(selectedRiskEntity.risk_band || 'low').toUpperCase()}
                              variant={(selectedRiskEntity.risk_band || 'low') as 'critical' | 'high' | 'medium' | 'low'}
                              isLightMode={isLightMode}
                            />
                          </div>

                          {selectedRiskEntity.entity_arn && (
                            <div className="mb-4 flex flex-wrap gap-2">
                              <button type="button" onClick={() => viewInTopology(selectedRiskEntity.entity_arn)} className={`rounded-lg border px-3 py-2 text-xs inline-flex items-center gap-2 ${isLightMode ? 'border-sky-300 text-sky-700 hover:bg-sky-50' : 'border-sky-800/70 text-sky-300 hover:bg-sky-950/30'}`}>
                                <Network className="h-3.5 w-3.5" /> View in topology
                              </button>
                              <button type="button" onClick={() => askAiAboutEntity(`Analyze risk score ${selectedRiskEntity.score} for ${selectedRiskEntity.entity_type} ${selectedRiskEntity.entity_name} and recommend next steps.`)} className={`rounded-lg border px-3 py-2 text-xs inline-flex items-center gap-2 ${isLightMode ? 'border-orange-300 text-orange-700 hover:bg-orange-50' : 'border-orange-800/70 text-orange-300 hover:bg-orange-950/30'}`}>
                                <Bot className="h-3.5 w-3.5" /> Ask AI
                              </button>
                            </div>
                          )}

                          <div className={`space-y-3 rounded-xl border ${isLightMode ? 'border-slate-300 bg-slate-50' : 'border-white/10 bg-[#101826]'} px-4 py-4`}>
                            <div>
                              <p className={`text-[11px] uppercase tracking-[0.24em] ${isLightMode ? 'text-slate-600' : 'text-slate-400'}`}>Why this matters</p>
                              <div className={`mt-2 space-y-2 text-sm leading-6 ${isLightMode ? 'text-slate-700' : 'text-slate-200'}`}>
                                {selectedRiskEntityInsights.map((line) => (
                                  <p key={line} className={`rounded-lg border ${isLightMode ? 'border-slate-300 bg-white' : 'border-white/5 bg-white/5'} px-3 py-2`}>
                                    {line}
                                  </p>
                                ))}
                              </div>
                            </div>

                            <div>
                              <p className={`text-[11px] uppercase tracking-[0.24em] ${isLightMode ? 'text-slate-600' : 'text-slate-400'}`}>Practical next steps</p>
                              <ul className={`mt-2 space-y-2 text-sm leading-6 ${isLightMode ? 'text-slate-700' : 'text-slate-200'}`}>
                                {selectedRiskEntityRecommendations.map((item) => (
                                  <li key={item} className={`flex gap-2 rounded-lg border ${isLightMode ? 'border-slate-300 bg-white' : 'border-white/5 bg-white/5'} px-3 py-2`}>
                                    <span className={`mt-0.5 ${isLightMode ? 'text-sky-600' : 'text-sky-300'}`}>•</span>
                                    <span>{item}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>

                            <div>
                              <p className={`text-[11px] uppercase tracking-[0.24em] ${isLightMode ? 'text-slate-600' : 'text-slate-400'}`}>Score drivers</p>
                              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                                {Object.entries((selectedRiskEntity.factors || {}) as Record<string, unknown>)
                                  .filter(([key, value]) =>
                                    ['base_score', 'impact_score', 'repeat_bonus', 'path_bonus', 'blast_bonus', 'context_multiplier', 'hvt_multiplier', 'exposure_factor', 'direct_admin_access', 'cross_account_trust', 'hvt_role_exposed', 'privilege_escalation_paths'].includes(key) &&
                                    (typeof value === 'number' || typeof value === 'boolean'),
                                  )
                                  .map(([key, value]) => (
                                    <div key={key} className={`rounded-lg border ${isLightMode ? 'border-slate-300 bg-white' : 'border-white/5 bg-white/5'} px-3 py-2`}>
                                      <p className={`uppercase tracking-[0.22em] ${isLightMode ? 'text-slate-600' : 'text-slate-400'}`}>{key.replace(/_/g, ' ')}</p>
                                      <p className={`mt-1 ${isLightMode ? 'text-slate-900' : 'text-slate-100'}`}>
                                        {typeof value === 'number' ? value.toFixed(1) : value ? 'true' : 'false'}
                                      </p>
                                    </div>
                                  ))}
                              </div>
                            </div>

                            <div>
                              <p className={`text-[11px] uppercase tracking-[0.24em] ${isLightMode ? 'text-slate-600' : 'text-slate-400'}`}>References</p>
                              <div className="mt-2 space-y-2">
                                {selectedRiskEntityLinks.map((link) => (
                                  <a
                                    key={link.url}
                                    href={link.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`flex items-center justify-between gap-3 rounded-lg border ${isLightMode ? 'border-slate-300 bg-white text-sky-600 hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700' : 'border-white/5 bg-white/5 text-sky-200 hover:border-sky-400/30 hover:bg-sky-500/10 hover:text-sky-100'} px-3 py-2 text-sm transition`}
                                  >
                                    <span className="leading-5">{link.label}</span>
                                    <ExternalLink className="h-4 w-4 shrink-0" />
                                  </a>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </aside>
                    </>
                  )}

                  {/* Severity Breakdown */}
                  <Card isLightMode={isLightMode}>
                    <p className={`text-xs font-light uppercase tracking-widest mb-4 ${isLightMode ? 'text-slate-600' : 'text-[#c8d2e4]'}`}>Risk Breakdown</p>
                    <p className={`text-[11px] mb-4 ${isLightMode ? 'text-slate-500' : 'text-[#8fa0bb]'}`}>Click any segment to filter Security Incidents by severity.</p>

                    <div className={`rounded-lg border px-4 py-5 ${isLightMode ? 'border-slate-300 bg-slate-100' : 'border-[#303d53] bg-[#111925]'}`}>
                      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6 items-center">
                        <div className="flex items-center justify-center">
                          <div className="relative w-44 h-44">
                            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                              <circle
                                cx="60"
                                cy="60"
                                r={donutRadius}
                                fill="none"
                                stroke={isLightMode ? '#d1d5db' : '#223047'}
                                strokeWidth="14"
                              />
                              {donutSlices
                                .filter((slice) => slice.value > 0)
                                .map((slice) => (
                                  <circle
                                    key={slice.key}
                                    cx="60"
                                    cy="60"
                                    r={donutRadius}
                                    fill="none"
                                    stroke={slice.color}
                                    strokeWidth={selectedSeverity === slice.key ? 16 : 14}
                                    strokeLinecap="butt"
                                    strokeDasharray={`${slice.segmentLength} ${donutCircumference - slice.segmentLength}`}
                                    strokeDashoffset={slice.dashOffset}
                                    className="cursor-pointer transition-all"
                                    onClick={() => setSelectedSeverity(slice.key)}
                                  />
                                ))}
                            </svg>
                            <button
                              onClick={() => setSelectedSeverity('all')}
                              className="absolute inset-0 flex flex-col items-center justify-center text-center rounded-full focus:outline-none"
                              aria-label="Show all severities"
                            >
                              <p className={`text-[11px] uppercase tracking-widest ${isLightMode ? 'text-slate-600' : 'text-[#93a3bc]'}`}>Total Risk</p>
                              <p className={`text-3xl font-light leading-tight ${isLightMode ? 'text-slate-900' : 'text-[#eef3fb]'}`}>{totalRiskFindings}</p>
                              <p className={`text-[10px] mt-1 uppercase tracking-wider ${isLightMode ? 'text-slate-500' : 'text-[#8092ae]'}`}>
                                {selectedSeverity === 'all' ? 'All Active' : 'Show All'}
                              </p>
                            </button>
                          </div>
                        </div>

                        <div>
                          <p className={`text-xs font-light uppercase tracking-widest mb-3 ${isLightMode ? 'text-slate-600' : 'text-[#9fb0c9]'}`}>Severity Distribution</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {donutSlices.map((slice) => (
                              <button
                                key={slice.key}
                                onClick={() => setSelectedSeverity(slice.key)}
                                className={`flex items-center justify-between rounded border px-3 py-2 text-left transition-all ${
                                  selectedSeverity === slice.key
                                    ? (isLightMode ? 'border-slate-400 bg-slate-200' : 'border-[#5d7192] bg-[#1b2738]')
                                    : (isLightMode ? 'border-slate-300 bg-slate-100 hover:border-slate-400' : 'border-[#2f3c53] bg-[#171f2c] hover:border-[#506180]')
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: slice.color }}
                                  />
                                   <span className={`text-sm ${isLightMode ? 'text-slate-700' : 'text-[#d7e0ef]'}`}>{slice.label}</span>
                                </div>
                                <div className="text-right ml-3">
                                   <p className={`text-sm ${isLightMode ? 'text-slate-900' : 'text-[#eef3fb]'}`}>{slice.value}</p>
                                   <p className={`text-[11px] ${isLightMode ? 'text-slate-500' : 'text-[#8fa0bb]'}`}>{slice.percentage.toFixed(0)}%</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>

                  {/* Incidents List */}
                  <Card isLightMode={isLightMode}>
                    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                      <p className={`text-xs font-light uppercase tracking-widest ${isLightMode ? 'text-slate-700' : 'text-[#c8d2e4]'}`}>
                        Security Incidents ({getFilteredFindings().length})
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-[11px] font-light uppercase tracking-widest ${isLightMode ? 'text-slate-600' : 'text-[#9fb0c9]'}`}>Filter</span>
                        {['all', 'critical', 'high', 'medium', 'low', 'info'].map((sev) => (
                          <button
                            key={sev}
                            onClick={() => setSelectedSeverity(sev)}
                            className={`px-2 py-1 text-xs font-light rounded transition-all border ${
                              selectedSeverity === sev
                                ? (isLightMode ? 'bg-slate-300 text-slate-900 border-slate-400' : 'bg-[#1e2736] text-[#eaf0fa] border-[#4a5874]')
                                : (isLightMode ? 'bg-slate-200 text-slate-700 border-slate-300 hover:border-slate-400 hover:text-slate-900' : 'bg-[#171d28] text-[#a8b4ca] border-[#38445c] hover:border-[#4a5874] hover:text-[#eaf0fa]')
                            }`}
                          >
                            {sev === 'all' ? 'All' : sev.charAt(0).toUpperCase() + sev.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {getFilteredFindings().map((finding) => {
                        const incidentKey = finding.id;
                        const isExpanded = incidentStates[incidentKey]?.expanded || false;
                        const status = incidentStates[incidentKey]?.status || 'new';

                        return (
                          <div
                            key={finding.id}
                            className={`border transition-all overflow-hidden ${isLightMode ? 'border-slate-300 hover:border-slate-400 bg-slate-100' : 'border-[#364258] hover:border-[#4b5b78] bg-[#171e2a]'}`}
                          >
                            {/* Incident Header */}
                            <div
                              onClick={() =>
                                setIncidentStates((prev) => ({
                                  ...prev,
                                  [incidentKey]: {
                                    ...prev[incidentKey],
                                    expanded: !isExpanded,
                                  },
                                }))
                              }
                              className={`px-4 py-3 cursor-pointer transition-colors flex items-start justify-between ${isLightMode ? 'hover:bg-slate-200' : 'hover:bg-[#202a3a]'}`}
                            >
                              <div className="flex-1">
                                <div className="flex items-center gap-3 mb-1">
                                  {/* Severity dot */}
                                  <div
                                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                      finding.severity === 'critical'
                                        ? 'bg-red-600'
                                        : finding.severity === 'high'
                                          ? 'bg-orange-600'
                                          : finding.severity === 'medium'
                                            ? 'bg-yellow-600'
                                            : 'bg-blue-600'
                                    }`}
                                  />
                                  <h4 className={`font-light text-sm ${isLightMode ? 'text-slate-900' : 'text-slate-100'}`}>{finding.title}</h4>
                                  <Badge label={finding.severity.toUpperCase()} variant={finding.severity as any} isLightMode={isLightMode} />
                                </div>
                                <p className={`text-xs ml-5 ${isLightMode ? 'text-slate-600' : 'text-[#a8b4ca]'}`}>{finding.description}</p>
                              </div>
                              <div className="flex-shrink-0 ml-4">
                                {isExpanded ? (
                                    <ChevronUp className={`w-4 h-4 ${isLightMode ? 'text-slate-400' : 'text-[#9eabc2]'}`} />
                                ) : (
                                    <ChevronDown className={`w-4 h-4 ${isLightMode ? 'text-slate-400' : 'text-[#9eabc2]'}`} />
                                )}
                              </div>
                            </div>

                            {/* Expanded Details */}
                            {isExpanded && (
                              <>
                                <div className={`border-t ${isLightMode ? 'border-slate-200' : 'border-[#38445c]'}`} />
                                <div className={`px-4 py-3 space-y-3 ${isLightMode ? 'bg-slate-50' : 'bg-[#1b2433]'}`}>
                                  <div className="space-y-2 text-xs">
                                    <p>
                                      <span className={isLightMode ? 'text-slate-500' : 'text-[#97a5bd]'}>Severity:</span>{' '}
                                      <span className={`font-light capitalize ${isLightMode ? 'text-slate-900' : 'text-[#e7edf8]'}`}>{finding.severity}</span>
                                    </p>
                                    <p>
                                      <span className={isLightMode ? 'text-slate-500' : 'text-[#97a5bd]'}>Type:</span>{' '}
                                      <span className={`font-light font-mono text-xs ${isLightMode ? 'text-slate-900' : 'text-[#e7edf8]'}`}>{finding.finding_type}</span>
                                    </p>
                                    {finding.entity_name && (
                                      <>
                                        <p>
                                          <span className={isLightMode ? 'text-slate-500' : 'text-[#97a5bd]'}>Entity:</span>{' '}
                                          <span className={`font-light font-mono text-xs ${isLightMode ? 'text-slate-900' : 'text-[#e7edf8]'}`}>{finding.entity_name}</span>
                                        </p>
                                        <p>
                                          <span className={isLightMode ? 'text-slate-500' : 'text-[#97a5bd]'}>Entity Type:</span>{' '}
                                          <span className={`font-light ${isLightMode ? 'text-slate-900' : 'text-[#d3ddee]'}`}>{finding.entity_type}</span>
                                        </p>
                                      </>
                                    )}
                                  </div>

                                  {/* Status and Actions */}
                                  <div className={`flex items-center gap-2 pt-2 border-t ${isLightMode ? 'border-slate-300' : 'border-slate-800/80'}`}>
                                    <span
                                      className={`px-2 py-1 text-xs font-light rounded border ${
                                        status === 'resolved'
                                          ? 'bg-emerald-950/30 text-emerald-300 border-emerald-800/70'
                                          : status === 'investigating'
                                            ? 'bg-sky-950/30 text-sky-300 border-sky-800/70'
                                            : status === 'acknowledged'
                                              ? 'bg-slate-900 text-slate-300 border-slate-700/80'
                                              : 'bg-orange-950/30 text-orange-300 border-orange-800/70'
                                      }`}
                                    >
                                      {status === 'new' ? 'NEW' : status.toUpperCase()}
                                    </span>
                                    <button
                                      onClick={() =>
                                        setIncidentStates((prev) => ({
                                          ...prev,
                                          [incidentKey]: {
                                            ...prev[incidentKey],
                                            status: 'acknowledged',
                                          },
                                        }))
                                      }
                                      className={`px-2 py-1 text-xs rounded transition-all border ${isLightMode ? 'text-slate-700 hover:text-slate-900 border-slate-400 hover:border-slate-500' : 'text-slate-400 hover:text-slate-100 border-slate-700/80 hover:border-slate-500'}`}
                                    >
                                      Acknowledge
                                    </button>
                                    <button
                                      onClick={() =>
                                        setIncidentStates((prev) => ({
                                          ...prev,
                                          [incidentKey]: {
                                            ...prev[incidentKey],
                                            status: 'resolved',
                                          },
                                        }))
                                      }
                                      className={`px-2 py-1 text-xs rounded transition-all border ${isLightMode ? 'text-slate-700 hover:text-slate-900 border-slate-400 hover:border-slate-500' : 'text-slate-400 hover:text-slate-100 border-slate-700/80 hover:border-slate-500'}`}
                                    >
                                      Resolve
                                    </button>
                                    {finding.entity_arn && (
                                      <>
                                        <button type="button" onClick={() => viewInTopology(finding.entity_arn)} className={`px-2 py-1 text-xs rounded border inline-flex items-center gap-1 ${isLightMode ? 'text-sky-700 border-sky-300 hover:bg-sky-50' : 'text-sky-300 border-sky-800/70 hover:bg-sky-950/30'}`}>
                                          <Network className="h-3 w-3" /> View in topology
                                        </button>
                                        <button type="button" onClick={() => askAiAboutEntity(`Explain the risk for ${finding.entity_type} ${finding.entity_name} (${finding.title}) and suggest remediation steps.`)} className={`px-2 py-1 text-xs rounded border inline-flex items-center gap-1 ${isLightMode ? 'text-orange-700 border-orange-300 hover:bg-orange-50' : 'text-orange-300 border-orange-800/70 hover:bg-orange-950/30'}`}>
                                          <Bot className="h-3 w-3" /> Ask AI
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                </>
              )}
            </div>
            </div>
          )}

          {/* Tab 2: Graph Explorer */}
          {activeTab === 'graph' && (
            <div className="relative h-full min-h-[760px]">
              {graph && !loading && graph.configured && !isGraphOverlayMode && (
                <div className="pointer-events-none absolute bottom-12 left-3 right-3 z-50 flex justify-center lg:right-[calc(clamp(300px,32vw,360px)+1.5rem)]">
                  <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-2xl border border-slate-700/80 bg-slate-950/82 px-4 py-2.5 shadow-[0_12px_34px_rgba(2,6,23,0.55)] backdrop-blur-xl">
                    {[
                      { key: 'iam_topology', label: 'Full topology' },
                      { key: 'privilege_escalation_paths', label: 'Privilege escalation' },
                      { key: 'hvt_entities', label: 'High-value targets' },
                      { key: 'external_trusts', label: 'External trust' },
                      ...(selectedGraphQuery === 'ai_query' && activeGraphDirective
                        ? [{ key: 'ai_query', label: activeGraphDirective.title || activeGraphDirective.label || 'AI query' }]
                        : []),
                    ].map((option) => (
                      <button
                        key={option.key}
                        onClick={() => {
                          if (option.key === 'ai_query') {
                            setSelectedGraphQuery('ai_query');
                            return;
                          }
                          selectGraphQuery(option.key);
                        }}
                        className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-all ${
                          selectedGraphQuery === option.key
                            ? 'border-sky-500/70 bg-sky-500/22 text-sky-100'
                            : 'border-slate-700/80 bg-slate-900/80 text-slate-300 hover:border-slate-500 hover:bg-slate-800/85 hover:text-slate-100'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {errors.graph && (
                <div className="mb-4">
                  <Alert title="Error loading graph" description={errors.graph} type="error" isLightMode={isLightMode} />
                </div>
              )}

              {loading && (
                <div className="rounded-2xl border border-slate-700/70 bg-slate-950/70 py-20 text-center">
                  <Clock className="mx-auto mb-4 h-12 w-12 animate-spin text-[#7e8fae]" />
                  <p className="text-slate-400">Loading IAM topology...</p>
                </div>
              )}

              {graph && !loading && (
                <>
                  {!graph.configured ? (
                    <Alert
                      title="Graph not configured"
                      description={graph.detail || (graph.metrics as { note?: string } | undefined)?.note || 'Neo4j database has not been configured for this account'}
                      type="info"
                    />
                  ) : (
                    <CloudHoundGraphCanvas 
                      graph={graph}
                      isAdmin={currentUserIsAdmin}
                      selectedAwsAccountId={selectedAwsAccountId}
                      isLightMode={isLightMode}
                      focusNodeArn={activeTab === 'graph' ? focusNodeArn || undefined : undefined}
                      onFocusNodeHandled={() => setFocusNodeArn(null)}
                      onRequestAiAssist={handleGraphAiAssist}
                      onRequestGraphAiMode={openGraphAiMode}
                      aiAssist={{
                        isOpen: graphAiOpen,
                        mode: graphAiMode,
                        nodeId: graphAiNodeId,
                        nodeTitle: graphAiNodeTitle,
                        draft: graphAiDraft,
                        loading: graphAiLoading,
                        messages: graphAiMessages,
                        lastInstruction: graphAiLastInstruction,
                        applyingProposalId,
                        appliedProposalIds,
                        canApplyProposals: canAccessControl,
                        onDraftChange: setGraphAiDraft,
                        onSubmit: submitGraphAiPrompt,
                        onSwitchMode: switchGraphAiMode,
                        onClose: closeGraphAiAssist,
                        onApplyProposal: applyAiProposal,
                      }}
                    />
                  )}
                </>
              )}
            </div>
          )}

          {/* Tab 3: AI Assistant */}
          {activeTab === 'assistant' && (
            <div className="space-y-6 px-7 py-6">
              <Card isLightMode={isLightMode}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <p className={`text-xs font-light uppercase tracking-widest ${isLightMode ? 'text-slate-700' : 'text-[#c8d2e4]'}`}>CloudHound AI Assistant</p>
                    <p className={`text-sm mt-1 ${isLightMode ? 'text-slate-600' : 'text-[#9fb0c9]'}`}>Ask natural-language questions about the selected account risk posture and graph.</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded border ${isLightMode ? 'border-slate-300 bg-slate-100 text-slate-700' : 'border-[#3a465e] bg-[#171d28] text-[#a8b4ca]'}`}>
                    Account: {selectedAccount?.name || 'Not selected'}
                  </span>
                </div>

                <style>{`
                  .chat-scroll::-webkit-scrollbar { display: none; }
                  @keyframes chat-thinking-bounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-3px); opacity: 1; } }
                  .chat-thinking-dot { animation: chat-thinking-bounce 1.2s infinite ease-in-out; }
                `}</style>
                <div
                  className={`chat-scroll rounded-lg border p-4 h-[420px] overflow-y-auto space-y-3 ${isLightMode ? 'bg-slate-50 border-slate-200' : 'bg-[#0f141d] border-[#2d374a]'}`}
                  style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                >
                  {aiMessages.length === 0 && !aiLoading ? (
                    <p className={`text-sm ${isLightMode ? 'text-slate-500' : 'text-[#9aa7bd]'}`}>
                      Try: "What are the highest-risk entities in this account?"
                    </p>
                  ) : (
                    aiMessages.map((msg, index) => (
                      <div
                        key={`${msg.role}-${index}`}
                        className={`rounded-lg border px-3 py-2 ${msg.role === 'user'
                          ? (isLightMode ? 'ml-10 bg-white border-slate-300' : 'ml-10 bg-[#1a2230] border-[#3a465e]')
                          : (isLightMode ? 'mr-10 bg-slate-100 border-slate-300' : 'mr-10 bg-[#111925] border-[#334159]')}`}
                      >
                        <p className={`text-[11px] uppercase tracking-widest mb-1 ${isLightMode ? 'text-slate-500' : 'text-[#8fa0bb]'}`}>
                          {msg.role === 'user' ? 'You' : 'Assistant'}
                        </p>
                        {msg.role === 'assistant' ? (
                          <AssistantRichText
                            content={msg.content}
                            className={`text-sm ${isLightMode ? 'text-slate-900' : 'text-[#e8edf6]'}`}
                            mutedClassName={isLightMode ? 'text-slate-700' : 'text-[#d8e1ef]'}
                          />
                        ) : (
                          <p className={`text-sm whitespace-pre-wrap break-words ${isLightMode ? 'text-slate-900' : 'text-[#e8edf6]'}`}>{msg.content}</p>
                        )}

                        {msg.evidence && msg.role === 'assistant' && (
                          <AssistantEvidencePanel evidence={msg.evidence} isLightMode={isLightMode} />
                        )}

                        {msg.remediationProposals && msg.remediationProposals.length > 0 && (
                          <div className="mt-3">
                            <p className={`text-[11px] uppercase tracking-widest mb-2 ${isLightMode ? 'text-slate-500' : 'text-[#8fa0bb]'}`}>AI Remediation Proposals</p>
                            <div className="space-y-2">
                              {msg.remediationProposals.map((proposal) => {
                                const isApplied = appliedProposalIds.has(proposal.proposal_id);
                                const isApplying = applyingProposalId === proposal.proposal_id;
                                return (
                                  <div
                                    key={proposal.proposal_id}
                                    className={`rounded-lg border px-3 py-3 ${isLightMode ? 'border-slate-300 bg-white' : 'border-[#334159] bg-[#0f1724]'}`}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <p className={`text-sm ${isLightMode ? 'text-slate-900' : 'text-slate-100'}`}>{proposal.title}</p>
                                        <p className={`mt-1 text-xs leading-5 ${isLightMode ? 'text-slate-600' : 'text-[#b8c4d9]'}`}>{proposal.description}</p>
                                      </div>
                                      <span className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${isLightMode ? 'border-slate-300 bg-slate-100 text-slate-700' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>
                                        {proposal.action.replace(/_/g, ' ')}
                                      </span>
                                    </div>
                                    <div className="mt-3 flex items-center justify-between gap-3">
                                      <p className={`text-[11px] ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>
                                        {proposal.policy_name
                                          ? `${proposal.entity_type} ${proposal.entity_name} <- ${proposal.policy_name}`
                                          : `${proposal.entity_type} ${proposal.entity_name}`}
                                      </p>
                                      <button
                                        type="button"
                                        disabled={!canAccessControl || isApplied || isApplying || reviewingProposalId === proposal.proposal_id}
                                        onClick={() => void applyAiProposal(proposal)}
                                        className={`rounded px-3 py-1.5 text-xs font-medium transition ${isApplied
                                          ? 'bg-emerald-600 text-white'
                                          : isLightMode
                                            ? 'bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-400'
                                            : 'bg-orange-500 text-white hover:bg-orange-400 disabled:bg-slate-700'} disabled:cursor-not-allowed`}
                                      >
                                        {isApplied ? 'Applied' : isApplying ? 'Applying...' : reviewingProposalId === proposal.proposal_id ? 'Reviewing...' : canAccessControl ? (proposal.requires_confirmation ? 'Review' : 'Apply') : 'Admin only'}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {msg.findings && msg.findings.length > 0 && (
                          <div className="mt-2">
                            <p className={`text-[11px] uppercase tracking-widest mb-1 ${isLightMode ? 'text-slate-500' : 'text-[#8fa0bb]'}`}>Key Findings</p>
                            <ul className={`list-disc ml-5 text-xs space-y-1 ${isLightMode ? 'text-slate-700' : 'text-[#c9d4e8]'}`}>
                              {msg.findings.slice(0, 4).map((item, idx) => (
                                <li key={`f-${idx}`}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {msg.actions && msg.actions.length > 0 && (
                          <div className="mt-2">
                            <p className={`text-[11px] uppercase tracking-widest mb-1 ${isLightMode ? 'text-slate-500' : 'text-[#8fa0bb]'}`}>Recommended Actions</p>
                            <ul className={`list-disc ml-5 text-xs space-y-1 ${isLightMode ? 'text-slate-700' : 'text-[#c9d4e8]'}`}>
                              {msg.actions.slice(0, 4).map((item, idx) => (
                                <li key={`a-${idx}`}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {msg.role === 'assistant' && msg.agent && (msg.agent.model || (msg.agent.toolsUsed && msg.agent.toolsUsed.length > 0)) && (
                          <div className={`mt-3 flex flex-wrap items-center gap-1.5 border-t pt-2 ${isLightMode ? 'border-slate-200' : 'border-[#26324a]'}`}>
                            {msg.agent.auto && (
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${isLightMode ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-500/15 text-emerald-300'}`}
                                title="Auto mode picked the provider for this question"
                              >
                                Auto
                              </span>
                            )}
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${isLightMode ? 'bg-violet-100 text-violet-700' : 'bg-violet-500/15 text-violet-300'}`}
                              title={msg.agent.provider ? `${msg.agent.provider} / ${msg.agent.model || ''}` : undefined}
                            >
                              <Sparkles className="h-3 w-3" />
                              {msg.agent.model || 'AI agent'}
                            </span>
                            {(msg.agent.fallbackChain || [])
                              .filter((step) => step.status === 'error')
                              .map((step, idx) => (
                                <span
                                  key={`${step.provider}-${idx}`}
                                  className={`rounded-full px-2 py-0.5 text-[10px] ${isLightMode ? 'bg-amber-100 text-amber-700' : 'bg-amber-500/15 text-amber-300'}`}
                                  title={step.error || `${step.provider} unavailable`}
                                >
                                  {step.provider} skipped
                                </span>
                              ))}
                            {(msg.agent.toolsUsed || []).map((tool) => (
                              <span
                                key={tool}
                                className={`rounded-full px-2 py-0.5 text-[10px] ${isLightMode ? 'bg-slate-100 text-slate-600' : 'bg-[#1a2230] text-[#9fb0cc]'}`}
                                title="Tool the AI called to ground this answer"
                              >
                                {tool}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}

                  {aiLoading && (
                    <div
                      className={`mr-10 rounded-lg border px-3 py-2 ${isLightMode ? 'bg-slate-100 border-slate-300' : 'bg-[#111925] border-[#334159]'}`}
                      role="status"
                      aria-live="polite"
                    >
                      <p className={`text-[11px] uppercase tracking-widest mb-1 ${isLightMode ? 'text-slate-500' : 'text-[#8fa0bb]'}`}>Assistant</p>
                      <div className={`flex items-center gap-2 text-sm ${isLightMode ? 'text-slate-600' : 'text-[#c9d4e8]'}`}>
                        <span>Thinking</span>
                        <span className="inline-flex items-end gap-1" aria-hidden="true">
                          <span className={`chat-thinking-dot inline-block h-1.5 w-1.5 rounded-full ${isLightMode ? 'bg-slate-500' : 'bg-[#8fa0bb]'}`} style={{ animationDelay: '0s' }} />
                          <span className={`chat-thinking-dot inline-block h-1.5 w-1.5 rounded-full ${isLightMode ? 'bg-slate-500' : 'bg-[#8fa0bb]'}`} style={{ animationDelay: '0.15s' }} />
                          <span className={`chat-thinking-dot inline-block h-1.5 w-1.5 rounded-full ${isLightMode ? 'bg-slate-500' : 'bg-[#8fa0bb]'}`} style={{ animationDelay: '0.3s' }} />
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <form onSubmit={submitAiPrompt} className="mt-4 flex items-center gap-2">
                  <input
                    type="text"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    disabled={aiLoading || !selectedAwsAccountId}
                    placeholder="Ask about risk, paths, exposed roles, or remediation..."
                    className={`flex-1 px-4 py-2 rounded border focus:outline-none focus:ring-1 ${isLightMode ? 'bg-white border-slate-300 text-slate-900 focus:ring-slate-400' : 'bg-[#111925] border-[#334159] text-[#e8edf6] focus:ring-[#4a5b79]'}`}
                  />
                  <button
                    type="submit"
                    disabled={aiLoading || !selectedAwsAccountId || !aiPrompt.trim()}
                    className="px-4 py-2 rounded bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-medium"
                  >
                    {aiLoading ? 'Thinking...' : 'Send'}
                  </button>
                </form>
              </Card>
            </div>
          )}

          {/* Tab 4: Access Control */}
          {activeTab === 'access' && (
            <div className="space-y-6 px-7 py-6">
              <Card isLightMode={isLightMode}>
                <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                  <div>
                    <p className="text-xs font-light text-[#c8d2e4] uppercase tracking-widest">Settings Hub</p>
                    <p className="text-sm text-[#9fb0c9] mt-1">Use this area for portal users, configuration, and integrations.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { key: 'users', label: 'Users' },
                      { key: 'configuration', label: 'Configuration' },
                      { key: 'integrations', label: 'Integrations' },
                    ].map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setActiveAccessSection(item.key as typeof activeAccessSection)}
                        className={`px-3 py-1.5 text-xs uppercase tracking-widest rounded border transition-all ${
                          activeAccessSection === item.key
                            ? 'border-[#4a5874] bg-[#1e2736] text-[#eef3fb]'
                            : 'border-[#38445c] bg-[#171d28] text-[#a8b4ca] hover:border-[#4a5874] hover:text-[#eef3fb]'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {activeAccessSection === 'configuration' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded border border-[#364258] bg-[#171e2a] px-3 py-3">
                      <p className="text-[11px] text-[#8fa0bb] uppercase tracking-widest">Selected account</p>
                      <p className="text-sm text-[#eef3fb] mt-1 truncate">{selectedAccount?.name || 'No account selected'}</p>
                    </div>
                    <div className="rounded border border-[#364258] bg-[#171e2a] px-3 py-3">
                      <p className="text-[11px] text-[#8fa0bb] uppercase tracking-widest">Scan cadence</p>
                      <p className="text-sm text-[#eef3fb] mt-1">Managed by the backend scheduler and cron configuration.</p>
                    </div>
                    <div className="rounded border border-[#364258] bg-[#171e2a] px-3 py-3">
                      <p className="text-[11px] text-[#8fa0bb] uppercase tracking-widest">Risk filters</p>
                      <p className="text-sm text-[#eef3fb] mt-1">Current filters follow the active scan context and topology view.</p>
                    </div>
                  </div>
                )}

                {activeAccessSection === 'integrations' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded border border-[#364258] bg-[#171e2a] px-3 py-3">
                      <p className="text-[11px] text-[#8fa0bb] uppercase tracking-widest">AWS / Cognito</p>
                      <p className="text-sm text-[#eef3fb] mt-1">Authentication and account access are already connected.</p>
                    </div>
                    <div className="rounded border border-[#364258] bg-[#171e2a] px-3 py-3">
                      <p className="text-[11px] text-[#8fa0bb] uppercase tracking-widest">Graph store</p>
                      <p className="text-sm text-[#eef3fb] mt-1">IAM topology is backed by Neo4j when configured.</p>
                    </div>
                    <div className="rounded border border-[#364258] bg-[#171e2a] px-3 py-3">
                      <p className="text-[11px] text-[#8fa0bb] uppercase tracking-widest">Alerts</p>
                      <p className="text-sm text-[#eef3fb] mt-1">Email and chat hooks can be wired from the backend workflows.</p>
                    </div>
                  </div>
                )}
              </Card>

              {activeAccessSection === 'users' && (
                <>
              {/* Add User Form */}
              <Card isLightMode={isLightMode}>
                <p className="text-sm font-bold text-slate-100 uppercase tracking-wide mb-4">Add Tool User</p>
                <form onSubmit={handleAddUser} className="space-y-4">
                  {errors.form && <Alert title={errors.form} type="error" isLightMode={isLightMode} />}
                  {successMessage && <Alert title={successMessage} type="success" isLightMode={isLightMode} />}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-slate-200 mb-2 font-medium">Email *</label>
                      <input
                        type="email"
                        value={formState.email}
                        onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                        placeholder="user@example.com"
                        className="w-full px-4 py-2 bg-slate-900/85 border border-slate-700/80 text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4a5b79]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-slate-200 mb-2 font-medium">First Name</label>
                      <input
                        type="text"
                        value={formState.firstName}
                        onChange={(e) => setFormState({ ...formState, firstName: e.target.value })}
                        placeholder="John"
                        className="w-full px-4 py-2 bg-slate-900/85 border border-slate-700/80 text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4a5b79]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-slate-200 mb-2 font-medium">Last Name</label>
                      <input
                        type="text"
                        value={formState.lastName}
                        onChange={(e) => setFormState({ ...formState, lastName: e.target.value })}
                        placeholder="Doe"
                        className="w-full px-4 py-2 bg-slate-900/85 border border-slate-700/80 text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4a5b79]"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isAddingUser || !selectedAwsAccountId}
                    className="flex items-center gap-2 bg-[#33445f] hover:bg-[#3c4f6f] disabled:opacity-50 text-slate-100 font-semibold px-4 py-2 rounded-lg transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    {isAddingUser ? 'Creating user...' : 'Add User'}
                  </button>
                  {isAddingUser && (
                    <p className="text-xs text-slate-400">Creating Cognito user and sending invite email...</p>
                  )}
                </form>
              </Card>

              {/* Users List */}
              <Card isLightMode={isLightMode}>
                <p className="text-sm font-bold text-slate-100 uppercase tracking-wide mb-4">
                  Active Users ({toolUsers.length})
                </p>
                {errors.users && <Alert title={errors.users} type="error" isLightMode={isLightMode} />}

                {toolUsers.length === 0 ? (
                  <p className="text-slate-300 text-sm">No users added yet</p>
                ) : (
                  <div className="space-y-2">
                    {toolUsers.map((user) => (
                      <div key={user.id} className="border border-slate-800/80 rounded-lg p-4 flex items-center justify-between hover:border-slate-600 bg-slate-950/50">
                        <div className="flex items-center gap-3">
                          <Mail className="w-4 h-4 text-slate-400" />
                          <div>
                            <p className="text-slate-100 font-medium text-sm">{user.email}</p>
                            <p className="text-slate-400 text-xs font-mono">{user.cognito_user_id}</p>
                            <p className="text-slate-500 text-xs mt-1">
                              Login status: {user.is_logged_in ? 'Logged in' : 'Logged out'} | Last login: {formatLastLogin(user.last_login_at)}
                            </p>
                            <p className="text-slate-500 text-xs mt-1">
                              Role: {user.is_primary_admin ? 'Main Admin' : user.is_admin ? 'Admin' : 'Member'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {user.is_active ? (
                            <span className="px-2 py-1 bg-emerald-950/30 text-emerald-300 text-xs rounded border border-emerald-700/60">
                              Active
                            </span>
                          ) : (
                            <span className="px-2 py-1 bg-slate-900 text-slate-300 text-xs rounded border border-slate-700/80">
                              Inactive
                            </span>
                          )}
                          {!user.is_primary_admin && user.id !== currentUserId && (
                            <button
                              type="button"
                              onClick={() => handleSetAdminRole(user.id, user.email, !user.is_admin)}
                              disabled={actingUserId === user.id}
                              className="px-2 py-1 bg-sky-950/30 text-sky-300 text-xs rounded border border-sky-800/70 hover:bg-sky-900/40 disabled:opacity-60"
                            >
                              {actingUserId === user.id ? 'Working...' : user.is_admin ? 'Remove Admin' : 'Make Admin'}
                            </button>
                          )}
                          {user.is_active ? (
                            <button
                              type="button"
                              onClick={() => handleDeactivateUser(user.id, user.email)}
                              disabled={actingUserId === user.id || user.is_primary_admin}
                              className="px-2 py-1 bg-amber-950/30 text-amber-300 text-xs rounded border border-amber-800/70 hover:bg-amber-900/40 disabled:opacity-60"
                            >
                              {actingUserId === user.id ? 'Working...' : 'Deactivate'}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => handleDeleteUser(user.id, user.email)}
                            disabled={actingUserId === user.id || user.is_primary_admin}
                            className="px-2 py-1 bg-red-950/30 text-red-300 text-xs rounded border border-red-800/70 hover:bg-red-900/40 disabled:opacity-60"
                          >
                            {actingUserId === user.id ? 'Working...' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
                </>
              )}
            </div>
          )}

          {proposalReview && (
            <ProposalReviewDialog
              review={proposalReview}
              isApplying={applyingProposalId === proposalReview.proposal.proposal_id}
              isLightMode={isLightMode}
              onClose={closeProposalReview}
              onConfirm={() => executeAiProposal(proposalReview.proposal)}
            />
          )}

          {activeTab === 'results' && (
            <button
              type="button"
              onClick={() => setCopilotOpen((open) => !open)}
              className="fixed bottom-6 right-6 z-[60] inline-flex items-center gap-2 rounded-full bg-orange-500 px-4 py-3 text-sm font-medium text-white shadow-lg hover:bg-orange-600"
              aria-label="Ask CloudHound"
            >
              <Bot className="h-4 w-4" />
              Ask CloudHound
            </button>
          )}

          {copilotOpen && activeTab === 'results' && (
            <div className="fixed bottom-20 right-6 z-[60] w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-slate-700 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-xl">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium text-slate-100">Quick AI Assist</p>
                <button type="button" onClick={() => setCopilotOpen(false)} className="text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!copilotDraft.trim()) return;
                  setActiveTab('assistant');
                  void runAiPrompt(copilotDraft);
                  setCopilotOpen(false);
                  setCopilotDraft('');
                }}
              >
                <textarea
                  value={copilotDraft}
                  onChange={(event) => setCopilotDraft(event.target.value)}
                  rows={3}
                  placeholder="Ask about findings, risky roles, or remediation..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                />
                <button type="submit" disabled={!copilotDraft.trim() || aiLoading} className="mt-3 w-full rounded-lg bg-orange-500 py-2 text-sm text-white hover:bg-orange-600 disabled:opacity-60">
                  {aiLoading ? 'Thinking...' : 'Send to Assistant'}
                </button>
              </form>
            </div>
          )}

          <ScanCompareModal
            open={compareOpen}
            isLightMode={isLightMode}
            selectedAwsAccountId={selectedAwsAccountId}
            history={scanHistory}
            defaultCurrentResultId={latestResult?.scan_run?.id ?? null}
            onClose={() => setCompareOpen(false)}
          />

          <ToastStack toasts={toasts} onDismiss={dismissToast} isLightMode={isLightMode} />
        </div>
      </div>
    </div>
  );
}
