import React from 'react';
import { motion } from 'framer-motion';
import { MapPin, Droplets, Flame, Bed, Star, Heart, Ban } from 'lucide-react';

const RefugeCard = ({ refuge, score, onSelect, layout = 'grid', isStarred, onToggleStar, isLiked, onToggleLike, isDisliked, onToggleDislike, onHover, onHoverEnd }) => {
  const { nom, coord, details, photos, remarks, places } = refuge.properties;

  const hasWater = details?.water && !details.water.toLowerCase().includes('non');
  const hasWood = details?.wood && !details.wood.toLowerCase().includes('non');
  const placeCount = places?.valeur ?? '?';
  const bgImage = photos && photos.length > 0 ? photos[photos.length - 1] : null;
  const isList = layout === 'list';

  return (
    <motion.div
      className="glass-panel"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, scale: 1.02, boxShadow: '0 16px 40px rgba(0,0,0,0.28)' }}
      onClick={() => onSelect(refuge)}
      onMouseEnter={onHover}
      onMouseLeave={onHoverEnd}
      style={{
        overflow: 'hidden',
        display: 'flex',
        flexDirection: isList ? 'row' : 'column',
        height: isList ? '160px' : '400px',
        cursor: 'pointer',
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: '16px',
      }}
    >
      <div
        style={{
          width: isList ? '180px' : '100%',
          minWidth: isList ? '180px' : 'auto',
          height: isList ? '100%' : '200px',
          background: bgImage ? `url(${bgImage}) center/cover` : 'linear-gradient(45deg, var(--bg-color), var(--card-bg))',
          position: 'relative',
        }}
      >
        <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: '8px' }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleStar();
            }}
            style={{
              background: 'rgba(0,0,0,0.6)',
              border: 'none',
              borderRadius: '50%',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: isStarred ? 'var(--warning)' : 'var(--text-secondary)',
            }}
          >
            <Star size={16} fill={isStarred ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleLike();
            }}
            style={{
              background: 'rgba(0,0,0,0.6)',
              border: 'none',
              borderRadius: '50%',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: isLiked ? '#ef4444' : 'var(--text-secondary)',
            }}
          >
            <Heart size={16} fill={isLiked ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleDislike();
            }}
            style={{
              background: 'rgba(0,0,0,0.6)',
              border: 'none',
              borderRadius: '50%',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: isDisliked ? '#ef4444' : 'var(--text-secondary)',
            }}
          >
            <Ban size={16} />
          </button>
        </div>
      </div>

      <div
        style={{
          padding: '1rem',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
            <span style={{
              fontSize: '0.7rem',
              fontWeight: '700',
              textTransform: 'uppercase',
              padding: '2px 8px',
              borderRadius: '12px',
              background: 'rgba(255,255,255,0.1)',
              color: 'var(--text-secondary)'
            }}>
              {refuge.properties.type?.valeur || 'Refuge'}
            </span>
            {score > 0 && (
              <span style={{ fontSize: '0.75rem', color: score > 80 ? 'var(--success)' : 'var(--warning)' }}>
                {Math.round(score)}% Match
              </span>
            )}
          </div>

          <h3 style={{
            fontSize: isList ? '1.1rem' : '1.25rem',
            marginBottom: '0.25rem',
            color: 'var(--text-primary)',
            lineHeight: 1.3
          }}>
            {nom}
          </h3>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            color: 'var(--text-secondary)',
            fontSize: '0.85rem',
            marginBottom: '0.5rem'
          }}>
            <span>{coord.alt}m</span>
          </div>

          <p
            style={{
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
              lineHeight: '1.4',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: isList ? 2 : 3,
              WebkitBoxOrient: 'vertical',
              margin: 0,
            }}
          >
            {remarks || 'Aucune remarque disponible.'}
          </p>
        </div>

      </div>
    </motion.div>
  );
};

export default RefugeCard;
