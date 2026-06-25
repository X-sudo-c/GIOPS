import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2, X } from 'lucide-react';
import {
  getCloudHoundScanDiffs,
  type CloudHoundScanDiffRow,
  type CloudHoundScanDiffsResponse,
  type ScanHistoryEntry,
} from '../api/cloudhound-api';

interface ScanCompareModalProps {
  open: boolean;
  isLightMode: boolean;
  selectedAwsAccountId: string;
  history: ScanHistoryEntry[];
  defaultCurrentResultId?: string | null;
  defaultCompareToResultId?: string | null;
  onClose: () => void;
}

function formatScanLabel(entry: ScanHistoryEntry | undefined): string {
  if (!entry) return 'Select a scan';
  const ts = entry.completed_at || entry.started_at;
  if (!ts) return entry.result_id.slice(0, 8);
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return entry.result_id.slice(0, 8);
  const dateStr = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  const status = entry.status === 'failed' ? ' · failed' : '';
  return `${dateStr} ${timeStr}${status}`;
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

function ScanPicker({
  label,
  value,
  options,
  onChange,
  disabledIds,
  isLightMode,
}: {
  label: string;
  value: string | null;
  options: ScanHistoryEntry[];
  onChange: (id: string) => void;
  disabledIds: Set<string>;
  isLightMode: boolean;
}) {
  const labelMuted = isLightMode ? 'text-slate-500' : 'text-[#8fa0bb]';
  const selectShell = isLightMode
    ? 'border-slate-300 bg-white text-slate-800'
    : 'border-[#2a3345] bg-[#0f141d] text-[#e8edf6]';

  return (
    <label className="flex flex-col gap-1 min-w-0 flex-1">
      <span className={`text-[10px] uppercase tracking-[0.18em] ${labelMuted}`}>{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-md border px-2.5 py-1.5 text-xs ${selectShell}`}
      >
        {!value && <option value="">Select a scan…</option>}
        {options.map((entry) => {
          const isDisabled = disabledIds.has(entry.result_id);
          return (
            <option key={entry.result_id} value={entry.result_id} disabled={isDisabled}>
              {formatScanLabel(entry)}{isDisabled ? ' (already selected)' : ''}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function DiffRow({ row, isLightMode }: { row: CloudHoundScanDiffRow; isLightMode: boolean }) {
  const valueText = isLightMode ? 'text-slate-800' : 'text-[#e8edf6]';
  const labelMuted = isLightMode ? 'text-slate-500' : 'text-[#8fa0bb]';
  const cellShell = isLightMode
    ? 'border-slate-200 bg-white/80'
    : 'border-[#2a3345]/60 bg-[#0a0f16]/60';

  const showSev = row.change_type === 'changed' ? (
    <span className="inline-flex items-center gap-1 text-[10px]">
      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${severityChipClasses(row.previous_severity, isLightMode)}`}>
        {row.previous_severity ?? '—'}
      </span>
      <ArrowRight className={`h-3 w-3 ${labelMuted}`} />
      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${severityChipClasses(row.current_severity, isLightMode)}`}>
        {row.current_severity ?? '—'}
      </span>
    </span>
  ) : (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${severityChipClasses(
        row.current_severity ?? row.previous_severity,
        isLightMode,
      )}`}
    >
      {row.current_severity ?? row.previous_severity ?? '—'}
    </span>
  );

  return (
    <li className={`px-2.5 py-2 rounded-md border ${cellShell}`}>
      <div className="flex items-center gap-2 min-w-0">
        {showSev}
        <p className={`text-[11px] truncate min-w-0 flex-1 ${valueText}`} title={row.entity_name}>
          {row.entity_name || row.finding_type}
        </p>
      </div>
      <p className={`text-[10px] mt-0.5 truncate ${labelMuted}`}>{row.finding_type}</p>
    </li>
  );
}

function DiffColumn({
  title,
  count,
  rows,
  isLightMode,
  accent,
}: {
  title: string;
  count: number;
  rows: CloudHoundScanDiffRow[];
  isLightMode: boolean;
  accent: 'rose' | 'amber' | 'emerald';
}) {
  const labelMuted = isLightMode ? 'text-slate-500' : 'text-[#8fa0bb]';
  const headerColor =
    accent === 'rose'
      ? isLightMode ? 'text-rose-600' : 'text-rose-400'
      : accent === 'amber'
        ? isLightMode ? 'text-amber-600' : 'text-amber-300'
        : isLightMode ? 'text-emerald-600' : 'text-emerald-400';

  const emptyShell = isLightMode
    ? 'border-slate-200 bg-slate-50/70 text-slate-500'
    : 'border-[#2a3345]/60 bg-[#0a0f16]/40 text-[#7f8fa8]';

  return (
    <div className="min-w-0 flex flex-col">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className={`text-[10px] uppercase tracking-[0.18em] ${labelMuted}`}>{title}</p>
        <p className={`text-base font-light tabular-nums ${headerColor}`}>{count}</p>
      </div>
      {rows.length === 0 ? (
        <div className={`flex-1 rounded-md border border-dashed px-3 py-4 text-[11px] text-center ${emptyShell}`}>
          None
        </div>
      ) : (
        <ul className="space-y-1.5 overflow-y-auto pr-1 max-h-[50vh]">
          {rows.map((row) => (
            <DiffRow key={`${row.change_type}-${row.id}`} row={row} isLightMode={isLightMode} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function ScanCompareModal({
  open,
  isLightMode,
  selectedAwsAccountId,
  history,
  defaultCurrentResultId,
  defaultCompareToResultId,
  onClose,
}: ScanCompareModalProps) {
  const successful = useMemo(() => history.filter((e) => e.status === 'success'), [history]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [response, setResponse] = useState<CloudHoundScanDiffsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const fallbackCurrent = defaultCurrentResultId || successful[0]?.result_id || null;
    const fallbackCompare =
      defaultCompareToResultId ||
      successful.find((e) => e.result_id !== fallbackCurrent)?.result_id ||
      null;
    setCurrentId(fallbackCurrent);
    setCompareId(fallbackCompare);
    setResponse(null);
    setError(null);
  }, [open, defaultCurrentResultId, defaultCompareToResultId, successful]);

  useEffect(() => {
    if (!open) return;
    if (!currentId || !compareId || currentId === compareId || !selectedAwsAccountId) {
      setResponse(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCloudHoundScanDiffs({
      selectedAwsAccountId,
      resultId: currentId,
      compareToResultId: compareId,
    })
      .then((res) => {
        if (cancelled) return;
        setResponse(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load diff.';
        setError(message);
        setResponse(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, currentId, compareId, selectedAwsAccountId]);

  const groupedRows = useMemo(() => {
    const groups = { new: [] as CloudHoundScanDiffRow[], changed: [] as CloudHoundScanDiffRow[], resolved: [] as CloudHoundScanDiffRow[] };
    if (!response) return groups;
    for (const row of response.diffs) {
      if (row.change_type in groups) {
        groups[row.change_type].push(row);
      }
    }
    return groups;
  }, [response]);

  if (!open) return null;

  const overlayShell = isLightMode ? 'bg-slate-900/40' : 'bg-black/60';
  const dialogShell = isLightMode
    ? 'bg-white border border-slate-200 shadow-[0_24px_48px_rgba(15,23,42,0.18)]'
    : 'bg-[#141a23] border border-[#2a3345]/75 shadow-[0_24px_48px_rgba(0,0,0,0.55)]';
  const labelMuted = isLightMode ? 'text-slate-500' : 'text-[#8fa0bb]';
  const titleColor = isLightMode ? 'text-slate-900' : 'text-[#e8edf6]';

  const sameScanWarning = currentId && compareId && currentId === compareId;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${overlayShell}`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Scan compare"
    >
      <div
        className={`relative w-full max-w-5xl rounded-lg overflow-hidden ${dialogShell}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between gap-3 px-5 py-3 border-b ${
          isLightMode ? 'border-slate-200' : 'border-[#2a3345]/60'
        }`}>
          <div>
            <p className={`text-[10px] uppercase tracking-[0.18em] ${labelMuted}`}>Scan compare</p>
            <p className={`text-sm font-light ${titleColor}`}>
              Diff findings between any two completed scans
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`rounded p-1 transition-colors ${
              isLightMode ? 'text-slate-500 hover:text-slate-700' : 'text-[#8fa0bb] hover:text-[#cfd8e9]'
            }`}
            aria-label="Close compare"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <ScanPicker
              label="Compare against (older)"
              value={compareId}
              options={successful}
              onChange={setCompareId}
              disabledIds={new Set(currentId ? [currentId] : [])}
              isLightMode={isLightMode}
            />
            <div className={`flex items-center justify-center pt-4 ${labelMuted}`}>
              <ArrowRight className="h-4 w-4" />
            </div>
            <ScanPicker
              label="Current (newer)"
              value={currentId}
              options={successful}
              onChange={setCurrentId}
              disabledIds={new Set(compareId ? [compareId] : [])}
              isLightMode={isLightMode}
            />
          </div>

          {sameScanWarning && (
            <p className={`text-[11px] ${isLightMode ? 'text-rose-600' : 'text-rose-400'}`}>
              Pick two different scans to see a diff.
            </p>
          )}

          {error && (
            <p className={`text-[11px] ${isLightMode ? 'text-rose-600' : 'text-rose-400'}`}>
              {error}
            </p>
          )}

          {loading ? (
            <div className={`flex items-center justify-center py-12 gap-2 text-[11px] ${labelMuted}`}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Computing diff…
            </div>
          ) : response ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <DiffColumn
                title="New"
                count={response.diff_counts.new}
                rows={groupedRows.new}
                isLightMode={isLightMode}
                accent="rose"
              />
              <DiffColumn
                title="Changed severity"
                count={response.diff_counts.changed}
                rows={groupedRows.changed}
                isLightMode={isLightMode}
                accent="amber"
              />
              <DiffColumn
                title="Resolved"
                count={response.diff_counts.resolved}
                rows={groupedRows.resolved}
                isLightMode={isLightMode}
                accent="emerald"
              />
            </div>
          ) : !sameScanWarning ? (
            <p className={`text-[11px] py-8 text-center ${labelMuted}`}>
              Select two scans above to compare.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
