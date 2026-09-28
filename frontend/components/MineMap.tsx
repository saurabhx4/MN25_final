'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Maximize, Minus, MousePointer2, Plus, ScanLine, Satellite, SquareDashedMousePointer, Map as MapIcon, Mountain, LocateFixed, Layers3 } from 'lucide-react';
import type { Zone } from '../lib/data';
import { getNearbyMiningAreas, type NearbyMiningArea } from '../lib/api';

declare global {
  interface Window {
    require?: ((modules: string[], callback: (...args: any[]) => void) => void) & { on?: (...args: any[]) => void };
    __mn25ArcgisPromise?: Promise<void>;
  }
}

export type MapLayers = {
  boundary: boolean;
  zones: boolean;
  geology: boolean;
  elevation: boolean;
  satellite: boolean;
};

export type MapSelection = {
  south: number;
  west: number;
  north: number;
  east: number;
  centerLat: number;
  centerLng: number;
  areaKm2: number;
};

type BaseMode = 'map' | 'satellite' | 'terrain';
type MiningFilter = 'all' | 'available' | 'active' | 'monitoring' | 'restricted';

type ArcObjects = {
  Map: any;
  SceneView: any;
  GraphicsLayer: any;
  Graphic: any;
  Point: any;
  Polygon: any;
  Camera: any;
  Search: any;
  Home: any;
  SimpleMarkerSymbol: any;
  SimpleFillSymbol: any;
  SimpleLineSymbol: any;
};

const ARCGIS_CSS = 'https://js.arcgis.com/4.34/esri/themes/dark/main.css';
const ARCGIS_JS = 'https://js.arcgis.com/4.34/';

const zoneColor = (score: number) => score >= 75 ? '#5fa38d' : score >= 40 ? '#c1893f' : '#a54b45';

function loadArcGIS(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.__mn25ArcgisPromise) return window.__mn25ArcgisPromise;

  window.__mn25ArcgisPromise = new Promise((resolve, reject) => {
    const finish = () => {
      if (window.require) resolve();
      else reject(new Error('ArcGIS AMD loader did not initialize.'));
    };

    if (!document.querySelector(`link[data-mn25-arcgis="css"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = ARCGIS_CSS;
      link.dataset.mn25Arcgis = 'css';
      document.head.appendChild(link);
    }

    if (window.require) {
      finish();
      return;
    }

    const existing = document.querySelector(`script[data-mn25-arcgis="js"]`) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener('error', () => reject(new Error('Unable to load ArcGIS JavaScript API.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = ARCGIS_JS;
    script.async = true;
    script.dataset.mn25Arcgis = 'js';
    script.onload = finish;
    script.onerror = () => reject(new Error('Unable to load ArcGIS JavaScript API.'));
    document.body.appendChild(script);
  });

  return window.__mn25ArcgisPromise;
}

function selectionFromBounds(south: number, west: number, north: number, east: number): MapSelection {
  const centerLat = (south + north) / 2;
  const centerLng = (west + east) / 2;
  const latKm = Math.max(0, (north - south) * 111.32);
  const lngKm = Math.max(0, (east - west) * 111.32 * Math.cos(centerLat * Math.PI / 180));
  return {
    south, west, north, east,
    centerLat: Number(centerLat.toFixed(5)),
    centerLng: Number(centerLng.toFixed(5)),
    areaKm2: Number((latKm * lngKm).toFixed(2)),
  };
}

export default function MineMap({
  zones,
  onSelect,
  layers,
  onLayersChange,
  selection,
  onAreaSelect,
  onScanArea,
}: {
  zones: Zone[];
  onSelect: (z: Zone) => void;
  layers: MapLayers;
  onLayersChange?: (l: MapLayers) => void;
  selection?: MapSelection | null;
  onAreaSelect?: (area: MapSelection | null) => void;
  onScanArea?: (area: MapSelection) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const viewRef = useRef<any>(null);
  const earthLayerRef = useRef<any>(null);
  const selectionLayerRef = useRef<any>(null);
  const arcRef = useRef<ArcObjects | null>(null);
  const dragHandlersRef = useRef<Array<{ remove: () => void }>>([]);
  const selectModeRef = useRef(false);
  const onAreaSelectRef = useRef(onAreaSelect);
  const onSelectRef = useRef(onSelect);
  const selectionRef = useRef(selection);
  const [ready, setReady] = useState(false);
  const [showLayers, setShowLayers] = useState(false);
  const [baseMode, setBaseMode] = useState<BaseMode>('satellite');
  const [selectMode, setSelectMode] = useState(false);
  const [miningFilter, setMiningFilter] = useState<MiningFilter>('all');
  const [selectedArea, setSelectedArea] = useState<MapSelection | null>(selection ?? null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [nearbyEnabled, setNearbyEnabled] = useState(false);
  const [nearbyRadius, setNearbyRadius] = useState(100);
  const [searchLocationLabel, setSearchLocationLabel] = useState<string | null>(null);
  const locationGraphicRef = useRef<any>(null);
  // Backend-sourced nearby manganese locations (Explore §B). Distance is
  // computed server-side via PostGIS ST_Distance, never re-derived here.
  const [nearbyResults, setNearbyResults] = useState<NearbyMiningArea[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState(false);

  useEffect(() => { onAreaSelectRef.current = onAreaSelect; }, [onAreaSelect]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { selectionRef.current = selection; }, [selection]);
  useEffect(() => { selectModeRef.current = selectMode; }, [selectMode]);

  useEffect(() => {
    let cancelled = false;
    let searchComplete: { remove: () => void } | null = null;
    let searchClear: { remove: () => void } | null = null;
    loadArcGIS().then(() => {
      if (cancelled || !container.current || !window.require) return;
      window.require([
        'esri/Map',
        'esri/views/SceneView',
        'esri/layers/GraphicsLayer',
        'esri/Graphic',
        'esri/geometry/Point',
        'esri/geometry/Polygon',
        'esri/Camera',
        'esri/widgets/Search',
        'esri/widgets/Home',
        'esri/symbols/SimpleMarkerSymbol',
        'esri/symbols/SimpleFillSymbol',
        'esri/symbols/SimpleLineSymbol',
      ], (Map: any, SceneView: any, GraphicsLayer: any, Graphic: any, Point: any, Polygon: any, Camera: any, Search: any, Home: any, SimpleMarkerSymbol: any, SimpleFillSymbol: any, SimpleLineSymbol: any) => {
        if (cancelled || !container.current) return;
        const arc: ArcObjects = { Map, SceneView, GraphicsLayer, Graphic, Point, Polygon, Camera, Search, Home, SimpleMarkerSymbol, SimpleFillSymbol, SimpleLineSymbol };
        arcRef.current = arc;

        const earthLayer = new GraphicsLayer({ id: 'mn25-mining-intelligence', title: 'MN25 Mining Intelligence' });
        const selectionLayer = new GraphicsLayer({ id: 'mn25-analysis-selection', title: 'Analysis Region' });
        earthLayerRef.current = earthLayer;
        selectionLayerRef.current = selectionLayer;

        const map = new Map({
          basemap: 'satellite',
          ground: 'world-elevation',
          layers: [earthLayer, selectionLayer],
        });

        const view = new SceneView({
          container: container.current,
          map,
          qualityProfile: 'high',
          environment: {
            atmosphereEnabled: true,
            starsEnabled: true,
          },
          camera: new Camera({
            heading: 15,
            tilt: 48,
            position: {
              latitude: 21.45,
              longitude: 85.35,
              z: 1500000,
            },
          }),
          constraints: { snapToZoom: false },
        });
        viewRef.current = view;

        // Keep the same Google-Earth-clone interaction model: a real 3D SceneView,
        // world elevation, satellite globe imagery, search/home controls and a basemap toggle.
        const placeSearch = new Search({
          view,
          allPlaceholder: 'Search places…',
          includeDefaultSources: true,
        });
        view.ui.add(placeSearch, { position: 'top-right', index: 0 });
        view.ui.add(new Home({ view }), { position: 'top-right', index: 1 });

        searchComplete = placeSearch.on('search-complete', (event: any) => {
          const result = event?.results
            ?.flatMap((group: any) => group?.results ?? [])
            ?.find((item: any) => item?.feature?.geometry);

          const geometry = result?.feature?.geometry;
          const lat = Number(geometry?.latitude);
          const lng = Number(geometry?.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

          const label =
            result?.name ||
            result?.feature?.attributes?.Match_addr ||
            result?.feature?.attributes?.LongLabel ||
            'Selected location';

          setUserLocation({ lat, lng });
          setSearchLocationLabel(label);
          setNearbyEnabled(true);

          const a = arcRef.current;
          const viewNow = viewRef.current;
          if (a && viewNow) {
            viewNow.goTo(
              { target: new a.Point({ latitude: lat, longitude: lng }), zoom: 9 },
              { duration: 900 }
            );
          }
        });

        searchClear = placeSearch.on('search-clear', () => {
          setSearchLocationLabel(null);
          setNearbyEnabled(false);
          setUserLocation(null);
        });

        const handle = view.when(() => {
          if (cancelled) return;
          setReady(true);
          renderSelection(selectionRef.current);
        });

        function renderSelection(area: MapSelection | null | undefined) {
          const a = arcRef.current;
          const layer = selectionLayerRef.current;
          if (!a || !layer) return;
          layer.removeAll();
          if (!area) return;
          const rings = [[
            [area.west, area.south],
            [area.east, area.south],
            [area.east, area.north],
            [area.west, area.north],
            [area.west, area.south],
          ]];
          layer.add(new a.Graphic({
            geometry: new a.Polygon({ rings, spatialReference: { wkid: 4326 } }),
            symbol: new a.SimpleFillSymbol({ color: [210, 168, 106, 0.10], outline: new a.SimpleLineSymbol({ color: [210, 168, 106, 0.95], width: 2, style: 'dash' }) }),
          }));
        }

        const startPointRef = { value: null as { x: number; y: number } | null };
        const drag = view.on('drag', (event: any) => {
          if (!selectModeRef.current) return;
          event.stopPropagation();
          if (event.action === 'start') {
            startPointRef.value = { x: event.x, y: event.y };
          }
          if (event.action === 'update' && startPointRef.value) {
            drawPreview(startPointRef.value, { x: event.x, y: event.y });
          }
          if (event.action === 'end' && startPointRef.value) {
            const start = startPointRef.value;
            startPointRef.value = null;
            finishSelection(start, { x: event.x, y: event.y });
          }
        });
        dragHandlersRef.current.push(drag);

        function drawPreview(start: { x: number; y: number }, end: { x: number; y: number }) {
          const a = arcRef.current;
          const viewNow = viewRef.current;
          const layer = selectionLayerRef.current;
          if (!a || !viewNow || !layer) return;
          const p1 = viewNow.toMap({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) });
          const p2 = viewNow.toMap({ x: Math.max(start.x, end.x), y: Math.max(start.y, end.y) });
          if (!p1 || !p2) return;
          const south = Math.min(p1.latitude, p2.latitude);
          const north = Math.max(p1.latitude, p2.latitude);
          const west = Math.min(p1.longitude, p2.longitude);
          const east = Math.max(p1.longitude, p2.longitude);
          const area = selectionFromBounds(south, west, north, east);
          layer.removeAll();
          layer.add(new a.Graphic({
            geometry: new a.Polygon({ rings: [[
              [west, south], [east, south], [east, north], [west, north], [west, south],
            ]], spatialReference: { wkid: 4326 } }),
            symbol: new a.SimpleFillSymbol({ color: [210, 168, 106, 0.12], outline: new a.SimpleLineSymbol({ color: [210, 168, 106, 1], width: 2, style: 'dash' }) }),
          }));
          setSelectedArea(area);
        }

        function finishSelection(start: { x: number; y: number }, end: { x: number; y: number }) {
          const a = arcRef.current;
          const viewNow = viewRef.current;
          if (!a || !viewNow) return;
          const p1 = viewNow.toMap({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) });
          const p2 = viewNow.toMap({ x: Math.max(start.x, end.x), y: Math.max(start.y, end.y) });
          if (!p1 || !p2) return;
          const area = selectionFromBounds(Math.min(p1.latitude, p2.latitude), Math.min(p1.longitude, p2.longitude), Math.max(p1.latitude, p2.latitude), Math.max(p1.longitude, p2.longitude));
          setSelectedArea(area);
          selectionRef.current = area;
          onAreaSelectRef.current?.(area);
          renderSelection(area);
        }

        handle?.catch?.(() => setReady(false));
      });
    }).catch(() => setReady(false));

    return () => {
      cancelled = true;
      dragHandlersRef.current.forEach(h => h.remove());
      dragHandlersRef.current = [];
      searchComplete?.remove?.();
      searchClear?.remove?.();
      searchComplete = null;
      searchClear = null;
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
      earthLayerRef.current = null;
      selectionLayerRef.current = null;
      arcRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = viewRef.current?.map;
    if (!map) return;
    const basemap = baseMode === 'satellite' ? 'satellite' : baseMode === 'terrain' ? 'terrain' : 'topo-vector';
    map.basemap = basemap;
    onLayersChange?.({ ...layers, satellite: baseMode === 'satellite' });
  }, [baseMode]);

  useEffect(() => {
    const a = arcRef.current;
    const layer = earthLayerRef.current;
    if (!a || !layer || !ready) return;
    layer.removeAll();

    if (layers.boundary) {
      const rings = [[[83.0, 21.5], [83.3, 20.55], [84.8, 20.15], [87.0, 20.35], [87.1, 21.95], [86.0, 22.55], [84.75, 22.57], [83.0, 21.5]]];
      layer.add(new a.Graphic({
        geometry: new a.Polygon({ rings, spatialReference: { wkid: 4326 } }),
        symbol: new a.SimpleFillSymbol({ color: [185,179,168,0.02], outline: new a.SimpleLineSymbol({ color: [185,179,168,0.82], width: 1.5 }) }),
      }));
    }

    if (layers.zones) {
      zones.forEach(z => {
        const status = z.status.toLowerCase();
        const matches = miningFilter === 'all'
          || (miningFilter === 'available' && status.includes('available'))
          || (miningFilter === 'active' && status.includes('active'))
          || (miningFilter === 'monitoring' && status.includes('monitor'))
          || (miningFilter === 'restricted' && status.includes('restrict'));
        if (!matches) return;
        const c = zoneColor(z.prospectivity);
        const graphic = new a.Graphic({
          geometry: new a.Point({ latitude: z.lat, longitude: z.lng }),
          symbol: new a.SimpleMarkerSymbol({ style: 'circle', color: c, size: 22 + z.prospectivity / 7, outline: { color: [244,238,229,0.95], width: 1.4 } }),
          attributes: { id: z.id, name: z.name, status: z.status, concentration: z.concentration },
          popupTemplate: { title: z.name, content: `${z.status} · ${z.concentration.toFixed(1)}% Mn` },
        });
        layer.add(graphic);
        graphic.popupTemplate = { title: z.name, content: `${z.status} · ${z.concentration.toFixed(1)}% Mn` };
      });
    }

    if (layers.geology) {
      const rings = [[[84.0,21.05],[84.7,21.42],[85.6,21.55],[86.2,22.1]]];
      layer.add(new a.Graphic({
        geometry: { type: 'polyline', paths: rings, spatialReference: { wkid: 4326 } },
        symbol: new a.SimpleLineSymbol({ color: [138,106,72,0.8], width: 2, style: 'dash' }),
      }));
    }

    if (layers.elevation) {
      [20, 40, 60].forEach((r, i) => {
        const points = Array.from({ length: 73 }, (_, n) => {
          const theta = (n / 72) * Math.PI * 2;
          return [85.4 + (r / 111.32) * Math.cos(theta), 21.5 + (r / 111.32) * Math.sin(theta)];
        });
        layer.add(new a.Graphic({
          geometry: { type: 'polyline', paths: [points], spatialReference: { wkid: 4326 } },
          symbol: new a.SimpleLineSymbol({ color: [58,63,69,0.45 - i * 0.08], width: 1 }),
        }));
      });
    }
    if (userLocation && arcRef.current?.Point) {
      const a = arcRef.current;
      const graphic = new a.Graphic({
        geometry: new a.Point({ latitude: userLocation.lat, longitude: userLocation.lng }),
        symbol: new a.SimpleMarkerSymbol({ style: 'circle', color: [203,163,106,1], size: 12, outline: { color: [255,255,255,1], width: 2 } }),
        attributes: { kind: 'user-location' },
        popupTemplate: { title: 'Your approximate location', content: 'Browser location permission was granted.' },
      });
      locationGraphicRef.current = graphic;
      layer.add(graphic);
    }
  }, [layers, zones, miningFilter, ready, userLocation]);

  useEffect(() => {
    const layer = earthLayerRef.current;
    const view = viewRef.current;
    if (!layer || !view || !ready) return;
    const handler = view.on('click', (event: any) => {
      if (selectModeRef.current) return;
      view.hitTest(event).then((response: any) => {
        const result = response.results?.find((r: any) => r.graphic?.attributes?.id);
        if (result?.graphic?.attributes?.id) {
          const zone = zones.find(z => z.id === result.graphic.attributes.id);
          if (zone) onSelectRef.current(zone);
        }
      });
    });
    return () => handler.remove();
  }, [zones, ready]);

  useEffect(() => {
    if (selection === undefined) return;
    setSelectedArea(selection ?? null);
    const layer = selectionLayerRef.current;
    const a = arcRef.current;
    if (!layer || !a || !ready) return;
    layer.removeAll();
    if (!selection) return;
    layer.add(new a.Graphic({
      geometry: new a.Polygon({ rings: [[
        [selection.west, selection.south], [selection.east, selection.south], [selection.east, selection.north], [selection.west, selection.north], [selection.west, selection.south],
      ]], spatialReference: { wkid: 4326 } }),
      symbol: new a.SimpleFillSymbol({ color: [210,168,106,0.1], outline: new a.SimpleLineSymbol({ color: [210,168,106,0.95], width: 2, style: 'dash' }) }),
    }));
  }, [selection, ready]);

  // Explore §B — fetch nearby mining areas from the backend (PostGIS
  // ST_DWithin/ST_Distance) instead of computing haversine distance against
  // the locally-loaded zones array.
  useEffect(() => {
    if (!nearbyEnabled || !userLocation) {
      setNearbyResults([]);
      setNearbyError(false);
      return;
    }
    let cancelled = false;
    setNearbyLoading(true);
    setNearbyError(false);
    getNearbyMiningAreas({ latitude: userLocation.lat, longitude: userLocation.lng, radiusKm: nearbyRadius, limit: 4 })
      .then(({ results }) => { if (!cancelled) setNearbyResults(results); })
      .catch(() => { if (!cancelled) { setNearbyResults([]); setNearbyError(true); } })
      .finally(() => { if (!cancelled) setNearbyLoading(false); });
    return () => { cancelled = true; };
  }, [nearbyEnabled, userLocation, nearbyRadius]);

  const filterLabel = useMemo(() => ({ all: 'All mining areas', available: 'Available', active: 'Active extraction', monitoring: 'Monitoring', restricted: 'Restricted' } as Record<MiningFilter, string>)[miningFilter], [miningFilter]);

  function toggle(key: keyof MapLayers) { onLayersChange?.({ ...layers, [key]: !layers[key] }); }
  function clearSelection() {
    selectionLayerRef.current?.removeAll();
    setSelectedArea(null);
    selectionRef.current = null;
    onAreaSelect?.(null);
  }
  function setMode(mode: BaseMode) { setBaseMode(mode); }
  function useMyLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const lat = coords.latitude;
        const lng = coords.longitude;
        setUserLocation({ lat, lng });
        const a = arcRef.current;
        const view = viewRef.current;
        if (!a || !view) return;
        locationGraphicRef.current?.remove?.();
        const graphic = new a.Graphic({
          geometry: new a.Point({ latitude: lat, longitude: lng }),
          symbol: new a.SimpleMarkerSymbol({ style: 'circle', color: [203,163,106,1], size: 12, outline: { color: [255,255,255,1], width: 2 } }),
          attributes: { kind: 'user-location' },
          popupTemplate: { title: 'Your approximate location', content: 'Browser location permission was granted. Nearby results are based on this point.' },
        });
        locationGraphicRef.current = graphic;
        earthLayerRef.current?.add(graphic);
        view.goTo({ target: new a.Point({ latitude: lat, longitude: lng }), zoom: 9 }, { duration: 900 });
      },
      () => setUserLocation(null),
      { enableHighAccuracy: false, maximumAge: 300000, timeout: 8000 },
    );
  }

  function resetView() {
    const view = viewRef.current;
    const a = arcRef.current;
    if (!view || !a) return;
    view.goTo(new a.Camera({ heading: 15, tilt: 48, position: { latitude: 21.45, longitude: 85.35, z: 1500000 } }), { duration: 900 });
  }
  function fullscreen() {
    container.current?.parentElement?.requestFullscreen?.();
  }


  return <div className={`map ${selectMode ? 'map-select-mode' : ''}`}>
    <div ref={container} className="map-canvas" />
    {!ready && <div className="map-loading">Initializing 3D Earth…</div>}

    <div className="map-mode-tabs" aria-label="Basemap mode">
      <button className={baseMode === 'map' ? 'active' : ''} onClick={() => setMode('map')}><MapIcon size={12}/> Physical</button>
      <button className={baseMode === 'satellite' ? 'active' : ''} onClick={() => setMode('satellite')}><Satellite size={12}/> Satellite</button>
      <button className={baseMode === 'terrain' ? 'active' : ''} onClick={() => setMode('terrain')}><Mountain size={12}/> Terrain</button>
    </div>

    <button
      className={`map-layer-toggle ${showLayers ? 'active' : ''}`}
      onClick={() => setShowLayers(v => !v)}
      aria-label={showLayers ? 'Hide map layers' : 'Show map layers'}
      title={showLayers ? 'Hide map layers' : 'Map layers'}
    >
      <Layers3 size={15} />
    </button>

    {showLayers && <div className="map-layer-panel">
      <div className="layer-title"><span>Map layers</span></div>
      <label><input type="checkbox" checked={layers.zones} onChange={() => toggle('zones')} /><span>AI prospectivity</span></label>
      <label><input type="checkbox" checked={layers.boundary} onChange={() => toggle('boundary')} /><span>State boundaries</span></label>
      <label><input type="checkbox" checked={layers.elevation} onChange={() => toggle('elevation')} /><span>Elevation (DEM)</span></label>
      <label><input type="checkbox" checked={layers.geology} onChange={() => toggle('geology')} /><span>Geological formations</span></label>
      <label><input type="checkbox" checked={layers.satellite} onChange={() => toggle('satellite')} /><span>Satellite imagery</span></label>
      <div className="map-layer-divider" />
      <span className="map-layer-caption">Mining availability</span>
      <select value={miningFilter} onChange={e => setMiningFilter(e.target.value as MiningFilter)} aria-label="Mining availability filter">
        <option value="all">{filterLabel}</option><option value="available">Available</option><option value="active">Active extraction</option><option value="monitoring">Monitoring</option><option value="restricted">Restricted</option>
      </select>
      <div className="map-layer-divider" />
      <span className="map-layer-caption">Nearby manganese</span>
      <button className={`map-nearby-button ${nearbyEnabled ? 'active' : ''}`} onClick={() => setNearbyEnabled(v => !v)}>
        <LocateFixed size={11}/> {nearbyEnabled ? 'Showing nearby results' : 'Find nearby'}
      </button>
      {nearbyEnabled && <select value={nearbyRadius} onChange={e => setNearbyRadius(Number(e.target.value))} aria-label="Nearby radius">
        {[25,50,100,250,500].map(r => <option key={r} value={r}>{r} km radius</option>)}
      </select>}
      {nearbyEnabled && !userLocation && <span className="map-location-note">Use the location button to search around your current position.</span>}
    </div>}

    <div className="map-controls">
      <button className={`icon-btn ${selectMode ? 'selected' : ''}`} title="Select an area for AI scan" onClick={() => setSelectMode(v => { const next = !v; selectModeRef.current = next; return next; })}><SquareDashedMousePointer size={14}/></button>
      <button className="icon-btn" title="Zoom in" onClick={() => viewRef.current?.goTo({ zoom: Math.min((viewRef.current.zoom ?? 7) + 1, 18) })}><Plus size={14}/></button>
      <button className="icon-btn" title="Zoom out" onClick={() => viewRef.current?.goTo({ zoom: Math.max((viewRef.current.zoom ?? 7) - 1, 1) })}><Minus size={14}/></button>
      <button className="icon-btn" title="Use my location" onClick={useMyLocation}><LocateFixed size={14}/></button>
      <button className="icon-btn" title="Reset Earth view" onClick={resetView}><Crosshair size={14}/></button>
      <button className="icon-btn" title="Fullscreen" onClick={fullscreen}><Maximize size={14}/></button>
    </div>

    {selectMode && <div className="map-selection-hint"><MousePointer2 size={13}/> Drag across the 3D Earth to crop a region for manganese detection</div>}
    {selectedArea && <div className="map-selection-card">
      <div><b>Selected region</b><span>{selectedArea.centerLat.toFixed(4)}° N, {selectedArea.centerLng.toFixed(4)}° E · {selectedArea.areaKm2.toLocaleString()} km²</span></div>
      <div className="map-selection-actions"><button className="icon-btn" onClick={clearSelection} title="Clear selection">×</button>{onScanArea && <button className="btn map-scan-button" onClick={() => onScanArea(selectedArea)}><ScanLine size={13}/> Scan with AI</button>}</div>
    </div>}

    {nearbyEnabled && userLocation && <div className="map-nearby-results">
      <div className="nearby-head">
        <b>{searchLocationLabel ? `Mining areas near ${searchLocationLabel}` : 'Nearby manganese'}</b>
        <span>{nearbyLoading ? 'Searching…' : `${nearbyResults.length} in ${nearbyRadius} km`}</span>
      </div>
      {nearbyLoading ? <span className="map-location-note">Searching documented records…</span> : nearbyError ? (
        <span className="map-location-note">Nearby lookup is unavailable right now.</span>
      ) : nearbyResults.length ? nearbyResults.map(result => <button key={result.id} onClick={() => {
        const zone = zones.find(z => z.id === result.id);
        if (zone) onSelectRef.current(zone);
        const a = arcRef.current;
        const view = viewRef.current;
        if (a && view) view.goTo({ target: new a.Point({ latitude: result.latitude, longitude: result.longitude }), zoom: 10 }, { duration: 700 });
      }}>
        <span><b>{result.name}</b><small>{result.region} · {result.commodity} · {result.status}</small></span><em>{Math.round(result.distanceKm)} km</em>
      </button>) : <span className="map-location-note">No documented manganese locations found within this radius.</span>}
    </div>}
    <div className="map-coordinate">⌾ &nbsp;{(userLocation?.lat ?? 21.4532).toFixed(4)}° N, {(userLocation?.lng ?? 85.7214).toFixed(4)}° E</div>
    <div className="map-scale"><span>0</span><span>50</span><span>100</span><span>200 km</span></div>
    <div className="map-legend"><b>AI-predicted Mn concentration · demo</b><div className="gradient"/><div><span>&lt; 1%</span><span>1 – 3%</span><span>3 – 5%</span><span>&gt; 5%</span></div></div>
  </div>;
}
