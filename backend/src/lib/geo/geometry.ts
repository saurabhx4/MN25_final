// Minimal, dependency-free geometry helpers for validating user-drawn
// analysis regions (Explore §I). No fabricated data here — just math.

export type GeoJsonPolygon = {
  type: 'Polygon';
  coordinates: number[][][]; // [ring][point][lng,lat]
};

export type Bbox = { west: number; south: number; east: number; north: number };

const EARTH_RADIUS_M = 6378137;

export function isValidPolygon(geometry: unknown): geometry is GeoJsonPolygon {
  if (!geometry || typeof geometry !== 'object') return false;
  const g = geometry as { type?: unknown; coordinates?: unknown };
  if (g.type !== 'Polygon' || !Array.isArray(g.coordinates) || g.coordinates.length === 0) return false;
  const outerRing = g.coordinates[0];
  if (!Array.isArray(outerRing) || outerRing.length < 4) return false; // closed ring needs >= 4 points
  for (const point of outerRing) {
    if (!Array.isArray(point) || point.length < 2) return false;
    const [lng, lat] = point;
    if (typeof lng !== 'number' || typeof lat !== 'number') return false;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return false;
  }
  const first = outerRing[0];
  const last = outerRing[outerRing.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) return false; // ring must be closed
  return true;
}

// Geodesic area of a simple (non self-intersecting) polygon on a spherical
// earth, via the standard spherical-excess formula. Accurate to well within
// the tolerance needed for area-limit validation on exploration-scale
// regions (km² not requiring ellipsoidal precision).
export function polygonAreaKm2(geometry: GeoJsonPolygon): number {
  const ring = geometry.coordinates[0];
  let total = 0;
  const n = ring.length;
  for (let i = 0; i < n - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    total += toRad(lng2 - lng1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  const areaM2 = Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
  return areaM2 / 1_000_000;
}

export function polygonCentroid(geometry: GeoJsonPolygon): { latitude: number; longitude: number } {
  const ring = geometry.coordinates[0];
  const pts = ring.slice(0, -1);
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const lng = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  return { latitude: lat, longitude: lng };
}

export function polygonBbox(geometry: GeoJsonPolygon): Bbox {
  const ring = geometry.coordinates[0];
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, south, east, north };
}

export function parseBboxParam(bbox: string): Bbox | null {
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return null;
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) return null;
  return { west, south, east, north };
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
