/** Ghana SLD voltage styling — ported from backoffice-ui/theme.js */

export const GHANA_VOLTAGE_OPTIONS = [
  'LV_230V',
  'LV_400V',
  'MV_11KV',
  'MV_33KV',
  'HV_161KV',
  'HV_330KV',
] as const;

export type GhanaVoltage = (typeof GHANA_VOLTAGE_OPTIONS)[number];

const VOLTAGE_EDGE_COLORS: Record<string, string> = {
  HV_161KV: '#78350F',
  HV_330KV: '#78350F',
  MV_33KV: '#1D4ED8',
  MV_11KV: '#B91C1C',
  LV_230V: '#0F172A',
  LV_400V: '#0F172A',
};

const VOLTAGE_LINE_WIDTH: Record<string, number> = {
  HV_161KV: 5,
  HV_330KV: 5,
  MV_33KV: 3.5,
  MV_11KV: 2.5,
  LV_230V: 1.5,
  LV_400V: 1.5,
};

export function voltageEdgeColor(voltage?: string | null): string {
  if (!voltage) return '#475569';
  const key = voltage.toUpperCase();
  return VOLTAGE_EDGE_COLORS[key] ?? '#475569';
}

export function voltageLineWidth(voltage?: string | null): number {
  if (!voltage) return 2.5;
  return VOLTAGE_LINE_WIDTH[voltage.toUpperCase()] ?? 2.5;
}

export function isLowVoltage(voltage?: string | null): boolean {
  const v = (voltage || '').toUpperCase();
  return v === 'LV_230V' || v === 'LV_400V';
}

export const CONFLICT_NODE_STROKE = '#ef4444';
export const CONFLICT_NODE_FILL = '#7f1d1d';
