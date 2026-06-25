import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, GitCompareArrows, TrendingDown, TrendingUp, X } from 'lucide-react';
import type {
  CloudHoundFinding,
  ScanHistoryEntry,
  ScanHistorySeverityCounts,
} from '../api/cloudhound-api';

const SEVERITY_LAYERS: Array<{ key: keyof ScanHistorySeverityCounts; label: string; color: string }> = [
  { key: 'critical', label: 'Critical', color: '#ef4444' },
  { key: 'high', label: 'High', color: '#f97316' },
  { key: 'medium', label: 'Medium', color: '#f59e0b' },
  { key: 'low', label: 'Low', color: '#22c55e' },
  { key: 'info', label: 'Info', color: '#64748b' },
];

const EMPTY_SEVERITY: ScanHistorySeverityCounts = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
};

type Posture = 'improving' | 'stable' | 'degrading' | 'unknown';

// The plot area (SVG) only contains the line, area, dots and Y-axis grid.
// The date axis is rendered as real HTML below the SVG so it's never clipped
// by SVG sizing or viewBox math.
const PLOT_HEIGHT = 220;
const DATE_AXIS_HEIGHT = 40;
const CHART_HEIGHT = PLOT_HEIGHT + DATE_AXIS_HEIGHT;
const CHART_PAD = { top: 22, right: 18, bottom: 14, left: 38 };

interface ChartLayout {
  width: number;
  height: number;
  pad: typeof CHART_PAD;
  plotW: number;
  plotH: number;
  chartX: (index: number, total: number) => number;
  chartY: (value: number) => number;
  baseline: number;
}

function createChartLayout(width: number): ChartLayout {
  const height = PLOT_HEIGHT;
  const plotW = width - CHART_PAD.left - CHART_PAD.right;
  const plotH = height - CHART_PAD.top - CHART_PAD.bottom;

  return {
    width,
    height,
    pad: CHART_PAD,
    plotW,
    plotH,
    chartX: (index, total) => {
      if (total <= 1) return CHART_PAD.left + plotW / 2;
      return CHART_PAD.left + (index / (total - 1)) * plotW;
    },
    chartY: (value) => CHART_PAD.top + plotH * (1 - Math.min(100, Math.max(0, value)) / 100),
    baseline: CHART_PAD.top + plotH,
  };
}

function normalizeSeverityCounts(entry: ScanHistoryEntry): ScanHistorySeverityCounts {
  if (entry.severity_counts) return entry.severity_counts;
  return { ...EMPTY_SEVERITY, critical: entry.critical_count ?? 0 };
}

function totalFindings(severity: ScanHistorySeverityCounts, findingsCount?: number): number {
  if (typeof findingsCount === 'number' && findingsCount > 0) return findingsCount;
  return SEVERITY_LAYERS.reduce((sum, layer) => sum + severity[layer.key], 0);
}

function computePostureIndex(severity: ScanHistorySeverityCounts, findingsCount?: number): number {
  const count = totalFindings(severity, findingsCount);
  if (count === 0) return 0;

  const weightedPoints =
    severity.critical * 8 +
    severity.high * 4 +
    severity.medium * 1.5 +
    severity.low * 0.4 +
    severity.info * 0.1;

  const volumeFactor = 1 + Math.min(0.35, Math.log10(Math.max(count, 1)) * 0.12);
  const raw = weightedPoints * volumeFactor;

  return Math.min(100, Math.round(100 * (1 - Math.exp(-raw / 55))));
}

function computeActionableCount(severity: ScanHistorySeverityCounts): number {
  return severity.critical + severity.high;
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function scanDateLabel(entry: ScanHistoryEntry, fallbackIndex?: number): string {
  const fromTimestamp = formatShortDate(entry.completed_at || entry.started_at);
  if (fromTimestamp) return fromTimestamp;
  if (typeof fallbackIndex === 'number') return `Scan ${fallbackIndex + 1}`;
  return '';
}

// Pick which point indices get an axis label/tick. Always keep the first, last
// and latest scans, then greedily add any point that is at least `minPx` away
// (in viewBox units) from every already-chosen label. This keeps the axis
// readable even when several scans land on the same day and cluster tightly on
// the time-proportional axis.
function selectLabelIndices(
  points: TrendChartPoint[],
  latestResultId: string | null | undefined,
  minPx = 52,
): Set<number> {
  const chosen = new Set<number>();
  if (points.length === 0) return chosen;
  chosen.add(0);
  chosen.add(points.length - 1);
  const latestIdx = points.findIndex((p) => latestResultId === p.entry.result_id);
  if (latestIdx >= 0) chosen.add(latestIdx);

  for (let i = 0; i < points.length; i += 1) {
    if (chosen.has(i)) continue;
    const x = points[i].x;
    const tooClose = [...chosen].some((j) => Math.abs(points[j].x - x) < minPx);
    if (!tooClose) chosen.add(i);
  }
  return chosen;
}

function computePosture(successful: ScanHistoryEntry[]): Posture {
  if (successful.length < 2) return 'unknown';

  const scores = successful.map((entry) =>
    computePostureIndex(normalizeSeverityCounts(entry), entry.findings_count),
  );
  const latestScore = scores[0];
  const prevScore = scores[1];
  const delta = latestScore - prevScore;
  const threshold = Math.max(3, prevScore * 0.12);

  if (delta > threshold) return 'degrading';
  if (delta < -threshold) return 'improving';

  if (successful.length >= 3) {
    const threeScanDelta = scores[0] - scores[2];
    if (threeScanDelta > threshold * 1.5) return 'degrading';
    if (threeScanDelta < -threshold * 1.5) return 'improving';
  }

  return 'stable';
}

function generateInsights(successful: ScanHistoryEntry[]): string[] {
  if (successful.length === 0) return ['No successful scans to analyze yet.'];

  const latest = successful[0];
  const latestSeverity = normalizeSeverityCounts(latest);
  const insights: string[] = [];

  const diff = latest.diff_counts;
  if (diff) {
    const net = diff.new - diff.resolved;
    if (diff.new > 0 && diff.new > diff.resolved) {
      insights.push(`${diff.new} new vs ${diff.resolved} resolved — net +${net} exposure.`);
    } else if (diff.resolved > 0 && diff.resolved > diff.new) {
      insights.push(`Resolved ${diff.resolved} findings — net −${Math.abs(net)} exposure.`);
    } else if (diff.new > 0) {
      insights.push(`${diff.new} new finding${diff.new === 1 ? '' : 's'} since the previous scan.`);
    }
  }

  if (latestSeverity.critical > 0) {
    insights.push(`${latestSeverity.critical} critical finding${latestSeverity.critical === 1 ? '' : 's'} require immediate remediation.`);
  }

  const posture = computePosture(successful);
  if (insights.length === 0) {
    if (posture === 'stable') insights.push('Exposure is stable across recent scans.');
    if (posture === 'improving') insights.push('Exposure is trending down — keep resolving findings.');
    if (posture === 'degrading') insights.push('Exposure is trending up — prioritize critical items.');
  }

  return insights.slice(0, 2);
}

function formatDelta(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `${value}`;
  return '0';
}

function dominantSeverityColor(severity: ScanHistorySeverityCounts): string {
  if (severity.critical > 0) return '#ef4444';
  if (severity.high > 0) return '#f97316';
  if (severity.medium > 0) return '#f59e0b';
  if (severity.low > 0) return '#22c55e';
  return '#64748b';
}

type TrendMode = 'posture' | 'severity';

// Stack order for the severity area chart: info at the bottom, critical at top
// so the most-severe band visually sits closest to the eye.
const SEVERITY_STACK: Array<{ key: keyof ScanHistorySeverityCounts; color: string; label: string }> = [
  { key: 'info', color: '#64748b', label: 'Info' },
  { key: 'low', color: '#22c55e', label: 'Low' },
  { key: 'medium', color: '#f59e0b', label: 'Medium' },
  { key: 'high', color: '#f97316', label: 'High' },
  { key: 'critical', color: '#ef4444', label: 'Critical' },
];

function niceCeiling(v: number): number {
  if (v <= 5) return 5;
  if (v <= 10) return 10;
  if (v <= 25) return 25;
  if (v <= 50) return 50;
  if (v <= 100) return 100;
  return Math.ceil(v / 50) * 50;
}

interface SeverityScale {
  max: number;
  ticks: number[];
}

function buildSeverityScale(points: TrendChartPoint[]): SeverityScale {
  let raw = 0;
  for (const p of points) {
    if (p.isFailed) continue;
    const total = SEVERITY_STACK.reduce((s, layer) => s + p.severity[layer.key], 0);
    if (total > raw) raw = total;
  }
  if (raw === 0) return { max: 5, ticks: [0, 5] };
  const max = niceCeiling(raw);
  return { max, ticks: [0, Math.round(max / 2), max] };
}

function chartYCount(layout: ChartLayout, value: number, max: number): number {
  if (max <= 0) return layout.baseline;
  const clamped = Math.min(max, Math.max(0, value));
  return layout.pad.top + layout.plotH * (1 - clamped / max);
}

interface SeverityBand {
  key: keyof ScanHistorySeverityCounts;
  color: string;
  label: string;
  path: string;
}

interface StackedSeverity {
  bands: SeverityBand[];
  // Total findings per valid (non-failed) point, in `valid` order.
  totals: number[];
  // Mapping from each entry in `points` to its index in `valid`, or -1 if failed.
  validIndex: number[];
}

function buildStackedSeverity(
  points: TrendChartPoint[],
  layout: ChartLayout,
  max: number,
): StackedSeverity {
  const valid: TrendChartPoint[] = [];
  const validIndex: number[] = [];
  for (const p of points) {
    if (p.isFailed) {
      validIndex.push(-1);
    } else {
      validIndex.push(valid.length);
      valid.push(p);
    }
  }

  if (valid.length === 0) {
    return { bands: [], totals: [], validIndex };
  }

  let prevTops = valid.map(() => 0);
  const bands: SeverityBand[] = [];

  for (const layer of SEVERITY_STACK) {
    const newTops = valid.map((p, i) => prevTops[i] + p.severity[layer.key]);

    const topSeg = valid
      .map(
        (p, i) =>
          `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${chartYCount(layout, newTops[i], max).toFixed(1)}`,
      )
      .join(' ');

    const bottomSeg: string[] = [];
    for (let i = valid.length - 1; i >= 0; i -= 1) {
      bottomSeg.push(
        `L ${valid[i].x.toFixed(1)} ${chartYCount(layout, prevTops[i], max).toFixed(1)}`,
      );
    }

    bands.push({
      key: layer.key,
      color: layer.color,
      label: layer.label,
      path: `${topSeg} ${bottomSeg.join(' ')} Z`,
    });

    prevTops = newTops;
  }

  return { bands, totals: prevTops, validIndex };
}

interface TrendChartPoint {
  entry: ScanHistoryEntry;
  index: number;
  x: number;
  y: number | null;
  posture: number;
  isFailed: boolean;
  severity: ScanHistorySeverityCounts;
}

function buildTrendPoints(entries: ScanHistoryEntry[], layout: ChartLayout): TrendChartPoint[] {
  // Space points evenly across the axis. The date labels under the chart
  // already communicate the elapsed time between scans, so time-proportional
  // positioning only wastes horizontal room and clusters scans that ran close
  // together. Even spacing keeps every point readable and clickable.
  const xs = entries.map((_entry, index) => layout.chartX(index, entries.length));

  return entries.map((entry, index) => {
    const severity = normalizeSeverityCounts(entry);
    const isFailed = entry.status === 'failed';
    const posture = isFailed ? 0 : computePostureIndex(severity, entry.findings_count);
    return {
      entry,
      index,
      x: xs[index],
      y: isFailed ? null : layout.chartY(posture),
      posture,
      isFailed,
      severity,
    };
  });
}

function buildLinePath(points: TrendChartPoint[]): string {
  const valid = points.filter((p) => !p.isFailed && p.y != null);
  if (valid.length === 0) return '';
  return valid.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y!.toFixed(1)}`).join(' ');
}

function buildAreaPath(points: TrendChartPoint[], layout: ChartLayout): string {
  const line = buildLinePath(points);
  if (!line) return '';
  const valid = points.filter((p) => !p.isFailed && p.y != null);
  const first = valid[0];
  const last = valid[valid.length - 1];
  return `${line} L ${last.x.toFixed(1)} ${layout.baseline} L ${first.x.toFixed(1)} ${layout.baseline} Z`;
}

// Linearly interpolate the posture trend line's y at an arbitrary x using the
// surrounding successful points. Lets us tether a failed-scan marker up to the
// line at its exact time position without implying posture changed.
function interpolateLineY(points: TrendChartPoint[], x: number): number | null {
  const valid = points.filter((p) => !p.isFailed && p.y != null);
  if (valid.length === 0) return null;
  if (x <= valid[0].x) return valid[0].y;
  if (x >= valid[valid.length - 1].x) return valid[valid.length - 1].y;
  for (let i = 1; i < valid.length; i += 1) {
    const a = valid[i - 1];
    const b = valid[i];
    if (x >= a.x && x <= b.x) {
      const span = b.x - a.x || 1;
      const t = (x - a.x) / span;
      return a.y! + (b.y! - a.y!) * t;
    }
  }
  return valid[valid.length - 1].y;
}

const POSTURE_THEME: Record<Posture, { label: string; dot: string; chip: string }> = {
  improving: {
    label: 'Improving',
    dot: 'bg-emerald-400',
    chip: 'border-emerald-400/30 bg-emerald-950/50 text-emerald-300 backdrop-blur-md',
  },
  stable: {
    label: 'Stable',
    dot: 'bg-sky-400',
    chip: 'border-sky-400/30 bg-sky-950/50 text-sky-300 backdrop-blur-md',
  },
  degrading: {
    label: 'Degrading',
    dot: 'bg-rose-400',
    chip: 'border-rose-400/30 bg-rose-950/50 text-rose-300 backdrop-blur-md',
  },
  unknown: {
    label: 'Baseline',
    dot: 'bg-slate-400',
    chip: 'border-slate-400/30 bg-slate-950/50 text-slate-300 backdrop-blur-md',
  },
};

const POSTURE_THEME_LIGHT: Record<Posture, { label: string; dot: string; chip: string }> = {
  improving: {
    label: 'Improving',
    dot: 'bg-emerald-500',
    chip: 'border-emerald-200/80 bg-white/75 text-emerald-700 backdrop-blur-md',
  },
  stable: {
    label: 'Stable',
    dot: 'bg-sky-500',
    chip: 'border-sky-200/80 bg-white/75 text-sky-700 backdrop-blur-md',
  },
  degrading: {
    label: 'Degrading',
    dot: 'bg-rose-500',
    chip: 'border-rose-200/80 bg-white/75 text-rose-700 backdrop-blur-md',
  },
  unknown: {
    label: 'Baseline',
    dot: 'bg-slate-400',
    chip: 'border-slate-200/80 bg-white/75 text-slate-600 backdrop-blur-md',
  },
};

function OverlayStat({
  label,
  value,
  delta,
  deltaGoodWhenNegative,
  accent,
  isLightMode,
}: {
  label: string;
  value: number;
  delta?: number | null;
  deltaGoodWhenNegative?: boolean;
  accent?: 'rose' | 'emerald' | 'neutral';
  isLightMode: boolean;
}) {
  const valueColor =
    accent === 'rose'
      ? isLightMode ? 'text-rose-600' : 'text-rose-300'
      : accent === 'emerald'
        ? isLightMode ? 'text-emerald-600' : 'text-emerald-300'
        : isLightMode ? 'text-slate-900' : 'text-white';

  let deltaColor = isLightMode ? 'text-slate-500' : 'text-white/60';
  if (delta != null && delta !== 0) {
    const isGood = deltaGoodWhenNegative ? delta < 0 : delta > 0;
    deltaColor = isGood
      ? isLightMode ? 'text-emerald-600' : 'text-emerald-400'
      : isLightMode ? 'text-rose-600' : 'text-rose-400';
  }

  const glass = isLightMode
    ? 'border-white/60 bg-white/55 shadow-[0_2px_12px_rgba(15,23,42,0.08)]'
    : 'border-white/[0.08] bg-[#0a0f16]/55 shadow-[0_2px_16px_rgba(0,0,0,0.35)]';

  return (
    <div className={`rounded-md border px-2.5 py-1.5 backdrop-blur-md ${glass}`}>
      <p className={`text-[8px] uppercase tracking-[0.16em] leading-none ${isLightMode ? 'text-slate-500' : 'text-white/50'}`}>
        {label}
      </p>
      <div className="flex items-baseline gap-1 mt-0.5">
        <p className={`text-base font-light tabular-nums leading-none ${valueColor}`}>{value}</p>
        {delta != null && delta !== 0 && (
          <span className={`inline-flex items-center gap-0.5 text-[9px] tabular-nums ${deltaColor}`}>
            {delta > 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
            {formatDelta(delta)}
          </span>
        )}
      </div>
    </div>
  );
}

function TrendModeToggle({
  mode,
  onChange,
  isLightMode,
}: {
  mode: TrendMode;
  onChange: (next: TrendMode) => void;
  isLightMode: boolean;
}) {
  const shellClass = isLightMode
    ? 'border-white/60 bg-white/55 backdrop-blur-md'
    : 'border-white/[0.08] bg-[#0a0f16]/55 backdrop-blur-md';

  const buttonBase = 'px-2 py-1 text-[9px] uppercase tracking-[0.14em] rounded transition-colors';
  const activeClass = isLightMode
    ? 'bg-orange-100 text-orange-700'
    : 'bg-orange-500/15 text-orange-300';
  const inactiveClass = isLightMode ? 'text-slate-500 hover:text-slate-700' : 'text-[#8fa0bb] hover:text-[#cfd8e9]';

  const options: Array<{ key: TrendMode; label: string }> = [
    { key: 'posture', label: 'Posture' },
    { key: 'severity', label: 'Severity' },
  ];

  return (
    <div className={`inline-flex items-center gap-0.5 rounded-md border p-0.5 ${shellClass}`}>
      {options.map((opt) => {
        const isActive = mode === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`${buttonBase} ${isActive ? activeClass : inactiveClass}`}
            aria-pressed={isActive}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ExposureTrendCanvas({
  entries,
  avgPosture,
  isLightMode,
  latestResultId,
  selectedId,
  hoveredId,
  mode,
  onSelect,
  onHover,
}: {
  entries: ScanHistoryEntry[];
  avgPosture: number;
  isLightMode: boolean;
  latestResultId?: string | null;
  selectedId: string | null;
  hoveredId: string | null;
  mode: TrendMode;
  onSelect: (entry: ScanHistoryEntry) => void;
  onHover: (id: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: CHART_HEIGHT });
  const gradientId = useId().replace(/:/g, '');

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      setSize({
        width: Math.max(Math.round(width), 1),
        height: Math.max(Math.round(height), CHART_HEIGHT),
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(
    () => createChartLayout(size.width || 480),
    [size.width],
  );
  const points = useMemo(() => buildTrendPoints(entries, layout), [entries, layout]);
  const linePath = buildLinePath(points);
  const areaPath = buildAreaPath(points, layout);
  const avgY = layout.chartY(avgPosture);
  const successCount = points.filter((p) => !p.isFailed).length;
  const labelIndices = useMemo(
    () => selectLabelIndices(points, latestResultId),
    [points, latestResultId],
  );

  const isSeverity = mode === 'severity';
  const severityScale = useMemo(() => buildSeverityScale(points), [points]);
  const stacked = useMemo(
    () => (isSeverity ? buildStackedSeverity(points, layout, severityScale.max) : null),
    [isSeverity, points, layout, severityScale.max],
  );

  // Resolve a point's vertical position. In posture mode use the precomputed y;
  // in severity mode anchor the dot to the top of its stack so the dot always
  // sits on the highest band.
  const pointDotY = (idx: number): number | null => {
    const point = points[idx];
    if (point.isFailed) return null;
    if (!isSeverity) return point.y;
    if (!stacked) return point.y;
    const vIdx = stacked.validIndex[idx];
    if (vIdx < 0) return point.y;
    return chartYCount(layout, stacked.totals[vIdx], severityScale.max);
  };

  const pointDotLabel = (idx: number): number => {
    const point = points[idx];
    if (!isSeverity) return point.posture;
    if (!stacked) return point.posture;
    const vIdx = stacked.validIndex[idx];
    if (vIdx < 0) return 0;
    return stacked.totals[vIdx];
  };

  const yTicks = isSeverity ? severityScale.ticks : [0, 50, 100];

  const plotFill = isLightMode ? 'rgba(248,250,252,0.35)' : 'rgba(8,12,20,0.45)';
  const gridStroke = isLightMode ? 'rgba(148,163,184,0.28)' : 'rgba(71,85,105,0.4)';
  const axisLabel = isLightMode ? '#64748b' : '#8fa0bb';
  const lineStroke = isLightMode ? '#ea580c' : '#f59e0b';

  const shell = isLightMode
    ? 'border-slate-200/80 bg-gradient-to-br from-slate-100 via-white to-orange-50/40'
    : 'border-[#2a3345]/60 bg-gradient-to-br from-[#0c1018] via-[#0f1520] to-[#141a23]';

  return (
    <div ref={containerRef} className={`relative w-full ${shell}`}>
      {size.width > 0 && (
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="block w-full"
          style={{ height: PLOT_HEIGHT }}
          role="img"
          aria-label="Exposure trend across recent scans"
        >
          <defs>
            <linearGradient id={`area-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isLightMode ? 'rgba(251,146,60,0.42)' : 'rgba(245,158,11,0.32)'} />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
            <filter id={`glow-${gradientId}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <rect x="0" y="0" width={layout.width} height={layout.height} fill="transparent" />

          <rect
            x={layout.pad.left}
            y={layout.pad.top}
            width={layout.plotW}
            height={layout.plotH}
            rx="6"
            fill={plotFill}
          />

          {yTicks.map((tick, tickIdx) => {
            const y = isSeverity
              ? chartYCount(layout, tick, severityScale.max)
              : layout.chartY(tick);
            const isMid = isSeverity ? tickIdx === 1 : tick === 50;
            return (
              <g key={`tick-${tick}-${tickIdx}`}>
                <line
                  x1={layout.pad.left}
                  y1={y}
                  x2={layout.width - layout.pad.right}
                  y2={y}
                  stroke={gridStroke}
                  strokeDasharray={isMid ? '4 5' : '2 6'}
                />
                <text x={layout.pad.left - 6} y={y + 3} textAnchor="end" fontSize="9" fill={axisLabel} opacity="0.9">
                  {tick}
                </text>
              </g>
            );
          })}

          {!isSeverity && successCount >= 2 && (
            <line
              x1={layout.pad.left}
              y1={avgY}
              x2={layout.width - layout.pad.right}
              y2={avgY}
              stroke={isLightMode ? '#94a3b8' : '#475569'}
              strokeDasharray="6 5"
              strokeWidth="1"
              opacity="0.75"
            />
          )}

          {!isSeverity && areaPath && <path d={areaPath} fill={`url(#area-${gradientId})`} />}
          {!isSeverity && linePath && (
            <path
              d={linePath}
              fill="none"
              stroke={lineStroke}
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              filter={`url(#glow-${gradientId})`}
            />
          )}

          {isSeverity && stacked &&
            stacked.bands.map((band) => (
              <path
                key={`band-${band.key}`}
                d={band.path}
                fill={band.color}
                fillOpacity={isLightMode ? 0.55 : 0.7}
                stroke={band.color}
                strokeOpacity={isLightMode ? 0.8 : 0.9}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}

          {points.map((point, idx) => {
            const isSelected = selectedId === point.entry.result_id;
            const isHovered = hoveredId === point.entry.result_id;
            const isLatest = latestResultId === point.entry.result_id;
            const active = isSelected || isHovered;
            const color = dominantSeverityColor(point.severity);
            const showLabel = active || isLatest;

            if (point.isFailed) {
              const failY = layout.baseline - 6;
              // In posture mode, tether the marker to the trend line at this
              // scan's x with a faint dashed stem so it reads as "scan failed
              // at this time" rather than an orphan point the line skipped.
              const stemTop = !isSeverity ? interpolateLineY(points, point.x) : null;
              return (
                <g
                  key={point.entry.result_id}
                  className="cursor-pointer"
                  onClick={() => onSelect(point.entry)}
                  onMouseEnter={() => onHover(point.entry.result_id)}
                  onMouseLeave={() => onHover(null)}
                >
                  {stemTop != null && stemTop < failY - 6 && (
                    <line
                      x1={point.x}
                      x2={point.x}
                      y1={stemTop}
                      y2={failY - 6}
                      stroke="#f87171"
                      strokeWidth="1"
                      strokeDasharray="2 3"
                      opacity={active ? 0.55 : 0.32}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  <circle
                    cx={point.x}
                    cy={failY}
                    r={active ? 7 : 5.5}
                    fill={isLightMode ? '#fef2f2' : '#1a0a0c'}
                    stroke="#f87171"
                    strokeWidth="1.5"
                    opacity="0.95"
                  />
                  <path
                    d={`M ${point.x - 2.5} ${failY - 2.5} L ${point.x + 2.5} ${failY + 2.5} M ${point.x + 2.5} ${failY - 2.5} L ${point.x - 2.5} ${failY + 2.5}`}
                    stroke="#f87171"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            }

            const dotY = pointDotY(idx);
            if (dotY == null) return null;
            const labelValue = pointDotLabel(idx);
            const labelY = dotY - layout.pad.top < 16 ? dotY + 16 : dotY - 12;

            return (
              <g
                key={point.entry.result_id}
                className="cursor-pointer"
                onClick={() => onSelect(point.entry)}
                onMouseEnter={() => onHover(point.entry.result_id)}
                onMouseLeave={() => onHover(null)}
              >
                {active && (
                  <circle cx={point.x} cy={dotY} r="13" fill={color} opacity={isLightMode ? 0.14 : 0.22} />
                )}
                {isLatest && !active && (
                  <circle cx={point.x} cy={dotY} r="10" fill="none" stroke={color} strokeWidth="1" opacity="0.4" />
                )}
                <circle
                  cx={point.x}
                  cy={dotY}
                  r={active ? 5.5 : isLatest ? 5 : 3.75}
                  fill={isLightMode ? '#ffffff' : '#0f141d'}
                  stroke={color}
                  strokeWidth={isLatest ? 2.25 : 1.75}
                  vectorEffect="non-scaling-stroke"
                />
                {showLabel && (
                  <text
                    x={point.x}
                    y={labelY}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill={isLightMode ? '#0f172a' : '#f1f5f9'}
                  >
                    {labelValue}
                  </text>
                )}
              </g>
            );
          })}

          {/* Tick marks for the date axis - the labels themselves are rendered
              as real HTML below to guarantee they are visible. */}
          {points.map((point, idx) => {
            const isLatest = latestResultId === point.entry.result_id;
            if (!labelIndices.has(idx)) return null;
            return (
              <line
                key={`tick-${point.entry.result_id}`}
                x1={point.x}
                x2={point.x}
                y1={layout.baseline + 2}
                y2={layout.baseline + 7}
                stroke={isLatest ? lineStroke : gridStroke}
                strokeWidth={isLatest ? 1.4 : 1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
      )}

      {/* HTML date axis - normal-flow block under the SVG so it can never be
          clipped or hidden by SVG sizing/parent overflow. The container is
          100% of layout.width, matching the SVG viewBox 1:1, so we can use
          point.x as a percentage directly. */}
      {size.width > 0 && (
        <div className="relative w-full" style={{ height: DATE_AXIS_HEIGHT }}>
          {points.map((point, idx) => {
            const date = scanDateLabel(point.entry, idx);
            const isLatest = latestResultId === point.entry.result_id;
            if (!labelIndices.has(idx)) return null;
            if (!date) return null;

            const leftPct = (point.x / layout.width) * 100;
            const isLeftEdge = idx === 0;
            const isRightEdge = idx === points.length - 1;
            const transform = isLeftEdge
              ? 'translateX(0)'
              : isRightEdge
                ? 'translateX(-100%)'
                : 'translateX(-50%)';
            const color = isLatest
              ? lineStroke
              : isLightMode
                ? '#475569'
                : '#cbd5e1';

            return (
              <span
                key={`date-${point.entry.result_id}`}
                className="absolute whitespace-nowrap text-[11px] tracking-wide"
                style={{
                  top: 10,
                  left: `${leftPct}%`,
                  transform,
                  color,
                  fontWeight: isLatest ? 700 : 500,
                }}
              >
                {date}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ScanHistoryTrendProps {
  history: ScanHistoryEntry[];
  isLightMode: boolean;
  loading?: boolean;
  latestResultId?: string | null;
  latestFindings?: CloudHoundFinding[];
  onSelectLatest?: () => void;
  onViewNewFindings?: () => void;
  onCompareScans?: () => void;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

function severityRank(value: string | null | undefined): number {
  if (!value) return 0;
  return SEVERITY_RANK[value] ?? 0;
}

function formatLongDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function severityChipClasses(severity: string | null | undefined, isLightMode: boolean): string {
  const sev = (severity ?? '').toLowerCase();
  if (sev === 'critical') {
    return isLightMode
      ? 'bg-rose-50 text-rose-700 border border-rose-200'
      : 'bg-rose-950/60 text-rose-300 border border-rose-800/60';
  }
  if (sev === 'high') {
    return isLightMode
      ? 'bg-orange-50 text-orange-700 border border-orange-200'
      : 'bg-orange-950/60 text-orange-300 border border-orange-800/60';
  }
  if (sev === 'medium') {
    return isLightMode
      ? 'bg-amber-50 text-amber-700 border border-amber-200'
      : 'bg-amber-950/60 text-amber-300 border border-amber-800/60';
  }
  if (sev === 'low') {
    return isLightMode
      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
      : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60';
  }
  return isLightMode
    ? 'bg-slate-50 text-slate-700 border border-slate-200'
    : 'bg-slate-900/70 text-slate-300 border border-slate-700/70';
}

interface EntityAggregate {
  key: string;
  name: string;
  type: string;
  arn: string;
  count: number;
  worstSeverity: string;
}

function aggregateTopEntities(findings: CloudHoundFinding[], limit = 5): EntityAggregate[] {
  const map = new Map<string, EntityAggregate>();
  for (const f of findings) {
    const key = f.entity_arn || `${f.entity_type}:${f.entity_name}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      if (severityRank(f.severity) > severityRank(existing.worstSeverity)) {
        existing.worstSeverity = f.severity;
      }
    } else {
      map.set(key, {
        key,
        name: f.entity_name || f.entity_arn || 'Unknown',
        type: f.entity_type || '—',
        arn: f.entity_arn || '',
        count: 1,
        worstSeverity: f.severity,
      });
    }
  }
  return Array.from(map.values())
    .sort(
      (a, b) =>
        severityRank(b.worstSeverity) - severityRank(a.worstSeverity) || b.count - a.count,
    )
    .slice(0, limit);
}

export function ScanHistoryTrend({
  history,
  isLightMode,
  loading = false,
  latestResultId,
  latestFindings,
  onSelectLatest,
  onViewNewFindings,
  onCompareScans,
}: ScanHistoryTrendProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [mode, setMode] = useState<TrendMode>('posture');

  const successful = useMemo(() => history.filter((entry) => entry.status === 'success'), [history]);
  const chronological = useMemo(() => [...history].reverse(), [history]);
  const latest = successful[0];
  const previous = successful[1];

  const latestSeverity = latest ? normalizeSeverityCounts(latest) : EMPTY_SEVERITY;
  const previousSeverity = previous ? normalizeSeverityCounts(previous) : EMPTY_SEVERITY;

  const latestPosture = computePostureIndex(latestSeverity, latest?.findings_count);
  const previousPosture = computePostureIndex(previousSeverity, previous?.findings_count);
  const postureDelta = previous ? latestPosture - previousPosture : 0;

  const latestActionable = computeActionableCount(latestSeverity);
  const previousActionable = computeActionableCount(previousSeverity);
  const actionableDelta = previous ? latestActionable - previousActionable : 0;

  const avgPosture = useMemo(() => {
    if (successful.length === 0) return 0;
    return (
      successful.reduce(
        (sum, entry) => sum + computePostureIndex(normalizeSeverityCounts(entry), entry.findings_count),
        0,
      ) / successful.length
    );
  }, [successful]);

  const posture = computePosture(successful);
  const insights = useMemo(() => generateInsights(successful), [successful]);
  const postureTheme = isLightMode ? POSTURE_THEME_LIGHT[posture] : POSTURE_THEME[posture];

  const activeId = hoveredId ?? selectedId ?? null;
  const activeEntry = activeId ? history.find((entry) => entry.result_id === activeId) : undefined;
  const activeIndex = activeEntry ? successful.findIndex((entry) => entry.result_id === activeEntry.result_id) : -1;
  const activePrevious = activeIndex >= 0 ? successful[activeIndex + 1] : undefined;

  const latestDiff = latest?.diff_counts;
  const hasNewFindings = (latestDiff?.new ?? 0) > 0;

  const handleSelect = (entry: ScanHistoryEntry) => {
    setSelectedId((prev) => (prev === entry.result_id ? null : entry.result_id));
    if (latestResultId && entry.result_id === latestResultId) {
      onSelectLatest?.();
    }
  };

  if (loading) {
    return (
      <div className={`relative w-full h-[260px] overflow-hidden rounded-lg border animate-pulse ${
        isLightMode ? 'border-slate-200 bg-slate-100' : 'border-[#2a3345] bg-[#141a23]'
      }`}
      />
    );
  }

  if (history.length === 0) {
    return (
      <div className={`relative w-full h-[260px] flex items-center justify-center rounded-lg border ${
        isLightMode ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-[#2a3345] bg-[#141a23] text-[#9aa8c0]'
      }`}
      >
        <div className="text-center px-6">
          <p className="text-sm">No completed scans yet.</p>
          <p className={`text-xs mt-1 ${isLightMode ? 'text-slate-500' : 'text-[#7f8fa8]'}`}>Run your first scan to establish a baseline.</p>
        </div>
      </div>
    );
  }

  const headerWrap = isLightMode
    ? 'bg-gradient-to-br from-slate-50 to-white'
    : 'bg-gradient-to-br from-[#141a23] to-[#10151e]';

  return (
    <div className={`w-full ${headerWrap}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 pt-4 pb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <p className={`text-[10px] uppercase tracking-[0.2em] leading-none ${isLightMode ? 'text-slate-500' : 'text-[#8fa0bb]'}`}>
              Exposure trend
            </p>
            <p className={`text-sm font-light mt-1 leading-none ${isLightMode ? 'text-slate-800' : 'text-[#e8edf6]'}`}>
              {history.length} scan{history.length === 1 ? '' : 's'}
              <span className={`mx-1.5 ${isLightMode ? 'text-slate-300' : 'text-white/20'}`}>·</span>
              <span className={isLightMode ? 'text-slate-500' : 'text-[#8fa0bb]'}>avg {avgPosture.toFixed(0)}</span>
            </p>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-widest shrink-0 ${postureTheme.chip}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${postureTheme.dot}`} />
            {postureTheme.label}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {onCompareScans && history.filter((e) => e.status === 'success').length >= 2 && (
            <button
              type="button"
              onClick={onCompareScans}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] uppercase tracking-[0.14em] transition-colors ${
                isLightMode
                  ? 'border-slate-200 bg-white/70 text-slate-600 hover:text-slate-900 hover:bg-white'
                  : 'border-white/[0.08] bg-[#0a0f16]/55 text-[#9aa7bd] hover:text-[#cfd8e9] hover:bg-[#0a0f16]/80'
              }`}
            >
              <GitCompareArrows className="h-3 w-3" />
              Compare
            </button>
          )}
          <TrendModeToggle mode={mode} onChange={setMode} isLightMode={isLightMode} />
          <OverlayStat
            label="Exposure"
            value={latestPosture}
            delta={previous ? Math.round(postureDelta) : null}
            deltaGoodWhenNegative
            isLightMode={isLightMode}
          />
          <OverlayStat
            label="C+H"
            value={latestActionable}
            delta={previous ? actionableDelta : null}
            deltaGoodWhenNegative
            accent={latestActionable > 0 ? 'rose' : 'neutral'}
            isLightMode={isLightMode}
          />
          <OverlayStat
            label="New"
            value={latestDiff?.new ?? 0}
            accent={(latestDiff?.new ?? 0) > 0 ? 'rose' : 'neutral'}
            isLightMode={isLightMode}
          />
          <OverlayStat
            label="Resolved"
            value={latestDiff?.resolved ?? 0}
            accent={(latestDiff?.resolved ?? 0) > 0 ? 'emerald' : 'neutral'}
            isLightMode={isLightMode}
          />
        </div>
      </div>

      <ExposureTrendCanvas
        entries={chronological}
        avgPosture={avgPosture}
        isLightMode={isLightMode}
        latestResultId={latestResultId}
        selectedId={selectedId}
        hoveredId={hoveredId}
        mode={mode}
        onSelect={handleSelect}
        onHover={setHoveredId}
      />

      {mode === 'severity' && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 pt-2 pb-1">
          {SEVERITY_STACK.slice().reverse().map((layer) => (
            <span
              key={`legend-${layer.key}`}
              className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] ${
                isLightMode ? 'text-slate-600' : 'text-[#9aa7bd]'
              }`}
            >
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: layer.color, opacity: isLightMode ? 0.6 : 0.8 }}
              />
              {layer.label}
            </span>
          ))}
        </div>
      )}

      {selectedId && activeEntry ? (
        <ScanDrillDownPanel
          entry={activeEntry}
          previousEntry={activePrevious}
          isLightMode={isLightMode}
          isLatest={activeEntry.result_id === latestResultId}
          latestFindings={
            activeEntry.result_id === latestResultId ? latestFindings : undefined
          }
          onClose={() => setSelectedId(null)}
          onJumpToFindings={onSelectLatest}
        />
      ) : insights[0] || (hasNewFindings && onViewNewFindings) ? (
        <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t ${isLightMode ? 'border-slate-200/80' : 'border-[#2a3345]/60'}`}>
          {insights[0] ? (
            <p className={`text-[11px] leading-snug ${isLightMode ? 'text-slate-600' : 'text-[#b8c4d9]'}`}>
              {insights[0]}
            </p>
          ) : (
            <span />
          )}

          {hasNewFindings && onViewNewFindings && (
            <button
              type="button"
              onClick={onViewNewFindings}
              className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] transition-colors shrink-0 ${
                isLightMode ? 'text-orange-600 hover:text-orange-700' : 'text-orange-400 hover:text-orange-300'
              }`}
            >
              Review new
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ScanDrillDownPanel({
  entry,
  previousEntry,
  isLightMode,
  isLatest,
  latestFindings,
  onClose,
  onJumpToFindings,
}: {
  entry: ScanHistoryEntry;
  previousEntry?: ScanHistoryEntry;
  isLightMode: boolean;
  isLatest: boolean;
  latestFindings?: CloudHoundFinding[];
  onClose: () => void;
  onJumpToFindings?: () => void;
}) {
  const severity = normalizeSeverityCounts(entry);
  const prevSeverity = previousEntry ? normalizeSeverityCounts(previousEntry) : null;
  const posture = computePostureIndex(severity, entry.findings_count);
  const prevPosture = prevSeverity
    ? computePostureIndex(prevSeverity, previousEntry?.findings_count)
    : null;
  const total = totalFindings(severity, entry.findings_count);
  const prevTotal = prevSeverity ? totalFindings(prevSeverity, previousEntry?.findings_count) : null;

  const topEntities = useMemo(() => {
    if (!isLatest || !latestFindings || latestFindings.length === 0) return [];
    return aggregateTopEntities(latestFindings, 5);
  }, [isLatest, latestFindings]);

  const wrapBorder = isLightMode ? 'border-slate-200/80' : 'border-[#2a3345]/60';
  const labelMuted = isLightMode ? 'text-slate-500' : 'text-[#8fa0bb]';
  const valueText = isLightMode ? 'text-slate-800' : 'text-[#e8edf6]';
  const subtleText = isLightMode ? 'text-slate-600' : 'text-[#b8c4d9]';
  const cellShell = isLightMode
    ? 'border-white/70 bg-white/70'
    : 'border-white/[0.08] bg-[#0a0f16]/60';

  if (entry.status === 'failed') {
    return (
      <div className={`flex items-center justify-between gap-3 px-4 py-3 border-t ${wrapBorder}`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-widest shrink-0 ${
            isLightMode
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-rose-800/60 bg-rose-950/60 text-rose-300'
          }`}>
            Failed
          </span>
          <p className={`text-[11px] truncate ${subtleText}`}>
            {formatLongDate(entry.completed_at || entry.started_at)}
            {entry.error_message ? ` · ${entry.error_message}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`shrink-0 rounded p-1 transition-colors ${
            isLightMode ? 'text-slate-500 hover:text-slate-700' : 'text-[#8fa0bb] hover:text-[#cfd8e9]'
          }`}
          aria-label="Close scan details"
        >
          <X className="h-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  const postureDelta = prevPosture != null ? posture - prevPosture : null;
  const totalDelta = prevTotal != null ? total - prevTotal : null;
  const diff = entry.diff_counts;

  return (
    <div className={`px-4 py-3 border-t ${wrapBorder}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`text-[10px] uppercase tracking-[0.2em] leading-none ${labelMuted}`}>
              {isLatest ? 'Current scan' : 'Scan detail'}
            </p>
            {isLatest && (
              <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[8px] uppercase tracking-widest ${
                isLightMode
                  ? 'border-orange-200 bg-orange-50 text-orange-700'
                  : 'border-orange-800/60 bg-orange-950/60 text-orange-300'
              }`}>
                Latest
              </span>
            )}
          </div>
          <p className={`text-sm font-light mt-1 leading-tight ${valueText}`}>
            {formatLongDate(entry.completed_at || entry.started_at) || '—'}
          </p>
          <p className={`text-[11px] mt-0.5 ${subtleText}`}>
            {total} finding{total === 1 ? '' : 's'} · exposure {posture}
            {postureDelta != null && postureDelta !== 0 && (
              <span className={postureDelta > 0 ? ' text-rose-400' : ' text-emerald-400'}>
                {' '}({formatDelta(postureDelta)})
              </span>
            )}
            {totalDelta != null && totalDelta !== 0 && (
              <span className={` ${labelMuted}`}>
                {' · '}{totalDelta > 0 ? '+' : ''}{totalDelta} vs prev
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isLatest && onJumpToFindings && (
            <button
              type="button"
              onClick={onJumpToFindings}
              className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] transition-colors ${
                isLightMode ? 'text-orange-600 hover:text-orange-700' : 'text-orange-400 hover:text-orange-300'
              }`}
            >
              Jump to findings
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className={`rounded p-1 transition-colors ${
              isLightMode ? 'text-slate-500 hover:text-slate-700' : 'text-[#8fa0bb] hover:text-[#cfd8e9]'
            }`}
            aria-label="Close scan details"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {total > 0 && (
        <div className="mb-3">
          <div
            className={`flex h-2 w-full overflow-hidden rounded-full border ${
              isLightMode ? 'border-slate-200' : 'border-[#2a3345]/60'
            }`}
            role="img"
            aria-label="Severity composition"
          >
            {SEVERITY_LAYERS.map((layer) => {
              const count = severity[layer.key];
              if (count === 0) return null;
              const widthPct = (count / total) * 100;
              return (
                <span
                  key={`bar-${layer.key}`}
                  title={`${layer.label}: ${count}`}
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: layer.color,
                    opacity: isLightMode ? 0.75 : 0.85,
                  }}
                />
              );
            })}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {SEVERITY_LAYERS.map((layer) => {
              const count = severity[layer.key];
              if (count === 0) return null;
              return (
                <span
                  key={`legend-${layer.key}`}
                  className={`inline-flex items-center gap-1 text-[10px] ${labelMuted}`}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{ backgroundColor: layer.color, opacity: isLightMode ? 0.65 : 0.85 }}
                  />
                  <span className={valueText}>{count}</span>
                  {layer.label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {diff && (diff.new > 0 || diff.changed > 0 || diff.resolved > 0) && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className={`rounded-md border px-2.5 py-1.5 ${cellShell}`}>
            <p className={`text-[9px] uppercase tracking-[0.14em] leading-none ${labelMuted}`}>New</p>
            <p className={`text-base font-light tabular-nums leading-none mt-1 ${diff.new > 0 ? (isLightMode ? 'text-rose-600' : 'text-rose-400') : valueText}`}>
              {diff.new}
            </p>
          </div>
          <div className={`rounded-md border px-2.5 py-1.5 ${cellShell}`}>
            <p className={`text-[9px] uppercase tracking-[0.14em] leading-none ${labelMuted}`}>Changed</p>
            <p className={`text-base font-light tabular-nums leading-none mt-1 ${diff.changed > 0 ? (isLightMode ? 'text-amber-600' : 'text-amber-300') : valueText}`}>
              {diff.changed}
            </p>
          </div>
          <div className={`rounded-md border px-2.5 py-1.5 ${cellShell}`}>
            <p className={`text-[9px] uppercase tracking-[0.14em] leading-none ${labelMuted}`}>Resolved</p>
            <p className={`text-base font-light tabular-nums leading-none mt-1 ${diff.resolved > 0 ? (isLightMode ? 'text-emerald-600' : 'text-emerald-400') : valueText}`}>
              {diff.resolved}
            </p>
          </div>
        </div>
      )}

      {topEntities.length > 0 && (
        <div>
          <p className={`text-[10px] uppercase tracking-[0.14em] mb-1.5 ${labelMuted}`}>
            Top resources in this scan
          </p>
          <ul className="space-y-1">
            {topEntities.map((ent) => (
              <li
                key={ent.key}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md border ${cellShell}`}
              >
                <span
                  className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] uppercase tracking-widest shrink-0 ${severityChipClasses(ent.worstSeverity, isLightMode)}`}
                >
                  {ent.worstSeverity}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-[11px] truncate ${valueText}`} title={ent.arn || ent.name}>
                    {ent.name}
                  </p>
                  <p className={`text-[10px] truncate ${labelMuted}`}>
                    {ent.type}
                  </p>
                </div>
                <span className={`text-[10px] tabular-nums shrink-0 ${subtleText}`}>
                  {ent.count} finding{ent.count === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
