'use client';
import { X } from 'lucide-react';
import type { Zone } from '../lib/data';

export function Drawer({ zone, close }: { zone: Zone; close: () => void }) {
  return (
    <aside className="drawer" role="dialog" aria-label={`${zone.name} details`}>
      <button className="icon-btn close" onClick={close} aria-label="Close panel"><X size={16} /></button>
      <span className="pill">ZONE ANALYSIS</span>
      <h2>{zone.name}</h2>
      <p className="sub">Interactive geospatial intelligence</p>

      <div className="card" style={{ marginTop: 15 }}>
        <div className="eyebrow">PROSPECTIVITY SCORE</div>
        <div className="metric green">{zone.prospectivity}%</div>
        <p className="sub">Manganese prospectivity — not a confirmed reserve estimate.</p>
        <div className="row"><span>Model confidence</span><b>{zone.confidence}%</b></div>
        <div className="row" style={{ marginTop: 10 }}><span>Ore grade indicator</span><b>{zone.oreGrade == null ? 'Unavailable' : `${zone.oreGrade}%`}</b></div>
        <div className="row" style={{ marginTop: 10 }}><span>Estimated reserves</span><b>{zone.reserves == null ? 'Unavailable' : `${zone.reserves.toLocaleString()} T`}</b></div>
        <div className="row" style={{ marginTop: 10 }}><span>Extraction status</span><b>{zone.status}</b></div>
        <div className="row" style={{ marginTop: 10 }}><span>Operational risk</span><b className={zone.risk == null ? '' : zone.risk < 40 ? 'green' : 'warn'}>{zone.risk == null ? 'Unavailable' : `${zone.risk}%`}</b></div>
      </div>

      <div className="card" style={{ marginTop: 15 }}>
        <b>Key Indicators</b>
        <p className="sub" style={{ marginTop: 8 }}>Geological proximity · spectral features · terrain characteristics.</p>
      </div>

      <div className="card" style={{ marginTop: 15 }}>
        <b>AI Recommendation</b>
        <p style={{ marginTop: 8 }}>Prioritize exploration drilling.</p>
        <p className="sub">Operational recommendations are shown only when the backend has supporting evidence and authorization context.</p>
      </div>
    </aside>
  );
}
