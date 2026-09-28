'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { MapLayers, MapSelection } from '../MineMap';
import { FeatureBars } from '../Charts';
import { prospectivity } from '../../lib/data';
import type { Zone } from '../../lib/data';

const MineMap = dynamic(() => import('../MineMap'), { ssr: false });

const defaultWeights = { geology: 0.30, mineral: 0.25, historical: 0.20, terrain: 0.10, structure: 0.10, proximity: 0.05 };

export default function MineIntelligence({
  zones, setSelected, layers, setLayers, selectedArea, onAreaSelect, onScanArea,
}: {
  zones: Zone[];
  setSelected: (z: Zone) => void;
  layers: MapLayers;
  setLayers: (l: MapLayers) => void;
  selectedArea?: MapSelection | null; onAreaSelect?: (area: MapSelection | null) => void; onScanArea?: (area: MapSelection) => void;
}) {
  const [w, setW] = useState(defaultWeights);
  const demoFallback = process.env.NEXT_PUBLIC_ENABLE_DEMO_FALLBACK === 'true';
  const scored = (demoFallback ? zones.map(z => ({ ...z, prospectivity: prospectivity(z, w) })) : zones).sort((a, b) => b.prospectivity - a.prospectivity);

  return (
    <div className="page-fade">
      <div className="two">
        <div className="card map-card"><MineMap zones={scored} onSelect={setSelected} layers={layers} onLayersChange={setLayers} selection={selectedArea} onAreaSelect={onAreaSelect} onScanArea={onScanArea} /></div>
        <div className="card">
          <b>Prospectivity Engine</b>
          <p className="sub" style={{ marginTop: 6 }}>{demoFallback ? 'Weighted synthetic indicators · explicit demo mode' : 'Production model outputs from the authenticated backend'}</p>
          {Object.entries(w).map(([k, v]) => (
            <div className="control" key={k}>
              <label><span style={{ textTransform: 'capitalize' }}>{k}</span><span>{Math.round(v * 100)}%</span></label>
              <input disabled={!demoFallback} className="range" type="range" min={0} max={50} value={v * 100}
                onChange={e => setW({ ...w, [k]: Number(e.target.value) / 100 })} />
            </div>
          ))}
          <div className="section-title"><h2>Zone ranking</h2></div>
          <div className="zone-list">
            {scored.map(z => (
              <div className="zone-row" key={z.id} onClick={() => setSelected(z)}>
                <span>{z.name}</span><strong>{z.prospectivity}%</strong>
              </div>
            ))}
          </div>
          <p className="footer-note">{demoFallback ? 'Demo weights update prototype indicators only; they are not production AI predictions.' : 'Scores shown here come from backend model records and are not confirmed reserves.'}</p>
        </div>
      </div>

      <div className="section-title"><h2>Model Explainability</h2><span className="data-tag">{demoFallback ? 'Explicit demo mode' : 'Backend model output'}</span></div>
      <div className="card">{demoFallback ? <FeatureBars /> : <p className="footer-note">No calibrated explainability output is available from the connected model.</p>}</div>
    </div>
  );
}
