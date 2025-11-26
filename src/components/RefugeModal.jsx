import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MapPin, Droplets, Flame, Bed, ExternalLink, TreePine, Tent, MessageSquare, ChevronLeft, ChevronRight, Star, Heart, Ban } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { createRefugeMarker } from './GeoFilterMap';

const RefugeModal = ({ refuge, refuges = [], onClose, isStarred, onToggleStar, isLiked, onToggleLike, isDisliked, onToggleDislike }) => {
  if (!refuge) return null;

  const { nom, coord, details, photos, remarks, places, lien, type, comments = [] } = refuge.properties;
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const miniMapContainerRef = useRef(null);
  const miniMapRef = useRef(null);
  const expandedMapRef = useRef(null);

  const hasWater = details?.water && !details.water.toLowerCase().includes('non');
  const hasWood = details?.wood && !details.wood.toLowerCase().includes('non');
  const hasLatrines = details?.latrines && !details.latrines.toLowerCase().includes('non');
  const placeCount = places?.valeur ?? '?';

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

    const coords = refuge.geometry?.coordinates || [6.4, 45.2];
    const map = new maplibregl.Map({
      container: expandedMapRef.current,
      style: 'https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/gris.json',
      center: coords,
      zoom: 8,
      attributionControl: true,
    });

    const bounds = new maplibregl.LngLatBounds();
    const features = Array.isArray(refuges) ? refuges : [];

    features.forEach((feature) => {
      const position = feature.geometry?.coordinates;
      if (!position || position.length < 2) return;
      const isSelected = feature.properties?.id === refuge.properties?.id;

      const marker = createRefugeMarker(
        feature,
        map,
        undefined,
        { compact: true },
        { isSelected }
      );

      marker.addTo(map);

      bounds.extend(position);
    });

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 50, maxZoom: 12 });
    } else {
      map.setCenter(coords);
      map.setZoom(10);
    }

    return () => map.remove();
  }, [mapExpanded, refuge, refuges]);

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
                  background: photos && photos.length > 0 ? `url(${photos[photos.length - 1]}) center/cover` : 'linear-gradient(45deg, var(--bg-color), var(--card-bg))',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  position: 'relative',
                  cursor: photos && photos.length > 0 ? 'pointer' : 'default',
                }}
                onClick={() => photos && photos.length > 0 && openLightbox(photos.length - 1)}
                role="button"
                tabIndex={0}
              >
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    padding: '0.75rem 1rem',
                    background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)',
                    color: 'var(--text-primary)',
                    fontSize: '0.9rem',
                  }}
                >
                  Survolez une vignette pour zoomer
                </div>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <MapPin size={18} />
                    <strong>Localisation</strong>
                  </div>
                  <button
                    onClick={() => setMapExpanded(true)}
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      color: 'var(--text-primary)',
                      borderRadius: '12px',
                      padding: '0.35rem 0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    Agrandir la carte
                  </button>
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
