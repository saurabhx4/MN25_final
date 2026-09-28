// SatelliteProvider abstraction (Explore §H — satellite scene search).
//
// Follows the same rule as src/workers/analysisWorker.ts: this never
// fabricates scene metadata. If no catalog is configured (SATELLITE_STAC_URL),
// callers get an explicit "unavailable" response rather than invented scenes.

export type SatelliteSceneQuery = {
  bbox: { west: number; south: number; east: number; north: number };
  startDate?: string;
  endDate?: string;
  maxCloudCoverage?: number;
  resolution?: string;
};

export type SatelliteScene = {
  sceneId: string;
  acquisitionDate: string;
  provider: string;
  cloudCoveragePercent: number | null;
  bbox: [number, number, number, number];
  resolutionMeters: number | null;
  bands: string[];
  sourceUrl: string | null;
};

export interface SatelliteProvider {
  readonly name: string;
  readonly configured: boolean;
  search(query: SatelliteSceneQuery): Promise<SatelliteScene[]>;
}

// Talks to any STAC-compliant catalog (e.g. Copernicus Data Space, Element84
// Earth Search). STAC is the de facto standard for satellite scene search,
// so this is written generically rather than against one vendor's bespoke API.
export class StacSatelliteProvider implements SatelliteProvider {
  readonly name: string;
  readonly configured: boolean;
  private searchUrl: string | null;
  private collection: string | null;

  constructor(searchUrl: string | null, collection: string | null, providerName: string) {
    this.searchUrl = searchUrl;
    this.collection = collection;
    this.name = providerName;
    this.configured = Boolean(searchUrl);
  }

  async search(query: SatelliteSceneQuery): Promise<SatelliteScene[]> {
    if (!this.searchUrl) {
      throw new Error(`Satellite provider "${this.name}" is not configured (SATELLITE_STAC_URL unset).`);
    }
    const body: Record<string, unknown> = {
      bbox: [query.bbox.west, query.bbox.south, query.bbox.east, query.bbox.north],
      limit: 50,
    };
    if (this.collection) body.collections = [this.collection];
    if (query.startDate || query.endDate) {
      body.datetime = `${query.startDate ?? '..'}/${query.endDate ?? '..'}`;
    }
    if (query.maxCloudCoverage !== undefined) {
      body.query = { 'eo:cloud_cover': { lte: query.maxCloudCoverage } };
    }

    const res = await fetch(`${this.searchUrl.replace(/\/+$/, '')}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Satellite catalog (${this.name}) request failed with status ${res.status}`);
    }
    const data = (await res.json()) as {
      features: Array<{
        id: string;
        bbox: [number, number, number, number];
        properties: Record<string, unknown>;
        assets?: Record<string, { href?: string }>;
        links?: Array<{ rel: string; href: string }>;
      }>;
    };

    return data.features.map((f) => ({
      sceneId: f.id,
      acquisitionDate: String(f.properties.datetime ?? ''),
      provider: this.name,
      cloudCoveragePercent: typeof f.properties['eo:cloud_cover'] === 'number' ? (f.properties['eo:cloud_cover'] as number) : null,
      bbox: f.bbox,
      resolutionMeters: typeof f.properties['gsd'] === 'number' ? (f.properties['gsd'] as number) : null,
      bands: f.assets ? Object.keys(f.assets) : [],
      sourceUrl: f.links?.find((l) => l.rel === 'self')?.href ?? null,
    }));
  }
}

let cachedProvider: SatelliteProvider | null = null;

export function getSatelliteProvider(): SatelliteProvider {
  if (cachedProvider) return cachedProvider;
  const searchUrl = process.env.SATELLITE_STAC_URL ?? null;
  const collection = process.env.SATELLITE_STAC_COLLECTION ?? null;
  const providerName = process.env.SATELLITE_PROVIDER_NAME ?? 'configured-stac-catalog';
  cachedProvider = new StacSatelliteProvider(searchUrl, collection, providerName);
  return cachedProvider;
}
