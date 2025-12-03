import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MapPin, Droplets, Flame, Bed, ExternalLink, TreePine, Tent, MessageSquare, ChevronLeft, ChevronRight, Star, Heart, Ban, Layers } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { applyOverlayLayers, createRefugeMarker, OVERLAY_LAYERS } from './GeoFilterMap';

const CDN_THREE_URL = 'https://esm.sh/three@0.169.0';
const CDN_GLTF_URL = 'https://esm.sh/three@0.169.0/examples/jsm/loaders/GLTFLoader.js';

let threeStackPromise;
const loadThreeStack = async () => {
  if (threeStackPromise) return threeStackPromise;

  threeStackPromise = (async () => {
    if (window.THREE?.GLTFLoader) {
      return { THREE: window.THREE, GLTFLoader: window.THREE.GLTFLoader, isFallback: false };
    }

    try {
      const [three, loaderModule] = await Promise.all([
        import(/* @vite-ignore */ CDN_THREE_URL),
        import(/* @vite-ignore */ CDN_GLTF_URL),
      ]);

      const THREE = three?.default ?? three;
      const GLTFLoader = loaderModule?.GLTFLoader ?? loaderModule?.default?.GLTFLoader ?? loaderModule?.default;

      return { THREE, GLTFLoader, isFallback: false };
    } catch (error) {
      console.error('Unable to load Three.js stack', error);

      try {
        const [{ default: THREE, GLTFLoader }] = await Promise.all([import('../utils/threeFallback.js')]);
        return { THREE, GLTFLoader, isFallback: true };
      } catch (fallbackError) {
        console.error('Unable to load fallback Three.js stack', fallbackError);
        return { THREE: null, GLTFLoader: null, isFallback: true };
      }
    }
  })();

  return threeStackPromise;
};

// ============================================================================
// ORBIT CAMERA CONTROLLER
// 
// Design:
// - Uses map.easeTo for intro (native, smooth, terrain-aware)
// - Seamlessly takes over with free camera at exact end position
// - Robust terrain sampling with fallbacks
// - Clean state management
// ============================================================================

class OrbitController {
  constructor(map, targetLngLat) {
    this.map = map;
    this.target = targetLngLat;
    this.disposed = false;
    
    // State
    this.phase = 'idle'; // 'idle' | 'intro' | 'orbit'
    this.bearing = 0;
    this.radius = 300;
    this.height = 200;
    this.groundElevation = 0;
    
    // Animation
    this.animationFrame = null;
    this.lastTimestamp = null;
    this.isPaused = false;
    
    // Config
    this.orbitSpeed = 10; // degrees per second
    this.minClearance = 100; // minimum altitude above terrain
    
    // Bind methods
    this.tick = this.tick.bind(this);
  }

  // ───────────────────────────────────────────────────────────────────────
  // TERRAIN
  // ───────────────────────────────────────────────────────────────────────

  queryElevation(lng, lat) {
    if (this.disposed || !this.map) return this.groundElevation;
    try {
      const elev = this.map.queryTerrainElevation(new maplibregl.LngLat(lng, lat));
      return (elev != null && !isNaN(elev)) ? elev : this.groundElevation;
    } catch {
      return this.groundElevation;
    }
  }

  async waitForTerrain(maxWait = 3000) {
    const start = Date.now();
    
    while (Date.now() - start < maxWait) {
      if (this.disposed) return false;
      
      const elev = this.queryElevation(this.target.lng, this.target.lat);
      if (elev > 0) {
        this.groundElevation = elev;
        return true;
      }
      
      await new Promise(r => setTimeout(r, 100));
    }
    
    // Fallback: use coord altitude if available
    this.groundElevation = 0;
    return false;
  }

  refreshGroundElevation() {
    const elev = this.queryElevation(this.target.lng, this.target.lat);
    if (elev > 0) {
      this.groundElevation = elev;
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // GEOMETRY
  // ───────────────────────────────────────────────────────────────────────

  toRad(deg) {
    return deg * Math.PI / 180;
  }

  radiusForZoom(zoom) {
    const base = 220;
    const r = base * Math.pow(1.5, 14 - zoom);
    return Math.max(80, Math.min(r, 2000));
  }

  heightForRadius(r) {
    return r * 0.6;
  }

  // ───────────────────────────────────────────────────────────────────────
  // CAMERA APPLICATION
  // ───────────────────────────────────────────────────────────────────────

  computeCameraPosition() {
    const bearingRad = this.toRad(this.bearing);
    
    // Meters to degrees
    const mPerDegLat = 111320;
    const mPerDegLng = mPerDegLat * Math.cos(this.toRad(this.target.lat));
    
    // Camera offset from target
    const dLng = (Math.sin(bearingRad) * this.radius) / mPerDegLng;
    const dLat = (Math.cos(bearingRad) * this.radius) / mPerDegLat;
    
    const camLng = this.target.lng + dLng;
    const camLat = this.target.lat + dLat;
    
    // Terrain at camera position
    const terrainAtCam = this.queryElevation(camLng, camLat);
    
    // Look-at point (slightly above ground for model)
    const lookAtZ = this.groundElevation + 10;
    
    // Camera altitude - always above terrain
    const desiredZ = this.groundElevation + this.height;
    const minZ = Math.max(terrainAtCam, this.groundElevation) + this.minClearance;
    const camZ = Math.max(desiredZ, minZ);
    
    return { camLng, camLat, camZ, lookAtZ };
  }

  applyFreeCamera() {
    if (this.disposed || !this.map) return;
    
    const { camLng, camLat, camZ, lookAtZ } = this.computeCameraPosition();
    
    try {
      const camPos = maplibregl.MercatorCoordinate.fromLngLat(
        { lng: camLng, lat: camLat },
        camZ
      );
      const lookAt = maplibregl.MercatorCoordinate.fromLngLat(
        this.target,
        lookAtZ
      );
      
      const camera = this.map.getFreeCameraOptions();
      camera.position = camPos;
      camera.lookAtPoint(lookAt);
      this.map.setFreeCameraOptions(camera);
    } catch (e) {
      console.warn('Camera apply failed:', e);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // ANIMATION LOOP
  // ───────────────────────────────────────────────────────────────────────

  tick(timestamp) {
    if (this.disposed || this.phase !== 'orbit') return;
    
    // Delta time
    if (this.lastTimestamp === null) this.lastTimestamp = timestamp;
    const dt = Math.min((timestamp - this.lastTimestamp) / 1000, 0.1);
    this.lastTimestamp = timestamp;
    
    // Occasionally refresh ground elevation
    if (Math.random() < 0.01) {
      this.refreshGroundElevation();
    }
    
    // Update radius from zoom
    const zoom = this.map.getZoom();
    const targetRadius = this.radiusForZoom(zoom);
    this.radius += (targetRadius - this.radius) * Math.min(dt * 2, 0.1);
    this.height = this.heightForRadius(this.radius);
    
    // Rotate if not paused
    if (!this.isPaused) {
      this.bearing = (this.bearing + this.orbitSpeed * dt) % 360;
    }
    
    // Apply camera
    this.applyFreeCamera();
    
    // Continue
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  // ───────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ───────────────────────────────────────────────────────────────────────

  async start() {
    if (this.disposed) return;
    
    this.phase = 'intro';
    
    // Wait for terrain data
    await this.waitForTerrain();
    if (this.disposed) return;
    
    // Get current map state as starting point
    const startBearing = this.map.getBearing();
    const startZoom = this.map.getZoom();
    
    // Calculate where we want to end up
    const endBearing = startBearing + 45; // Rotate 45 degrees during intro
    const endZoom = 14.5;
    const endPitch = 50;
    
    // Initialize orbit params
    this.bearing = endBearing;
    this.radius = this.radiusForZoom(endZoom);
    this.height = this.heightForRadius(this.radius);
    
    // Use map.easeTo for smooth intro with terrain handling
    this.map.easeTo({
      center: this.target,
      zoom: endZoom,
      pitch: endPitch,
      bearing: endBearing,
      duration: 3000,
      easing: (t) => {
        // Smooth ease-out curve
        return 1 - Math.pow(1 - t, 3);
      }
    });
    
    // When intro finishes, start orbit
    const onMoveEnd = () => {
      if (this.disposed) return;
      this.map.off('moveend', onMoveEnd);
      
      // Small delay to ensure everything settled
      setTimeout(() => {
        if (this.disposed) return;
        
        // Refresh terrain one more time
        this.refreshGroundElevation();
        
        // Get the actual bearing the map ended at
        this.bearing = this.map.getBearing();
        
        // Start orbit loop
        this.phase = 'orbit';
        this.lastTimestamp = null;
        this.animationFrame = requestAnimationFrame(this.tick);
      }, 50);
    };
    
    this.map.once('moveend', onMoveEnd);
  }

  pause() {
    this.isPaused = true;
  }

  resume() {
    this.isPaused = false;
    this.lastTimestamp = null; // Prevent jump
  }

  dispose() {
    this.disposed = true;
    this.phase = 'idle';
    
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }
}

// ============================================================================
// COMPONENT
// ============================================================================

const RefugeModal = ({ refuge, refuges = [], onClose, isStarred, onToggleStar, isLiked, onToggleLike, isDisliked, onToggleDislike, massif }) => {
  if (!refuge) return null;

  const { nom, coord, details, photos, remarks, places, lien, type, comments = [] } = refuge.properties;
  const overlayVisibilityDefaults = useMemo(
    () =>
      OVERLAY_LAYERS.reduce((acc, layer) => {
        if (!layer.alwaysOn) {
          acc[layer.id] = !!layer.defaultVisible;
        }
        return acc;
      }, {}),
    []
  );
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [overlayVisibility, setOverlayVisibility] = useState(() => ({ ...overlayVisibilityDefaults }));
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const miniMapContainerRef = useRef(null);
  const miniMapRef = useRef(null);
  const expandedMapRef = useRef(null);
  const expandedMapInstanceRef = useRef(null);
  const overlayVisibilityRef = useRef(overlayVisibilityDefaults);
  const orbitRef = useRef(null);

  const hasWater = details?.water && !details.water.toLowerCase().includes('non');
  const hasWood = details?.wood && !details.wood.toLowerCase().includes('non');
  const hasLatrines = details?.latrines && !details.latrines.toLowerCase().includes('non');
  const placeCount = places?.valeur ?? '?';
  const mainPhoto = photos && photos.length > 0 ? photos[photos.length - 1] : null;
  const massifBreadcrumb = massif ? [massif.properties?.nom].filter(Boolean) : ['Massif non identifié'];

  const openLightbox = (idx) => {
    if (!photos || !photos.length) return;
    setLightboxIndex(idx);
  };

  const closeLightbox = () => setLightboxIndex(null);
  const gotoPhoto = (delta) => {
    if (!photos || !photos.length) return;
    setLightboxIndex((idx) => {
      const next = (idx + delta + photos.length) % photos.length;
      return next;
    });
  };

  // Mini map
  useEffect(() => {
    if (!miniMapContainerRef.current) return;
    const coords = refuge.geometry?.coordinates;
    if (!coords || coords.length < 2) return;

    if (miniMapRef.current) {
      miniMapRef.current.remove();
      miniMapRef.current = null;
    }

    const map = new maplibregl.Map({
      container: miniMapContainerRef.current,
      style: 'https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/gris.json',
      center: coords,
      zoom: 12,
      interactive: false,
      attributionControl: false,
    });

    map.on('load', () => {
      new maplibregl.Marker({ color: '#f97316' }).setLngLat(coords).addTo(map);
    });

    miniMapRef.current = map;

    return () => {
      miniMapRef.current?.remove();
      miniMapRef.current = null;
    };
  }, [refuge]);

  // Expanded 3D map
  useEffect(() => {
    if (!mapExpanded || !expandedMapRef.current) return;

    let idleTimeout = null;
    let mapInstance = null;
    let isCleanedUp = false;

    const handleInteraction = () => {
      if (isCleanedUp) return;
      orbitRef.current?.pause();
      
      clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        if (!isCleanedUp) {
          orbitRef.current?.resume();
        }
      }, 3000);
    };

    const setup = async () => {
      const coords = refuge.geometry?.coordinates || [6.4, 45.2];
      const targetLocation = new maplibregl.LngLat(coords[0], coords[1]);

      // Create map starting from top-down view
      mapInstance = new maplibregl.Map({
        container: expandedMapRef.current,
        style: 'https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/gris.json',
        center: coords,
        zoom: 12,  // Start zoomed out
        pitch: 0,  // Start flat
        bearing: 0,
        attributionControl: true,
        minZoom: 11,
        maxZoom: 17,
        dragPan: false,
        dragRotate: true,
        keyboard: false,
        touchPitch: true,
        pitchWithRotate: true,
        boxZoom: false,
      });

      expandedMapInstanceRef.current = mapInstance;

      // Bounds constraint
      mapInstance.setMaxBounds([
        [targetLocation.lng - 0.05, targetLocation.lat - 0.05],
        [targetLocation.lng + 0.05, targetLocation.lat + 0.05]
      ]);

      // Interaction handlers
      const canvas = mapInstance.getCanvas();
      ['mousedown', 'wheel', 'touchstart'].forEach(evt => {
        canvas.addEventListener(evt, handleInteraction, { passive: true });
      });

      // Add other refuge markers
      (refuges || []).forEach((f) => {
        const pos = f.geometry?.coordinates;
        if (!pos || pos.length < 2) return;
        if (f.properties?.id === refuge.properties?.id) return;
        createRefugeMarker(f, mapInstance, undefined, { compact: true }, {}).addTo(mapInstance);
      });

      mapInstance.on('load', async () => {
        if (isCleanedUp) return;

        // Hillshade
        mapInstance.addSource('hillshade-src', {
          type: 'raster-dem',
          url: 'https://tiles.mapterhorn.com/tilejson.json',
          tileSize: 256,
        });
        mapInstance.addLayer({
          id: 'hillshade-layer',
          type: 'hillshade',
          source: 'hillshade-src',
          paint: { 'hillshade-exaggeration': 0.3 },
        });

        applyOverlayLayers(mapInstance, overlayVisibilityRef.current);

        // Terrain (required for elevation queries)
        mapInstance.addSource('terrain-src', {
          type: 'raster-dem',
          url: 'https://tiles.mapterhorn.com/tilejson.json',
          tileSize: 256,
        });
        mapInstance.setTerrain({ source: 'terrain-src', exaggeration: 1.0 });

        // Load 3D model
        try {
          const { THREE, GLTFLoader } = await loadThreeStack();
          if (isCleanedUp || !THREE || !GLTFLoader) {
            startOrbit();
            return;
          }

          const loader = new GLTFLoader();
          loader.setCrossOrigin('anonymous');

          const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}refuge_LP.glb`);
          const model = gltf?.scene;
          
          if (isCleanedUp) return;
          
          if (!model) {
            startOrbit();
            return;
          }

          // Fix materials
          model.traverse((child) => {
            if (!child.isMesh) return;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((m) => {
              if (!m) return;
              ['map', 'emissiveMap'].forEach((k) => {
                if (m[k]) m[k].colorSpace = THREE.SRGBColorSpace;
              });
              m.needsUpdate = true;
            });
          });

          // Center and scale
          const box = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z, 1);

          model.position.set(-center.x, -box.min.y, -center.z);
          model.scale.setScalar((30 * 5) / maxDim);

          // Orient based on terrain slope (wait a bit for terrain)
          setTimeout(() => {
            if (isCleanedUp || !mapInstance) return;
            
            const offset = 0.001;
            const getElev = (lng, lat) => {
              try {
                return mapInstance.queryTerrainElevation(new maplibregl.LngLat(lng, lat)) || 0;
              } catch { return 0; }
            };
            
            const eN = getElev(coords[0], coords[1] + offset);
            const eS = getElev(coords[0], coords[1] - offset);
            const eE = getElev(coords[0] + offset, coords[1]);
            const eW = getElev(coords[0] - offset, coords[1]);
            
            if (!(eN === 0 && eS === 0 && eE === 0 && eW === 0)) {
              const downhill = Math.atan2(-(eN - eS), -(eE - eW));
              model.rotation.y = downhill - Math.PI / 2;
            }
          }, 500);

          // Custom 3D layer
          const customLayer = {
            id: 'refuge-3d',
            type: 'custom',
            renderingMode: '3d',
            onAdd(map, gl) {
              this.camera = new THREE.Camera();
              this.scene = new THREE.Scene();
              this.scene.rotateX(Math.PI / 2);
              this.scene.scale.multiply(new THREE.Vector3(1, 1, -1));
              this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
              this.scene.add(model);

              this.renderer = new THREE.WebGLRenderer({
                canvas: map.getCanvas(),
                context: gl,
                antialias: true,
              });
              this.renderer.outputColorSpace = THREE.SRGBColorSpace;
              this.renderer.autoClear = false;
            },
            render(gl, args) {
              if (isCleanedUp || !mapInstance) return;
              
              try {
                const elev = mapInstance.queryTerrainElevation(targetLocation) || 0;
                const mc = maplibregl.MercatorCoordinate.fromLngLat(targetLocation, elev);

                const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
                const l = new THREE.Matrix4()
                  .makeTranslation(mc.x, mc.y, mc.z)
                  .scale(new THREE.Vector3(
                    mc.meterInMercatorCoordinateUnits(),
                    -mc.meterInMercatorCoordinateUnits(),
                    mc.meterInMercatorCoordinateUnits()
                  ));

                this.camera.projectionMatrix = m.multiply(l);
                this.renderer.resetState();
                this.renderer.render(this.scene, this.camera);
                mapInstance.triggerRepaint();
              } catch (e) {
                // Map might be disposed
              }
            },
          };

          mapInstance.addLayer(customLayer);
          
          // Start orbit after model is added
          startOrbit();

        } catch (err) {
          console.error('3D model load failed:', err);
          startOrbit();
        }
      });

      function startOrbit() {
        if (isCleanedUp || !mapInstance) return;
        
        // Create and start orbit controller
        orbitRef.current = new OrbitController(mapInstance, targetLocation);
        orbitRef.current.start();
      }
    };

    setup();

    return () => {
      isCleanedUp = true;
      clearTimeout(idleTimeout);
      
      if (orbitRef.current) {
        orbitRef.current.dispose();
        orbitRef.current = null;
      }
      
      if (mapInstance) {
        const canvas = mapInstance.getCanvas();
        ['mousedown', 'wheel', 'touchstart'].forEach(evt => {
          canvas.removeEventListener(evt, handleInteraction);
        });
        mapInstance.remove();
      }
      
      expandedMapInstanceRef.current = null;
    };
  }, [mapExpanded, refuge, refuges, overlayVisibilityDefaults]);

  useEffect(() => {
    overlayVisibilityRef.current = overlayVisibility;
  }, [overlayVisibility]);

  useEffect(() => {
    if (!mapExpanded) return;
    const map = expandedMapInstanceRef.current;
    if (!map || !map.isStyleLoaded()) return;
    applyOverlayLayers(map, overlayVisibility);
  }, [mapExpanded, overlayVisibility]);

  const toggleOverlayLayer = (layerId) => {
    setOverlayVisibility((prev) => ({ ...prev, [layerId]: !prev[layerId] }));
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.8)',
          backdropFilter: 'blur(8px)',
          zIndex: 1300,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          overscrollBehavior: 'contain',
        }}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="glass-panel"
          style={{
            width: '100%',
            maxWidth: '1050px',
            maxHeight: '90vh',
            overflow: 'hidden',
            display: 'grid',
            gridTemplateRows: 'auto 1fr',
            background: 'var(--bg-color)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: '2rem', margin: 0 }}>{nom}</h2>
              <div style={{ display: 'flex', gap: '1rem', color: 'var(--text-secondary)', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}><MapPin size={18} /> {coord.alt}m</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}><Bed size={18} /> {placeCount} places</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}><TreePine size={18} /> {type?.valeur}</span>
              </div>
              {massifBreadcrumb && (
                <div style={{ marginTop: '0.45rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Massif</span>
                  {massifBreadcrumb.map((step, idx) => (
                    <React.Fragment key={`${step}-${idx}`}>
                      <span style={{ padding: '0.25rem 0.6rem', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>{step}</span>
                      {idx < massifBreadcrumb.length - 1 && <ChevronRight size={16} style={{ opacity: 0.6 }} />}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button onClick={onToggleStar} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: isStarred ? 'var(--warning)' : 'var(--text-secondary)', borderRadius: '50%', width: '42px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Star size={20} fill={isStarred ? 'currentColor' : 'none'} /></button>
              <button onClick={onToggleLike} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: isLiked ? '#ef4444' : 'var(--text-secondary)', borderRadius: '50%', width: '42px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Heart size={20} fill={isLiked ? 'currentColor' : 'none'} /></button>
              <button onClick={onToggleDislike} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: isDisliked ? '#ef4444' : 'var(--text-secondary)', borderRadius: '50%', width: '42px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Ban size={20} /></button>
              <a href={lien} target="_blank" rel="noopener noreferrer" className="btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', textDecoration: 'none', padding: '0.55rem 0.9rem', background: 'rgba(255,255,255,0.08)', color: 'var(--text-primary)' }}>Voir sur refuges.info <ExternalLink size={16} /></a>
              <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '50%', width: '42px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><X size={22} /></button>
            </div>
          </div>

          {/* Content */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '1.25rem', padding: '1.25rem', overflow: 'hidden', minHeight: 0 }}>
            {/* Left */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto', paddingRight: '0.25rem' }}>
              <div className="glass-panel" style={{ padding: '1.25rem', background: 'rgba(255,255,255,0.03)' }}>
                <h4 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Equipements</h4>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem' }}>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: hasWater ? 'var(--success)' : 'var(--text-secondary)' }}><Droplets size={18} /><span>{details?.water || 'Eau inconnue'}</span></li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: hasWood ? 'var(--warning)' : 'var(--text-secondary)' }}><Flame size={18} /><span>{details?.wood || 'Bois inconnu'}</span></li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: details?.heating && !details.heating.toLowerCase().includes('non') ? 'var(--warning)' : 'var(--text-secondary)' }}><Flame size={18} /><span>Chauffage: {details?.heating || '?'}</span></li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: hasLatrines ? 'var(--text-primary)' : 'var(--text-secondary)' }}><Tent size={18} /><span>Latrines: {details?.latrines || '?'}</span></li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: details?.mattress && !details.mattress.toLowerCase().includes('0') ? 'var(--text-primary)' : 'var(--text-secondary)' }}><Bed size={18} /><span>Matelas: {details?.mattress || '?'}</span></li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: details?.blankets && !details.blankets.toLowerCase().includes('non') ? 'var(--text-primary)' : 'var(--text-secondary)' }}><Bed size={18} /><span>Couvertures: {details?.blankets || '?'}</span></li>
                </ul>
                {details?.access && <div style={{ marginTop: '1rem', fontSize: '0.95rem', color: 'var(--text-secondary)' }}><strong>Acces :</strong> {details.access}</div>}
              </div>

              <div className="glass-panel" style={{ padding: '1.25rem', background: 'rgba(255,255,255,0.03)' }}>
                <h3 style={{ marginTop: 0, marginBottom: '0.75rem', color: 'var(--accent)' }}>Informations & Remarques</h3>
                <div style={{ lineHeight: '1.6', color: 'var(--text-primary)', whiteSpace: 'pre-line' }}>{remarks || 'Aucune description detaillee disponible.'}</div>
              </div>

              <div className="glass-panel" style={{ padding: '1.25rem', background: 'rgba(255,255,255,0.03)' }}>
                <h4 style={{ marginTop: 0, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><MessageSquare size={18} /> Commentaires recents</h4>
                {comments.filter(c => c.text?.trim()).length === 0 ? (
                  <div style={{ color: 'var(--text-secondary)' }}>Pas encore de commentaire textuel.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {comments.filter(c => c.text?.trim()).slice(0, 5).map((c, idx) => (
                      <div key={idx} style={{ padding: '0.75rem', borderRadius: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                          <span>{c.author || 'Anonyme'}</span>
                          <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>{c.date}</span>
                        </div>
                        <div style={{ color: 'var(--text-primary)', lineHeight: '1.5', whiteSpace: 'pre-line' }}>{c.text}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflow: 'hidden' }}>
              <div onClick={() => mainPhoto && openLightbox(photos.length - 1)} style={{ height: '240px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', cursor: mainPhoto ? 'pointer' : 'default', overflow: 'hidden', background: mainPhoto ? 'var(--card-bg)' : 'linear-gradient(45deg, var(--bg-color), var(--card-bg))' }}>
                {mainPhoto && <img src={mainPhoto} alt="Vue principale" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </div>

              {photos?.length > 1 && (
                <div style={{ overflowY: 'auto', paddingRight: '0.3rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem' }}>
                    {photos.slice(1).map((photo, idx) => (
                      <div key={idx} className="photo-thumb" onClick={() => openLightbox(idx + 1)} style={{ overflow: 'hidden', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer' }}>
                        <img src={photo} alt={`Vue ${idx + 2}`} style={{ width: '100%', height: '110px', objectFit: 'cover' }} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="glass-panel" style={{ padding: '1rem', background: 'rgba(255,255,255,0.03)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}><MapPin size={18} /><strong>Localisation</strong></div>
                <div ref={miniMapContainerRef} onClick={() => setMapExpanded(true)} style={{ height: '200px', borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' }} />
              </div>
            </div>
          </div>

          {/* Lightbox */}
          {lightboxIndex !== null && photos?.length > 0 && (
            <div onClick={closeLightbox} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
              <button onClick={(e) => { e.stopPropagation(); closeLightbox(); }} style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.3)', color: 'white', borderRadius: '50%', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><X size={20} /></button>
              <button onClick={(e) => { e.stopPropagation(); gotoPhoto(-1); }} style={{ position: 'absolute', left: 20, background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.3)', color: 'white', borderRadius: '50%', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><ChevronLeft size={22} /></button>
              <button onClick={(e) => { e.stopPropagation(); gotoPhoto(1); }} style={{ position: 'absolute', right: 20, background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.3)', color: 'white', borderRadius: '50%', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><ChevronRight size={22} /></button>
              <img src={photos[lightboxIndex]} alt={`Photo ${lightboxIndex + 1}`} onClick={(e) => e.stopPropagation()} style={{ maxHeight: '90vh', maxWidth: '90vw', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.2)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }} />
            </div>
          )}

          {/* Expanded Map */}
          {mapExpanded && (
            <div onClick={() => setMapExpanded(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1250, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
              <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', width: 'min(1100px, 95vw)', height: 'min(750px, 85vh)', background: 'var(--card-bg)', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.12)', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.45)' }}>
                <button onClick={() => setMapExpanded(false)} style={{ position: 'absolute', top: 14, right: 14, background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: '50%', width: 42, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', cursor: 'pointer', zIndex: 2 }}><X size={20} /></button>
                
                <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 16, left: 16, zIndex: 2, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <button onClick={() => setShowLayerMenu((o) => !o)} style={{ width: 44, height: 44, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(0,0,0,0.5)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Layers size={18} /></button>
                  {showLayerMenu && (
                    <div style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px', padding: '0.75rem', backdropFilter: 'blur(4px)', minWidth: '260px' }}>
                      <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Fonds supplémentaires</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                        {OVERLAY_LAYERS.filter((l) => !l.alwaysOn).map((layer) => (
                          <label key={layer.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                            <input type="checkbox" checked={!!overlayVisibility[layer.id]} onChange={() => toggleOverlayLayer(layer.id)} />
                            <span>{layer.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                
                <div ref={expandedMapRef} style={{ position: 'absolute', inset: 0 }} />
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default RefugeModal;
