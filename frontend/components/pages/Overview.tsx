'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowRight, ChevronDown, Download, FilePlus2, Layers3, Upload } from 'lucide-react';
import { Kpi } from '../ui/Kpi';
import type { MapLayers, MapSelection } from '../MineMap';
import type { Zone } from '../../lib/data';
import { apiGet, apiPost, apiUpload, isUnavailable, ApiError } from '../../lib/api';
import type { DashboardSummary, TopZone, RecentAnalysis, MnDistribution } from '../../lib/api';

const MineMap = dynamic(() => import('../MineMap'), { ssr: false });

export default function Overview({ zones, setSelected, layers, setLayers, live, risk, goTo, selectedArea, onAreaSelect, onScanArea }: {
  zones: Zone[]; setSelected: (z: Zone) => void; layers: MapLayers; setLayers: (l: MapLayers) => void;
  live: number; risk: number; goTo: (p: string, navId?: string) => void;
  selectedArea?: MapSelection | null; onAreaSelect?: (area: MapSelection | null) => void; onScanArea?: (area: MapSelection) => void;
}) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [topZones, setTopZones] = useState<TopZone[] | null>(null);
  const [topZonesError, setTopZonesError] = useState<string | null>(null);
  const [distribution, setDistribution] = useState<MnDistribution | null>(null);
  const [recent, setRecent] = useState<RecentAnalysis[] | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiGet<DashboardSummary>('/api/dashboard/summary')
      .then((data) => !cancelled && setSummary(data))
      .catch((err) => !cancelled && setSummaryError(err instanceof ApiError ? err.message : 'Unable to load dashboard summary.'));

    apiGet<TopZone[]>('/api/dashboard/top-zones', { limit: 5, sort: 'predictedMn' })
      .then((data) => !cancelled && setTopZones(data))
      .catch((err) => !cancelled && setTopZonesError(err instanceof ApiError ? err.message : 'Unable to load top zones.'));

    apiGet<MnDistribution>('/api/dashboard/manganese-distribution')
      .then((data) => !cancelled && setDistribution(data))
      .catch(() => !cancelled && setDistribution({ status: 'unavailable', reason: 'Unable to reach the backend.', dataSource: null }));

    apiGet<{ results: RecentAnalysis[] }>('/api/dashboard/recent-analyses')
      .then((data) => !cancelled && setRecent(data.results))
      .catch((err) => !cancelled && setRecentError(err instanceof ApiError ? err.message : 'Unable to load recent analyses.'));

    return () => { cancelled = true; };
  }, []);

  async function handleUploadSamples() {
    fileInputRef.current?.click();
  }

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setActionMessage('Uploading sample…');
      await apiUpload('/api/samples/upload', file);
      setActionMessage('Sample uploaded.');
    } catch (err) {
      setActionMessage(err instanceof ApiError ? err.message : 'Sample upload failed.');
    }
  }

  async function handleGenerateReport() {
    try {
      setActionMessage('Queuing report…');
      await apiPost('/api/reports', { reportType: 'dashboard_summary' });
      setActionMessage('Report queued — check Reports for status.');
    } catch (err) {
      setActionMessage(err instanceof ApiError ? err.message : 'Report request failed.');
    }
  }

  const predicted = distribution && !isUnavailable(distribution) ? distribution.predicted : [];
  const distributionMax = Math.max(1, ...predicted.map((d) => d.value));

  return (
    <div className="page-fade dashboard-page">
      <div className="dashboard-kpis">
        <Kpi title="Areas Analyzed" value={summary ? String(summary.areasAnalyzed) : '—'} sub="Distinct analyzed regions" trend="" spark={[]} onClick={() => goTo('mine', 'exploration')} />
        <Kpi title="Total Area Processed" value={summary?.totalAreaProcessedKm2 == null ? '—' : `${summary.totalAreaProcessedKm2.toFixed(1)} km²`} sub="Area represented by analyzed zones" trend="" spark={[]} />
        <Kpi title="Potential Zones" value={summary ? String(summary.highProspectivityZones) : '—'} sub="AI-detected hotspots" trend="" spark={[]} onClick={() => goTo('mine', 'hotspots')} />
        <Kpi title="Highest Predicted Mn" value={summary?.highestPredictedMn == null ? '—' : `${summary.highestPredictedMn.toFixed(1)}%`} sub="Peak recorded model output" trend="" color="green" spark={[]} />
        <Kpi title="Average Predicted Mn" value={summary?.averagePredictedMn == null ? '—' : `${summary.averagePredictedMn.toFixed(1)}%`} sub="Across persisted predictions" trend="" spark={[]} />
        <Kpi title="Model Confidence" value={summary && !isUnavailable(summary.confidence) ? `${summary.confidence.value}%` : '—'} sub="Current model" trend="" color="green" spark={[]} />
      </div>

      <div className="dashboard-main-grid">
        <section className="card map-card dashboard-map-card">
          <MineMap zones={zones} onSelect={setSelected} layers={layers} onLayersChange={setLayers} selection={selectedArea} onAreaSelect={onAreaSelect} onScanArea={onScanArea} />
        </section>

        <aside className="dashboard-side-stack">
          <section className="card analysis-card">
            <div className="card-heading"><h3>Selected Location Analysis</h3>
              <span>{summary && !isUnavailable(summary.selectedLocation) ? summary.selectedLocation.region : '—'}</span>
            </div>
            {summaryError && <p className="footer-note">{summaryError}</p>}
            {!summaryError && !summary && <p className="footer-note">Loading location analysis…</p>}
            {!summaryError && summary && (
              <>
                <div className="selected-location">
                  <div className="mini-satellite"><div className="mini-land" /></div>
                  <div>
                    <span>⌖ &nbsp;Selected Coordinates</span>
                    <b>{!isUnavailable(summary.selectedLocation)
                      ? `${summary.selectedLocation.latitude.toFixed(4)}° N, ${summary.selectedLocation.longitude.toFixed(4)}° E`
                      : 'No location selected'}</b>
                  </div>
                </div>
                <div className="metric-pair">
                  <div><span>Predicted Mn Concentration</span><strong>{!isUnavailable(summary.predictedMnConcentration) ? `${summary.predictedMnConcentration.value}%` : 'Unavailable'}</strong></div>
                  <div><span>Confidence</span><strong>{!isUnavailable(summary.confidence) ? `${summary.confidence.value}%` : 'Unavailable'}</strong>
                    <div className="confidence-bar"><i style={{ width: !isUnavailable(summary.confidence) ? `${summary.confidence.value}%` : '0%' }} /></div>
                  </div>
                </div>
                <div className="metric-pair lower">
                  <div><span>Uncertainty</span><strong>{!isUnavailable(summary.uncertainty) ? `± ${summary.uncertainty.value}%` : 'Unavailable'}</strong></div>
                  <div><span>Prospectivity Level</span><strong className="hot">{!isUnavailable(summary.prospectivity) ? summary.prospectivity.level : 'Unavailable'}</strong></div>
                </div>
              </>
            )}
            <button className="btn analysis-button" onClick={() => goTo('mine', 'exploration')}>View Detailed Analysis <ArrowRight size={15} /></button>
          </section>

          <section className="card quick-actions-card">
            <div className="card-heading"><h3>Quick Actions</h3></div>
            <div className="quick-grid">
              <button onClick={() => goTo('data', 'ai')}><FilePlus2 /><span>New Analysis<small>Select area & run AI model</small></span></button>
              <button onClick={handleUploadSamples}><Upload /><span>Upload Samples<small>Add ground truth data</small></span></button>
              <button onClick={handleGenerateReport}><Download /><span>Generate Report<small>Create PDF report</small></span></button>
              <button onClick={() => goTo('mine', 'exploration')}><Layers3 /><span>Compare Regions<small>Analyze multiple areas</small></span></button>
            </div>
            <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileChosen} />
            {actionMessage && <p className="footer-note">{actionMessage}</p>}
          </section>
        </aside>
      </div>

      <div className="dashboard-bottom-grid">
        <section className="card distribution-card">
          <div className="card-heading"><h3>Manganese Distribution</h3><button className="compact-select">Predicted <ChevronDown size={13} /></button></div>
          {!distribution && <p className="footer-note">Loading distribution…</p>}
          {distribution && isUnavailable(distribution) && <p className="footer-note">{distribution.reason}</p>}
          {distribution && !isUnavailable(distribution) && (
            <>
              <div className="bar-chart">
                <div className="y-axis"><span>{distributionMax}</span><span>{Math.round(distributionMax * 0.75)}</span><span>{Math.round(distributionMax * 0.5)}</span><span>{Math.round(distributionMax * 0.25)}</span><span>0</span></div>
                <div className="bars">{predicted.map((d, i) => <div className="bar-col" key={d.label}><div className={`dist-bar d${i % 6}`} style={{ height: `${(d.value / distributionMax) * 100}%` }} /><span>{d.label}</span></div>)}</div>
              </div>
              <div className="axis-caption">Predicted Mn Concentration (%)</div>
            </>
          )}
        </section>

        <section className="card zones-table-card">
          <div className="card-heading"><h3>Top Potential Zones</h3><button className="text-action" onClick={() => goTo('mine', 'hotspots')}>View All <ArrowRight size={14} /></button></div>
          {topZonesError && <p className="footer-note">{topZonesError}</p>}
          {!topZonesError && !topZones && <p className="footer-note">Loading zones…</p>}
          {!topZonesError && topZones && topZones.length === 0 && <p className="footer-note">No analyzed zones yet for this organization.</p>}
          {!topZonesError && topZones && topZones.length > 0 && (
            <div className="zones-table-wrap"><table className="dashboard-table"><thead><tr><th>#</th><th>Location (Lat, Long)</th><th>Predicted Mn</th><th>Confidence</th><th>Area (km²)</th><th /></tr></thead><tbody>{topZones.map((z, i) => (
              <tr key={z.id} onClick={() => { const match = zones.find(zz => zz.id === z.id); if (match) setSelected(match); }}>
                <td>{i + 1}</td>
                <td><span className={`heat-thumb h${(i % 4) + 1}`} />{z.latitude.toFixed(4)}, {z.longitude.toFixed(4)}</td>
                <td><b>{z.predictedMn.toFixed(1)}%</b></td>
                <td>{z.confidence}%</td>
                <td>{z.area.toFixed(1)}</td>
                <td>⋮</td>
              </tr>
            ))}</tbody></table></div>
          )}
        </section>

        <section className="card recent-card">
          <div className="card-heading"><h3>Recent Analyses</h3><button className="text-action">View All <ArrowRight size={14} /></button></div>
          {recentError && <p className="footer-note">{recentError}</p>}
          {!recentError && !recent && <p className="footer-note">Loading recent analyses…</p>}
          {!recentError && recent && recent.length === 0 && <p className="footer-note">No analyses have been run yet.</p>}
          {!recentError && recent && recent.length > 0 && (
            <div className="recent-list">{recent.map((r, i) => (
              <div className="recent-item" key={r.analysisId}>
                <div className={`recent-thumb ${['warm', 'green', 'blue', 'gold'][i % 4]}`}><span /></div>
                <div>
                  <b>{!isUnavailable(r.location) ? `${r.location.name} · ${r.location.region}` : 'Unscoped analysis'}</b>
                  <small>{r.status} &nbsp;•&nbsp; {new Date(r.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</small>
                </div>
                <strong>{r.prospectivity ? `${r.prospectivity.score}` : '—'}<small>Prospectivity</small></strong>
              </div>
            ))}</div>
          )}
        </section>
      </div>
    </div>
  );
}
