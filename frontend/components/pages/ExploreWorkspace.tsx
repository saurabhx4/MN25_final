'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Crosshair, Database, Layers3, Map as MapIcon, Mountain, Satellite, Sparkles, Target, Waves } from 'lucide-react';
import type { Zone } from '../../lib/data';
import type { MapLayers, MapSelection } from '../MineMap';
import {
  getProspectivityHotspots, getProspectivityZoneDetail, getGeospatialLayers,
  type ProspectivityHotspot, type GeospatialLayer,
} from '../../lib/api';

const MineMap = dynamic(() => import('../MineMap'), { ssr: false });

type ExploreSection = 'map' | 'hotspots' | 'mining' | 'satellite';

export default function ExploreWorkspace({
  zones, setSelected, layers, setLayers, selectedArea, onAreaSelect, onScanArea, section = 'map', onSectionChange,
}: {
  zones: Zone[];
  setSelected: (z: Zone) => void;
  layers: MapLayers;
  setLayers: (l: MapLayers) => void;
  selectedArea: MapSelection | null;
  onAreaSelect: (a: MapSelection | null) => void;
  onScanArea: (a: MapSelection) => void;
  section?: ExploreSection;
  onSectionChange?: (s: ExploreSection) => void;
}) {
  const demoFallback = process.env.NEXT_PUBLIC_ENABLE_DEMO_FALLBACK === 'true';
  const [sort, setSort] = useState<'prospectivity' | 'confidence' | 'distance'>('prospectivity');
  const [showKnownOnly, setShowKnownOnly] = useState(false);
  const scored = useMemo(() => [...zones].sort((a,b) => sort === 'confidence' ? b.confidence - a.confidence : b.prospectivity - a.prospectivity), [zones, sort]);
  const title = section === 'hotspots' ? 'AI Prospectivity Hotspots' : section === 'mining' ? 'Known Mining Areas' : section === 'satellite' ? 'Satellite & Geospatial Layers' : 'Earth Exploration Map';

  // Explore §E/§F — AI hotspots are ProspectivityZone model predictions, a
  // structurally distinct dataset from the documented Zone records above.
  // They are fetched separately and never merged with `zones`.
  const [hotspots, setHotspots] = useState<ProspectivityHotspot[] | null>(null);
  const [hotspotsError, setHotspotsError] = useState(false);
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const [hotspotDetail, setHotspotDetail] = useState<Awaited<ReturnType<typeof getProspectivityZoneDetail>> | null>(null);

  useEffect(() => {
    if (section !== 'hotspots') return;
    let cancelled = false;
    getProspectivityHotspots({ limit: 25, sortBy: sort === 'confidence' ? 'confidence' : 'prospectivity' })
      .then(({ results }) => { if (!cancelled) setHotspots(results); })
      .catch(() => { if (!cancelled) { setHotspots([]); setHotspotsError(true); } });
    return () => { cancelled = true; };
  }, [section, sort]);

  useEffect(() => {
    if (!selectedHotspotId) { setHotspotDetail(null); return; }
    let cancelled = false;
    getProspectivityZoneDetail(selectedHotspotId)
      .then((d) => { if (!cancelled) setHotspotDetail(d); })
      .catch(() => { if (!cancelled) setHotspotDetail(null); });
    return () => { cancelled = true; };
  }, [selectedHotspotId]);

  // Explore §G — real layer availability/provenance, never hardcoded.
  const [geoLayers, setGeoLayers] = useState<GeospatialLayer[] | null>(null);
  useEffect(() => {
    if (section !== 'satellite') return;
    let cancelled = false;
    getGeospatialLayers().then(({ layers: l }) => { if (!cancelled) setGeoLayers(l); }).catch(() => { if (!cancelled) setGeoLayers([]); });
    return () => { cancelled = true; };
  }, [section]);
  const layerToggleKey: Record<string, keyof MapLayers | undefined> = { satellite: 'satellite', boundaries: 'boundary', prospectivity: 'zones', geology: 'geology', elevation: 'elevation' };
  const featureContributions = hotspotDetail && (hotspotDetail as any).featureContributions;

  return (
    <div className="page-fade explore-workspace">
<section className="card explore-map-workspace">
        <div className="card-heading">
          <div><h3>{title}</h3><span>3D Earth · known data and AI-generated prospectivity kept visibly distinct</span></div>
          <span className="pill"><Crosshair size={12}/> Select a region to analyze</span>
        </div>
        <MineMap zones={zones} onSelect={setSelected} layers={layers} onLayersChange={setLayers} selection={selectedArea} onAreaSelect={onAreaSelect} onScanArea={onScanArea} />
      </section>

      {section === 'map' && <section className="explore-intelligence-grid">
        <div className="card region-intelligence-card">
          <div className="section-title"><h2>Region Intelligence</h2><span className="data-tag">{demoFallback ? 'Explicit demo mode' : 'Backend data'}</span></div>
          {selectedArea ? (
            <div className="region-intelligence-content">
              <div className="region-summary-head"><div><span>Selected region</span><b>{selectedArea.centerLat.toFixed(4)}° N, {selectedArea.centerLng.toFixed(4)}° E</b></div><button className="btn" onClick={() => onScanArea(selectedArea)}><Sparkles size={13}/> Analyze with AI</button></div>
              <div className="region-stat-grid">
                <Metric label="Area" value={`${selectedArea.areaKm2.toLocaleString()} km²`} />
                <Metric label="Latitude" value={`${selectedArea.south.toFixed(3)} → ${selectedArea.north.toFixed(3)}`} mono />
                <Metric label="Longitude" value={`${selectedArea.west.toFixed(3)} → ${selectedArea.east.toFixed(3)}`} mono />
                <Metric label="Status" value="Analysis region" />
              </div>
              <p className="footer-note">The selection is a geographic analysis window. Any manganese result produced from it must be treated as a model prediction, not confirmation of a reserve.</p>
            </div>
          ) : (
            <div className="explore-empty"><div className="selection-glyph"><i/><i/><i/><i/></div><b>Select a region on the map</b><span>Use the crop control to create a focused AI-analysis window.</span></div>
          )}
        </div>
        <div className="card explore-snapshot-card">
          <div className="section-title"><h2>Current View Snapshot</h2><span className="pill">MN25</span></div>
          <div className="snapshot-grid"><Metric label="Mapped locations" value={`${zones.length}`} /><Metric label="AI zones" value={`${zones.filter(z => z.prospectivity >= 75).length}`} /><Metric label="States represented" value={`${new Set(zones.map(z => z.region.split(',')[0])).size}`} /><Metric label="Data mode" value={demoFallback ? 'Demo' : 'Backend'} /></div>
          <div className="known-predicted"><span><i className="known-dot"/> Documented / known</span><span><i className="ai-dot"/> AI-predicted</span></div>
        </div>
      </section>}

      {section === 'hotspots' && <section className="two explore-list-section">
        <div className="card"><div className="section-title"><h2>Prospectivity Hotspots</h2><div className="actions-row"><select className="select compact-select" value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="prospectivity">Prospectivity</option><option value="confidence">Confidence</option></select></div></div>
          <div className="zone-list">
            {hotspots === null ? <span className="map-location-note">Loading hotspots…</span>
              : hotspotsError ? <span className="map-location-note">Prospectivity hotspots are unavailable right now.</span>
              : hotspots.length === 0 ? <span className="map-location-note">No AI-predicted hotspots are available yet.</span>
              : hotspots.map((h, i) => <button className={`zone-row hotspot-row ${selectedHotspotId === h.zoneId ? 'active' : ''}`} key={h.zoneId} onClick={() => setSelectedHotspotId(h.zoneId)}>
                  <span><b>MN-{String(i+1).padStart(3,'0')} · {h.center.latitude.toFixed(3)}°, {h.center.longitude.toFixed(3)}°</b><small>{h.modelVersion} · AI-PREDICTED ZONE</small></span>
                  <strong>{sort === 'confidence' ? `${h.confidence}% conf.` : `${h.prospectivityScore}/100`}</strong>
                </button>)}
          </div>
          <p className="footer-note">Use factual labels such as highest model score or highest confidence; do not interpret the ranking as proof of mineralization.</p>
        </div>
        <div className="card"><div className="section-title"><h2>Why a hotspot is flagged</h2></div><div className="feature-explain">
          {!selectedHotspotId ? <p className="footer-note">Select a hotspot from the list to see its model attribution, if the model provided one.</p>
            : !hotspotDetail ? <p className="footer-note">Loading model attribution…</p>
            : Array.isArray(featureContributions) && featureContributions.length > 0 ? (
              <>{(featureContributions as { feature: string; contribution: number }[]).map(f => <p key={f.feature}><b>{f.feature}</b> — {(f.contribution * 100).toFixed(0)}%</p>)}
                <p className="footer-note">Attribution from {hotspotDetail.modelVersion as string}. Uncertainty: {(hotspotDetail.uncertainty as number | null) ?? 'not reported'}.</p></>
            ) : (
              <><p><b>Model indicators</b></p><p>Geological compatibility, spectral similarity, terrain characteristics and historical occurrence features can contribute when the actual model provides them.</p>
                <p className="footer-note">{(hotspotDetail.limitations as string) ?? 'This model did not provide feature-level attribution for this zone.'}</p></>
            )}
        </div></div>
      </section>}

      {section === 'mining' && <section className="two explore-list-section">
        <div className="card"><div className="section-title"><h2>Known / documented locations</h2><span className="data-tag">{demoFallback ? 'Explicit demo mode' : 'Authoritative records'}</span></div>
          <div className="zone-list">{scored.map(z => <button className="zone-row hotspot-row" key={z.id} onClick={() => setSelected(z)}><span><b>{z.name}</b><small>{z.region} · {z.status}</small></span><strong>{z.area} km²</strong></button>)}</div>
          <p className="footer-note">Documented mining locations are shown only from organization-scoped backend records; demo records appear only when explicit demo mode is enabled.</p>
        </div>
        <div className="card mining-context-card"><div className="section-title"><h2>Location context</h2></div><Metric label="Classification" value="Manganese location"/><Metric label="Operational status" value={showKnownOnly ? 'Known records only' : demoFallback ? 'Demo view' : 'Backend records'} /><label className="toggle-row"><input type="checkbox" checked={showKnownOnly} onChange={e => setShowKnownOnly(e.target.checked)}/><span>Show documented records only</span></label><p className="footer-note">Reserve, production, ownership and operational details should only be displayed when supplied by the underlying authoritative source.</p></div>
      </section>}

      {section === 'satellite' && <section className="two explore-list-section">
        <div className="card"><div className="section-title"><h2>Layer manager</h2><span className="pill"><Layers3 size={12}/> Live map controls</span></div>
          {geoLayers === null ? <span className="map-location-note">Loading layers…</span> : geoLayers.map(l => {
            const key = layerToggleKey[l.id];
            const on = key ? layers[key] : false;
            const disabled = l.availability === 'unavailable' || !key;
            return <LayerToggle key={l.id} label={l.name} value={key ? on : false} disabled={disabled}
              onChange={() => { if (key && !disabled) setLayers({ ...layers, [key]: !layers[key] }); }}
              note={l.availability === 'unavailable' ? 'Not configured' : undefined} />;
          })}
          <div className="map-layer-divider"/><p className="footer-note">Historical imagery, change detection and spectral anomaly layers should only be enabled once real datasets are connected. The current UI does not fabricate those layers.</p></div>
        <div className="card"><div className="section-title"><h2>Data sources</h2></div>
          {geoLayers === null ? <span className="map-location-note">Loading sources…</span>
            : geoLayers.filter(l => l.availability === 'available' && l.sourceUrl).length === 0
              ? <span className="map-location-note">No connected data sources report provenance yet.</span>
              : geoLayers.filter(l => l.availability === 'available' && l.sourceUrl).map(l => <SourceRow key={l.id} name={l.source ?? l.name} href={l.sourceUrl as string}/>)}
          <p className="footer-note">Only source links that correspond to actual connected/used datasets are presented as data provenance.</p></div>
      </section>}
    </div>
  );
}

function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div className="metric-tile"><span>{label}</span><b className={mono ? 'mono' : ''}>{value}</b></div>; }
function LayerToggle({ label, value, onChange, disabled = false, note }: { label: string; value: boolean; onChange: () => void; disabled?: boolean; note?: string }) { return <button className={`layer-toggle-row ${disabled ? 'disabled' : ''}`} onClick={onChange} disabled={disabled}><span><i className={value ? 'checked' : ''}>{value ? '✓' : ''}</i>{label}</span><small>{note ?? (value ? 'ON' : 'OFF')}</small></button>; }
function SourceRow({ name, href }: { name: string; href: string }) { return <div className="source-row"><span>{name}</span><a href={href} target="_blank" rel="noreferrer">View source ↗</a></div>; }
