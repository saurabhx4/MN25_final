// SpectralProvider abstraction (AI Analysis: Spectral Analysis tab).
//
// Follows the same rule as lib/satellite/satellite.provider.ts and
// workers/analysisWorker.ts: this never fabricates spectral observations.
// Real band statistics/indices/anomaly maps require both (a) an actual
// satellite scene covering the requested geometry/sceneId and (b) a
// configured spectral processing engine. If either is missing, callers get
// an explicit "unavailable" result with a reason instead of invented numbers.

export type SpectralRequest = {
  sceneId?: string;
  geometry?: { type: 'Polygon'; coordinates: number[][][] };
  bands?: string[];
  indices?: string[];
};

export type SpectralResult = {
  modelName: string;
  modelVersion: string;
  dataSourceName: string;
  dataSourceDatasetVersion: string;
  sceneId: string;
  bandStatistics: Record<string, { min: number; max: number; mean: number; stdDev: number }>;
  indices: Record<string, number>;
  anomalyMap: { type: 'Polygon'; coordinates: number[][][]; anomalyLevel: 'normal' | 'low' | 'moderate' | 'high' }[] | null;
  spectralSignatures: Record<string, number[]> | null;
  pixelDistributions: Record<string, number[]> | null;
  qualityMetrics: { cloudCoveragePercent: number | null; validPixelPercent: number | null };
};

export interface SpectralProvider {
  readonly configured: boolean;
  analyze(request: SpectralRequest): Promise<SpectralResult>;
}

// Talks to a configured spectral-processing engine (SPECTRAL_ENGINE_URL).
// This service is responsible for reading the actual raster bands for the
// requested scene/geometry and computing real statistics/indices — the
// backend here only forwards the request and persists whatever comes back.
class HttpSpectralProvider implements SpectralProvider {
  readonly configured: boolean;
  private baseUrl: string | null;

  constructor(baseUrl: string | null) {
    this.baseUrl = baseUrl;
    this.configured = Boolean(baseUrl);
  }

  async analyze(request: SpectralRequest): Promise<SpectralResult> {
    if (!this.baseUrl) {
      throw new Error('SPECTRAL_ENGINE_URL is not configured — cannot compute real spectral features.');
    }
    const res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/v1/spectral/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      throw new Error(`Spectral engine returned ${res.status}`);
    }
    return res.json() as Promise<SpectralResult>;
  }
}

let cachedProvider: SpectralProvider | null = null;

export function getSpectralProvider(): SpectralProvider {
  if (cachedProvider) return cachedProvider;
  const baseUrl = process.env.SPECTRAL_ENGINE_URL ?? null;
  cachedProvider = new HttpSpectralProvider(baseUrl);
  return cachedProvider;
}
