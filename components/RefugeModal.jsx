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
// REFACTORED CAMERA ORBIT SYSTEM
// ============================================================================

/**
 * Smooth camera orbit controller using spherical coordinates
 * Provides fluid transitions and proper terrain avoidance
 */
class CameraOrbitController {
  constructor(map, targetLocation, options = {}) {
    this.map = map;
    this.targetLocation = targetLocation;
    
    // Orbit parameters (in spherical coordinates)
    this.currentBearing = options.initialBearing || 0;
    this.currentPitch = options.initialPitch || 55;
    this.currentDistance = options.initialDistance || 400;
    
    // Target values for smooth interpolation
    this.targetBearing = this.currentBearing;
    this.targetPitch = this.currentPitch;
    this.targetDistance = this.currentDistance;
    
    // Configuration
    this.orbitSpeed = options.orbitSpeed || 0.08; // degrees per frame
    this.minPitch = options.minPitch || 35;
    this.maxPitch = options.maxPitch || 70;
    this.minDistance = options.minDistance || 150;
    this.maxDistance = options.maxDistance || 1500;
    this.minAltitudeAboveTerrain = options.minAltitudeAboveTerrain || 80;
    this.groundElevation = options.groundElevation || 0;
    
    // Smoothing factors (0-1, higher = faster response)
    this.bearingSmoothFactor = 0.02;
    this.pitchSmoothFactor = 0.04;
    this.distanceSmoothFactor = 0.03;
    
    // Animation state
    this.animationFrame = null;
    this.isOrbiting = false;
    this.isPaused = false;
    
    // Terrain cache for performance
    this.terrainCache = new Map();
    this.terrainCacheTimeout = 500; // ms
  }

  /**
   * Convert degrees to radians
   */
  toRadians(degrees) {
    return (degrees * Math.PI) / 180;
  }

  /**
   * Get terrain elevation with caching
   */
  getTerrainElevation(lng, lat) {
    const key = `${lng.toFixed(5)},${lat.toFixed(5)}`;
    const cached = this.terrainCache.get(key);
    
    if (cached && Date.now() - cached.time < this.terrainCacheTimeout) {
      return cached.elevation;
    }
    
    const elevation = this.map.queryTerrainElevation(new maplibregl.LngLat(lng, lat)) || 0;
    this.terrainCache.set(key, { elevation, time: Date.now() });
    
    // Limit cache size
    if (this.terrainCache.size > 100) {
      const firstKey = this.terrainCache.keys().next().value;
      this.terrainCache.delete(firstKey);
    }
    
    return elevation;
  }

  /**
   * Sample terrain around the orbit path to find safe altitude
   */
  sampleOrbitPathTerrain(bearing, distance) {
    const samples = 8;
    let maxElevation = this.groundElevation;
    
    const pitchRad = this.toRadians(this.currentPitch);
    const horizontalDist = distance * Math.cos(pitchRad);
    
    // Sample terrain along part of the orbit path
    for (let i = -2; i <= 2; i++) {
      const sampleBearing = bearing + i * 15; // Check ±30 degrees
      const bearingRad = this.toRadians(sampleBearing);
      
      const metersPerDegreeLng = 111320 * Math.cos(this.toRadians(this.targetLocation.lat));
      const metersPerDegreeLat = 111320;
      
      const offsetLng = (Math.sin(bearingRad) * horizontalDist) / metersPerDegreeLng;
      const offsetLat = (Math.cos(bearingRad) * horizontalDist) / metersPerDegreeLat;
      
      const sampleLng = this.targetLocation.lng + offsetLng;
      const sampleLat = this.targetLocation.lat + offsetLat;
      
      const elev = this.getTerrainElevation(sampleLng, sampleLat);
      maxElevation = Math.max(maxElevation, elev);
    }
    
    return maxElevation;
  }

  /**
   * Calculate camera position using spherical coordinates with terrain avoidance
   */
  calculateCameraPosition(bearing, pitch, distance) {
    const pitchRad = this.toRadians(pitch);
    const bearingRad = this.toRadians(bearing);
    
    // Calculate horizontal and vertical components
    const horizontalDist = distance * Math.cos(pitchRad);
    const verticalDist = distance * Math.sin(pitchRad);
    
    // Convert to geographic offset
    const metersPerDegreeLng = 111320 * Math.cos(this.toRadians(this.targetLocation.lat));
    const metersPerDegreeLat = 111320;
    
    const offsetLng = (Math.sin(bearingRad) * horizontalDist) / metersPerDegreeLng;
    const offsetLat = (Math.cos(bearingRad) * horizontalDist) / metersPerDegreeLat;
    
    const cameraLng = this.targetLocation.lng + offsetLng;
    const cameraLat = this.targetLocation.lat + offsetLat;
    
    // Get terrain elevation at camera position and along path
    const cameraTerrainElev = this.getTerrainElevation(cameraLng, cameraLat);
    const pathMaxElev = this.sampleOrbitPathTerrain(bearing, distance);
    
    // Calculate target altitude (looking at refuge + some offset for the model)
    const targetAltitude = this.groundElevation + 15; // 15m above ground for model center
    const desiredCameraAlt = targetAltitude + verticalDist;
    
    // Ensure camera is safely above terrain
    const minSafeAlt = Math.max(cameraTerrainElev, pathMaxElev) + this.minAltitudeAboveTerrain;
    const cameraAlt = Math.max(desiredCameraAlt, minSafeAlt);
    
    // Create mercator coordinates
    const cameraPos = maplibregl.MercatorCoordinate.fromLngLat(
      { lng: cameraLng, lat: cameraLat },
      cameraAlt
    );
    
    const targetPos = maplibregl.MercatorCoordinate.fromLngLat(
      this.targetLocation,
      targetAltitude
    );
    
    return { cameraPos, targetPos, cameraAlt, minSafeAlt };
  }

  /**
   * Smoothly interpolate between current and target values
   */
  lerp(current, target, factor) {
    return current + (target - current) * factor;
  }

  /**
   * Apply camera position to the map
   */
  applyCamera(cameraPos, targetPos) {
    const camera = this.map.getFreeCameraOptions();
    camera.position = cameraPos;
    camera.lookAtPoint(targetPos);
    this.map.setFreeCameraOptions(camera);
  }

  /**
   * Update orbit parameters based on current zoom level
   */
  updateDistanceFromZoom() {
    const zoom = this.map.getZoom();
    
    // Exponential scaling: closer zoom = smaller orbit
    const baseDistance = 350;
    const zoomFactor = Math.pow(1.25, 14 - zoom);
    const newDistance = Math.min(Math.max(baseDistance * zoomFactor, this.minDistance), this.maxDistance);
    
    this.targetDistance = newDistance;
  }

  /**
   * Main animation frame - smooth continuous orbit
   */
  animate = () => {
    if (!this.isOrbiting || this.isPaused) return;
    
    // Update target distance based on zoom
    this.updateDistanceFromZoom();
    
    // Smoothly interpolate current values toward targets
    this.currentDistance = this.lerp(this.currentDistance, this.targetDistance, this.distanceSmoothFactor);
    this.currentPitch = this.lerp(this.currentPitch, this.targetPitch, this.pitchSmoothFactor);
    
    // Advance bearing (with smooth acceleration/deceleration near obstacles if needed)
    this.targetBearing = (this.targetBearing + this.orbitSpeed) % 360;
    this.currentBearing = this.lerp(this.currentBearing, this.targetBearing, this.bearingSmoothFactor);
    
    // Handle bearing wraparound
    if (Math.abs(this.targetBearing - this.currentBearing) > 180) {
      if (this.targetBearing > this.currentBearing) {
        this.currentBearing += 360;
      } else {
        this.currentBearing -= 360;
      }
    }
    this.currentBearing = ((this.currentBearing % 360) + 360) % 360;
    
    // Calculate and apply camera position
    const { cameraPos, targetPos } = this.calculateCameraPosition(
      this.currentBearing,
      this.currentPitch,
      this.currentDistance
    );
    
    this.applyCamera(cameraPos, targetPos);
    
    // Update map bearing to match (for UI consistency)
    this.map.setBearing(this.currentBearing, { animate: false });
    
    // Continue animation
    this.animationFrame = requestAnimationFrame(this.animate);
  };

  /**
   * Start the orbit animation
   */
  start() {
    if (this.isOrbiting) return;
    this.isOrbiting = true;
    this.isPaused = false;
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  /**
   * Stop the orbit animation
   */
  stop() {
    this.isOrbiting = false;
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  /**
   * Pause orbit (can resume)
   */
  pause() {
    this.isPaused = true;
  }

  /**
   * Resume orbit after pause
   */
  resume() {
    if (!this.isOrbiting) {
      this.start();
    } else {
      this.isPaused = false;
      this.animationFrame = requestAnimationFrame(this.animate);
    }
  }

  /**
   * Smoothly transition to a new camera configuration
   */
  transitionTo(bearing, pitch, distance, duration = 1500) {
    return new Promise((resolve) => {
      const wasOrbiting = this.isOrbiting;
      this.stop();
      
      const startBearing = this.currentBearing;
      const startPitch = this.currentPitch;
      const startDistance = this.currentDistance;
      const startTime = performance.now();
      
      // Handle bearing wraparound for shortest path
      let targetBearing = bearing;
      if (Math.abs(targetBearing - startBearing) > 180) {
        if (targetBearing > startBearing) {
          targetBearing -= 360;
        } else {
          targetBearing += 360;
        }
      }
      
      const animate = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Ease-out cubic for smooth deceleration
        const eased = 1 - Math.pow(1 - progress, 3);
        
        this.currentBearing = startBearing + (targetBearing - startBearing) * eased;
        this.currentPitch = startPitch + (pitch - startPitch) * eased;
        this.currentDistance = startDistance + (distance - startDistance) * eased;
        
        // Normalize bearing
        this.currentBearing = ((this.currentBearing % 360) + 360) % 360;
        
        const { cameraPos, targetPos } = this.calculateCameraPosition(
          this.currentBearing,
          this.currentPitch,
          this.currentDistance
        );
        
        this.applyCamera(cameraPos, targetPos);
        this.map.setBearing(this.currentBearing, { animate: false });
        
        if (progress < 1) {
          this.animationFrame = requestAnimationFrame(animate);
        } else {
          // Update targets to match final values
          this.targetBearing = this.currentBearing;
          this.targetPitch = this.currentPitch;
          this.targetDistance = this.currentDistance;
          
          if (wasOrbiting) {
            this.start();
          }
          resolve();
        }
      };
      
      this.animationFrame = requestAnimationFrame(animate);
    });
  }

  /**
   * Update ground elevation (call after terrain loads)
   */
  setGroundElevation(elevation) {
    this.groundElevation = elevation;
  }

  /**
   * Clean up resources
   */
  dispose() {
    this.stop();
    this.terrainCache.clear();
  }
}

// ============================================================================
// END CAMERA ORBIT SYSTEM
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
  const orbitControllerRef = useRef(null);

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

  useEffect(() => {
    if (!miniMapContainerRef.current) return undefined;
    const coords = refuge.geometry?.coordinates;
    if (!coords || coords.length < 2) return undefined;

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
      if (miniMapRef.current) {
        miniMapRef.current.remove();
        miniMapRef.current = null;
      }
    };
  }, [refuge]);

  useEffect(() => {
    if (!mapExpanded || !expandedMapRef.current) return undefined;

    let idleTimeout;
    let orbitStartTimeout;
    let mapInstance;
    let selectedLocation;

    const userInteractionEvents = [
      'dragstart',
      'zoomstart',
      'rotatestart',
      'pitchstart',
      'movestart',
      'mousedown',
      'click',
      'contextmenu',
      'wheel',
    ];

    const handleUserInteraction = (event) => {
      if (!event?.originalEvent) return;
      
      // Pause orbit during interaction
      if (orbitControllerRef.current) {
        orbitControllerRef.current.pause();
      }
      
      // Reset idle timer
      if (idleTimeout) clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        // Resume orbit after idle
        if (orbitControllerRef.current) {
          orbitControllerRef.current.resume();
        }
      }, 4000);
    };

    const setupExpandedMap = async () => {
      const coords = refuge.geometry?.coordinates || [6.4, 45.2];
      selectedLocation = new maplibregl.LngLat(coords[0], coords[1]);

      mapInstance = new maplibregl.Map({
        container: expandedMapRef.current,
        style: 'https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/gris.json',
        center: coords,
        zoom: 12,
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

      const lockBounds = new maplibregl.LngLatBounds(
        [selectedLocation.lng - 0.02, selectedLocation.lat - 0.02],
        [selectedLocation.lng + 0.02, selectedLocation.lat + 0.02]
      );
      mapInstance.setMaxBounds(lockBounds);

      userInteractionEvents.forEach((eventName) => {
        mapInstance.on(eventName, handleUserInteraction);
      });

      const bounds = new maplibregl.LngLatBounds();
      const features = Array.isArray(refuges) ? refuges : [];

      bounds.extend(selectedLocation);

      features.forEach((feature) => {
        const position = feature.geometry?.coordinates;
        if (!position || position.length < 2) return;
        const isSelected = feature.properties?.id === refuge.properties?.id;

        if (!isSelected) {
          const marker = createRefugeMarker(
            feature,
            mapInstance,
            undefined,
            { compact: true },
            { isSelected }
          );

          marker.addTo(mapInstance);
        }

        bounds.extend(position);
      });

      if (!bounds.isEmpty()) {
        mapInstance.fitBounds(bounds, { padding: 60, maxZoom: 12 });
      } else {
        mapInstance.setCenter(coords);
        mapInstance.setZoom(12);
      }

      mapInstance.on('load', async () => {
        // Add hillshade layer
        if (!mapInstance.getSource('modal-hillshade')) {
          mapInstance.addSource('modal-hillshade', {
            type: 'raster-dem',
            url: 'https://tiles.mapterhorn.com/tilejson.json',
            tileSize: 256,
          });
        }

        if (!mapInstance.getLayer('modal-hillshade-layer')) {
          mapInstance.addLayer({
            id: 'modal-hillshade-layer',
            type: 'hillshade',
            source: 'modal-hillshade',
            paint: {
              'hillshade-exaggeration': 0.3,
              'hillshade-shadow-color': '#000000',
            },
          });
        }

        applyOverlayLayers(mapInstance, overlayVisibilityRef.current);

        // Add terrain
        if (!mapInstance.getSource('modal-terrain-dem')) {
          mapInstance.addSource('modal-terrain-dem', {
            type: 'raster-dem',
            url: 'https://tiles.mapterhorn.com/tilejson.json',
            tileSize: 256,
          });

          mapInstance.setTerrain({ source: 'modal-terrain-dem', exaggeration: 1.0 });
        }

        try {
          const { THREE, GLTFLoader } = await loadThreeStack();
          if (!THREE || !GLTFLoader) return;

          const loader = new GLTFLoader();
          loader.setCrossOrigin('anonymous');

          const modelUrl = `${import.meta.env.BASE_URL}refuge_LP.glb`;
          const gltf = await loader.loadAsync(modelUrl);
          const model = gltf?.scene;

          if (!model) {
            return;
          }

          model.traverse((child) => {
            if (!child.isMesh) return;

            const materials = Array.isArray(child.material) ? child.material : [child.material];

            materials.forEach((material) => {
              if (!material) return;

              ['map', 'emissiveMap'].forEach((key) => {
                if (!material[key]) return;
                material[key].colorSpace = THREE.SRGBColorSpace;
              });

              material.needsUpdate = true;
            });

            child.material = Array.isArray(child.material) ? materials : materials[0];
          });

          const box = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxDimension = Math.max(size.x, size.y, size.z, 1);

          model.position.x -= center.x;
          model.position.y -= box.min.y;
          model.position.z -= center.z;

          model.scale.setScalar((30 * 5) / maxDimension);

          // Analyze terrain for model orientation
          const analyzeTerrain = () => {
            const centerCoord = selectedLocation;
            const offset = 0.001;

            const getElev = (lng, lat) => mapInstance.queryTerrainElevation(new maplibregl.LngLat(lng, lat)) || 0;

            const eC = getElev(centerCoord.lng, centerCoord.lat);
            const eN = getElev(centerCoord.lng, centerCoord.lat + offset);
            const eS = getElev(centerCoord.lng, centerCoord.lat - offset);
            const eE = getElev(centerCoord.lng + offset, centerCoord.lat);
            const eW = getElev(centerCoord.lng - offset, centerCoord.lat);

            if (eN === 0 && eS === 0 && eE === 0 && eW === 0) {
              return { rotation: 0, groundElevation: 0 };
            }

            const dz_dy = eN - eS;
            const dz_dx = eE - eW;
            const downhillAngle = Math.atan2(-dz_dy, -dz_dx);
            const rotation = downhillAngle - Math.PI / 2;

            return { rotation, groundElevation: eC };
          };

          const { rotation, groundElevation } = analyzeTerrain();
          model.rotation.y = rotation;

          const customLayer = {
            id: 'refuge-3d-model',
            type: 'custom',
            renderingMode: '3d',
            onAdd(map, gl) {
              this.camera = new THREE.Camera();
              this.scene = new THREE.Scene();
              this.scene.rotateX(Math.PI / 2);
              this.scene.scale.multiply(new THREE.Vector3(1, 1, -1));

              const ambient = new THREE.AmbientLight(0xffffff, 1.2);
              this.scene.add(ambient);

              this.model = model;
              this.scene.add(this.model);

              this.renderer = new THREE.WebGLRenderer({
                canvas: map.getCanvas(),
                context: gl,
                antialias: true,
              });

              if ('outputColorSpace' in this.renderer) {
                this.renderer.outputColorSpace = THREE.SRGBColorSpace;
              } else {
                this.renderer.outputEncoding = THREE.sRGBEncoding;
              }
              this.renderer.autoClear = false;
            },
            render(gl, args) {
              if (!this.model) return;

              const elevation = mapInstance.queryTerrainElevation(selectedLocation) || 0;
              const mercatorCoord = maplibregl.MercatorCoordinate.fromLngLat(
                selectedLocation,
                elevation
              );

              const modelTransform = {
                translateX: mercatorCoord.x,
                translateY: mercatorCoord.y,
                translateZ: mercatorCoord.z,
                scale: mercatorCoord.meterInMercatorCoordinateUnits(),
              };

              const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
              const l = new THREE.Matrix4()
                .makeTranslation(modelTransform.translateX, modelTransform.translateY, modelTransform.translateZ)
                .scale(new THREE.Vector3(modelTransform.scale, -modelTransform.scale, modelTransform.scale));

              this.camera.projectionMatrix = m.multiply(l);
              this.renderer.resetState();
              this.renderer.render(this.scene, this.camera);
              mapInstance.triggerRepaint();
            },
          };

          mapInstance.addLayer(customLayer);

          // Initialize the orbit controller
          orbitControllerRef.current = new CameraOrbitController(mapInstance, selectedLocation, {
            initialBearing: mapInstance.getBearing(),
            initialPitch: 55,
            initialDistance: 400,
            groundElevation: groundElevation,
            minAltitudeAboveTerrain: 100,
            orbitSpeed: 0.1,
          });

          // Start with a top-down view, then transition to orbit
          const initialZoom = 14.5;
          mapInstance.easeTo({
            center: selectedLocation,
            zoom: initialZoom,
            pitch: 20,
            bearing: 0,
            duration: 800,
            essential: true,
          });

          mapInstance.once('moveend', () => {
            orbitStartTimeout = setTimeout(async () => {
              if (!mapInstance || !orbitControllerRef.current) return;

              // Smooth transition into orbit position
              await orbitControllerRef.current.transitionTo(0, 55, 400, 1800);
              
              // Start continuous orbit
              orbitControllerRef.current.start();
            }, 600);
          });

        } catch (error) {
          console.error('Failed to load 3D model', error);
        }
      });
    };

    setupExpandedMap();

    return () => {
      // Clean up orbit controller
      if (orbitControllerRef.current) {
        orbitControllerRef.current.dispose();
        orbitControllerRef.current = null;
      }
      
      if (idleTimeout) clearTimeout(idleTimeout);
      if (orbitStartTimeout) clearTimeout(orbitStartTimeout);
      
      if (mapInstance) {
        userInteractionEvents.forEach((eventName) => {
          mapInstance.off(eventName, handleUserInteraction);
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
    setOverlayVisibility((prev) => ({
      ...prev,
      [layerId]: !prev[layerId],
    }));
  };

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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              position: 'relative',
            }}
          >
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: '2rem', margin: 0 }}>{nom}</h2>
              <div style={{ display: 'flex', gap: '1rem', color: 'var(--text-secondary)', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  <MapPin size={18} /> {coord.alt}m
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Bed size={18} /> {placeCount} places
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  <TreePine size={18} /> {type?.valeur}
                </span>
              </div>
              {massifBreadcrumb && (
                <div style={{ marginTop: '0.45rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Massif</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {massifBreadcrumb.map((step, idx) => (
                      <React.Fragment key={`${step}-${idx}`}>
                        <span style={{ padding: '0.25rem 0.6rem', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
                          {step}
                        </span>
                        {idx < massifBreadcrumb.length - 1 && <ChevronRight size={16} style={{ opacity: 0.6 }} />}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                onClick={onToggleStar}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: isStarred ? 'var(--warning)' : 'var(--text-secondary)',
                  borderRadius: '50%',
                  width: '42px',
                  height: '42px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
                title={isStarred ? "Retirer des favoris" : "Ajouter aux favoris"}
              >
                <Star size={20} fill={isStarred ? 'currentColor' : 'none'} />
              </button>
              <button
                onClick={onToggleLike}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: isLiked ? '#ef4444' : 'var(--text-secondary)',
                  borderRadius: '50%',
                  width: '42px',
                  height: '42px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
                title={isLiked ? "Je n'aime plus" : "J'aime"}
              >
                <Heart size={20} fill={isLiked ? 'currentColor' : 'none'} />
              </button>
              <button
                onClick={onToggleDislike}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: isDisliked ? '#ef4444' : 'var(--text-secondary)',
                  borderRadius: '50%',
                  width: '42px',
                  height: '42px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
                title={isDisliked ? "Retirer de la liste interdite" : "Ajouter à la liste interdite"}
              >
                <Ban size={20} />
              </button>
              <a
                href={lien}
                target="_blank"
                rel="noopener noreferrer"
                className="btn"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem',
                  textDecoration: 'none',
                  padding: '0.55rem 0.9rem',
                  background: 'rgba(255,255,255,0.08)',
                  color: 'var(--text-primary)',
                }}
              >
                Voir sur refuges.info <ExternalLink size={16} />
              </a>
              <button
                onClick={onClose}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'white',
                  borderRadius: '50%',
                  width: '42px',
                  height: '42px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <X size={22} />
              </button>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.1fr 0.9fr',
              gap: '1.25rem',
              padding: '1.25rem',
              overflow: 'hidden',
              minHeight: 0,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto', paddingRight: '0.25rem' }}>
              <div className="glass-panel" style={{ padding: '1.25rem', background: 'rgba(255,255,255,0.03)' }}>
                <h4 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Equipements</h4>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem' }}>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: hasWater ? 'var(--success)' : 'var(--text-secondary)' }}>
                    <Droplets size={18} />
                    <span>{details?.water || 'Eau inconnue'}</span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: hasWood ? 'var(--warning)' : 'var(--text-secondary)' }}>
                    <Flame size={18} />
                    <span>{details?.wood || 'Bois inconnu'}</span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: details?.heating && !details.heating.toLowerCase().includes('non') ? 'var(--warning)' : 'var(--text-secondary)' }}>
                    <Flame size={18} />
                    <span>Chauffage: {details?.heating || '?'}</span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: hasLatrines ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    <Tent size={18} />
                    <span>Latrines: {details?.latrines || '?'}</span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: details?.mattress && !details.mattress.toLowerCase().includes('0') ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    <Bed size={18} />
                    <span>Matelas: {details?.mattress || '?'}</span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: details?.blankets && !details.blankets.toLowerCase().includes('non') ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    <Bed size={18} />
                    <span>Couvertures: {details?.blankets || '?'}</span>
                  </li>
                </ul>
                {details?.access && (
                  <div style={{ marginTop: '1rem', fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                    <strong>Acces :</strong> {details.access}
                  </div>
                )}
              </div>

              <div className="glass-panel" style={{ padding: '1.25rem', background: 'rgba(255,255,255,0.03)' }}>
                <h3 style={{ marginTop: 0, marginBottom: '0.75rem', color: 'var(--accent)' }}>Informations & Remarques</h3>
                <div style={{ lineHeight: '1.6', color: 'var(--text-primary)', whiteSpace: 'pre-line' }}>
                  {remarks || 'Aucune description detaillee disponible.'}
                </div>
              </div>

              <div className="glass-panel" style={{ padding: '1.25rem', background: 'rgba(255,255,255,0.03)' }}>
                <h4 style={{ marginTop: 0, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <MessageSquare size={18} /> Commentaires recents
                </h4>
                {comments.filter(c => c.text && c.text.trim().length > 0).length === 0 ? (
                  <div style={{ color: 'var(--text-secondary)' }}>Pas encore de commentaire textuel.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {comments
                      .filter(c => c.text && c.text.trim().length > 0)
                      .slice(0, 5)
                      .map((c, idx) => (
                        <div key={idx} style={{ padding: '0.75rem', borderRadius: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                            <span>{c.author || 'Anonyme'}</span>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', opacity: 0.8 }}>{c.date}</span>
                          </div>
                          <div style={{ color: 'var(--text-primary)', lineHeight: '1.5', whiteSpace: 'pre-line' }}>{c.text}</div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflow: 'hidden' }}>
              <div
                style={{
                  height: '240px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  position: 'relative',
                  cursor: mainPhoto ? 'pointer' : 'default',
                  overflow: 'hidden',
                  background: mainPhoto ? 'var(--card-bg)' : 'linear-gradient(45deg, var(--bg-color), var(--card-bg))',
                }}
                onClick={() => mainPhoto && openLightbox(photos.length - 1)}
                role="button"
                tabIndex={0}
              >
                {mainPhoto && (
                  <img
                    src={mainPhoto}
                    alt="Vue principale du refuge"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                )}
              </div>

              {photos && photos.length > 1 && (
                <div style={{ overflowY: 'auto', paddingRight: '0.3rem' }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                      gap: '0.75rem',
                    }}
                  >
                    {photos.slice(1).map((photo, idx) => (
                      <div
                        key={idx}
                        style={{
                          position: 'relative',
                          overflow: 'hidden',
                          borderRadius: '10px',
                          border: '1px solid rgba(255,255,255,0.07)',
                        }}
                        className="photo-thumb"
                        onClick={() => openLightbox(idx + 1)}
                      >
                        <img
                          src={photo}
                          alt={`Vue ${idx + 2}`}
                          style={{
                            width: '100%',
                            height: '110px',
                            objectFit: 'cover',
                            display: 'block',
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="glass-panel" style={{ padding: '1rem', background: 'rgba(255,255,255,0.03)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', justifyContent: 'flex-start' }}>
                  <MapPin size={18} />
                  <strong>Localisation</strong>
                </div>
                <div
                  ref={miniMapContainerRef}
                  style={{
                    height: '200px',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    border: '1px solid rgba(255,255,255,0.08)',
                    cursor: 'pointer',
                  }}
                  onClick={() => setMapExpanded(true)}
                />
              </div>
            </div>
          </div>

          {lightboxIndex !== null && photos && photos.length > 0 && (
            <div
              onClick={closeLightbox}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.8)',
                zIndex: 1200,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem',
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeLightbox();
                }}
                style={{
                  position: 'absolute',
                  top: 16,
                  right: 16,
                  background: 'rgba(0,0,0,0.6)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  color: 'white',
                  borderRadius: '50%',
                  width: 40,
                  height: 40,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <X size={20} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  gotoPhoto(-1);
                }}
                style={{
                  position: 'absolute',
                  left: 20,
                  background: 'rgba(0,0,0,0.6)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  color: 'white',
                  borderRadius: '50%',
                  width: 44,
                  height: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <ChevronLeft size={22} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  gotoPhoto(1);
                }}
                style={{
                  position: 'absolute',
                  right: 20,
                  background: 'rgba(0,0,0,0.6)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  color: 'white',
                  borderRadius: '50%',
                  width: 44,
                  height: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <ChevronRight size={22} />
              </button>
              <img
                src={photos[lightboxIndex]}
                alt={`Photo ${lightboxIndex + 1}`}
                style={{
                  maxHeight: '90vh',
                  maxWidth: '90vw',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
                }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          {mapExpanded && (
            <div
              onClick={() => setMapExpanded(false)}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.8)',
                zIndex: 1250,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1.5rem',
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'relative',
                  width: 'min(1100px, 95vw)',
                  height: 'min(750px, 85vh)',
                  background: 'var(--card-bg)',
                  borderRadius: '14px',
                  border: '1px solid rgba(255,255,255,0.12)',
                  overflow: 'hidden',
                  boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
                }}
              >
                <button
                  onClick={() => setMapExpanded(false)}
                  style={{
                    position: 'absolute',
                    top: 14,
                    right: 14,
                    background: 'rgba(0,0,0,0.5)',
                    border: '1px solid rgba(255,255,255,0.25)',
                    borderRadius: '50%',
                    width: 42,
                    height: 42,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    cursor: 'pointer',
                    zIndex: 2,
                  }}
                >
                  <X size={20} />
                </button>
                <div
                  style={{
                    position: 'absolute',
                    top: 16,
                    left: 16,
                    zIndex: 2,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="map-layer-toggle-button"
                    aria-label="Basculer le menu des fonds"
                    aria-expanded={showLayerMenu}
                    onClick={() => setShowLayerMenu((open) => !open)}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      border: '1px solid rgba(255,255,255,0.25)',
                      background: 'rgba(0,0,0,0.5)',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <Layers size={18} />
                  </button>
                  {showLayerMenu && (
                    <div
                      className="map-layer-menu"
                      style={{
                        background: 'rgba(0,0,0,0.6)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: '12px',
                        padding: '0.75rem',
                        backdropFilter: 'blur(4px)',
                        minWidth: '260px',
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Fonds supplémentaires</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                        {OVERLAY_LAYERS.filter((layer) => !layer.alwaysOn).map((layer) => (
                          <label
                            key={layer.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.6rem',
                              color: 'var(--text-primary)',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={!!overlayVisibility[layer.id]}
                              onChange={() => toggleOverlayLayer(layer.id)}
                            />
                            <span>{layer.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                  }}
                  ref={expandedMapRef}
                />
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default RefugeModal;
