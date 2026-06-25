/**
 * Placeholder GIOP AI responses until backend assistant endpoints exist.
 */

export interface GiopNodeContext {
  mrid: string;
  name: string;
  validation: string;
  connected: boolean;
  traced?: boolean;
}

export function mockNodeAssist(ctx: GiopNodeContext): {
  content: string;
  findings: string[];
  actions: string[];
} {
  const findings: string[] = [];
  if (!ctx.connected) findings.push('Asset is not connected to the network graph.');
  if (ctx.validation === 'IN_CONFLICT') findings.push('Validation state is IN_CONFLICT — field capture disagrees with master.');
  if (ctx.validation === 'PENDING_FIELD' || ctx.validation === 'STAGED') {
    findings.push('Asset is in staging and awaiting backoffice approval.');
  }
  if (ctx.traced) findings.push('Node is on the active trace path from the selected BSP.');

  const actions = [
    'Review staging queue for pending promotions.',
    'Run topology repair if connectivity is missing.',
    'Approve field capture once geometry and name are verified.',
  ];

  return {
    content: `**${ctx.name}** (${ctx.mrid})\n\nValidation: \`${ctx.validation}\` · Connected: ${ctx.connected ? 'yes' : 'no'}${ctx.traced ? ' · On trace path' : ''}.\n\nGIOP assistant endpoints are not wired yet — this is a local preview of grid-aware analysis.`,
    findings: findings.length ? findings : ['No anomalies detected for this asset in the current view.'],
    actions,
  };
}

export function mockGraphAssist(prompt: string, nodeCount: number): {
  content: string;
  findings: string[];
  actions: string[];
} {
  return {
    content: `Received: "${prompt}"\n\nThe graph currently shows **${nodeCount}** connectivity nodes from Memgraph via sync-service trace. Full grid assistant integration will route prompts to \`POST /api/v1/portal/ai/chat\` when available.`,
    findings: ['Graph data is sourced from GET /api/v1/trace.'],
    actions: ['Use query chips to filter traced, disconnected, or conflict assets.'],
  };
}
