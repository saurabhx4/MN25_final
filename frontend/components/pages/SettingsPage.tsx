'use client';

import { useEffect, useMemo, useState } from 'react';
import { getMines, getSettings, getSystemStatus, updateSettings, Mn25Settings } from '../../lib/api';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Mn25Settings | null>(null);
  const [mines, setMines] = useState<Array<{ id: string; name: string; region: string }>>([]);
  const [system, setSystem] = useState<Record<string, { status: string; latency: number | null; lastChecked: string | null; version: string | null; message: string | null }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getSettings(), getMines(), getSystemStatus()])
      .then(([s, m, health]) => { setSettings(s); setMines(m.results); setSystem(health.components); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Unable to load settings.'));
  }, []);

  const writable = settings?.permissions.canWriteOperational ?? false;
  const overall = useMemo(() => {
    if (!system) return null;
    const values = Object.values(system);
    if (values.some(v => v.status === 'offline')) return 'Some Systems Offline';
    if (values.some(v => v.status === 'degraded')) return 'Systems Degraded';
    if (values.length && values.every(v => v.status === 'operational')) return 'All Systems Operational';
    return 'System Status Unavailable';
  }, [system]);

  async function save(changes: Parameters<typeof updateSettings>[0]) {
    try {
      setError(null);
      const next = await updateSettings(changes);
      setSettings(next);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save setting.'); }
  }

  if (!settings) return <div className="page-fade"><div className="card"><b>Mine Configuration</b><p className="sub" style={{ marginTop: 10 }}>{error ?? 'Loading settings…'}</p></div></div>;

  return (
    <div className="page-fade">
      <div className="card">
        <b>Mine Configuration</b>
        <div className="controls" style={{ marginTop: 15 }}>
          <div className="control">
            <label>Selected mine</label>
            <select className="select" style={{ width: '100%' }} value={settings.selectedMine?.id ?? ''} disabled={!writable} onChange={(e) => save({ selectedMineId: e.target.value || null })}>
              <option value="">No mine selected</option>
              {mines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="control">
            <label>Forecast horizon</label>
            <select className="select" style={{ width: '100%' }} value={settings.forecastHorizon} disabled={!writable} onChange={(e) => save({ forecastHorizon: Number(e.target.value) as 30 | 60 | 90 })}>
              <option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option>
            </select>
          </div>
          <div className="control">
            <label>Risk threshold</label>
            <input className="select" style={{ width: '100%' }} type="number" min={0} max={100} value={settings.riskThreshold} disabled={!writable} onChange={(e) => save({ riskThreshold: Number(e.target.value) })} />
          </div>
          <div className="control">
            <label>Prospectivity threshold</label>
            <input className="select" style={{ width: '100%' }} type="number" min={0} max={100} value={settings.prospectivityThreshold} disabled={!writable} onChange={(e) => save({ prospectivityThreshold: Number(e.target.value) })} />
          </div>
        </div>
        {error && <p className="sub" style={{ marginTop: 10 }}>{error}</p>}
      </div>

      <div className="card" style={{ marginTop: 15 }}>
        <b>System Status</b>
        <p className={overall === 'All Systems Operational' ? 'green' : ''} style={{ marginTop: 8 }}>● {overall ?? 'Checking Systems…'}</p>
        <p className="sub" style={{ marginTop: 6 }}>AI Engine · Database · Geospatial Engine · Forecasting · Data Pipeline · Reports · Storage</p>
      </div>

      <p className="footer-note">Mn 25 · Organization settings are persisted by the MN25 backend.</p>
    </div>
  );
}
