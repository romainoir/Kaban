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

    let animationFrame;
    let cameraTransitionFrame;
    let idleTimeout;
    let orbitStartTimeout;
    let mapInstance;
    let selectedLocation;
    let analyzedTerrain;

    const userInteractionEvents = [
      'dragstart',
      'zoomstart',
      'rotatestart',
      'pitchstart',
      'movestart',
      'mousedown',
      'mouseup',
      'click',
      'contextmenu',
      'wheel',
    ];

    const stopOrbit = () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
    };

    const toRadians = (degrees) => (degrees * Math.PI) / 180;

    const computeOrbitDistance = (zoomLevel, baseDistance = 420) => {
      const scaling = Math.pow(1.2, 14 - zoomLevel);
      return Math.min(Math.max(baseDistance * scaling, 180), 1400);
    };

    const buildCameraPosition = ({ bearing, pitch, distance, minAltitude }) => {
      const elevation = (mapInstance.queryTerrainElevation(selectedLocation) || 0) + minAltitude;
      const targetCoord = maplibregl.MercatorCoordinate.fromLngLat(selectedLocation, elevation);
      const metersToMercator = targetCoord.meterInMercatorCoordinateUnits();

      const pitchRad = toRadians(pitch);
      const bearingRad = toRadians(bearing);

      const horizontalDistance = Math.max(60, distance * Math.cos(pitchRad));
      const verticalDistance = distance * Math.sin(pitchRad);

      const offsetX = Math.sin(bearingRad) * horizontalDistance * metersToMercator;
      const offsetY = Math.cos(bearingRad) * horizontalDistance * metersToMercator;

      const position = new maplibregl.MercatorCoordinate(
        targetCoord.x + offsetX,
        targetCoord.y + offsetY,
        targetCoord.z + verticalDistance * metersToMercator
      );

      return { position, targetCoord };
    };

    const applyFreeCamera = ({ position, targetCoord }) => {
      const camera = mapInstance.getFreeCameraOptions();
      camera.position = position;
      camera.lookAtPoint(targetCoord);
      mapInstance.setFreeCameraOptions(camera);
    };

    const animateCameraTransition = (nextPosition, duration = 1400, onFinish) => {
      if (!nextPosition) return;

      if (cameraTransitionFrame) {
        cancelAnimationFrame(cameraTransitionFrame);
        cameraTransitionFrame = null;
      }

      const startCamera = mapInstance.getFreeCameraOptions();
      const startPosition = startCamera.position || nextPosition.position;
      const startTime = performance.now();

      const step = () => {
        const now = performance.now();
        const t = Math.min(1, (now - startTime) / duration);
        const eased = t * t * (3 - 2 * t);

        const x = startPosition.x + (nextPosition.position.x - startPosition.x) * eased;
        const y = startPosition.y + (nextPosition.position.y - startPosition.y) * eased;
        const z = startPosition.z + (nextPosition.position.z - startPosition.z) * eased;

        applyFreeCamera({ position: new maplibregl.MercatorCoordinate(x, y, z), targetCoord: nextPosition.targetCoord });

        if (t < 1) {
          cameraTransitionFrame = requestAnimationFrame(step);
        } else if (typeof onFinish === 'function') {
          cameraTransitionFrame = null;
          onFinish();
        } else {
          cameraTransitionFrame = null;
        }
      };

      cameraTransitionFrame = requestAnimationFrame(step);
    };

    const orbit = () => {
      if (!mapInstance || !analyzedTerrain) return;

      const currentZoom = mapInstance.getZoom();
      const distance = computeOrbitDistance(currentZoom, analyzedTerrain.baseDistance);
      const nextBearing = (mapInstance.getBearing() + 0.15) % 360;

      const cameraPosition = buildCameraPosition({
        bearing: nextBearing,
        pitch: analyzedTerrain.pitch,
        distance,
        minAltitude: analyzedTerrain.safetyMargin,
      });

      applyFreeCamera(cameraPosition);
      mapInstance.setBearing(nextBearing, { animate: false });

      animationFrame = requestAnimationFrame(orbit);
    };

    const startOrbit = () => {
      stopOrbit();
      animationFrame = requestAnimationFrame(orbit);
    };

    const resetIdleTimer = () => {
      if (idleTimeout) clearTimeout(idleTimeout);
      idleTimeout = setTimeout(startOrbit, 5000);
    };

    const handleUserInteraction = (event) => {
      if (!event?.originalEvent) return;
      stopOrbit();
      if (cameraTransitionFrame) {
        cancelAnimationFrame(cameraTransitionFrame);
        cameraTransitionFrame = null;
      }
      resetIdleTimer();
    };

    const reframeOrbitAfterZoom = () => {
      if (!mapInstance || !analyzedTerrain) return;
      stopOrbit();

      const cameraPosition = buildCameraPosition({
        bearing: mapInstance.getBearing(),
        pitch: analyzedTerrain.pitch,
        distance: computeOrbitDistance(mapInstance.getZoom(), analyzedTerrain.baseDistance),
        minAltitude: analyzedTerrain.safetyMargin,
      });

      animateCameraTransition(cameraPosition, 800, () => {
        resetIdleTimer();
        startOrbit();
      });
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

      mapInstance.on('zoomend', reframeOrbitAfterZoom);

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

      mapInstance.on('remove', stopOrbit);

      orbitStartTimeout = null;

      mapInstance.on('load', async () => {
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
          model.position.y -= box.min.y; // Align bottom to ground
          model.position.z -= center.z;

          // Reduced scale from 60 to 30
          model.scale.setScalar((30 * 5) / maxDimension);

          const analyzeTerrain = () => {
            const center = selectedLocation;
            const offset = 0.001; // ~100m

            // 1. Calculate Slope / Orientation
            // We need to handle cases where elevation is not yet available
            const getElev = (lng, lat) => mapInstance.queryTerrainElevation(new maplibregl.LngLat(lng, lat)) || 0;

            const eC = getElev(center.lng, center.lat);
            const eN = getElev(center.lng, center.lat + offset);
            const eS = getElev(center.lng, center.lat - offset);
            const eE = getElev(center.lng + offset, center.lat);
            const eW = getElev(center.lng - offset, center.lat);

            // If elevation data is missing (0), we might get wrong results, but it's a fallback
            if (eN === 0 && eS === 0 && eE === 0 && eW === 0) {
              return { rotation: 0, pitch: 60, zoom: 15, safetyMargin: 60, baseDistance: 420 };
            }

            const dz_dy = eN - eS; // North - South
            const dz_dx = eE - eW; // East - West

            // Downhill direction (angle from East, CCW)
            const downhillAngle = Math.atan2(-dz_dy, -dz_dx);

            // Model rotation: Assuming model front is +Z (North in our aligned space)
            // East (0) -> Rotate -90 (-PI/2)
            // North (PI/2) -> Rotate 0
            const rotation = downhillAngle - Math.PI / 2;

            // 2. Analyze Surroundings for Camera Safety
            const checkRadius = 0.01; // ~800m - 1km (Camera orbit path)
            const samples = 16;
            let maxElevDiff = -Infinity;

            for (let i = 0; i < samples; i++) {
              const theta = (i / samples) * Math.PI * 2;
              const lng = center.lng + checkRadius * Math.cos(theta);
              const lat = center.lat + checkRadius * Math.sin(theta);
              const elev = getElev(lng, lat);
              if (elev !== null) {
                const diff = elev - eC;
                if (diff > maxElevDiff) maxElevDiff = diff;
              }
            }

            // Heuristics for Camera
            let pitch = 60;
            let zoom = 14.8; // Further away

            if (maxElevDiff > 200) {
              // Very high walls
              pitch = 40;
            } else if (maxElevDiff > 100) {
              pitch = 50;
            } else if (maxElevDiff < -50) {
              // Peak
              pitch = 70;
            }

            const safetyMargin = Math.max(40, 20 + Math.max(0, maxElevDiff));
            const baseDistance = 420 + Math.max(0, maxElevDiff * 0.8);

            return { rotation, pitch, zoom, safetyMargin, baseDistance };
          };

          // Wait a bit for terrain to potentially load if it hasn't
          // But we are in an async flow, so we can just try.
          const { rotation, pitch, zoom, safetyMargin, baseDistance } = analyzeTerrain();

          analyzedTerrain = { pitch, safetyMargin, baseDistance };

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

          // Delay the fly-in to ensure top-down view is established and terrain loads
          const warmupView = {
            center: selectedLocation,
            zoom,
            pitch: Math.min(20, pitch),
            bearing: mapInstance.getBearing(),
            duration: 600,
            essential: true,
          };

          mapInstance.easeTo(warmupView);

          const targetCamera = buildCameraPosition({
            bearing: warmupView.bearing,
            pitch,
            distance: computeOrbitDistance(zoom, baseDistance),
            minAltitude: safetyMargin,
          });

          mapInstance.once('moveend', () => {
            orbitStartTimeout = setTimeout(() => {
              if (!mapInstance) return;

              animateCameraTransition(targetCamera, 1400, () => {
                startOrbit();
                resetIdleTimer();
              });
            }, 1000);
          });
        } catch (error) {
          console.error('Failed to load 3D model', error);
        }
      });
    };

    setupExpandedMap();

    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (cameraTransitionFrame) cancelAnimationFrame(cameraTransitionFrame);
      if (idleTimeout) clearTimeout(idleTimeout);
      if (orbitStartTimeout) clearTimeout(orbitStartTimeout);
      if (mapInstance) {
        userInteractionEvents.forEach((eventName) => {
          mapInstance.off(eventName, handleUserInteraction);
        });
        mapInstance.off('zoomend', reframeOrbitAfterZoom);
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
