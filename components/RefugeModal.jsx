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
// CINEMATIC CAMERA ORBIT SYSTEM
// 
// Design principles:
// 1. Orbit RADIUS (horizontal distance from mesh) is the key parameter
// 2. When zoom changes, we compute a NEW radius and smoothly transition to it
// 3. The intro is a slow, curved spiral descent with proper easing
// 4. Everything feels cinematic and intentional
// ============================================================================

class CinematicOrbit {
  constructor(map, target) {
    this.map = map;
    this.target = target; // LngLat
    
    // Orbit parameters
    this.bearing = 0;           // Current rotation angle (degrees)
    this.radius = 800;          // Horizontal distance from target (meters)
    this.height = 400;          // Vertical height above target (meters)
    this.targetRadius = 300;    // What we're transitioning toward
    this.targetHeight = 200;    // What we're transitioning toward
    
    // Speeds and smoothing
    this.orbitSpeed = 0.08;     // Degrees per frame during normal orbit
    this.radiusSmoothing = 0.015; // How fast radius transitions (lower = smoother)
    this.heightSmoothing = 0.015;
    
    // Ground reference
    this.groundElevation = 0;
    this.minClearance = 60;     // Minimum meters above terrain
    
    // State
    this.isRunning = false;
    this.isPaused = false;
    this.animationFrame = null;
    
    // Intro animation state
    this.introPhase = 'pending'; // 'pending' | 'running' | 'complete'
    this.introStartTime = null;
    this.introDuration = 4000;   // 4 seconds for elegant descent
    
    // Track zoom for radius updates
    this.lastZoom = map.getZoom();
    
    // Initialize
    this.updateGroundElevation();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UTILITIES
  // ─────────────────────────────────────────────────────────────────────────
  
  toRad(deg) {
    return deg * Math.PI / 180;
  }

  getTerrainElevation(lng, lat) {
    const elev = this.map.queryTerrainElevation(new maplibregl.LngLat(lng, lat));
    return elev ?? this.groundElevation;
  }

  updateGroundElevation() {
    const elev = this.map.queryTerrainElevation(this.target);
    if (elev != null) this.groundElevation = elev;
  }

  /**
   * Compute ideal orbit radius based on zoom level
   * This determines how far the camera orbits from the mesh
   */
  computeRadiusForZoom(zoom) {
    // Tuned values: zoom 14 ≈ 280m, zoom 12 ≈ 700m, zoom 16 ≈ 110m
    const baseRadius = 260;
    const radius = baseRadius * Math.pow(1.45, 14 - zoom);
    return Math.max(80, Math.min(radius, 2000));
  }

  /**
   * Compute ideal height based on radius (maintains good viewing angle)
   */
  computeHeightForRadius(radius) {
    // Maintain roughly 35-40 degree viewing angle
    return radius * 0.7;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EASING FUNCTIONS
  // ─────────────────────────────────────────────────────────────────────────

  // Slow start, slow end - very smooth
  easeInOutSine(t) {
    return -(Math.cos(Math.PI * t) - 1) / 2;
  }

  // Slow at the end - nice deceleration
  easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
  }

  // Custom bezier-like curve for spiral: slow start, accelerate, slow end
  easeSpiral(t) {
    // Attempt a nice S-curve that feels cinematic
    if (t < 0.3) {
      // Slow start (ease in)
      return 0.3 * this.easeInOutSine(t / 0.3) * (1/0.3) * 0.15;
    } else if (t < 0.7) {
      // Middle section - steady progress
      return 0.15 + (t - 0.3) * 1.75;
    } else {
      // Slow end (ease out)
      const localT = (t - 0.7) / 0.3;
      return 0.85 + 0.15 * this.easeOutQuart(localT);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CAMERA POSITIONING
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Convert orbit parameters to camera world position
   */
  computeCameraPosition() {
    const bearingRad = this.toRad(this.bearing);
    
    // Geographic conversion factors
    const mPerDegLat = 111320;
    const mPerDegLng = mPerDegLat * Math.cos(this.toRad(this.target.lat));
    
    // Camera offset from target (horizontal)
    const dLng = (Math.sin(bearingRad) * this.radius) / mPerDegLng;
    const dLat = (Math.cos(bearingRad) * this.radius) / mPerDegLat;
    
    const camLng = this.target.lng + dLng;
    const camLat = this.target.lat + dLat;
    
    // Terrain check at camera position
    const terrainAtCam = this.getTerrainElevation(camLng, camLat);
    
    // Look-at point (slightly above ground for model center)
    const lookAtZ = this.groundElevation + 8;
    
    // Camera altitude
    const desiredCamZ = this.groundElevation + this.height;
    const safeCamZ = Math.max(desiredCamZ, terrainAtCam + this.minClearance);
    
    return { camLng, camLat, camZ: safeCamZ, lookAtZ };
  }

  /**
   * Apply camera to map using free camera API
   */
  applyCamera() {
    const { camLng, camLat, camZ, lookAtZ } = this.computeCameraPosition();
    
    const camPos = maplibregl.MercatorCoordinate.fromLngLat(
      { lng: camLng, lat: camLat },
      camZ
    );
    
    const lookAt = maplibregl.MercatorCoordinate.fromLngLat(
      this.target,
      lookAtZ
    );
    
    const cam = this.map.getFreeCameraOptions();
    cam.position = camPos;
    cam.lookAtPoint(lookAt);
    this.map.setFreeCameraOptions(cam);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INTRO ANIMATION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * The intro: a slow, elegant spiral descent from above
   * 
   * Start: High above (radius=100, height=1500) looking almost straight down
   * End: Orbit position (radius=targetRadius, height=targetHeight)
   * 
   * The spiral effect comes from:
   * - Radius expanding outward
   * - Height descending
   * - Bearing rotating
   * All with different easing curves to create visual interest
   */
  tickIntro(now) {
    if (!this.introStartTime) {
      this.introStartTime = now;
      // Set starting position (high above, close to center)
      this.radius = 50;
      this.height = 1400;
      this.bearing = 0;
    }
    
    const elapsed = now - this.introStartTime;
    const rawProgress = Math.min(elapsed / this.introDuration, 1);
    
    // Different easing for different parameters creates the spiral feel
    const radiusProgress = this.easeOutQuart(rawProgress);      // Radius expands with deceleration
    const heightProgress = this.easeInOutSine(rawProgress);      // Height descends smoothly
    const bearingProgress = this.easeSpiral(rawProgress);        // Bearing has custom curve
    
    // Interpolate parameters
    const startRadius = 50;
    const startHeight = 1400;
    
    this.radius = startRadius + (this.targetRadius - startRadius) * radiusProgress;
    this.height = startHeight + (this.targetHeight - startHeight) * heightProgress;
    
    // Rotate 1.5 full circles during intro (540 degrees) for dramatic effect
    this.bearing = bearingProgress * 540;
    
    // Check if intro is complete
    if (rawProgress >= 1) {
      this.introPhase = 'complete';
      this.bearing = this.bearing % 360; // Normalize bearing
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NORMAL ORBIT
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if zoom changed and update target radius accordingly
   */
  checkZoomChange() {
    const currentZoom = this.map.getZoom();
    const zoomDelta = Math.abs(currentZoom - this.lastZoom);
    
    // Only react to meaningful zoom changes (avoid micro-adjustments)
    if (zoomDelta > 0.1) {
      this.lastZoom = currentZoom;
      this.targetRadius = this.computeRadiusForZoom(currentZoom);
      this.targetHeight = this.computeHeightForRadius(this.targetRadius);
    }
  }

  /**
   * Normal orbit tick: smooth rotation and radius/height transitions
   */
  tickOrbit() {
    if (this.isPaused) return;
    
    // Check for zoom changes → update targets
    this.checkZoomChange();
    
    // Smoothly interpolate radius and height toward targets
    // This creates fluid transitions when zooming
    const radiusDelta = this.targetRadius - this.radius;
    const heightDelta = this.targetHeight - this.height;
    
    this.radius += radiusDelta * this.radiusSmoothing;
    this.height += heightDelta * this.heightSmoothing;
    
    // Continuous rotation
    this.bearing = (this.bearing + this.orbitSpeed) % 360;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN LOOP
  // ─────────────────────────────────────────────────────────────────────────

  tick = () => {
    if (!this.isRunning) return;
    
    const now = performance.now();
    
    // Periodically update ground elevation (terrain loads async)
    if (Math.random() < 0.01) {
      this.updateGroundElevation();
    }
    
    // Run appropriate phase
    if (this.introPhase === 'running') {
      this.tickIntro(now);
    } else if (this.introPhase === 'complete') {
      this.tickOrbit();
    }
    
    // Always apply camera
    this.applyCamera();
    
    // Continue loop
    this.animationFrame = requestAnimationFrame(this.tick);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start the orbit (begins with intro animation)
   */
  start() {
    if (this.isRunning) return;
    
    // Compute initial targets based on current zoom
    const zoom = this.map.getZoom();
    this.targetRadius = this.computeRadiusForZoom(zoom);
    this.targetHeight = this.computeHeightForRadius(this.targetRadius);
    this.lastZoom = zoom;
    
    this.isRunning = true;
    this.introPhase = 'running';
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  /**
   * Stop completely
   */
  stop() {
    this.isRunning = false;
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  /**
   * Pause rotation (still applies camera, still tracks zoom)
   */
  pause() {
    this.isPaused = true;
  }

  /**
   * Resume rotation
   */
  resume() {
    this.isPaused = false;
  }

  /**
   * Skip intro and jump to orbit
   */
  skipIntro() {
    if (this.introPhase === 'running') {
      this.introPhase = 'complete';
      this.radius = this.targetRadius;
      this.height = this.targetHeight;
      this.bearing = 0;
    }
  }

  /**
   * Clean up
   */
  dispose() {
    this.stop();
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

    let idleTimeout;
    let mapInstance;
    let selectedLocation;

    const resetIdleTimer = () => {
      clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        orbitRef.current?.resume();
      }, 3500);
    };

    const handleInteraction = () => {
      orbitRef.current?.pause();
      resetIdleTimer();
    };

    const setup = async () => {
      const coords = refuge.geometry?.coordinates || [6.4, 45.2];
      selectedLocation = new maplibregl.LngLat(coords[0], coords[1]);

      mapInstance = new maplibregl.Map({
        container: expandedMapRef.current,
        style: 'https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/gris.json',
        center: coords,
        zoom: 14,
        pitch: 0,
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

      // Constrain bounds
      mapInstance.setMaxBounds([
        [selectedLocation.lng - 0.04, selectedLocation.lat - 0.04],
        [selectedLocation.lng + 0.04, selectedLocation.lat + 0.04]
      ]);

      // Interaction handlers
      const canvas = mapInstance.getCanvas();
      ['mousedown', 'wheel', 'touchstart'].forEach(evt => {
        canvas.addEventListener(evt, handleInteraction, { passive: true });
      });

      // Other refuge markers
      (refuges || []).forEach((f) => {
        const pos = f.geometry?.coordinates;
        if (!pos || pos.length < 2) return;
        if (f.properties?.id === refuge.properties?.id) return;
        createRefugeMarker(f, mapInstance, undefined, { compact: true }, {}).addTo(mapInstance);
      });

      mapInstance.on('load', async () => {
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

        // Terrain
        mapInstance.addSource('terrain-src', {
          type: 'raster-dem',
          url: 'https://tiles.mapterhorn.com/tilejson.json',
          tileSize: 256,
        });
        mapInstance.setTerrain({ source: 'terrain-src', exaggeration: 1.0 });

        // 3D Model
        try {
          const { THREE, GLTFLoader } = await loadThreeStack();
          if (!THREE || !GLTFLoader) return;

          const loader = new GLTFLoader();
          loader.setCrossOrigin('anonymous');

          const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}refuge_LP.glb`);
          const model = gltf?.scene;
          if (!model) return;

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

          // Orient based on terrain slope
          const offset = 0.001;
          const getElev = (lng, lat) => mapInstance.queryTerrainElevation(new maplibregl.LngLat(lng, lat)) || 0;
          const eN = getElev(coords[0], coords[1] + offset);
          const eS = getElev(coords[0], coords[1] - offset);
          const eE = getElev(coords[0] + offset, coords[1]);
          const eW = getElev(coords[0] - offset, coords[1]);
          
          if (!(eN === 0 && eS === 0 && eE === 0 && eW === 0)) {
            const downhill = Math.atan2(-(eN - eS), -(eE - eW));
            model.rotation.y = downhill - Math.PI / 2;
          }

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
              const elev = mapInstance.queryTerrainElevation(selectedLocation) || 0;
              const mc = maplibregl.MercatorCoordinate.fromLngLat(selectedLocation, elev);

              const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
              const l = new THREE.Matrix4()
                .makeTranslation(mc.x, mc.y, mc.z)
                .scale(new THREE.Vector3(mc.meterInMercatorCoordinateUnits(), -mc.meterInMercatorCoordinateUnits(), mc.meterInMercatorCoordinateUnits()));

              this.camera.projectionMatrix = m.multiply(l);
              this.renderer.resetState();
              this.renderer.render(this.scene, this.camera);
              mapInstance.triggerRepaint();
            },
          };

          mapInstance.addLayer(customLayer);

          // Start orbit after terrain has time to load
          setTimeout(() => {
            orbitRef.current = new CinematicOrbit(mapInstance, selectedLocation);
            orbitRef.current.start();
          }, 600);

        } catch (err) {
          console.error('3D model load failed:', err);
        }
      });
    };

    setup();

    return () => {
      clearTimeout(idleTimeout);
      orbitRef.current?.dispose();
      orbitRef.current = null;
      
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
