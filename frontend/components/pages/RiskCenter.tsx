'use client';
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Kpi } from '../ui/Kpi';
import { getRisks, evaluateRisks, getSettings, type RiskRecord } from '../../lib/api';

function labelSeverity(s: RiskRecord['severity']) { return s.charAt(0) + s.slice(1).toLowerCase(); }

export default function RiskCenter() {
  const [risks, setRisks] = useState<RiskRecord[]>([]);
  const [active, setActive] = useState<RiskRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true); setMessage(null);
    try {
      const settings = await getSettings();
      if (settings.selectedMine?.id) {
        const evaluated = await evaluateRisks(settings.selectedMine.id);
        if (evaluated.status === 'available') setRisks(evaluated.results);
        else setMessage(evaluated.reason ?? 'Risk data unavailable.');
      } else {
        const result = await getRisks();
        if (result.status === 'available') setRisks(result.results);
        else setMessage(result.reason ?? 'Select a mine to calculate operational risks.');
      }
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Risk data unavailable.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const high = useMemo(() => risks.filter(r => r.severity === 'HIGH' || r.severity === 'CRITICAL').length, [risks]);
  const avgProb = risks.length ? Math.round(risks.reduce((a, r) => a + r.probability, 0) / risks.length) : 0;

  return (
    <div className="page-fade">
      <div className="grid4">
        <Kpi title="Active Risks" value={String(risks.filter(r => r.status !== 'RESOLVED').length)} sub="Calculated from available operational data" trend="" color="risk" spark={risks.length ? [risks.length, risks.length, risks.length, risks.length, risks.length] : [0,0,0,0,0]} />
        <Kpi title="High Severity" value={String(high)} sub="Current calculated risks" trend="" color="risk" spark={risks.length ? [0, high, high, high, high] : [0,0,0,0,0]} />
        <Kpi title="Avg Probability" value={risks.length ? `${avgProb}%` : '—'} sub="Calculated from evidence" trend="" spark={risks.length ? [avgProb, avgProb, avgProb, avgProb, avgProb] : [0,0,0,0,0]} />
        <Kpi title="Mitigation Coverage" value="—" sub="Unavailable without mitigation dataset" trend="" spark={[0,0,0,0,0]} />
      </div>

      {message && <div className="card" style={{ marginBottom: 14 }}>{message}</div>}
      {loading && <div className="card">Calculating operational risk from available backend data…</div>}

      {!loading && risks.length > 0 && <div className="two">
        <div className="card">
          <div className="row"><b>Risk Matrix</b><span className="pill">Probability × Impact</span></div>
          <div className="matrix" style={{ marginTop: 12 }}>
            {risks.map(r => (
              <button key={r.id} className="risk-point" style={{ left: `${Math.max(0, Math.min(96, r.probability - 4))}%`, bottom: `${Math.max(0, Math.min(96, r.impact - 4))}%`, border: 0, padding: 0 }}
                title={r.name} aria-label={r.name} onClick={() => setActive(r)} />
            ))}
          </div>
        </div>
        <div className="card">
          <b>Active Risk Events</b>
          <div className="zone-list" style={{ marginTop: 10 }}>
            {risks.map(r => (
              <div className="zone-row" key={r.id} onClick={() => setActive(r)}>
                <div><b>{r.name}</b><div className="footer-note">{r.affectedArea ?? 'Operational area'} · {new Date(r.updatedAt).toLocaleString()}</div></div>
                <strong className={(r.severity === 'HIGH' || r.severity === 'CRITICAL') ? 'risk' : 'warn'}>{r.riskScore}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>}

      {!loading && active && (
        <aside className="drawer" role="dialog" aria-label={`${active.name} risk details`}>
          <button className="icon-btn close" onClick={() => setActive(null)} aria-label="Close panel"><X size={16} /></button>
          <span className="pill">{labelSeverity(active.severity).toUpperCase()} SEVERITY</span>
          <h2>{active.name}</h2>
          <p className="sub">{active.affectedArea ?? 'Operational area'} · updated {new Date(active.updatedAt).toLocaleString()}</p>
          <div className="card" style={{ marginTop: 15 }}>
            <div className="row"><span>Cause</span><b>{active.cause}</b></div>
            <div className="row" style={{ marginTop: 10 }}><span>Impact</span><b>{active.impact}/100</b></div>
            <div className="row" style={{ marginTop: 10 }}><span>Probability</span><b>{active.probability}%</b></div>
            <div className="row" style={{ marginTop: 10 }}><span>Risk score</span><b>{active.riskScore}/100</b></div>
            <div className="row" style={{ marginTop: 10 }}><span>Current status</span><b className="warn">{labelSeverity(active.status as any)}</b></div>
          </div>
          <div className="card" style={{ marginTop: 15 }}>
            <b>Evidence</b>
            <p className="sub" style={{ marginTop: 8 }}>{active.cause}</p>
            <p className="footer-note" style={{ marginTop: 8 }}>Calculation: {active.calculationVersion}</p>
          </div>
          {active.mitigation && <div className="card" style={{ marginTop: 15 }}><b>Recommended Response</b><p className="sub" style={{ marginTop: 8 }}>{active.mitigation}</p></div>}
        </aside>
      )}
    </div>
  );
}
