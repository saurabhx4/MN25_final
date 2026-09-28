'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Bell, BrainCircuit, ChartNoAxesCombined, FileText, FolderKanban, Map, Menu,
  Search, Settings, X, Target, Mountain, Satellite,
} from 'lucide-react';
import { Drawer } from './Drawer';
import Chatbot from './Chatbot';
import Overview from './pages/Overview';
import ExploreWorkspace from './pages/ExploreWorkspace';
import ActionCenter from './pages/ActionCenter';
import DataModels from './pages/DataModels';
import SettingsPage from './pages/SettingsPage';
import ReportsWorkspace from './pages/ReportsWorkspace';
import type { MapLayers, MapSelection } from './MineMap';
import { seedActions, seedZones, recommendations } from '../lib/data';
import { getProjectActions, getProjectRecommendations, generateActionPlan, approveProjectAction, rejectProjectAction, scheduleProjectAction, getDashboardSummary, getDashboardTopZones, getSystemStatus, authMe, type ProjectAction, type ProjectRecommendation } from '../lib/api';
import type { Zone, Action } from '../lib/data';

type NavItem = { id: string; label: string; icon: typeof Map; page: string };

const nav: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: ChartNoAxesCombined, page: 'overview' },
  { id: 'explore', label: 'Explore', icon: Map, page: 'mine' },
  { id: 'ai', label: 'AI Analysis', icon: BrainCircuit, page: 'data' },
  { id: 'projects', label: 'Projects', icon: FolderKanban, page: 'actions' },
  { id: 'reports', label: 'Reports', icon: FileText, page: 'reports' },
  { id: 'settings', label: 'Settings', icon: Settings, page: 'settings' },
];

type ExploreSection = 'map' | 'hotspots' | 'mining' | 'satellite';
type AnalysisSection = 'overview' | 'region' | 'spectral' | 'insights' | 'samples';

const pageTitles: Record<string, string> = { overview: 'Dashboard', mine: 'Explore', production: 'Production Intelligence', risk: 'Model Insights', actions: 'Projects', reports: 'Reports', data: 'AI Analysis', settings: 'Settings' };


export default function AppShell({ env, onExit }: { env: 'organization' | 'employee'; onExit?: () => void }) {
  const [page, setPage] = useState('overview');
  const [activeNav, setActiveNav] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [exploreSection, setExploreSection] = useState<ExploreSection>('map');
  const [analysisSection, setAnalysisSection] = useState<AnalysisSection>('overview');
  const [zones, setZones] = useState<Zone[]>([]);
  const [selected, setSelected] = useState<Zone | null>(null);
  const [selectedArea, setSelectedArea] = useState<MapSelection | null>(null);
  const [scanQueued, setScanQueued] = useState(false);
  const [layers, setLayers] = useState<MapLayers>({ boundary: true, zones: true, geology: false, elevation: false, satellite: true });
  const [search, setSearch] = useState('');
  const [live, setLive] = useState(0);
  const [risk, setRisk] = useState(0);
  const [systemMessage, setSystemMessage] = useState('Checking system status…');
  const [profile, setProfile] = useState<{name:string; role:string} | null>(null);
  const demoFallback = process.env.NEXT_PUBLIC_ENABLE_DEMO_FALLBACK === 'true';
  const [actions, setActions] = useState<Action[]>(demoFallback ? seedActions : []);
  useEffect(() => { if (demoFallback) setZones(seedZones); }, [demoFallback]);
  const [backendRecs, setBackendRecs] = useState<ProjectRecommendation[]>([]);
  const [actionPlanId, setActionPlanId] = useState<string | null>(null);
  const [actionPlanStatus, setActionPlanStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ results }, summary] = await Promise.all([getDashboardTopZones({ limit: 100 }), getDashboardSummary()]);
        if (cancelled) return;
        if (results.length) {
          setZones(results.map(z => ({ id: z.id, name: z.name, region: z.region, lat: z.latitude, lng: z.longitude, concentration: z.predictedMn, confidence: z.confidence, prospectivity: z.prospectivity, status: z.status, area: z.area })) as Zone[]);
        } else if (demoFallback) setZones(seedZones);
        const riskValue = summary.prospectivity && 'score' in summary.prospectivity ? Math.round(summary.prospectivity.score) : 0;
        setRisk(riskValue);
      } catch {
        if (!cancelled && demoFallback) setZones(seedZones);
      }
    })();
    return () => { cancelled = true; };
  }, [demoFallback]);

  const [updated, setUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [actionResponse, recResponse] = await Promise.all([getProjectActions(), getProjectRecommendations()]);
        if (cancelled) return;
        const mapped: Action[] = actionResponse.results.map((a: ProjectAction) => ({
          id: a.id, title: a.title, priority: a.priority, impact: a.impact ?? 0,
          confidence: a.recommendation?.confidence ?? 0, zone: a.zone ?? '—',
          status: a.status === 'PENDING' ? 'Pending' : a.status === 'APPROVED' ? 'Approved' : a.status === 'REJECTED' ? 'Rejected' : a.status === 'SCHEDULED' ? 'Scheduled' : a.status === 'COMPLETED' ? 'Completed' : 'Cancelled',
        }));
        setActions(mapped);
        setBackendRecs(recResponse.results);
      } catch {
        if (!demoFallback) { setActions([]); setBackendRecs([]); }
      }
    })();
    return () => { cancelled = true; };
  }, [demoFallback]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      setUpdated(new Date());
      try {
        const [status, me] = await Promise.all([getSystemStatus(), authMe()]);
        if (cancelled) return;
        const values = Object.values(status.components);
        const degraded = values.filter(v => v.status !== 'operational').length;
        setSystemMessage(values.length === 0 ? 'System status unavailable' : degraded ? `${degraded} system component${degraded === 1 ? '' : 's'} require attention` : 'All systems operational');
        setProfile({ name: me.name ?? 'MN25 User', role: String(me.role ?? '').replace('_', ' ') });
      } catch {
        if (!cancelled) setSystemMessage('System status unavailable');
      }
    };
    refresh();
    const id = setInterval(refresh, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const recs = useMemo(() => backendRecs.length > 0 ? backendRecs.map(r => ({ title: r.title, reason: r.reason, action: r.recommendedAction, confidence: r.confidence, impact: r.estimatedImpact ?? 0, priority: r.priority })) : (demoFallback ? recommendations(zones, 0, risk, 'Low') : []), [backendRecs, demoFallback, zones, risk]);
  const filtered = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return zones.filter(z => `${z.name} ${z.region}`.toLowerCase().includes(q)).map(z => ({ title: z.name, meta: `${z.region} · ${z.concentration}% predicted Mn`, zone: z }));
  }, [search, zones]);

  function handleAreaScan(area: MapSelection) { setSelectedArea(area); setScanQueued(true); setAnalysisSection('region'); goTo('data', 'ai'); }
  async function generateFullActionPlan() {
    try {
      setActionPlanStatus('QUEUED');
      const result = await generateActionPlan({
        date: new Date().toISOString(),
        analysisContext: { source: selected ? 'mn25-selected-zone' : 'mn25-persisted-analysis', ...(selected ? { zoneId: selected.id, zoneName: selected.name, region: selected.region } : {}) },
      });
      setActionPlanId(result.actionPlanId);
      setActionPlanStatus(result.status);
    } catch {
      setActionPlanStatus('UNAVAILABLE');
    }
  }

  async function setActionStatus(id: string, status: Action['status']) {
    try {
      if (status === 'Approved') await approveProjectAction(id);
      else if (status === 'Rejected') await rejectProjectAction(id);
      else if (status === 'Scheduled') await scheduleProjectAction(id, new Date(Date.now() + 60 * 60 * 1000).toISOString());
      setActions(a => a.map(x => x.id === id ? { ...x, status } : x));
    } catch {
      // Keep the existing UI state unchanged if the persistent operation fails.
    }
  }
  function goTo(p: string, navId?: string) {
    setPage(p);
    if (navId) setActiveNav(navId);
    else {
      const match = nav.find(n => n.page === p);
      if (match) setActiveNav(match.id);
    }
    setSidebarOpen(false);
  }

  return (
    <div className="app">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand-row">
          <div className="mn25-wordmark"><span>MN</span><em>25</em></div>
          <div className="brand-tagline">MINERAL INTELLIGENCE<br />FOR A STRONGER TOMORROW</div>
          <button className="icon-btn mobile-only sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        {onExit && <button className="dashboard-home-link" onClick={onExit}>← MN25 home</button>}
        <nav className="nav dashboard-nav">
          {nav.map(({ id, label, icon: Icon, page: target }) => (
            <button key={id} className={activeNav === id ? 'active' : ''} onClick={() => { if (id === 'explore') setExploreSection('map'); if (id === 'ai') setAnalysisSection('overview'); goTo(target, id); }}>
              <Icon size={17} /> <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-promo">
          <div className="promo-noise" />
          <span>SECURING</span><b>CRITICAL MINERALS<br />FOR A SUSTAINABLE<br />TOMORROW</b>
        </div>
        <div className="sidebar-foot">
          <div className="sidebar-foot-logo"><b>MN</b><em>25</em></div>
          <small>EARTH INTELLIGENCE<br />INDIA&apos;S RESOURCE FUTURE</small>
        </div>
      </aside>

      <main className="main">
        <div className="topbar dashboard-topbar">
          <button className="icon-btn mobile-only" onClick={() => setSidebarOpen(v => !v)} aria-label="Toggle navigation"><Menu size={18} /></button>
          <div className="search location-search">
            <Search size={17} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search location (e.g., Odisha, 21.45N 85.72E)" aria-label="Search location" />
            {filtered.length > 0 && <div className="search-results">{filtered.map(r => <div className="result" key={r.title} onClick={() => { setSelected(r.zone); setSearch(''); }}><b>{r.title}</b><div className="footer-note">{r.meta}</div></div>)}</div>}
          </div>
          <div className="top-links"><button onClick={() => { setExploreSection('map'); goTo('mine', 'explore'); }}>EXPLORE</button><button onClick={() => { setAnalysisSection('region'); goTo('data', 'ai'); }}>ANALYZE</button><button onClick={() => { setExploreSection('hotspots'); goTo('mine', 'explore'); }}>DISCOVER</button></div>
          <button className="icon-btn notification-btn" aria-label="Notifications"><Bell size={18} /><span className="badge">3</span></button>
          <div className="profile-pill">
            <div className="avatar">SS</div>
            <div className="who"><b>{profile?.name ?? 'MN25 User'}</b><span>{profile?.role ?? 'Authenticated user'}</span></div>
            <span className="profile-chevron">⌄</span>
          </div>
        </div>

        {activeNav === 'explore' && <div className="context-shell-nav"><span className="context-nav-label">EXPLORE</span><button className={exploreSection === 'map' ? 'active' : ''} onClick={() => setExploreSection('map')}><Map size={13}/> Map</button><button className={exploreSection === 'hotspots' ? 'active' : ''} onClick={() => setExploreSection('hotspots')}><Target size={13}/> Hotspots</button><button className={exploreSection === 'mining' ? 'active' : ''} onClick={() => setExploreSection('mining')}><Mountain size={13}/> Mining Areas</button><button className={exploreSection === 'satellite' ? 'active' : ''} onClick={() => setExploreSection('satellite')}><Satellite size={13}/> Satellite Layers</button></div>}
        {activeNav === 'ai' && <div className="context-shell-nav"><span className="context-nav-label">AI ANALYSIS</span><button className={analysisSection === 'overview' ? 'active' : ''} onClick={() => setAnalysisSection('overview')}>Overview</button><button className={analysisSection === 'region' ? 'active' : ''} onClick={() => setAnalysisSection('region')}>Region Analysis</button><button className={analysisSection === 'spectral' ? 'active' : ''} onClick={() => setAnalysisSection('spectral')}>Spectral Analysis</button><button className={analysisSection === 'insights' ? 'active' : ''} onClick={() => setAnalysisSection('insights')}>Model Insights</button><button className={analysisSection === 'samples' ? 'active' : ''} onClick={() => setAnalysisSection('samples')}>Data & Samples</button></div>}

        <div className="dashboard-heading">
          <div>
            <h1>{pageTitles[page]}</h1>
            <p>AI-powered satellite analytics for manganese exploration</p>
          </div>
          <div className="system-clock">
            <span>{updated ? updated.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '16 Sep 2026'} &nbsp; {updated ? updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '14:27'} IST</span>
            <b><i /> {systemMessage}</b>
          </div>
        </div>

        {page === 'overview' && <Overview zones={zones} setSelected={setSelected} layers={layers} setLayers={setLayers} live={live} risk={risk} goTo={goTo} selectedArea={selectedArea} onAreaSelect={setSelectedArea} onScanArea={handleAreaScan} />}
        {page === 'mine' && <ExploreWorkspace zones={zones} setSelected={setSelected} layers={layers} setLayers={setLayers} selectedArea={selectedArea} onAreaSelect={setSelectedArea} onScanArea={handleAreaScan} section={exploreSection} onSectionChange={setExploreSection} />}
        {page === 'actions' && <ActionCenter actions={actions} setAction={setActionStatus} recs={recs} onGenerate={generateFullActionPlan} planStatus={actionPlanStatus} planId={actionPlanId} />}
        {page === 'reports' && <ReportsWorkspace zones={zones} selectedZoneId={selected?.id ?? 'A'} />}
        {page === 'data' && <DataModels zones={zones} selectedArea={selectedArea} onAreaSelect={setSelectedArea} onScanArea={handleAreaScan} scanQueued={scanQueued} clearScan={() => setScanQueued(false)} section={analysisSection} />}
        {page === 'settings' && <SettingsPage />}

        {selected && <Drawer zone={selected} close={() => setSelected(null)} />}
        <p className="footer-note dashboard-disclaimer">MN25 data is shown only when backed by an authoritative source or explicitly enabled demo mode.</p>
      </main>
      <Chatbot />
    </div>
  );
}
