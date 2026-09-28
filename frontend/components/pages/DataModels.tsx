'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowUpRight, BrainCircuit, Database, FileBarChart2, MapPin,
  Satellite, Sparkles, Waves, CheckCircle2, Info, ExternalLink,
} from 'lucide-react';
import type { Zone } from '../../lib/data';
import type { MapLayers, MapSelection } from '../MineMap';
import {
  bboxToPolygon, createAiAnalysisRegion, getAiAnalysisStatus, getAiAnalysisOverview,
  getAiAnalysisExplainability, getModels, getMlModels, getSamples, isUnavailable, ApiError,
} from '../../lib/api';
import type {
  AiAnalysisStatus, AiAnalysisOverview, AiAnalysisExplainability, ModelInfo, SampleRecord,
} from '../../lib/api';

const MineMap = dynamic(() => import('../MineMap'), { ssr: false });

type AnalysisSection = 'overview' | 'region' | 'spectral' | 'insights' | 'samples';

type Props = {
  zones: Zone[];
  selectedArea: MapSelection | null;
  onAreaSelect: (area: MapSelection | null) => void;
  onScanArea: (area: MapSelection) => void;
  scanQueued: boolean;
  clearScan: () => void;
  section?: AnalysisSection;
};

const analysisLayers: MapLayers = { boundary: true, zones: true, geology: true, elevation: false, satellite: true };

const sources = [
  { name: 'Sentinel-2 / Copernicus Data Space', purpose: 'Satellite / remote-sensing context', href: 'https://dataspace.copernicus.eu/' },
  { name: 'Geological Survey of India', purpose: 'Geological context', href: 'https://www.gsi.gov.in/' },
  { name: 'India Meteorological Department', purpose: 'Weather context', href: 'https://mausam.imd.gov.in/' },
];

function nearestZone(zones: Zone[], area: MapSelection | null) {
  if (!area) return null;
  return zones.reduce((best, z) => {
    const d = Math.hypot(z.lat - area.centerLat, z.lng - area.centerLng);
    return !best || d < best.d ? { zone: z, d } : best;
  }, null as { zone: Zone; d: number } | null)?.zone ?? null;
}

function prospectivityClass(score: number) {
  if (score >= 75) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

function stageLabel(stage: string | null): string {
  if (!stage) return 'Queued';
  return stage.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function RegionHeader({ area, zones, status, onOpenExplore }: { area: MapSelection | null; zones: Zone[]; status?: AiAnalysisStatus | null; onOpenExplore?: () => void }) {
  const nearest = nearestZone(zones, area);
  const statusLabel = status
    ? status.status === 'completed' ? 'Completed'
      : status.status === 'failed' ? `Failed${status.error ? ` — ${status.error}` : ''}`
      : `${status.status === 'processing' ? 'Processing' : 'Queued'} · ${stageLabel(status.currentStage)} (${status.progress}%)`
    : area ? 'Ready — run analysis' : 'Awaiting region';
  return (
    <section className="analysis-context card">
      <div>
        <span className="eyebrow"><BrainCircuit size={12}/> AI ANALYSIS</span>
        <h2>{nearest?.name ?? (area ? 'Selected analysis region' : 'No analysis region selected')}</h2>
        <p className="sub">{nearest?.region ?? (area ? 'Geographic selection from Explore' : 'Open Explore to select a focused region')}</p>
      </div>
      <div className="analysis-context-metrics">
        <Metric label="Coordinates" value={area ? `${area.centerLat.toFixed(4)}, ${area.centerLng.toFixed(4)}` : '—'} />
        <Metric label="Area analyzed" value={area ? `${area.areaKm2.toLocaleString()} km²` : '—'} />
        <Metric label="Analysis status" value={statusLabel} />
        <Metric label="Data mode" value={status ? 'Backend analysis pipeline' : 'Awaiting analysis'} />
      </div>
      {onOpenExplore && <button className="btn small" onClick={onOpenExplore}><MapPin size={13}/> Open in Explore <ArrowUpRight size={13}/></button>}
    </section>
  );
}

export default function DataModels({ zones, selectedArea, onAreaSelect, onScanArea, scanQueued, clearScan, section = 'overview' }: Props) {
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [selectedSample, setSelectedSample] = useState<string | null>(null);

  // --- Real backend analysis pipeline state (replaces the old setTimeout
  // prototype scan). analysisId/status/overview/explainability come from
  // POST /api/ai-analysis/region + GET .../status|overview|explainability. ---
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiAnalysisStatus | null>(null);
  const [aiOverview, setAiOverview] = useState<AiAnalysisOverview | null>(null);
  const [aiExplainability, setAiExplainability] = useState<AiAnalysisExplainability | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  // --- Model registry (Model Insights tab) ---
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [mlModels, setMlModels] = useState<Awaited<ReturnType<typeof getMlModels>>['results']>([]);
  const [modelsUnavailable, setModelsUnavailable] = useState<string | null>(null);

  // --- Samples (Data & Samples tab) ---
  const [samples, setSamples] = useState<SampleRecord[] | null>(null);
  const [samplesError, setSamplesError] = useState<string | null>(null);

  const nearest = useMemo(() => nearestZone(zones, selectedArea), [zones, selectedArea]);
  const high = zones.filter(z => z.prospectivity >= 75).length;
  const medium = zones.filter(z => z.prospectivity >= 40 && z.prospectivity < 75).length;
  const low = zones.filter(z => z.prospectivity < 40).length;

  // Kicks off a real backend region analysis (POST /api/ai-analysis/region),
  // then polls GET /api/ai-analysis/:id/status until it leaves the
  // queued/processing states, and finally loads overview + explainability.
  useEffect(() => {
    if (!scanQueued || !selectedArea) return;
    let cancelled = false;
    setRunning(true);
    setCompleted(false);
    setAiError(null);
    setAiOverview(null);
    setAiExplainability(null);

    (async () => {
      try {
        const { analysisId: id } = await createAiAnalysisRegion({ geometry: bboxToPolygon(selectedArea) });
        if (cancelled) return;
        setAnalysisId(id);

        const poll = async () => {
          if (cancelled) return;
          try {
            const status = await getAiAnalysisStatus(id);
            if (cancelled) return;
            setAiStatus(status);
            if (status.status === 'completed') {
              const [overview, explainability] = await Promise.all([
                getAiAnalysisOverview(id).catch((): AiAnalysisOverview => ({ status: 'unavailable', reason: 'Unable to load the overview result.' })),
                getAiAnalysisExplainability(id).catch((): AiAnalysisExplainability => ({ status: 'unavailable', reason: 'Unable to load explainability output.', features: [] })),
              ]);
              if (cancelled) return;
              setAiOverview(overview);
              setAiExplainability(explainability);
              setRunning(false);
              setCompleted(true);
              clearScan();
              return;
            }
            if (status.status === 'failed') {
              setAiError(status.error ?? 'Analysis failed.');
              setRunning(false);
              clearScan();
              return;
            }
            pollRef.current = window.setTimeout(poll, 1500);
          } catch (err) {
            if (cancelled) return;
            setAiError(err instanceof ApiError ? err.message : 'Unable to reach the analysis backend.');
            setRunning(false);
            clearScan();
          }
        };
        await poll();
      } catch (err) {
        if (cancelled) return;
        setAiError(err instanceof ApiError ? err.message : 'Unable to start analysis — backend unreachable.');
        setRunning(false);
        clearScan();
      }
    })();

    return () => {
      cancelled = true;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanQueued, selectedArea, clearScan]);

  useEffect(() => {
    let cancelled = false;
    getModels()
      .then((data) => {
        if (cancelled) return;
        if (data.status === 'unavailable') { setModelsUnavailable(data.reason ?? 'No model registered yet.'); setModels([]); }
        else { setModels(data.results); setModelsUnavailable(null); }
      })
      .catch(() => { if (!cancelled) { setModels([]); setModelsUnavailable('Unable to reach the model registry.'); } });
    getMlModels().then((data) => { if (!cancelled) setMlModels(data.results ?? []); }).catch(() => { if (!cancelled) setMlModels([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (section !== 'samples') return;
    let cancelled = false;
    getSamples({ limit: 100 })
      .then((data) => { if (!cancelled) setSamples(data.results); })
      .catch((err) => { if (!cancelled) setSamplesError(err instanceof ApiError ? err.message : 'Unable to load samples.'); });
    return () => { cancelled = true; };
  }, [section]);

  const runSelectedArea = () => {
    if (selectedArea) onScanArea(selectedArea);
  };

  const overviewAvailable = aiOverview && !isUnavailable(aiOverview);
  const overviewData = overviewAvailable ? (aiOverview as Exclude<AiAnalysisOverview, { status: 'unavailable' }>) : null;

  const miniMap = (
    <div className="analysis-mini-map">
      <MineMap
        zones={zones}
        onSelect={() => undefined}
        layers={analysisLayers}
        selection={selectedArea}
        onAreaSelect={onAreaSelect}
        onScanArea={onScanArea}
      />
    </div>
  );

  const overview = (
    <div className="page-fade ai-analysis-page">
      <RegionHeader area={selectedArea} zones={zones} status={aiStatus} />
      <div className="analysis-result-hero card">
        <div>
          <span className="eyebrow">PRIMARY RESULT · {overviewData ? 'BACKEND MODEL OUTPUT' : 'AWAITING ANALYSIS'}</span>
          <h1>{overviewData ? prospectivityClass(overviewData.prospectivityScore) : running ? 'Analyzing…' : aiError ? 'Analysis unavailable' : 'Awaiting analysis'}</h1>
          <p className="sub">
            {overviewData
              ? `Model-derived prospectivity classification from ${overviewData.modelVersion}, generated ${new Date(overviewData.generatedAt).toLocaleString()}. This is not confirmation of a manganese reserve.`
              : aiError
              ? aiError
              : running
              ? 'Running the backend analysis pipeline for the selected region…'
              : 'Select a region in Explore and run an analysis to populate this result.'}
          </p>
        </div>
        <div className="result-score-grid">
          <Metric label="Prospectivity score" value={overviewData ? `${Math.round(overviewData.prospectivityScore)} / 100` : '—'} />
          <Metric label="Model confidence" value={overviewData ? `${Math.round(overviewData.confidence)}%` : '—'} />
          <Metric label="Known/demo locations" value={`${zones.length}`} />
        </div>
      </div>

      <div className="analysis-two-col">
        <section className="card">
          <SectionTitle title="What does this mean?" />
          <p className="analysis-copy">
            {overviewData
              ? `The backend model places this region in the ${prospectivityClass(overviewData.prospectivityScore).toLowerCase()} prospectivity class${overviewData.predictedMnConcentration !== null ? `, with a predicted Mn concentration of ${overviewData.predictedMnConcentration.toFixed(2)}%` : ''}.`
              : 'The analysis result will appear here once a region has been analyzed.'}
          </p>
          <div className="integrity-note"><Info size={14}/><span>Prospectivity score and predicted concentration are model outputs, not mineral-reserve estimates, and should be validated against ground-truth samples.</span></div>
        </section>
        <section className="card">
          <SectionTitle title="Key metrics" />
          <div className="metric-grid-4">
            <Metric label="Area analyzed" value={overviewData?.analysisArea ? `${overviewData.analysisArea.toLocaleString()} km²` : selectedArea ? `${selectedArea.areaKm2.toLocaleString()} km²` : '—'} />
            <Metric label="High-prospectivity zones" value={`${high}`} />
            <Metric label="Medium zones" value={`${medium}`} />
            <Metric label="Model uncertainty" value={overviewData?.uncertainty !== null && overviewData?.uncertainty !== undefined ? `± ${overviewData.uncertainty}%` : '—'} />
          </div>
        </section>
      </div>

      <section className="card">
        <SectionTitle title="Key findings" badge={overviewData ? 'From this analysis' : 'No completed analysis yet'} />
        <div className="finding-list">
          {overviewData ? (
            <>
              <Finding text={`This region scored ${Math.round(overviewData.prospectivityScore)}/100 prospectivity under ${overviewData.modelVersion}.`} />
              <Finding text={`Model confidence for this result is ${Math.round(overviewData.confidence)}%${overviewData.uncertainty !== null ? `, with an uncertainty band of ± ${overviewData.uncertainty}%` : ''}.`} />
              <Finding text={overviewData.predictedMnConcentration !== null ? `Predicted Mn concentration: ${overviewData.predictedMnConcentration.toFixed(2)}%.` : 'This model run did not produce a predicted Mn concentration.'} />
            </>
          ) : (
            <Finding text={aiError ?? 'Run an analysis on a selected region to see findings backed by the real model output here.'} />
          )}
        </div>
      </section>

      <section className="card">
        <SectionTitle title="Mini analysis map" badge="Open full map in Explore" />
        {miniMap}
      </section>

      <section className="card">
        <SectionTitle title="AI interpretation" />
        {aiExplainability && aiExplainability.status === 'available' ? (
          <>
            <p className="analysis-copy">The model's own feature-attribution output for this analysis is shown below (see Model Insights for the full breakdown).</p>
            <div className="finding-list">
              {aiExplainability.features.slice(0, 3).map((f) => <Finding key={f.feature} text={`${f.feature}: ${(f.contribution * 100).toFixed(1)}% contribution`} />)}
            </div>
          </>
        ) : (
          <>
            <p className="analysis-copy">This analysis does not have a real explainability payload yet. MN25 does not invent a causal explanation for the prediction — see Model Insights once the model run has produced an attribution output.</p>
            <div className="integrity-note"><Info size={14}/><span>{aiExplainability?.status === 'unavailable' ? aiExplainability.reason : 'Model explanation unavailable until an analysis completes.'}</span></div>
          </>
        )}
      </section>
    </div>
  );

  const region = (
    <div className="page-fade ai-analysis-page">
      <RegionHeader area={selectedArea} zones={zones} status={aiStatus} />
      <section className="card">
        <SectionTitle title="Prospectivity distribution" />
        <div className="distribution-grid">
          <Distribution label="HIGH" value={high} total={zones.length} />
          <Distribution label="MEDIUM" value={medium} total={zones.length} />
          <Distribution label="LOW" value={low} total={zones.length} />
        </div>
      </section>
      <section className="card analysis-map-card">
        <SectionTitle title="Interactive prospectivity map" badge="AI-predicted zones" />
        <div className="analysis-map-large">
          <MineMap zones={zones} onSelect={() => undefined} layers={analysisLayers} selection={selectedArea} onAreaSelect={onAreaSelect} onScanArea={onScanArea} />
        </div>
      </section>
      <div className="analysis-two-col">
        <section className="card">
          <SectionTitle title="Analytical zones" />
          <div className="analysis-zone-list">
            {zones.map((z, i) => <button key={z.id} className="analysis-zone-row" onClick={() => setSelectedSample(z.id)}><span><b>ZONE {String.fromCharCode(65 + i)}</b><small>{z.name} · {prospectivityClass(z.prospectivity)} prospectivity</small></span><strong>{z.prospectivity}/100</strong></button>)}
          </div>
        </section>
        <section className="card">
          <SectionTitle title="Zone inspection" />
          {selectedSample ? (() => { const z = zones.find(x => x.id === selectedSample)!; return <div className="inspection-panel"><b>{z.name}</b><span>{z.region}</span><div className="metric-grid-2"><Metric label="Prospectivity" value={`${z.prospectivity}/100`} /><Metric label="Confidence" value={`${z.confidence}%`} /><Metric label="Area" value={`${z.area} km²`} /><Metric label="Modeled concentration" value={`${z.concentration}%`} /></div><button className="btn" onClick={() => onScanArea({ south: z.lat - .05, west: z.lng - .05, north: z.lat + .05, east: z.lng + .05, centerLat: z.lat, centerLng: z.lng, areaKm2: Number((.1 * .1 * 111.32 * 111.32 * Math.cos(z.lat * Math.PI / 180)).toFixed(2)) })}><Sparkles size={13}/> Analyze zone</button></div>; })() : <p className="footer-note">Select an analytical zone to inspect its score, confidence and context.</p>}
        </section>
      </div>
      <section className="card"><SectionTitle title="Geological & terrain context" badge="Available fields only" /><div className="metric-grid-4"><Metric label="Geology indicator" value={nearest?.geology == null ? 'Unavailable' : `${nearest.geology}/100`} /><Metric label="Terrain indicator" value={nearest?.terrain == null ? 'Unavailable' : `${nearest.terrain}/100`} /><Metric label="Structure indicator" value={nearest?.structure == null ? 'Unavailable' : `${nearest.structure}/100`} /><Metric label="Known proximity indicator" value={nearest?.proximity == null ? 'Unavailable' : `${nearest.proximity}/100`} /></div><p className="footer-note">These values come from the documented mining-area record nearest the selected point, not from the AI region-analysis result above.</p></section>
    </div>
  );

  const spectral = (
    <div className="page-fade ai-analysis-page">
      <RegionHeader area={selectedArea} zones={zones} status={aiStatus} />
      <section className="card">
        <SectionTitle title="Spectral summary" badge="No connected spectral dataset" />
        <div className="metric-grid-4"><Metric label="Samples analyzed" value="Unavailable" /><Metric label="Spectral anomalies" value="Unavailable" /><Metric label="Reference matches" value="Unavailable" /><Metric label="Coverage" value="Unavailable" /></div>
      </section>
      <div className="analysis-two-col">
        <section className="card empty-analysis-card"><Waves size={24}/><h3>No spectral observations connected</h3><p className="sub">A real spectral dataset is required before MN25 can display wavelengths, reflectance, band values, or sample-to-reference comparisons. POST /api/spectral-analysis reports this honestly once a satellite scene and spectral engine are configured.</p><span className="data-tag">Do not fabricate spectral values</span></section>
        <section className="card"><SectionTitle title="Spectral interpretation" /><div className="integrity-note"><Info size={14}/><span>When connected, this section reports actual wavelength/reflectance evidence and reference-source metadata from GET /api/spectral-analysis/:id. Spectral similarity is an indicator, not confirmation of manganese.</span></div><div className="source-row"><span>Reference data</span><span className="footer-note">Awaiting connected dataset</span></div></section>
      </div>
      <section className="card"><SectionTitle title="Spectral anomaly map" /><div className="empty-map-state"><Satellite size={22}/><b>Spatial spectral data unavailable</b><span>Connect a spectral provider (SPECTRAL_ENGINE_URL) to visualize normal, low, moderate and high anomaly areas.</span></div></section>
    </div>
  );

  const registeredModel = models && models.length > 0 ? models[0] : null;
  const productionMlModel = mlModels.find((m) => m.status === 'PRODUCTION' && m.deploymentStatus === 'DEPLOYED') ?? null;

  const insights = (
    <div className="page-fade ai-analysis-page">
      <RegionHeader area={selectedArea} zones={zones} status={aiStatus} />
      <section className="card model-summary">
        <div>
          <span className="eyebrow"><BrainCircuit size={12}/> MODEL SUMMARY</span>
          <h2>{productionMlModel ? `${productionMlModel.name} v${productionMlModel.version}` : 'MODEL NOT TRAINED / NOT IN PRODUCTION'}</h2>
          <p className="sub">{registeredModel ? (registeredModel.description ?? 'Registered by the backend analysis pipeline after its first real inference run.') : (modelsUnavailable ?? 'A model is registered automatically once the first real backend analysis completes.')}</p>
        </div>
        <span className="data-tag">{productionMlModel ? 'Production ML model' : 'Model unavailable'}</span>
      </section>
      <div className="analysis-two-col">
        <section className="card"><SectionTitle title="Analysis method" /><div className="definition-row"><b>Algorithm</b><span>{productionMlModel?.algorithm ?? '—'}</span></div><div className="definition-row"><b>Training dataset</b><span>{productionMlModel?.datasetVersion ?? 'Unavailable'}</span></div><div className="definition-row"><b>Feature version</b><span>{productionMlModel?.featureVersion ?? 'Unavailable'}</span></div></section>
        <section className="card"><SectionTitle title="Current output" /><div className="metric-grid-2"><Metric label="Prospectivity" value={overviewData ? `${Math.round(overviewData.prospectivityScore)}/100` : '—'} /><Metric label="Confidence" value={overviewData ? `${Math.round(overviewData.confidence)}%` : '—'} /></div><p className="footer-note">Confidence is the model's own calibrated output for the most recent analysis, not a prototype value.</p></section>
      </div>
      <section className="card"><SectionTitle title="Feature contribution" badge={aiExplainability?.status === 'available' ? 'Real model attribution' : 'Not available from current analysis'} /><div className="feature-contribution-placeholder">{aiExplainability?.status === 'available' ? aiExplainability.features.map((f) => <RealFeatureContribution key={f.feature} label={f.feature} value={f.contribution} />) : <div className="empty-analysis-card compact"><Info size={16}/><b>No real feature attribution available</b><span>Feature contributions will appear only when the production ML model returns an explainability payload.</span></div>}</div><p className="footer-note">{aiExplainability?.status === 'available' ? (aiExplainability.limitations ?? 'Attribution output from the model that produced the current analysis result.') : 'Run a region analysis whose model produces a real attribution output (for example SHAP or permutation importance) to populate this section.'}</p></section>
      <section className="card"><SectionTitle title="Model validation" /><div className="empty-analysis-card compact"><FileBarChart2 size={20}/><b>{productionMlModel?.metrics ? 'Validation metrics available' : 'No production ML validation metrics connected'}</b><span>{productionMlModel?.metrics ? Object.entries(productionMlModel.metrics).map(([k, v]) => `${k}: ${String(v)}`).join(' · ') : 'The ML model must complete spatial validation before metrics appear here. No fabricated metrics are displayed.'}</span></div></section>
      <section className="card"><SectionTitle title="Model limitations" /><ul className="clean-list"><li>{registeredModel ? "Feature values come from the backend analysis pipeline's real inputs." : 'No model has completed a real analysis run in this organization yet.'}</li><li>{aiExplainability?.status === 'available' ? 'An explainability output is connected for the current analysis.' : 'No calibrated attribution output is connected for the current analysis.'}</li><li>No independent spectral inference pipeline is connected unless SPECTRAL_ENGINE_URL is configured.</li><li>Geographic generalization cannot be established from a single analysis run alone.</li></ul></section>
    </div>
  );

  const samplesTab = (
    <div className="page-fade ai-analysis-page">
      <RegionHeader area={selectedArea} zones={zones} status={aiStatus} />
      <section className="card"><SectionTitle title="Data used" /><div className="data-used-grid"><DataUsed name="Satellite imagery" purpose="Remote-sensing context"/><DataUsed name="Geological data" purpose="Documented geological indicators"/><DataUsed name="Terrain data" purpose="Documented terrain indicators"/><DataUsed name="Ground-truth samples" purpose="Lab/field-measured Mn concentration for model validation"/></div></section>
      <section className="card"><SectionTitle title="Data sources" badge="Authoritative provider links" />{sources.map(s => <div className="source-row" key={s.name}><div><b>{s.name}</b><small>{s.purpose}</small></div><a href={s.href} target="_blank" rel="noreferrer" className="data-source-link">View source <ExternalLink size={11}/></a></div>)}</section>
      <section className="card"><SectionTitle title="Source-to-result traceability" /><div className="traceability"><Trace label="Prospectivity result" value={overviewData ? overviewData.modelVersion : 'No completed analysis yet'}/><Trace label="Geological context" value="Documented mining-area records"/><Trace label="Terrain context" value="Documented mining-area records"/><Trace label="Ground-truth samples" value={samples ? `${samples.filter(s => s.kind === 'GROUND_TRUTH').length} recorded` : 'Loading…'}/></div></section>
      <section className="card"><SectionTitle title="Sample table" badge="Backend records — GET /api/samples" />
        {samplesError ? (
          <p className="footer-note">{samplesError}</p>
        ) : samples === null ? (
          <p className="footer-note">Loading samples…</p>
        ) : samples.length === 0 ? (
          <div className="empty-analysis-card compact"><Database size={20}/><b>No samples recorded yet</b><span>Upload a file or register a ground-truth measurement via the backend to populate this table — MN25 does not fabricate sample rows.</span></div>
        ) : (
          <div className="sample-table-wrap"><table className="analysis-table"><thead><tr><th>Sample ID</th><th>Kind</th><th>Location</th><th>Mn %</th><th>Method</th><th>Status</th><th/></tr></thead><tbody>{samples.map(s => <tr key={s.sampleId}><td>{s.sampleId.slice(0, 8)}</td><td>{s.kind === 'GROUND_TRUTH' ? 'Ground truth' : 'File upload'}</td><td>{s.location ? `${s.location.latitude.toFixed(3)}, ${s.location.longitude.toFixed(3)}` : '—'}</td><td>{s.mnConcentration !== null ? `${s.mnConcentration.toFixed(2)}%` : '—'}</td><td>{s.measurementMethod ?? '—'}</td><td>{s.status}</td><td><button className="text-action" onClick={() => setSelectedSample(s.sampleId)}>Inspect</button></td></tr>)}</tbody></table></div>
        )}
        {selectedSample && samples?.find(s => s.sampleId === selectedSample) && <div className="sample-detail"><b>Sample {selectedSample.slice(0, 8)}</b><span>{samples.find(s => s.sampleId === selectedSample)?.laboratory ? `Measured by ${samples.find(s => s.sampleId === selectedSample)?.laboratory}.` : 'Backend-recorded sample.'} {samples.find(s => s.sampleId === selectedSample)?.source ?? ''}</span></div>}
      </section>
    </div>
  );

  const content = section === 'region' ? region : section === 'spectral' ? spectral : section === 'insights' ? insights : section === 'samples' ? samplesTab : overview;

  return <div className="ai-analysis-shell">{content}{selectedArea && <div className="analysis-action-bar"><span><CheckCircle2 size={14}/> Analysis region selected</span><button className="btn small" disabled={running} onClick={runSelectedArea}>{running ? 'Analyzing…' : completed ? 'Run again' : 'Analyze selected region'} <Sparkles size={13}/></button><button className="text-action" onClick={() => onAreaSelect(null)}>Clear</button></div>}</div>;
}

function SectionTitle({ title, badge }: { title: string; badge?: string }) { return <div className="section-title"><h2>{title}</h2>{badge && <span className="data-tag">{badge}</span>}</div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric-tile"><span>{label}</span><b>{value}</b></div>; }
function Finding({ text }: { text: string }) { return <div className="finding"><CheckCircle2 size={14}/><span>{text}</span></div>; }
function Distribution({ label, value, total }: { label: string; value: number; total: number }) { const pct = total ? Math.round((value / total) * 100) : 0; return <div className="distribution"><div><b>{label}</b><span>{pct}%</span></div><div className="distribution-track"><i style={{ width: `${pct}%` }}/></div><small>{value} zones</small></div>; }
function FeatureContribution({ label }: { label: string }) { return <div className="feature-placeholder-row"><span>{label}</span><i/><em>Awaiting attribution</em></div>; }
function RealFeatureContribution({ label, value }: { label: string; value: number }) { const pct = Math.max(0, Math.min(100, Math.round(value * 100))); return <div className="feature-placeholder-row"><span>{label}</span><i style={{ width: `${pct}%` }}/><em>{pct}%</em></div>; }
function DataUsed({ name, purpose }: { name: string; purpose: string }) { return <div className="data-used"><Database size={15}/><div><b>{name}</b><span>{purpose}</span></div></div>; }
function Trace({ label, value }: { label: string; value: string }) { return <div className="trace-row"><span>{label}</span><b>{value}</b><ArrowUpRight size={13}/></div>; }
