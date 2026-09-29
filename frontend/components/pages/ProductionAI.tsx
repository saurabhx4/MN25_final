'use client';
import { useEffect, useMemo, useState } from 'react';
import { Kpi } from '../ui/Kpi';
import { ProductionChart } from '../Charts';
import { getProductionHistory, getProductionForecast, runProductionScenario, getSettings, createProductionForecast, type ProductionHistoryPoint, type ProductionForecast } from '../../lib/api';

type Sim = { equipmentDowntime: number; rainfall: 'Low' | 'Medium' | 'High'; blastingDelay: number; workingHours: number };
const ranges = ['7 Days', '30 Days', '90 Days'] as const;

export default function ProductionAI() {
  const [range, setRange] = useState<(typeof ranges)[number]>('90 Days');
  const [mineId, setMineId] = useState<string | null>(null);
  const [forecastHorizon, setForecastHorizon] = useState<7 | 30 | 90>(30);
  const [history, setHistory] = useState<ProductionHistoryPoint[]>([]);
  const [forecast, setForecast] = useState<ProductionForecast | null>(null);
  const [sim, setSim] = useState<Sim>({ equipmentDowntime: 18, rainfall: 'Medium', blastingDelay: 22, workingHours: 91 });
  const [scenario, setScenario] = useState<Awaited<ReturnType<typeof runProductionScenario>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { (async () => { try { const settings = await getSettings(); if (settings.selectedMine?.id) setMineId(settings.selectedMine.id); if ([7, 30, 90].includes(settings.forecastHorizon)) setForecastHorizon(settings.forecastHorizon as 7 | 30 | 90); } catch { setMessage('Production settings are unavailable.'); } })(); }, []);
  useEffect(() => { if (!mineId) return; (async () => { try { const r = await getProductionHistory({ mineId, granularity: 'daily' }); setHistory(r.results); } catch { setHistory([]); } })(); }, [mineId]);

  const days = range === '7 Days' ? 7 : range === '30 Days' ? 30 : 90;
  const view = useMemo(() => history.slice(-days).map((p, i) => ({ day: p.date || i + 1, actual: p.actualProduction, forecast: null, target: p.plannedProduction })), [history, days]);
  const forecastProduction = forecast?.status === 'COMPLETED' && forecast.forecast ? forecast.forecast.reduce((s, p) => s + p.predictedProduction, 0) : null;
  const target = forecast?.target ?? null;
  const shortfall = forecast?.shortfall ?? null;

  async function loadForecast() {
    if (!mineId) { setMessage('Select a mine in Settings before forecasting.'); return; }
    setLoading(true); setMessage(null);
    try {
      const created = await createProductionForecast({ mineId, forecastHorizon });
      for (let i = 0; i < 30; i++) { const r = await getProductionForecast(created.forecastId); setForecast(r); if (r.status === 'COMPLETED' || r.status === 'FAILED' || r.status === 'UNAVAILABLE') break; await new Promise(res => setTimeout(res, 1000)); }
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Forecast unavailable.'); }
    finally { setLoading(false); }
  }

  async function runScenario() {
    if (!mineId) { setMessage('Select a mine in Settings before running a scenario.'); return; }
    setLoading(true); setMessage(null);
    try { setScenario(await runProductionScenario({ mineId, ...sim, forecastHorizon })); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Scenario unavailable.'); }
    finally { setLoading(false); }
  }

  return <div className="page-fade">
    <div className="grid4">
      <Kpi title="Forecast" value={forecastProduction != null ? `${forecastProduction.toLocaleString()} T` : 'Unavailable'} sub={forecast?.modelVersion ?? 'No forecast generated'} trend="dynamic" spark={forecast?.forecast?.slice(0, 5).map(x => x.predictedProduction) ?? []} />
      <Kpi title="Target" value={target != null ? `${target.toLocaleString()} T` : 'Unavailable'} sub="Selected horizon" trend="fixed" spark={target != null ? [target] : []} />
      <Kpi title="Shortfall" value={shortfall != null ? `${shortfall.toLocaleString()} T` : 'Unavailable'} sub="vs target" trend="dynamic" color="risk" spark={shortfall != null ? [shortfall] : []} />
      <Kpi title="Forecast confidence" value={forecast?.confidence != null ? `${forecast.confidence}%` : 'Unavailable'} sub="Backend model" trend="stable" spark={forecast?.confidence != null ? [forecast.confidence] : []} />
    </div>
    <div className="two">
      <div className="card"><div className="row"><b>Production Intelligence</b><div className="actions-row">{ranges.map(r => <button key={r} className={`btn small ${range === r ? 'primary' : ''}`} onClick={() => setRange(r)}>{r}</button>)}<button className="btn small primary" onClick={loadForecast} disabled={loading || !mineId}>{loading ? 'Running…' : 'Generate Forecast'}</button></div></div><div className="chart" style={{ marginTop: 10 }}><ProductionChart data={view} /></div>{message && <p className="footer-note">{message}</p>}</div>
      <div className="card"><b>What-If Simulator</b><p className="sub" style={{ marginTop: 6 }}>Change operating conditions and run the backend model.</p><div className="controls" style={{ marginTop: 12 }}>
        {([['equipmentDowntime','Equipment Downtime'],['blastingDelay','Blasting Delay'],['workingHours','Working Hours']] as const).map(([k,l]) => <div className="control" key={k}><label><span>{l}</span><span>{sim[k]}%</span></label><input className="range" type="range" min={0} max={100} value={sim[k]} onChange={e => setSim({ ...sim, [k]: Number(e.target.value) })} /></div>)}
        <div className="control"><label><span>Rainfall</span><span>{sim.rainfall}</span></label><select className="select" style={{ width: '100%' }} value={sim.rainfall} onChange={e => setSim({ ...sim, rainfall: e.target.value as Sim['rainfall'] })}><option>Low</option><option>Medium</option><option>High</option></select></div>
      </div><button className="btn primary block" style={{ marginTop: 15 }} onClick={runScenario} disabled={loading || !mineId}>Generate Scenario Report</button>
      {scenario && <><div className="section-title"><h2>Result</h2><span className={scenario.risk > 70 ? 'risk' : 'green'}>{scenario.risk}% risk</span></div><p className="metric">{scenario.production.toLocaleString()} T</p><p className="sub">Recovery opportunity {scenario.recoveryOpportunity == null ? 'Unavailable' : `+${scenario.recoveryOpportunity.toLocaleString()} T`} · Shortfall {scenario.shortfall == null ? 'Unavailable' : `${scenario.shortfall.toLocaleString()} T`}</p><span className="data-tag">Backend scenario model · {scenario.modelVersion}</span></>}
      </div>
    </div>
  </div>;
}
