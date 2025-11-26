import React, { useMemo, useState, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { Layers } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';

const WMTS_PREVIEW_COORDS = { z: 12, x: 2072, y: 1475 };
const IGN_ATTRIBUTION = '© IGN / Geoportail';

function createIgnTileTemplate(layerName, format = 'image/png') {
  const encodedFormat = encodeURIComponent(format);
  const encodedLayer = encodeURIComponent(layerName);
  return `https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=${encodedLayer}&STYLE=normal&FORMAT=${encodedFormat}&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
}

function createTilePreviewUrl(template, coords = WMTS_PREVIEW_COORDS) {
  if (typeof template !== 'string' || !template.length) {
    return null;
  }
  const replacements = [
    { token: /\{z\}/gi, value: coords?.z ?? WMTS_PREVIEW_COORDS.z },
    { token: /\{x\}/gi, value: coords?.x ?? WMTS_PREVIEW_COORDS.x },
    { token: /\{y\}/gi, value: coords?.y ?? WMTS_PREVIEW_COORDS.y }
  ];
  return replacements.reduce((acc, entry) => acc.replace(entry.token, entry.value), template);
}

const OVERLAY_LAYERS = [
  {
    id: 'ign-orthophotos',
    label: 'Satellite',
    sourceId: 'ign-orthophotos',
    layerId: 'ign-orthophotos',
    tileTemplate: createIgnTileTemplate('ORTHOIMAGERY.ORTHOPHOTOS.BDORTHO', 'image/jpeg'),
    tileSize: 256,
    attribution: IGN_ATTRIBUTION,
    defaultVisible: false,
    defaultOpacity: 0.6,
  },
  {
    id: 'ign-forest-inventory',
    label: 'Forêt',
    sourceId: 'ign-forest-inventory',
    layerId: 'ign-forest-inventory',
    tileTemplate: createIgnTileTemplate('LANDCOVER.FORESTINVENTORY.V2', 'image/png'),
    tileSize: 256,
    attribution: IGN_ATTRIBUTION,
    defaultVisible: false,
    defaultOpacity: 0.5,
  },
  {
    id: 'ign-opentopo',
    label: 'OpenTopo',
    sourceId: 'ign-opentopo',
    layerId: 'ign-opentopo',
    tileTemplate: createIgnTileTemplate('GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOPO', 'image/jpeg'),
    tileSize: 256,
    attribution: IGN_ATTRIBUTION,
    defaultVisible: false,
    defaultOpacity: 0.8,
  },
  {
    id: 'ign-cosia',
    label: 'AI Ground — COSIA 2021-2023',
    sourceId: 'ign-cosia',
    layerId: 'ign-cosia',
    tileTemplate: createIgnTileTemplate('IGNF_COSIA_2021-2023', 'image/png'),
    tileSize: 256,
    attribution: IGN_ATTRIBUTION,
    defaultVisible: true,
    alwaysOn: true,
    defaultOpacity: 0.35,
  },
];

const GeoFilterMap = ({
  refuges,
  onBoundsChange,
  activeBounds,
  useMapFilter,
  onToggleMapFilter,
  onResetBounds,
  compact = false,
  title = 'Filtre geographique',
  subtitle = 'La liste se met a jour automatiquement en fonction du cadre de carte.',
  onExpand,
  showControls = true,
  initialView = { center: [6.4, 45.2], zoom: 6 },
  onViewChange = () => { },
  onSelectMarker,
  hoveredRefugeId = null,
  selectedMassif = null,
  selectedMassifPolygon = null,
  likedRefugeIds = [],
  starredRefugeIds = [],
  dislikedRefugeIds = [],
}) => {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const markersRef = useRef(new Map());
  const thumbCacheRef = useRef(new Map());
  const syncRequestRef = useRef(() => { });
  const latestDataRef = useRef([]);
  const [liveBounds, setLiveBounds] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const fitHash = useRef('');
  const userMovedRef = useRef(false);
  const hoveredMarkerRef = useRef(null);
  const hoveredIdRef = useRef(null);
  const [overlayVisibility, setOverlayVisibility] = useState(() =>
    OVERLAY_LAYERS.reduce((acc, layer) => {
      if (!layer.alwaysOn) {
        acc[layer.id] = !!layer.defaultVisible;
      }
      return acc;
    }, {})
  );
  const [showLayerMenu, setShowLayerMenu] = useState(false);

  const layerPreviews = useMemo(
    () => Object.fromEntries(OVERLAY_LAYERS.map((layer) => [layer.id, createTilePreviewUrl(layer.tileTemplate)])),
    []
  );

  // --- Hover Logic ---
  const hoverPreviewRef = useRef(null);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const hoverShownRef = useRef(false);

  const updateHoverPos = () => {
    if (!hoverShownRef.current || !hoverPreviewRef.current) return;
    hoverPreviewRef.current.style.left = lastMouseRef.current.x + 'px';
    hoverPreviewRef.current.style.top = lastMouseRef.current.y + 'px';
  };

  const showHover = (url, title) => {
    if (!hoverPreviewRef.current) return;
    hoverPreviewRef.current.innerHTML = '';

    if (title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'hover-title';
      titleEl.textContent = title;
      hoverPreviewRef.current.appendChild(titleEl);
    }

    if (url) {
      const img = document.createElement('img');
      img.referrerPolicy = 'no-referrer';
      img.src = url;
      hoverPreviewRef.current.appendChild(img);
    }

    hoverPreviewRef.current.classList.add('open');
    hoverShownRef.current = true;
    updateHoverPos();
  };

  const hideHover = () => {
    if (!hoverPreviewRef.current) return;
    hoverPreviewRef.current.classList.remove('open');
    hoverShownRef.current = false;
  };

  const geoFeatures = useMemo(
    () =>
      refuges
        .map((r) => {
          const coords = r.geometry?.coordinates;
          if (!coords || coords.length < 2) return null;
          const rid = r.properties?.id;
          return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: coords },
            properties: {
              ...r.properties,
              __isLiked: likedRefugeIds.includes(rid),
              __isStarred: starredRefugeIds.includes(rid),
              __isDisliked: dislikedRefugeIds.includes(rid),
            },
          };
        })
        .filter(Boolean),
    [refuges, likedRefugeIds, starredRefugeIds, dislikedRefugeIds]
  );

  const reset = () => onResetBounds();

  // Initialize maplibre
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/standard.json',
      center: initialView?.center || [6.4, 45.2],
      zoom: initialView?.zoom ?? (compact ? 5.5 : 6),
      pitch: 0,
      bearing: 0,
      renderWorldCopies: false,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    if (!compact) {
      map.addControl(new maplibregl.NavigationControl(), 'top-right');
    }

    // PRIORITY: Load markers first (immediately on style load)
    map.on('load', () => {
      // Add refuges source and layers FIRST
      map.addSource('refuges', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterRadius: 60,
        clusterMaxZoom: 16,
      });

      map.addLayer({
        id: 'ml-refuges-clusters',
        type: 'circle',
        source: 'refuges',
        filter: ['has', 'point_count'],
        paint: { 'circle-opacity': 0, 'circle-radius': 1 },
      });

      map.addLayer({
        id: 'ml-refuges-counts',
        type: 'symbol',
        source: 'refuges',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 12,
        },
        paint: {
          'text-opacity': 0,
        },
      });

      map.addLayer({
        id: 'ml-refuges-points',
        type: 'circle',
        source: 'refuges',
        filter: ['!', ['has', 'point_count']],
        paint: { 'circle-opacity': 0, 'circle-radius': 1 },
      });

      // Trigger initial sync
      syncRequestRef.current?.(true);
      setMapReady(true);
    });

    // SECONDARY: Load hillshade after markers are ready (no terrain to keep map flat)
    if (!compact) {
      map.once('idle', () => {
        setTimeout(() => {
          if (!map.getSource('hillshade')) {
            map.addSource('hillshade', {
              type: 'raster-dem',
              url: 'https://tiles.mapterhorn.com/tilejson.json',
              tileSize: 256,
            });

            map.addLayer({
              id: 'hillshade-layer',
              type: 'hillshade',
              source: 'hillshade',
              paint: {
                'hillshade-exaggeration': 0.3,
                'hillshade-shadow-color': '#000000',
              },
            });
          }
        }, 100);
      });
    }
    mapRef.current = map;

    const handleMoveEnd = () => {
      const b = map.getBounds();
      const bounds = { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
      setLiveBounds(bounds);
      const c = map.getCenter();
      onViewChange({ center: [c.lng, c.lat], zoom: map.getZoom() });
    };

    let syncTimeout;
    const requestSync = (immediate) => {
      if (syncTimeout) clearTimeout(syncTimeout);
      if (immediate) {
        syncMarkers();
      } else {
        syncTimeout = setTimeout(syncMarkers, 50);
      }
    };
    syncRequestRef.current = requestSync;

    const syncMarkers = () => {
      if (!map.getLayer('ml-refuges-clusters') || !map.getLayer('ml-refuges-points')) return;
      const features = map.queryRenderedFeatures({ layers: ['ml-refuges-clusters', 'ml-refuges-points'] });
      const nextMarkers = new Set();

      const handleSelectMarker = (id) => {
        if (!onSelectMarker) return;
        const feature = latestDataRef.current.find((f) => f.properties.id === id);
        if (feature) onSelectMarker(feature);
      };

      features.forEach((f) => {
        const isCluster = !!f.properties.cluster_id;
        const id = isCluster ? `c-${f.properties.cluster_id}` : `p-${f.properties.id || f.id}`;
        nextMarkers.add(id);

        if (!markersRef.current.has(id)) {
          const marker = isCluster
            ? createRefugeCluster(f, map, thumbCacheRef.current, hoveredIdRef, hoveredMarkerRef)
            : createRefugeMarker(f, map, handleSelectMarker, { showHover, hideHover, lastMouseRef, updateHoverPos, compact });
          marker.addTo(map);
          markersRef.current.set(id, marker);
        } else {
          markersRef.current.get(id).setLngLat(f.geometry.coordinates);
        }
      });

      for (const [id, marker] of markersRef.current) {
        if (!nextMarkers.has(id)) {
          marker.remove();
          markersRef.current.delete(id);
        }
      }
    };

    map.on('moveend', handleMoveEnd);
    map.on('move', () => requestSync(false));
    map.on('zoom', () => requestSync(false));
    map.on('idle', () => requestSync(true));
    map.on('dragstart', () => { userMovedRef.current = true; });
    map.on('zoomstart', () => { userMovedRef.current = true; });

    // cleanup
    return () => {
      if (syncTimeout) clearTimeout(syncTimeout);
      syncRequestRef.current = () => { };
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      setMapReady(false);
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact]);

  // Update data when refuges change
  useEffect(() => {
    if (!mapReady) return;
    latestDataRef.current = geoFeatures;
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource('refuges');
    if (!source) return;

    source.setData({ type: 'FeatureCollection', features: geoFeatures });

    // Fit to results (avoid spamming by hashing length + first coords)
    if (geoFeatures.length && !userMovedRef.current) {
      const first = geoFeatures[0].geometry.coordinates.join(',');
      const hash = `${geoFeatures.length}-${first}`;
      if (hash !== fitHash.current) {
        fitHash.current = hash;
        const bounds = geoFeatures.reduce(
          (acc, f) => {
            const [lon, lat] = f.geometry.coordinates;
            acc.west = Math.min(acc.west, lon);
            acc.east = Math.max(acc.east, lon);
            acc.south = Math.min(acc.south, lat);
            acc.north = Math.max(acc.north, lat);
            return acc;
          },
          { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity }
        );
        if (isFinite(bounds.west)) {
          map.fitBounds(
            [
              [bounds.west, bounds.south],
              [bounds.east, bounds.north],
            ],
            { padding: 30, maxZoom: 12, duration: 0 }
          );
        }
      }
    }

    // Re-sync markers
    syncRequestRef.current(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoFeatures, mapReady]);

  useEffect(() => {
    if (liveBounds) onBoundsChange(liveBounds);
  }, [liveBounds, onBoundsChange]);

  useEffect(() => {
    if (!useMapFilter && !activeBounds) {
      userMovedRef.current = false;
    }
  }, [useMapFilter, activeBounds]);

  useEffect(() => {
    hoveredIdRef.current = hoveredRefugeId ? String(hoveredRefugeId) : null;
  }, [hoveredRefugeId]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    OVERLAY_LAYERS.forEach((layer) => {
      if (!map.getSource(layer.sourceId)) {
        map.addSource(layer.sourceId, {
          type: 'raster',
          tiles: [layer.tileTemplate],
          tileSize: layer.tileSize || 256,
          attribution: layer.attribution,
        });
      }

      if (!map.getLayer(layer.layerId)) {
        const firstLayerId = map.getStyle()?.layers?.[0]?.id;
        map.addLayer(
          {
            id: layer.layerId,
            type: 'raster',
            source: layer.sourceId,
            paint: { 'raster-opacity': layer.defaultOpacity ?? 1 },
          },
          firstLayerId || 'ml-refuges-clusters'
        );
      }

      const isVisible = layer.alwaysOn || overlayVisibility[layer.id];
      map.setLayoutProperty(layer.layerId, 'visibility', isVisible ? 'visible' : 'none');
    });
  }, [mapReady, overlayVisibility]);

  const toggleOverlayLayer = (layerId) => {
    const layer = OVERLAY_LAYERS.find((l) => l.id === layerId);
    if (layer?.alwaysOn) return;
    setOverlayVisibility((prev) => ({ ...prev, [layerId]: !prev[layerId] }));
  };

  useEffect(() => {
    if (!mapReady) return;

    if (hoveredMarkerRef.current?.getElement) {
      hoveredMarkerRef.current.getElement().classList.remove('hovered');
    }

    if (!hoveredRefugeId) {
      hoveredMarkerRef.current = null;
      return;
    }

    const hoveredId = String(hoveredRefugeId);
    for (const marker of markersRef.current.values()) {
      const el = marker.getElement?.();
      if (!el) continue;

      const matchesPoint = marker.__refugeId && String(marker.__refugeId) === hoveredId;
      const matchesCluster = marker.__leafIds && marker.__leafIds.has(hoveredId);

      if (matchesPoint || matchesCluster) {
        el.classList.add('hovered');
        hoveredMarkerRef.current = marker;
        break;
      }
    }
  }, [hoveredRefugeId, mapReady]);

  // Watch for initialView changes (e.g., from search) and update map
  useEffect(() => {
    if (!mapRef.current || !initialView) return;

    const map = mapRef.current;
    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();

    // Check if view has changed significantly (avoid infinite loops)
    const centerChanged =
      Math.abs(currentCenter.lng - initialView.center[0]) > 0.01 ||
      Math.abs(currentCenter.lat - initialView.center[1]) > 0.01;
    const zoomChanged = Math.abs(currentZoom - initialView.zoom) > 0.5;

    if (centerChanged || zoomChanged) {
      map.flyTo({
        center: initialView.center,
        zoom: initialView.zoom,
        duration: 1500,
      });
    }
  }, [initialView]);

  // Display selected massif polygon
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    // Remove existing massif layer and source if any
    if (map.getLayer('massif-polygon-fill')) {
      map.removeLayer('massif-polygon-fill');
    }
    if (map.getLayer('massif-polygon-outline')) {
      map.removeLayer('massif-polygon-outline');
    }
    if (map.getSource('massif-polygon')) {
      map.removeSource('massif-polygon');
    }

    // Add new massif polygon if selected
    if (selectedMassif && selectedMassifPolygon) {
      const polygon = selectedMassifPolygon;
      if (polygon) {
        try {
          map.addSource('massif-polygon', {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: polygon
            }
          });

          map.addLayer({
            id: 'massif-polygon-fill',
            type: 'fill',
            source: 'massif-polygon',
            paint: {
              'fill-color': '#2e7d32',
              'fill-opacity': 0.1
            }
          });

          map.addLayer({
            id: 'massif-polygon-outline',
            type: 'line',
            source: 'massif-polygon',
            paint: {
              'line-color': '#2e7d32',
              'line-width': 2,
              'line-opacity': 0.6
            }
          });

          // Fit map to polygon bounds - calculate bbox manually
          let allCoords = [];
          if (polygon.type === 'MultiPolygon') {
            polygon.coordinates.forEach(poly => {
              poly.forEach(ring => {
                allCoords = allCoords.concat(ring);
              });
            });
          } else if (polygon.type === 'Polygon') {
            polygon.coordinates.forEach(ring => {
              allCoords = allCoords.concat(ring);
            });
          }

          if (allCoords.length > 0) {
            const lngs = allCoords.map(coord => coord[0]);
            const lats = allCoords.map(coord => coord[1]);

            const bbox = [
              Math.min(...lngs),
              Math.min(...lats),
              Math.max(...lngs),
              Math.max(...lats)
            ];

            map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
              padding: 20,
              duration: 1000
            });
          }
        } catch (error) {
          console.error('Error adding massif polygon:', error);
        }
      }
    }
  }, [selectedMassif]);


  return (
    <div className="glass-panel" style={{
      padding: '0',
      background: 'transparent',
      width: '100%',
      height: compact ? 'auto' : '100%',
      display: 'flex',
      flexDirection: 'column',
      border: 'none',
      boxShadow: 'none'
    }}>


      <div className="map-shell" style={{ width: '100%', flex: 1, display: 'flex', flexDirection: 'column' }} onWheel={(e) => e.stopPropagation()}>
        <div
          ref={containerRef}
          className="maplibre-container"
          style={{ height: compact ? '200px' : '100%', width: '100%', flex: compact ? 'none' : 1, minHeight: compact ? 'auto' : '360px' }}
        />
        <div className={`map-layer-controls ${compact ? 'compact' : ''}`} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <button
            className="map-layer-toggle-button"
            aria-label="Basculer le menu des fonds"
            aria-expanded={showLayerMenu}
            onClick={() => setShowLayerMenu((open) => !open)}
          >
            <Layers size={18} />
          </button>
          {showLayerMenu && (
            <div className={`map-layer-menu ${compact ? 'compact' : ''}`}>
              <div className="map-layer-menu-title">Fonds supplémentaires</div>
              <div className="map-layer-menu-list">
                {OVERLAY_LAYERS.filter((layer) => !layer.alwaysOn).map((layer) => (
                  <label key={layer.id} className="map-layer-toggle">
                    <input
                      type="checkbox"
                      checked={!!overlayVisibility[layer.id]}
                      onChange={() => toggleOverlayLayer(layer.id)}
                    />
                    <div className="map-layer-toggle-info">
                      <span className="map-layer-name">{layer.label}</span>
                      {layerPreviews[layer.id] && (
                        <span
                          className="map-layer-preview"
                          style={{ backgroundImage: `url(${layerPreviews[layer.id]})` }}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <div id="hoverPreview" ref={hoverPreviewRef}></div>
      </div>
    </div>
  );
};

export default GeoFilterMap;

// --- Marker helpers ---
const REFUGE_ICON =
  'data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\" fill=\"none\" stroke=\"%23ffffff\" stroke-width=\"3\"><path fill=\"%232e7d32\" d=\"M8 30L32 12l24 18v20a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z\"/><path d=\"M24 52V34a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v18\"/><path d=\"M12 32l20-15 20 15\"/></svg>';

const STAR_ICON =
  'data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"%23fbbf24\" stroke=\"%23fbbf24\" stroke-width=\"1.5\"><path d=\"M12 2.5l2.9 6 6.6.9-4.8 4.7 1.1 6.6L12 17.7l-5.8 3.1 1.1-6.6L2.5 9.4l6.6-.9z\"/></svg>';

const HEART_ICON =
  'data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"%23ef4444\" stroke=\"%23ef4444\" stroke-width=\"1.5\"><path d=\"M12 21s-7.2-4.2-9.5-9C.7 8 .9 4.7 3.4 3c2.9-2 6.1-.4 8.6 2.2C14.5 2.6 17.7 1 20.6 3c2.5 1.7 2.7 5 .9 9-2.3 4.8-9.5 9-9.5 9z\"/></svg>';

const BAN_ICON =
  'data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"%23ef4444\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M6.5 6.5l11 11\"/></svg>';

function preloadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

function extractPhotos(p) {
  let photos = p.photos || p.photo || p.image;
  if (typeof photos === 'string') {
    try {
      photos = JSON.parse(photos);
    } catch (e) {
      // treat as single url if not json
      if (photos.startsWith('http')) photos = [photos];
      else photos = [];
    }
  }
  if (!Array.isArray(photos)) photos = [];
  return photos;
}

function getRefugePrimaryPhoto(p) {
  const photos = extractPhotos(p);
  if (photos.length) return photos[photos.length - 1]; // Use last photo
  return p.thumbnail || '';
}

function createStatusIcon(icon, type) {
  const badge = document.createElement('div');
  badge.className = `marker-status-icon ${type}`;
  badge.style.backgroundImage = `url('${icon}')`;
  return badge;
}

function createRefugeMarker(f, map, onSelect, hoverCtx, options = {}) {
  // console.log('createRefugeMarker', f.properties.nom, 'hoverCtx:', !!hoverCtx, 'compact:', hoverCtx?.compact);
  const p = f.properties || {};
  const el = document.createElement('div');
  el.className = 'marker-container';

  if (options.isSelected) {
    el.classList.add('hovered');
  }

  const hut = document.createElement('div');
  hut.className = 'hut-marker';

  el.dataset.refugeId = p.id;

  const status = (p.status || p.etat?.valeur || '').toLowerCase();
  if (status.includes('ferm') || status.includes('detru')) hut.classList.add('is-closed');

  const photo = getRefugePrimaryPhoto(p);
  if (photo) {
    hut.style.backgroundImage = `url('${photo}')`;
    hut.style.backgroundSize = 'cover';
    hut.style.backgroundPosition = 'center';
  } else {
    const icon = document.createElement('img');
    icon.className = 'icon';
    icon.src = REFUGE_ICON;
    hut.appendChild(icon);
  }

  el.appendChild(hut);

  const statusBar = document.createElement('div');
  statusBar.className = 'marker-status-bar';

  if (p.__isStarred) statusBar.appendChild(createStatusIcon(STAR_ICON, 'star'));
  if (p.__isLiked) statusBar.appendChild(createStatusIcon(HEART_ICON, 'like'));
  if (p.__isDisliked) statusBar.appendChild(createStatusIcon(BAN_ICON, 'ban'));

  if (statusBar.childNodes.length) {
    el.appendChild(statusBar);
  }

  // Hover events (only if not compact and hoverCtx provided)
  if (hoverCtx && !hoverCtx.compact) {
    const { showHover, hideHover, lastMouseRef, updateHoverPos } = hoverCtx;

    el.addEventListener('mouseenter', (e) => {
      const mapRect = map.getContainer().getBoundingClientRect();
      lastMouseRef.current.x = e.clientX - mapRect.left;
      lastMouseRef.current.y = e.clientY - mapRect.top;
      showHover(photo, p.nom);
    });

    el.addEventListener('mousemove', (e) => {
      const mapRect = map.getContainer().getBoundingClientRect();
      lastMouseRef.current.x = e.clientX - mapRect.left;
      lastMouseRef.current.y = e.clientY - mapRect.top;
      updateHoverPos();
    });

    el.addEventListener('mouseleave', hideHover);
  }

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    // If we have an onSelect handler (for full screen), call it.
    // Otherwise fall back to zoom behavior (for mini map).
    if (onSelect && hoverCtx && !hoverCtx.compact) {
      onSelect(p.id);
    }

    map.easeTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 11) });
  });

  const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(f.geometry.coordinates);
  marker.__refugeId = p.id;
  return marker;
}

function createRefugeCluster(f, map, thumbCache, hoveredIdRef, hoveredMarkerRef) {
  const cid = f.properties.cluster_id;
  const count = f.properties.point_count;
  const el = document.createElement('div');
  el.className = 'marker-container';

  const box = document.createElement('div');
  box.className = 'cluster-hut';
  const span = document.createElement('span');
  span.textContent = count;
  box.appendChild(span);
  el.appendChild(box);

  const cacheKey = `refuges:${cid}`;
  const cached = thumbCache.get(cacheKey);
  const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(f.geometry.coordinates);
  marker.__leafIds = new Set();
  marker.__clusterId = cid;

  const assignLeaves = (leaves) => {
    marker.__leafIds = new Set(leaves.map((l) => String(l.properties?.id ?? l.id)));
    if (hoveredIdRef?.current && marker.__leafIds.has(String(hoveredIdRef.current))) {
      const markerEl = marker.getElement?.();
      if (markerEl) {
        markerEl.classList.add('hovered');
        if (hoveredMarkerRef) hoveredMarkerRef.current = marker;
      }
    }
  };

  const setFallback = () => {
    box.classList.add('no-photo');
    box.style.backgroundImage = `url('${REFUGE_ICON}')`;
  };

  const setImage = (url) => {
    box.classList.remove('no-photo');
    box.style.backgroundImage = `url('${url}')`;
    box.style.backgroundSize = 'cover';
    box.style.backgroundPosition = 'center';
  };

  const source = map.getSource('refuges');
  const leafCount = count || 10;

  if (cached) {
    setImage(cached);
    if (source && source.getClusterLeaves) {
      source.getClusterLeaves(cid, leafCount, 0).then(assignLeaves).catch(() => { });
    }
  } else if (source && source.getClusterLeaves) {
    source
      .getClusterLeaves(cid, leafCount, 0)
      .then((leaves) => {
        assignLeaves(leaves);
        const leaf = leaves.find((l) => getRefugePrimaryPhoto(l.properties));
        if (leaf) {
          const url = getRefugePrimaryPhoto(leaf.properties);
          if (url) {
            preloadImage(url).then((ok) => {
              if (ok) {
                thumbCache.set(cacheKey, url);
                setImage(url);
              } else {
                setFallback();
              }
            });
          } else {
            setFallback();
          }
        } else {
          setFallback();
        }
      })
      .catch(setFallback);
  }

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    map.easeTo({ center: f.geometry.coordinates, zoom: map.getZoom() + 1.5 });
  });

  return marker;
}

export { createRefugeMarker };
