/**
 * Stub IAM graph API calls for GiopGraphCanvas (Phase 1–2).
 * Real GIOP endpoints can replace these in a later phase.
 */

import type {
  CloudHoundAIChatResponse,
  CloudHoundPathFindingResponse,
  CloudHoundPolicyDocumentResponse,
  CloudHoundPortalGraphResponse,
} from './cloudhound-api';

export type {
  CloudHoundPortalGraphResponse,
  CloudHoundAIChatResponse,
  CloudHoundPolicyDocumentResponse,
  CloudHoundPathFindingResponse,
};

export async function getCloudHoundPolicyDocument(params: {
  selectedAwsAccountId: string;
  policyArn?: string;
  policyName?: string;
}): Promise<CloudHoundPolicyDocumentResponse> {
  return {
    policy_arn: params.policyArn || '',
    policy_name: params.policyName || 'Asset',
    default_version_id: 'giop-local',
    document: {
      note: 'GIOP asset detail placeholder — full registry integration coming soon.',
      asset_name: params.policyName,
    },
    is_attachable: false,
  };
}

export async function findCloudHoundPath(_params: {
  selectedAwsAccountId: string;
  sourceArn: string;
  targetArn: string;
}): Promise<CloudHoundPathFindingResponse> {
  return {
    found: false,
    path: { nodes: [], edges: [] },
    message: 'Path finding will connect to GIOP trace endpoints in a future release.',
  };
}

export async function performIAMGraphAction(_params: {
  selectedAwsAccountId: string;
  action: string;
  nodeId?: string;
  nodeArn?: string;
  entityArn?: string;
  entityName?: string;
  entityType?: string;
}): Promise<{ ok: boolean; message: string; status?: boolean; error?: string }> {
  return {
    ok: false,
    status: false,
    error: 'Not wired',
    message: 'Grid remediation actions will be available when GIOP assistant endpoints are wired.',
  };
}
