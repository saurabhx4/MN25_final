// Thin client for the MN25 backend (see /mn25-backend). Handles the bearer
// token and the "unavailable" data-quality contract used across the
// Dashboard endpoints, so page components can stay simple.

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';
const DEMO_EMAIL = 'example@gmail.com';
const DEMO_PASSWORD = '12345678';
const DEMO_STORAGE_KEY = 'mn25_demo_session';
const DEMO_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEMO_FALLBACK === 'true';

const demoUser = {
  id: 'demo-user-kmclu',
  name: 'MN25 Demo User',
  email: DEMO_EMAIL,
  role: 'ADMIN',
  organizationId: 'demo-kmclu',
  mineIds: [],
  environment: 'organization',
  permissions: ['*'],
  createdAt: new Date(0).toISOString(),
};

function isLocalDemoSession() {
  return typeof window !== 'undefined' && DEMO_ENABLED && window.localStorage.getItem(DEMO_STORAGE_KEY) === 'true';
}

export type Unavailable = { status: 'unavailable'; reason: string; dataSource: null };
export function isUnavailable(v: unknown): v is Unavailable {
  return !!v && typeof v === 'object' && (v as { status?: string }).status === 'unavailable';
}

async function ensureSession(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    if (isLocalDemoSession()) return true;
    const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
    if (res.ok) return true;
    if (res.status === 401) {
      const refreshed = await fetch(`${API_BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include' });
      return refreshed.ok;
    }
    return false;
  } catch { return false; }
}

export async function authRegister(body: { organizationName: string; name: string; email: string; password: string; environment?: 'ORGANIZATION' | 'EMPLOYEE'; role?: 'RESEARCHER' | 'OPERATOR' | 'MANAGER' | 'ADMIN' }) {
  return fetch(`${API_BASE}/api/auth/register`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => { if (!r.ok) throw new ApiError(r.status, `Registration failed (${r.status})`); return r.json(); });
}
export async function authLogin(body: { email: string; password: string }) {
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new ApiError(res.status, `Login failed (${res.status})`);
    return res.json();
  } catch (error) {
    // Explicit local-only demo fallback: it activates only for the exact demo
    // credentials and only when NEXT_PUBLIC_ENABLE_DEMO_FALLBACK=true. It
    // covers every reason the backend login can fail for this exact demo
    // account — unreachable backend (TypeError/"Failed to fetch"), or a
    // reachable backend that rejects it (e.g. 401 because the demo account
    // was never seeded with `npm run prisma:seed-demo`, or a fresh DB) —
    // so the documented demo credentials always work locally.
    if (DEMO_ENABLED && body.email.trim().toLowerCase() === DEMO_EMAIL && body.password === DEMO_PASSWORD) {
      window.localStorage.setItem(DEMO_STORAGE_KEY, 'true');
      return { user: demoUser, demo: true };
    }
    throw error;
  }
}
export async function authLogout() {
  if (typeof window !== 'undefined') window.localStorage.removeItem(DEMO_STORAGE_KEY);
  try { await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' }); } catch { /* local demo sessions do not need a backend */ }
}
export async function authMe() {
  if (isLocalDemoSession()) return { user: demoUser, demo: true };
  return fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' }).then(async r => { if (!r.ok) throw new ApiError(r.status, 'Not authenticated'); return r.json(); });
}



export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiGet<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const authenticated = await ensureSession();
  if (!authenticated) throw new ApiError(401, 'Not authenticated');
  const qs = params
    ? '?' + Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
    : '';
  const res = await fetch(`${API_BASE}${path}${qs}`, { credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, `Request to ${path} failed (${res.status})`);
  return res.json();
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const authenticated = await ensureSession();
  if (!authenticated) throw new ApiError(401, 'Not authenticated');
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new ApiError(res.status, `Request to ${path} failed (${res.status})`);
  return res.json();
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const authenticated = await ensureSession();
  if (!authenticated) throw new ApiError(401, 'Not authenticated');
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, `Request to ${path} failed (${res.status})`);
  return res.json();
}

export type Mn25Settings = {
  selectedMine: { id: string; name: string; region: string } | null;
  forecastHorizon: 30 | 60 | 90;
  riskThreshold: number;
  prospectivityThreshold: number;
  defaultModel: string | null;
  timezone: string;
  units: 'metric' | 'imperial';
  notificationPreferences: Record<string, boolean>;
  permissions: { canWriteOperational: boolean; canWriteFull: boolean };
};

export function getSettings() { return apiGet<Mn25Settings>('/api/settings'); }
export function updateSettings(body: Partial<Omit<Mn25Settings, 'selectedMine' | 'permissions'>> & { selectedMineId?: string | null; reason?: string }) { return apiPatch<Mn25Settings>('/api/settings', body); }
export function getMines() { return apiGet<{ results: Array<{ id: string; name: string; region: string }> }>('/api/mines'); }
export function getSystemStatus() { return apiGet<{ components: Record<string, { status: 'operational' | 'degraded' | 'offline'; latency: number | null; lastChecked: string | null; version: string | null; message: string | null }> }>('/api/system/status'); }

export async function apiDelete(path: string): Promise<void> {
  const authenticated = await ensureSession();
  if (!authenticated) throw new ApiError(401, 'Not authenticated');
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, `Request to ${path} failed (${res.status})`);
}

export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const authenticated = await ensureSession();
  if (!authenticated) throw new ApiError(401, 'Not authenticated');
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', credentials: 'include', body: form });
  if (!res.ok) throw new ApiError(res.status, `Upload to ${path} failed (${res.status})`);
  return res.json();
}

// ---- Dashboard-specific types -------------------------------------------

export type DashboardSummary = {
  selectedLocation: { zoneId: string; name: string; region: string; latitude: number; longitude: number } | Unavailable;
  predictedMnConcentration: { value: number; unit: string } | Unavailable;
  confidence: { value: number; unit: string } | Unavailable;
  uncertainty: { value: number; unit: string } | Unavailable;
  prospectivity: { level: 'LOW' | 'MODERATE' | 'HIGH'; score: number } | Unavailable;
  activeMiningAreas: number;
  highProspectivityZones: number;
  areasAnalyzed: number;
  totalAreaProcessedKm2: number | null;
  highestPredictedMn: number | null;
  averagePredictedMn: number | null;
  lastUpdated: string;
};

export type TopZone = {
  id: string; name: string; region: string; latitude: number; longitude: number;
  prospectivity: number; confidence: number; predictedMn: number; area: number;
  status: string; risk: number | null; lastAnalyzedAt: string;
};

export type RecentAnalysis = {
  analysisId: string;
  location: { name: string; region: string } | Unavailable;
  analysisType: string;
  status: string;
  modelVersion: string | null;
  prospectivity: { level: string; score: number } | null;
  confidence: number | null;
  createdAt: string;
  completedAt: string | null;
};


export function getDashboardSummary() { return apiGet<DashboardSummary & { systemStatus?: Record<string, unknown> }>('/api/dashboard/summary'); }
export function getDashboardTopZones(params?: { limit?: number; mineId?: string; region?: string; minimumProspectivity?: number; sort?: 'prospectivity' | 'confidence' | 'predictedMn' }) { return apiGet<TopZone[]>('/api/dashboard/top-zones', params); }
export function getRecentAnalyses(limit = 10) { return apiGet<{ results: RecentAnalysis[] }>('/api/dashboard/recent-analyses', { limit }); }

export type MnDistribution =
  | { observed: { label: string; value: number }[]; modelled: { label: string; value: number }[]; predicted: { label: string; value: number }[] }
  | Unavailable;

// ---- Explore-specific types & calls --------------------------------------
// Mirrors backend/src/modules/{geospatial,mining,prospectivity,satellite}.
// Documented locations (Zone) and AI hotspots (ProspectivityZone) are kept
// as distinct response shapes end-to-end — never merged into one type.

export type PlaceSearchResult = {
  id: string; name: string; type: string;
  latitude: number; longitude: number; region: string | null; country: string | null; source: string;
};

export function searchPlaces(q: string, opts?: { limit?: number; country?: string; region?: string }) {
  return apiGet<PlaceSearchResult[]>('/api/geospatial/search', { q, ...opts });
}

export type GeospatialLayer = {
  id: string; name: string; type: string; provider: string | null;
  availability: 'available' | 'unavailable'; lastUpdated: string | null; source: string | null; sourceUrl: string | null;
};

export function getGeospatialLayers() {
  return apiGet<{ layers: GeospatialLayer[] }>('/api/geospatial/layers');
}

export type NearbyMiningArea = {
  id: string; name: string; latitude: number; longitude: number; distanceKm: number;
  region: string; status: string; commodity: string; area: number;
  source: string; sourceUrl: string | null; confidence: number;
  operatorName: string | null; productionTonnesPerYear: number | null;
};

export function getNearbyMiningAreas(params: { latitude: number; longitude: number; radiusKm?: number; status?: string; commodity?: string; limit?: number }) {
  return apiGet<{ results: NearbyMiningArea[]; count: number }>('/api/mining/nearby', params);
}

export type MiningArea = {
  id: string; name: string; recordType: 'DOCUMENTED_MINE' | 'DOCUMENTED_OCCURRENCE';
  latitude: number; longitude: number; region: string; state: string | null; district: string | null;
  status: string; commodity: string; mineType: string | null; area: number;
  operatorName: string | null; productionTonnesPerYear: number | null;
  source: string; sourceUrl: string | null; lastUpdated: string;
};

export function getMiningAreas(params?: { region?: string; state?: string; district?: string; status?: string; commodity?: string; bbox?: string; mineType?: string; limit?: number; offset?: number }) {
  return apiGet<{ results: MiningArea[]; total: number; limit: number; offset: number }>('/api/mining/areas', params);
}

export function getMiningAreaDetail(id: string) {
  return apiGet<Record<string, unknown>>(`/api/mining/areas/${id}`);
}

export type ProspectivityHotspot = {
  zoneId: string; center: { latitude: number; longitude: number };
  prospectivityScore: number; confidence: number; modelVersion: string; generatedAt: string; status: string; note: string;
};

export function getProspectivityHotspots(params?: { region?: string; bbox?: string; minimumScore?: number; limit?: number; sortBy?: 'prospectivity' | 'confidence' | 'generatedAt'; modelVersion?: string }) {
  return apiGet<{ results: ProspectivityHotspot[]; count: number }>('/api/prospectivity/hotspots', params);
}

export function getProspectivityZoneDetail(id: string) {
  return apiGet<Record<string, unknown>>(`/api/prospectivity/zones/${id}`);
}

export function getSatelliteScenes(params: { bbox: string; startDate?: string; endDate?: string; cloudCoverage?: number; provider?: string; resolution?: string }) {
  return apiGet<{ status?: 'unavailable'; reason?: string; results: unknown[]; count?: number; provider?: string }>('/api/satellite/scenes', params);
}

export function createRegionAnalysis(body: { geometry: { type: 'Polygon'; coordinates: number[][][] }; analysisType?: 'PROSPECTIVITY' | 'REGION_COMPARISON' | 'SPECTRAL' | 'REGION_SCAN'; requestedLayers?: string[]; modelVersion?: string }) {
  return apiPost<{ analysisId: string; geometry: unknown; status: string }>('/api/analyses/region', body);
}

export function getAnalysisStatus(analysisId: string) {
  return apiGet<{ analysisId: string; status: 'queued' | 'processing' | 'completed' | 'failed'; errorMessage: string | null; createdAt: string; completedAt: string | null }>(`/api/analyses/${analysisId}/status`);
}

export function getAnalysisResult(analysisId: string) {
  return apiGet<Record<string, unknown>>(`/api/analyses/${analysisId}/result`);
}

export function listMapConfigurations() {
  return apiGet<{ results: Array<{ id: string; name: string; layers: Record<string, boolean>; mapView: unknown; updatedAt: string }> }>('/api/map-configurations');
}

export function saveMapConfiguration(body: { name: string; layers: Record<string, boolean>; mapView?: { centerLat: number; centerLng: number; zoom: number } }) {
  return apiPost<{ id: string; name: string }>('/api/map-configurations', body);
}

// ---- AI Analysis page (backend replacement for the DataModels.tsx prototype) ----
// Mirrors backend/src/modules/{ai-analysis,spectral-analysis,models,samples,model-validation}.
// Every function here either returns a real, provenance-carrying result or an
// explicit Unavailable/error — never a fabricated score, index or metric.

export type GeoJsonPolygon = { type: 'Polygon'; coordinates: number[][][] };

// Converts the rectangular MineMap selection into the closed GeoJSON polygon
// the backend's region-analysis endpoints expect.
export function bboxToPolygon(area: { south: number; west: number; north: number; east: number }): GeoJsonPolygon {
  const { south, west, north, east } = area;
  return { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] };
}

export function createAiAnalysisRegion(body: { geometry: GeoJsonPolygon; analysisType?: 'PROSPECTIVITY' | 'REGION_COMPARISON' | 'SPECTRAL' | 'REGION_SCAN'; requestedLayers?: string[]; modelVersion?: string }) {
  return apiPost<{ analysisId: string; status: string }>('/api/ai-analysis/region', body);
}

export type AiAnalysisStatus = {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  currentStage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
};

export function getAiAnalysisStatus(analysisId: string) {
  return apiGet<AiAnalysisStatus>(`/api/ai-analysis/${analysisId}/status`);
}

export type AiAnalysisOverview =
  | {
      prospectivityScore: number; confidence: number; uncertainty: number | null;
      predictedMnConcentration: number | null; analysisArea: number | null;
      modelVersion: string; generatedAt: string; note: string;
    }
  | { status: 'unavailable'; reason: string };

export function getAiAnalysisOverview(analysisId: string) {
  return apiGet<AiAnalysisOverview>(`/api/ai-analysis/${analysisId}/overview`);
}

export type AiAnalysisExplainability =
  | { status: 'available'; format: string; features: { feature: string; contribution: number }[]; limitations: string | null }
  | { status: 'unavailable'; reason: string; features: [] };

export function getAiAnalysisExplainability(analysisId: string) {
  return apiGet<AiAnalysisExplainability>(`/api/ai-analysis/${analysisId}/explainability`);
}

export function createSpectralAnalysis(body: { sceneId?: string; geometry?: GeoJsonPolygon; bandConfiguration?: { bands?: string[]; indices?: string[] } }) {
  return apiPost<{ analysisId: string; status: string }>('/api/spectral-analysis', body);
}

export type SpectralAnalysisResult =
  | { status: 'unavailable'; reason: string | null }
  | { status: 'failed'; error: string | null }
  | { status: 'queued' | 'running' }
  | {
      status: 'completed'; sceneId: string | null; bandStatistics: unknown; indices: unknown; anomalyMap: unknown;
      spectralSignatures: unknown; pixelDistributions: unknown; qualityMetrics: unknown;
      modelVersion: string | null; dataSource: { name: string; datasetVersion: string; provenanceUrl: string | null } | null; completedAt: string;
    };

export function getSpectralAnalysis(analysisId: string) {
  return apiGet<SpectralAnalysisResult>(`/api/spectral-analysis/${analysisId}`);
}

export type ModelInfo = {
  modelId: string; modelVersion: string; name: string; purpose?: string; version: string | null; type: string;
  status?: string; description?: string | null; modelTrainingDataset: string | null; modelCreatedAt: string;
  modelMetrics: Record<string, unknown> | null; trainingDate?: string | null; features?: unknown; deploymentDate?: string | null;
  latestVersion?: { id: string; version: string; status: string; metrics: unknown; features: unknown; productionReady: boolean } | null;
};

export function getModels() {
  return apiGet<{ status?: 'unavailable'; reason?: string; results: ModelInfo[] }>('/api/models');
}

export function getModel(modelId: string) {
  return apiGet<Record<string, unknown>>(`/api/models/${modelId}`);
}

export function getModelMetrics(modelId: string) {
  return apiGet<Record<string, unknown>>(`/api/models/${modelId}/metrics`);
}

export function getModelVersions(modelId: string) {
  return apiGet<Record<string, unknown>>(`/api/models/${modelId}/versions`);
}

export function getPredictionRecord(predictionId: string) {
  return apiGet<Record<string, unknown>>(`/api/models/predictions/${predictionId}`);
}

export type SampleRecord = {
  sampleId: string; kind: 'FILE_UPLOAD' | 'GROUND_TRUTH'; status: string; fileName: string | null;
  location: { latitude: number; longitude: number } | null; collectionDate: string | null;
  mnConcentration: number | null; measurementMethod: string | null; laboratory: string | null;
  quality: string | null; source: string | null; regionId: string | null; createdAt: string;
};

export function getSamples(params?: { kind?: 'FILE_UPLOAD' | 'GROUND_TRUTH'; regionId?: string; limit?: number; offset?: number }) {
  return apiGet<{ results: SampleRecord[]; total: number; limit: number; offset: number }>('/api/samples', params);
}

export function createGroundTruthSample(body: {
  latitude: number; longitude: number; collectionDate: string; mnConcentration: number; measurementMethod: string;
  laboratory?: string; quality?: 'verified' | 'provisional' | 'flagged'; source?: string; mineId?: string; regionId?: string;
}) {
  return apiPost<{ sampleId: string; status: string }>('/api/samples', body);
}

export type ModelValidationResult =
  | { status: 'unavailable'; reason: string; sampleCount: 0; skipped: number }
  | {
      validationId: string; precision: number | null; recall: number | null; mae: number | null; rmse: number | null; r2: number | null;
      confusionMatrix: Record<string, Record<string, number>>; sampleCount: number; skipped: number;
      validationDataset: string | null; validationTimestamp: string;
    };

export function createModelValidation(body: { modelVersion: string; sampleIds: string[]; regionId?: string }) {
  return apiPost<ModelValidationResult>('/api/model-validation', body);
}

// Maps the real /api/mining/areas response onto the legacy demo `Zone` shape
// (lib/data.ts) so the existing Explore UI — MineMap, ExploreWorkspace, the
// zone lists — can render authoritative data with ZERO component changes.
// Fields the backend doesn't (yet) return per-location (geology/mineral/etc.
// sub-scores used only by the old client-side prospectivity() demo formula)
// are set to neutral defaults; `prospectivity`/`confidence` here describe the
// documented record's completeness, NOT an AI prediction — real AI hotspots
// are fetched separately via getProspectivityHotspots() and must stay
// visually distinct in the UI, per the platform's data-quality rule.
export function miningAreaToLegacyZone(a: MiningArea): import('./data').Zone {
  return {
    id: a.id,
    name: a.name,
    region: a.region,
    lat: a.latitude,
    lng: a.longitude,
    prospectivity: 0,
    area: a.area,
    status: a.status,
    confidence: a.recordType === 'DOCUMENTED_MINE' ? 100 : 70,
  };
}

// ---- Projects / AI Action Center -----------------------------------------
// All action-center state is persisted by the backend. The API deliberately
// requires provenance-bearing context when a new plan is generated so the
// backend cannot silently invent production, weather, risk or AI signals.

export type ProjectActionPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type ProjectActionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';

export type ProjectAction = {
  id: string;
  title: string;
  description: string | null;
  priority: ProjectActionPriority;
  impact: number | null;
  zone: string | null;
  status: ProjectActionStatus;
  createdAt: string;
  scheduledFor: string | null;
  assignedTeam: string | null;
  notes: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  completedAt: string | null;
  recommendation?: ProjectRecommendation | null;
};

export type ProjectRecommendation = {
  id: string;
  title: string;
  reason: string;
  recommendedAction: string;
  priority: ProjectActionPriority;
  confidence: number;
  estimatedImpact: number | null;
  sourceAnalysis: string | null;
  modelVersion: string | null;
  createdAt: string;
};

export type ActionPlan = {
  id: string;
  status: 'QUEUED' | 'GENERATING' | 'READY' | 'FAILED';
  summary: string | null;
  detectedIssues: unknown;
  confidence: number | null;
  expectedImpact: number | null;
  supportingEvidence: unknown;
  modelVersion: string | null;
  generatedAt: string | null;
  errorMessage: string | null;
  recommendations: ProjectRecommendation[];
  factors: { id: string; name: string; value: number | null; impact: number | null; source: string; observedAt: string | null }[];
  actions: ProjectAction[];
};

export type SourcedContext = Record<string, unknown> & { source: string };

export function getProjectActions(params?: { mineId?: string; priority?: ProjectActionPriority; status?: ProjectActionStatus; limit?: number }) {
  return apiGet<{ results: ProjectAction[] }>('/api/actions', params);
}

export function getProjectRecommendations(params?: { mineId?: string; priority?: ProjectActionPriority; status?: ProjectActionStatus }) {
  return apiGet<{ results: ProjectRecommendation[] }>('/api/actions/recommendations', params);
}

export function generateActionPlan(body: {
  mineId?: string;
  date?: string;
  analysisContext?: SourcedContext;
  productionContext?: SourcedContext;
  riskContext?: SourcedContext;
  weatherContext?: SourcedContext;
}) {
  return apiPost<{ actionPlanId: string; status: string }>('/api/actions/action-plans/generate', body);
}

export function getActionPlan(id: string) {
  return apiGet<ActionPlan>(`/api/actions/action-plans/${id}`);
}

export function getActionPlanFactors(id: string) {
  return apiGet<{ results: ActionPlan['factors'] }>(`/api/actions/action-plans/${id}/factors`);
}

export function approveProjectAction(id: string, notes?: string) {
  return apiPost<ProjectAction>(`/api/actions/${id}/approve`, { notes });
}

export function rejectProjectAction(id: string, reason?: string) {
  return apiPost<ProjectAction>(`/api/actions/${id}/reject`, { reason });
}

export function scheduleProjectAction(id: string, scheduledFor: string, assignedTeam?: string, notes?: string) {
  return apiPost<ProjectAction>(`/api/actions/${id}/schedule`, { scheduledFor, assignedTeam, notes });
}

export function completeProjectAction(id: string, executionResult?: unknown) {
  return apiPost<ProjectAction>(`/api/actions/${id}/complete`, { executionResult });
}


// ---- Production Intelligence ---------------------------------------------
export type ProductionHistoryPoint = {
  date: string; plannedProduction: number | null; actualProduction: number | null; oreGrade: number | null;
  equipmentAvailability: number | null; weather: unknown; downtime: number | null; source?: { name: string; datasetVersion: string | null; url: string | null } | null;
};
export type ProductionForecast = {
  forecastId: string; status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'UNAVAILABLE';
  mine: { id: string; name: string; region: string };
  forecast: Array<{ date: string; predictedProduction: number; lowerBound: number; upperBound: number }> | null;
  target: number | null; shortfall: number | null; confidence: number | null; uncertainty: number | null;
  modelId: string | null; modelVersion: string | null; trainingDataset: string | null; forecastGeneratedAt: string | null;
  factors: Array<{ name: string; value?: number; impact?: number | null; source: string; observedAt?: string }> | null;
  errorMessage: string | null;
};
export type ProductionScenarioResult = {
  scenarioId: string; production: number; shortfall: number | null; recoveryOpportunity: number | null;
  risk: number; confidence: number; modelId: string | null; modelVersion: string | null; trainingDataset: string | null; assumptions: unknown;
};
export function ingestProductionHistory(mineId: string, records: Array<Record<string, unknown>>) { return apiPost<{ count: number }>(`/api/production/history?mineId=${encodeURIComponent(mineId)}`, { records }); }
export function getProductionHistory(params: { mineId: string; startDate?: string; endDate?: string; granularity?: 'daily' | 'weekly' | 'monthly' }) {
  return apiGet<{ status: 'available' | 'unavailable'; reason?: string; results: ProductionHistoryPoint[] }>('/api/production/history', params);
}
export function createProductionForecast(body: { mineId: string; forecastHorizon: 7 | 30 | 90; modelVersion?: string | null }) {
  return apiPost<{ forecastId: string; status: string }>('/api/production/forecast', body);
}
export function getProductionForecast(id: string) { return apiGet<ProductionForecast>(`/api/production/forecast/${id}`); }
export function runProductionScenario(body: { mineId: string; equipmentDowntime: number; blastingDelay: number; workingHours: number; rainfall: 'Low' | 'Medium' | 'High'; forecastHorizon: 7 | 30 | 90 }) {
  return apiPost<ProductionScenarioResult>('/api/production/scenario', body);
}
export function createProductionForecastReport(id: string) { return apiPost<{ reportId: string; status: string }>(`/api/production/forecast/${id}/report`); }

// ---- Reports ---------------------------------------------------------------
export type ReportType = 'quick' | 'detailed' | 'prospectivity';
export type ReportSection = 'summary' | 'maps' | 'mining' | 'geology' | 'production' | 'ai' | 'spectral' | 'model' | 'sources' | 'limits';
export type BackendReport = {
  id: string; title: string; subjectType: string; subjectId: string; reportType: ReportType;
  sections: ReportSection[]; analysisIds: string[]; status: 'QUEUED' | 'GENERATING' | 'READY' | 'FAILED';
  currentVersion: number; createdAt: string; updatedAt: string; completedAt: string | null; errorMessage: string | null;
  version: { id: string; version: number; generatedAt: string; checksum: string | null } | null;
};

export function getReports(params?: { type?: ReportType; subject?: string; status?: BackendReport['status']; q?: string; limit?: number; offset?: number }) {
  return apiGet<{ results: BackendReport[]; total: number; limit: number; offset: number }>('/api/reports', params);
}

export function createReport(body: { subjectType: 'analysis' | 'region' | 'mine' | 'hotspot'; subjectId: string; reportType: ReportType; sections: ReportSection[]; analysisIds?: string[] }) {
  return apiPost<{ reportId: string; status: string }>('/api/reports', body);
}

export function getReport(id: string) { return apiGet<BackendReport>(`/api/reports/${id}`); }
export type ReportPreview = {
  reportId: string; version: number; title: string; reportType: ReportType;
  content: {
    title: string; reportType: string; subjectType: string; subjectId: string; generatedAt: string;
    sections: Array<{ id: ReportSection; title: string; paragraphs?: string[]; rows?: Array<[string, string]>; bullets?: string[]; unavailable?: string }>;
  };
  analysisSnapshot: unknown; modelSnapshot: unknown; dataSnapshot: unknown;
};
export function getReportPreview(id: string) { return apiGet<ReportPreview>(`/api/reports/${id}/preview`); }
export function regenerateReportPdf(id: string) { return apiPost<{ reportId: string; status: string }>(`/api/reports/${id}/generate-pdf`); }
export function getReportDownloadUrl(id: string) { return apiGet<{ url: string; expiresAt: number; version: number }>(`/api/reports/${id}/download-url`); }
export function deleteReport(id: string) { return apiDelete(`/api/reports/${id}`); }

export type RiskRecord = {
  id: string; name: string; cause: string; impact: number; probability: number; riskScore: number;
  severity: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'; status: 'ACTIVE'|'MONITORING'|'ACKNOWLEDGED'|'RESOLVED';
  affectedArea: string | null; evidence: unknown; source: unknown; mitigation: string | null; notes: string | null;
  owner: { id: string; name: string; email: string } | null; calculationVersion: string;
  modelVersion: string | null; confidence: number | null; uncertainty: number | null; inputFactors: unknown;
  createdAt: string; updatedAt: string;
};
export function getRisks(params?: { mineId?: string; severity?: string; status?: string; date?: string }) {
  return apiGet<{ status: 'available'|'unavailable'; results: RiskRecord[]; reason?: string }>('/api/risks', params);
}
export function evaluateRisks(mineId: string) { return apiPost<{ status: 'available'|'unavailable'; results: RiskRecord[]; reason?: string }>('/api/risks/evaluate', { mineId }); }
export function getRiskMatrix(mineId?: string) { return apiGet<{ results: Array<Pick<RiskRecord,'id'|'name'|'probability'|'impact'|'riskScore'|'severity'|'status'|'affectedArea'>> }>('/api/risks/matrix', mineId ? { mineId } : undefined); }
export function updateRisk(id: string, body: Partial<Pick<RiskRecord,'status'|'mitigation'|'owner'|'notes'>> & { ownerId?: string | null }) { return apiPatch<RiskRecord>(`/api/risks/${id}`, body); }
export function acknowledgeRisk(id: string) { return apiPost<RiskRecord>(`/api/risks/${id}/acknowledge`); }
export function resolveRisk(id: string) { return apiPost<RiskRecord>(`/api/risks/${id}/resolve`); }

// ---- Data Ingestion -------------------------------------------------------
export type DatasetType = 'satellite'|'geology'|'mining'|'production'|'weather'|'spectral'|'samples'|'terrain'|'historicalOccurrences';
export type DatasetProcessingStatus = 'uploaded'|'validating'|'processing'|'ready'|'failed';
export type DatasetRecord = {
  id: string; name: string; type: DatasetType; provider: string; sourceUrl: string; version: string;
  coverage: unknown; acquisitionDate: string | null; ingestionDate: string; processingStatus: DatasetProcessingStatus;
  qualityScore: number | null; license: string | null; checksum: string; mineId: string | null;
  format: string | null; contentType: string | null; sizeBytes: string | null; validationReport: unknown; processingError: string | null;
  createdAt: string; updatedAt: string; versionId?: string | null;
};
export function getDatasets(params?: { type?: DatasetType; status?: DatasetProcessingStatus; mineId?: string; limit?: number; offset?: number }) {
  return apiGet<{ results: DatasetRecord[]; total: number; limit: number; offset: number }>('/api/datasets', params as Record<string, string | number | undefined>);
}
export function getDataset(id: string) { return apiGet<DatasetRecord & { versions: DatasetRecord[] }>(`/api/datasets/${id}`); }
export function validateDataset(id: string) { return apiPost<{ datasetId: string; status: DatasetProcessingStatus }>(`/api/datasets/${id}/validate`); }
export function processDataset(id: string) { return apiPost<{ datasetId: string; status: DatasetProcessingStatus }>(`/api/datasets/${id}/process`); }
export function getDatasetProvenance(id: string) { return apiGet<{ datasetId: string; dataset: DatasetRecord; analyses: Array<{ analysisId: string; analysisType: string; status: string; requestedByUserId: string; createdAt: string; completedAt: string | null; role: string; datasetVersion: DatasetRecord | null }> }>(`/api/datasets/${id}/provenance`); }
export function queryDatasetSpatial(id: string, params: { latitude?: number; longitude?: number; radiusKm?: number; bbox?: string }) { return apiGet<{ query: unknown; results: unknown[] }>(`/api/datasets/${id}/spatial`, params as Record<string, string | number | undefined>); }
export async function createDataset(body: { name: string; type: DatasetType; provider: string; sourceUrl: string; version: string; coverage?: unknown; acquisitionDate?: string; license?: string; mineId?: string; file?: File }) {
  const authenticated = await ensureSession();
  if (!authenticated) throw new ApiError(401, 'Not authenticated');
  const form = new FormData();
  Object.entries(body).forEach(([key, value]) => { if (key !== 'file' && value !== undefined) form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value)); });
  if (body.file) form.append('file', body.file);
  const res = await fetch(`${API_BASE}/api/datasets`, { method: 'POST', credentials: 'include', body: form });
  if (!res.ok) throw new ApiError(res.status, `Request to /api/datasets failed (${res.status})`);
  return res.json() as Promise<DatasetRecord>;
}

// ---- Canonical MN25 domain graph / provenance -----------------------------
export function getAnalysisProvenance(analysisId: string) {
  return apiGet<Record<string, unknown>>(`/api/domain/analyses/${analysisId}/provenance`);
}
export function getPredictionProvenance(predictionId: string) {
  return apiGet<Record<string, unknown>>(`/api/domain/predictions/${predictionId}/provenance`);
}
export function getOrganizationDomainGraph() {
  return apiGet<Record<string, unknown>>('/api/domain/organizations/me/graph');
}

// MN25 production ML API — no client-side prospectivity calculations.
export type MlModelVersion = {
  id: string; modelId: string | null; name: string; version: string; algorithm: string | null;
  datasetVersion: string | null; featureVersion: string | null; status: string; deploymentStatus: string;
  metrics: Record<string, unknown> | null; calibration: Record<string, unknown> | null;
  artifactLocation: string | null; trainingDate: string | null; deploymentDate: string | null;
};
export type MlPrediction = {
  predictionId: string; model: { id: string; name: string };
  modelVersion: { id: string; version: string; algorithm: string | null; metrics: Record<string, unknown> | null };
  inputDatasetVersions: { id: string; dataset: string; version: string; checksum: string; role: string }[];
  geometry: unknown; prediction: Record<string, unknown>; uncertainty: number | null;
  applicability: string | null; dataQuality: number | null; featureVersion: string | null;
  sourceSceneIds: string[] | null; explanation: unknown; generatedAt: string; status: string;
};
export function getMlModels() { return apiGet<{ results: MlModelVersion[] }>('/api/ml/models'); }
export function getMlModel(id: string) { return apiGet<MlModelVersion & { experiments?: unknown[]; trainingRuns?: unknown[] }>(`/api/ml/models/${id}`); }
export function getMlExperiments() { return apiGet<{ results: unknown[] }>('/api/ml/experiments'); }
export function requestMlTraining(body: { datasetVersion: string; featureVersion: string; name?: string; hyperparameters?: unknown; randomSeed?: number }) { return apiPost<{ experimentId: string; status: string }>('/api/ml/train', body); }
export function requestMlPrediction(body: { modelVersionId: string; geometry: unknown; datasetVersion?: string; featureVersion?: string }) { return apiPost<{ predictionRunId: string; status: string }>('/api/ml/predict', body); }
export function getMlPrediction(id: string) { return apiGet<MlPrediction>(`/api/ml/predictions/${id}`); }
export function getMlPredictionExplanation(id: string) { return apiGet<{ model: string; modelVersion: string; explanation: unknown }>(`/api/ml/predictions/${id}/explanation`); }
export function getMlPredictionUncertainty(id: string) { return apiGet<{ uncertainty: number | null; applicability: string | null; dataQuality: number | null; status: string }>(`/api/ml/predictions/${id}/uncertainty`); }
export function getMlPredictionMap(id: string) { return apiGet<{ predictionId: string; modelVersion: string; geometry: unknown; rasterArtifact: string | null; vectorArtifact: string | null }>(`/api/ml/predictions/${id}/map`); }
