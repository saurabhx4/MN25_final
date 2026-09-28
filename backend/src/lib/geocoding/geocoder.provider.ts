// GeocoderProvider abstraction (Explore §A — Place Search).
//
// The provider interface is deliberately small so the backing service can be
// swapped later (e.g. a commercial geocoder) without touching route code.
// Default implementation uses Nominatim (OpenStreetMap's public geocoding
// API) because an authoritative geocoding service is already available —
// per the task spec we do not roll our own global geocoder.

export type GeocodeResultType = 'city' | 'district' | 'state' | 'coordinate' | 'landmark' | 'mining_location';

export type GeocodeResult = {
  id: string;
  name: string;
  type: GeocodeResultType;
  latitude: number;
  longitude: number;
  region: string | null;
  country: string | null;
  source: string;
};

export interface GeocoderProvider {
  readonly name: string;
  search(params: { q: string; limit: number; country?: string; region?: string }): Promise<GeocodeResult[]>;
}

// Matches "12.34, -56.78" / "12.34,-56.78" style direct coordinate queries so
// the search box also works as a go-to-coordinate box, per the spec's
// "coordinates" search type.
export function parseCoordinateQuery(q: string): { latitude: number; longitude: number } | null {
  const m = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

export class NominatimGeocoderProvider implements GeocoderProvider {
  readonly name = 'nominatim';
  private baseUrl: string;
  private userAgent: string;

  constructor(baseUrl: string, userAgent: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.userAgent = userAgent;
  }

  async search(params: { q: string; limit: number; country?: string; region?: string }): Promise<GeocodeResult[]> {
    const coord = parseCoordinateQuery(params.q);
    if (coord) {
      return [
        {
          id: `coord:${coord.latitude.toFixed(5)},${coord.longitude.toFixed(5)}`,
          name: `${coord.latitude.toFixed(5)}, ${coord.longitude.toFixed(5)}`,
          type: 'coordinate',
          latitude: coord.latitude,
          longitude: coord.longitude,
          region: null,
          country: null,
          source: 'coordinate_input',
        },
      ];
    }

    const query = new URLSearchParams({
      q: [params.q, params.region, params.country].filter(Boolean).join(', '),
      format: 'jsonv2',
      addressdetails: '1',
      limit: String(params.limit),
    });
    if (params.country) query.set('countrycodes', params.country.toLowerCase());

    const res = await fetch(`${this.baseUrl}/search?${query.toString()}`, {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Geocoder (${this.name}) request failed with status ${res.status}`);
    }
    const rows = (await res.json()) as Array<{
      place_id: number;
      lat: string;
      lon: string;
      display_name: string;
      type: string;
      class: string;
      address?: Record<string, string>;
    }>;

    return rows.map((r) => ({
      id: `nominatim:${r.place_id}`,
      name: r.display_name.split(',')[0],
      type: classify(r.class, r.type),
      latitude: Number(r.lat),
      longitude: Number(r.lon),
      region: r.address?.state ?? r.address?.county ?? null,
      country: r.address?.country ?? null,
      source: 'OpenStreetMap / Nominatim',
    }));
  }
}

function classify(osmClass: string, osmType: string): GeocodeResultType {
  if (osmType === 'city' || osmType === 'town' || osmType === 'village') return 'city';
  if (osmClass === 'boundary' && osmType === 'administrative') return 'district';
  if (osmType === 'state') return 'state';
  if (osmClass === 'landuse' && (osmType === 'quarry' || osmType === 'mine')) return 'mining_location';
  return 'landmark';
}

let cachedProvider: GeocoderProvider | null = null;

export function getGeocoderProvider(): GeocoderProvider {
  if (cachedProvider) return cachedProvider;
  const baseUrl = process.env.NOMINATIM_BASE_URL ?? 'https://nominatim.openstreetmap.org';
  const userAgent = process.env.NOMINATIM_USER_AGENT ?? 'MN25-Mineral-Intelligence/1.0 (contact: ops@mn25.example)';
  cachedProvider = new NominatimGeocoderProvider(baseUrl, userAgent);
  return cachedProvider;
}
