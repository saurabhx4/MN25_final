'use client';
import { useEffect, useState } from 'react';
import { Check, Clock3 } from 'lucide-react';
import { FeatureBars } from '../Charts';
import type { Action } from '../../lib/data';
import { getActionPlan, type ActionPlan } from '../../lib/api';

type Rec = { title: string; reason: string; action: string; confidence: number; impact: number; priority: 'LOW' | 'MEDIUM' | 'HIGH' };

export default function ActionCenter({
  actions, setAction, recs, onGenerate, planStatus, planId,
}: {
  actions: Action[];
  setAction: (id: string, status: Action['status']) => void | Promise<void>;
  recs: Rec[];
  onGenerate: () => void | Promise<void>;
  planStatus: string | null;
  planId: string | null;
}) {
  const [plan, setPlan] = useState<ActionPlan | null>(null);

  useEffect(() => {
    if (!planId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await getActionPlan(planId);
        if (cancelled) return;
        setPlan(next);
        if (next.status === 'QUEUED' || next.status === 'GENERATING') window.setTimeout(poll, 1800);
      } catch {
        // The page remains usable; the next explicit generation can retry.
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [planId]);

  return (
    <div className="page-fade">
      <div className="section-title">
        <h2>Today&apos;s AI Action Plan</h2>
        <button className="btn primary" onClick={() => onGenerate()} disabled={planStatus === 'QUEUED' || planStatus === 'GENERATING'}>
          {planStatus === 'QUEUED' || planStatus === 'GENERATING' ? 'Generating…' : 'Generate Full Action Plan'}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        {plan?.status === 'READY' ? (
          <>
            <div className="row"><b>{plan.summary || 'Action plan generated'}</b><span className="pill">{plan.confidence != null ? `${plan.confidence}% confidence` : 'Confidence unavailable'}</span></div>
            {plan.expectedImpact != null && <p className="sub" style={{ marginTop: 8 }}>Estimated impact: <b>{plan.expectedImpact}</b></p>}
            {Array.isArray(plan.detectedIssues) && plan.detectedIssues.length > 0 && (
              <div className="controls" style={{ marginTop: 10 }}>
                {plan.detectedIssues.map((issue, index) => <div className="row" key={index}><span>{typeof issue === 'string' ? issue : JSON.stringify(issue)}</span></div>)}
              </div>
            )}
            <div className="row" style={{ marginTop: 14 }}>
              <div><div className="footer-note">MODEL</div><b style={{ fontSize: 16 }}>{plan.modelVersion || 'Unavailable'}</b></div>
              <div><div className="footer-note">GENERATED</div><b style={{ fontSize: 16 }}>{plan.generatedAt ? new Date(plan.generatedAt).toLocaleString() : '—'}</b></div>
            </div>
          </>
        ) : plan?.status === 'FAILED' ? (
          <>
            <div className="row"><b>Action plan unavailable</b><span className="pill">No recommendation generated</span></div>
            <p className="sub" style={{ marginTop: 8 }}>{plan.errorMessage || 'The decision engine could not produce a sourced action plan.'}</p>
          </>
        ) : planStatus === 'UNAVAILABLE' ? (
          <>
            <div className="row"><b>Action plan unavailable</b><span className="pill">Backend required</span></div>
            <p className="sub" style={{ marginTop: 8 }}>MN25 requires a configured decision engine and sourced operational signals. No production, weather, risk or AI values are invented in the client.</p>
          </>
        ) : (
          <>
            <div className="row"><b>No current AI action plan</b><span className="pill">Sourced data required</span></div>
            <p className="sub" style={{ marginTop: 8 }}>Generate a plan after the backend has access to real production, risk, weather or analysis signals.</p>
          </>
        )}
      </div>

      <div className="grid4">
        {recs.map((r, i) => (
          <div className="card" key={i}>
            <span className="pill">{r.priority}</span>
            <h3 style={{ fontSize: 14.5, margin: '12px 0 7px' }}>{r.title}</h3>
            <p className="sub">{r.reason}</p>
            <p style={{ fontSize: 13, margin: '10px 0' }}>{r.action}</p>
            <div className="row"><span className="green">{r.impact ? `+${r.impact} T` : 'Impact unavailable'}</span><span>{r.confidence}% confidence</span></div>
          </div>
        ))}
      </div>

      <div className="section-title"><h2>AI Decision Factors</h2><span className="data-tag">{plan?.status === 'READY' ? `Model ${plan.modelVersion || '—'}` : 'No sourced factors'}</span></div>
      <div className="card">
        {plan?.status === 'READY' && plan.factors.length > 0 ? (
          <FeatureBars factors={plan.factors.map(f => ({ name: f.name, value: f.impact ?? f.value ?? 0 }))} />
        ) : (
          <div className="empty-analysis-card compact"><b>Decision factors unavailable</b><span className="sub">The backend will display actual contributing signals when they are supplied by the decision engine.</span></div>
        )}
      </div>

      <div className="section-title"><h2>Action Queue</h2></div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Action</th><th>Priority</th><th>Impact</th><th>Zone</th><th>Status</th><th /></tr></thead>
          <tbody>
            {actions.length === 0 ? (
              <tr><td colSpan={6} className="sub">No persisted actions are available for this organization.</td></tr>
            ) : actions.map(a => (
              <tr key={a.id}>
                <td>{a.title}</td>
                <td><span className={a.priority === 'HIGH' ? 'risk' : 'warn'}>{a.priority}</span></td>
                <td>{a.impact ? `+${a.impact} T` : '—'}</td>
                <td>{a.zone}</td>
                <td>{a.status}</td>
                <td>
                  {a.status === 'Pending' && (
                    <div className="actions-row">
                      <button className="btn good small" onClick={() => setAction(a.id, 'Approved')}><Check size={13} />Approve</button>
                      <button className="btn bad small" onClick={() => setAction(a.id, 'Rejected')}>Reject</button>
                      <button className="btn small" onClick={() => setAction(a.id, 'Scheduled')}><Clock3 size={13} />Schedule</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
