import { useCallback, useEffect, useState } from 'react';
import {
  approveAsset,
  getStagingAssets,
  listConflicts,
  listInspections,
  patchAssetName,
  patchAssetVoltage,
  repairTopology,
  resolveConflict,
  type GiopConflictProposal,
  type GiopStagingAsset,
  type GiopInspection,
} from '../api/giop-api';
import { countValidationStats } from '../lib/giopGraphAdapter';
import { useGiopSelection } from '../context/GiopSelectionContext';
import { useDebouncedCallback } from '../hooks/useDebouncedCallback';
import { GHANA_VOLTAGE_OPTIONS } from '../lib/giopSldTheme';

interface GiopOperationsTabProps {
  isLightMode: boolean;
  onRefreshTopology?: () => void;
  onMapRefresh?: () => void;
  refreshToken?: number;
}

function validationBadgeClass(validation?: string): string {
  if (validation === 'APPROVED') return 'bg-green-900 text-green-300';
  if (validation === 'IN_CONFLICT') return 'bg-red-900 text-red-300';
  if (validation === 'PENDING_FIELD') return 'bg-amber-900 text-amber-300';
  if (validation === 'STAGED') return 'bg-blue-900 text-blue-300';
  return 'bg-slate-800 text-slate-300';
}

export function GiopOperationsTab({
  isLightMode,
  onRefreshTopology,
  onMapRefresh,
  refreshToken = 0,
}: GiopOperationsTabProps) {
  const { setSelection } = useGiopSelection();
  const [assets, setAssets] = useState<GiopStagingAsset[]>([]);
  const [inspectionsByAsset, setInspectionsByAsset] = useState<Record<string, GiopInspection>>({});
  const [conflicts, setConflicts] = useState<GiopConflictProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('Idle');
  const [repairTarget, setRepairTarget] = useState<string | null>(null);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await getStagingAssets();
      setAssets(rows);
      const inspections = await listInspections().catch(() => [] as GiopInspection[]);
      const byAsset: Record<string, GiopInspection> = {};
      for (const row of inspections) {
        if (!byAsset[row.asset_mrid]) byAsset[row.asset_mrid] = row;
      }
      setInspectionsByAsset(byAsset);
      const conflictRows = await listConflicts().catch(() => [] as GiopConflictProposal[]);
      setConflicts(conflictRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load staging assets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets, refreshToken]);

  const stats = countValidationStats(assets);
  const total = assets.length || 1;

  const debouncedPatchName = useDebouncedCallback(async (mrid: string, name: string) => {
    try {
      await patchAssetName(mrid, name);
      setStatus(`Saved name for ${mrid.slice(0, 8)}…`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Name update failed');
    }
  }, 500);

  const handleVoltageChange = async (mrid: string, voltage: string) => {
    setStatus('Saving voltage…');
    try {
      await patchAssetVoltage(mrid, voltage);
      setStatus(`Voltage updated for ${mrid.slice(0, 8)}…`);
      await loadAssets();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Voltage update failed');
    }
  };

  const handleApprove = async (mrid: string) => {
    setStatus('Approving…');
    try {
      await approveAsset(mrid);
      await loadAssets();
      onRefreshTopology?.();
      onMapRefresh?.();
      setStatus('Asset promoted to master');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Approve failed');
    }
  };

  const handleRepair = async () => {
    const mrid = repairTarget || assets[0]?.mrid;
    if (!mrid) return;
    setStatus('Running topology repair…');
    try {
      await repairTopology(mrid);
      setStatus(`Repair complete for ${mrid}`);
      onRefreshTopology?.();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Repair failed');
    }
  };

  const handleResolveConflict = async (
    conflictId: string,
    resolution: 'master' | 'field' | 'discard',
  ) => {
    setStatus(`Resolving conflict (${resolution})…`);
    try {
      await resolveConflict(conflictId, resolution);
      await loadAssets();
      onRefreshTopology?.();
      setStatus('Conflict resolved');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Resolve failed');
    }
  };

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Pending field', value: stats.pending, color: '#f59e0b' },
          { label: 'Staged', value: stats.staged, color: '#3b82f6' },
          { label: 'In conflict', value: stats.conflict, color: '#ef4444' },
          { label: 'Other', value: stats.other, color: '#64748b' },
        ].map((item) => (
          <div
            key={item.label}
            className={`rounded-xl border p-4 ${isLightMode ? 'border-slate-200 bg-white' : 'border-[#283246]/75 bg-[#0f141d]'}`}
          >
            <p className={`text-xs uppercase tracking-wide ${isLightMode ? 'text-slate-500' : 'text-[#93a0b8]'}`}>{item.label}</p>
            <p className="text-2xl font-light mt-1" style={{ color: item.color }}>{item.value}</p>
            <p className={`text-xs mt-1 ${isLightMode ? 'text-slate-400' : 'text-[#6b7a94]'}`}>
              {((item.value / total) * 100).toFixed(0)}% of queue
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className={`text-sm font-semibold ${isLightMode ? 'text-slate-800' : 'text-slate-200'}`}>Asset Verification</h3>
          <p className={`text-xs ${isLightMode ? 'text-slate-500' : 'text-slate-400'}`}>{status}</p>
        </div>
        <button
          type="button"
          onClick={() => void handleRepair()}
          className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 rounded text-xs font-medium text-white"
        >
          One-Click Topology Repair
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {conflicts.length > 0 && (
        <div className={`rounded-xl border overflow-hidden ${isLightMode ? 'border-red-200' : 'border-red-900/50'}`}>
          <div className={`px-4 py-2 text-xs font-semibold uppercase ${isLightMode ? 'bg-red-50 text-red-800' : 'bg-red-950/40 text-red-300'}`}>
            Open conflicts ({conflicts.length})
          </div>
          <table className="w-full text-sm text-left">
            <thead className={`text-xs uppercase ${isLightMode ? 'bg-slate-100 text-slate-500' : 'bg-slate-900 text-slate-400'}`}>
              <tr>
                <th className="px-4 py-2">Asset</th>
                <th className="px-4 py-2">Server updated</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isLightMode ? 'divide-slate-200' : 'divide-slate-800'}`}>
              {conflicts.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 font-mono text-xs">{c.asset_name || c.asset_mrid}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {c.server_updated_at ? new Date(c.server_updated_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2 space-x-1">
                    <button type="button" className="text-xs px-2 py-0.5 bg-slate-700 rounded text-white" onClick={() => void handleResolveConflict(c.id, 'master')}>Keep master</button>
                    <button type="button" className="text-xs px-2 py-0.5 bg-emerald-800 rounded text-white" onClick={() => void handleResolveConflict(c.id, 'field')}>Accept field</button>
                    <button type="button" className="text-xs px-2 py-0.5 bg-slate-600 rounded text-white" onClick={() => void handleResolveConflict(c.id, 'discard')}>Discard</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={`rounded-xl border overflow-hidden ${isLightMode ? 'border-slate-200' : 'border-slate-800'}`}>
        <table className="w-full text-sm text-left">
          <thead className={`text-xs uppercase sticky top-0 ${isLightMode ? 'bg-slate-100 text-slate-500' : 'bg-slate-900 text-slate-400'}`}>
            <tr>
              <th className="px-4 py-3">Asset MRID</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Voltage</th>
              <th className="px-4 py-3">Validation</th>
              <th className="px-4 py-3">AI validation</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${isLightMode ? 'divide-slate-200' : 'divide-slate-800'}`}>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-slate-500">Loading staging assets…</td>
              </tr>
            )}
            {!loading && assets.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-slate-500">No pending field assets</td>
              </tr>
            )}
            {assets.map((row) => {
              const canApprove = row.validation === 'PENDING_FIELD' || row.validation === 'STAGED';
              return (
                <tr
                  key={row.mrid}
                  className={`cursor-pointer ${isLightMode ? 'hover:bg-slate-50' : 'hover:bg-slate-900/60'}`}
                  onClick={() => {
                    setRepairTarget(row.mrid);
                    const coords = row.geom?.coordinates;
                    setSelection(row.mrid, {
                      name: row.name,
                      coordinates: coords ?? null,
                      source: 'table',
                    });
                  }}
                >
                  <td className="px-4 py-3 font-mono text-xs">{row.mrid}</td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      defaultValue={row.name ?? ''}
                      className={`w-full rounded px-2 py-1 text-sm border ${isLightMode ? 'bg-white border-slate-300' : 'bg-slate-900 border-slate-700'}`}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const value = e.target.value.trim();
                        if (value) void debouncedPatchName(row.mrid, value);
                      }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    {row.nominal_voltage ? (
                      <select
                        value={row.nominal_voltage}
                        className={`rounded px-2 py-1 text-xs border ${isLightMode ? 'bg-white border-slate-300' : 'bg-slate-900 border-slate-700'}`}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => void handleVoltageChange(row.mrid, e.target.value)}
                      >
                        {GHANA_VOLTAGE_OPTIONS.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${validationBadgeClass(row.validation)}`}>
                      {row.validation ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {inspectionsByAsset[row.mrid]?.ai_validation_status ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    {canApprove && (
                      <button
                        type="button"
                        className="text-xs px-2 py-0.5 bg-emerald-800 hover:bg-emerald-700 rounded text-white"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleApprove(row.mrid);
                        }}
                      >
                        Approve → Master
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
