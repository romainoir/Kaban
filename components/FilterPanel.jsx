import { useRef, useCallback } from 'react';
import { Heart, KeyRound, Map, Star } from 'lucide-react';

const FilterPanel = ({ draft, onChange, onReset, massifs = [] }) => {
  const debounceTimer = useRef(null);

  const updateRange = (key, value) => {
    const [min, max] = draft.altitude;
    const next = key === 'min' ? [Math.min(value, max), max] : [min, Math.max(value, min)];

    // Clear existing timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Debounce the onChange call
    debounceTimer.current = setTimeout(() => {
      onChange({ ...draft, altitude: next });
    }, 150);
  };

  const updateEquipment = (key) => {
    onChange({ ...draft, equipments: { ...draft.equipments, [key]: !draft.equipments[key] } });
  };

  return (
    <div className="glass-panel filter-panel">
      <div className="filter-header">
        <div>
          <h3 style={{ margin: 0 }}>Filtres</h3>
        </div>
        <button className="link-btn" type="button" onClick={onReset}>
          Reinitialiser
        </button>
      </div>

      <div className="filter-block">
        <label>Massif</label>
        <select
          value={draft.massif}
          onChange={(e) => onChange({ ...draft, massif: e.target.value })}
          className="filter-select"
        >
          {massifs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-block">
        <label>Altitude</label>
        <div className="range-row">
          <input
            type="range"
            min="0"
            max="4000"
            value={draft.altitude[0]}
            onChange={(e) => updateRange('min', Number(e.target.value))}
          />
          <input
            type="range"
            min="0"
            max="4000"
            value={draft.altitude[1]}
            onChange={(e) => updateRange('max', Number(e.target.value))}
          />
        </div>
        <div className="range-inputs">
          <input
            type="number"
            min="0"
            max="4000"
            value={draft.altitude[0]}
            onChange={(e) => updateRange('min', Number(e.target.value))}
          />
          <span>-</span>
          <input
            type="number"
            min="0"
            max="4000"
            value={draft.altitude[1]}
            onChange={(e) => updateRange('max', Number(e.target.value))}
          />
        </div>
      </div>

      <div className="filter-block">
        <label>Equipements</label>
        <div className="equip-grid">
          {Object.entries(draft.equipments).map(([key, val]) => (
            <label key={key} className={`chip ${val ? 'chip-active' : ''}`}>
              <input
                type="checkbox"
                checked={val}
                onChange={() => updateEquipment(key)}
                style={{ display: 'none' }}
              />
              {key}
            </label>
          ))}
        </div>
      </div>

      <div className="filter-block">
        <label>Capacite minimale</label>
        <input
          type="number"
          min="0"
          max="50"
          value={draft.capacity}
          onChange={(e) => onChange({ ...draft, capacity: Number(e.target.value) })}
          className="filter-select"
        />
      </div>

      <div className="filter-block toggle-row">
        <div className="filter-label">
          <KeyRound size={16} />
          <span>Inclure refuges fermés</span>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={draft.includeClosed}
            onChange={(e) => onChange({ ...draft, includeClosed: e.target.checked })}
          />
          <span className="slider" />
        </label>
      </div>

      <div className="filter-block toggle-row">
        <div className="filter-label">
          <Star size={16} />
          <span>Favoris uniquement</span>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={draft.showFavorites || false}
            onChange={(e) => onChange({ ...draft, showFavorites: e.target.checked })}
          />
          <span className="slider" />
        </label>
      </div>

      <div className="filter-block toggle-row">
        <div className="filter-label">
          <Heart size={16} />
          <span>Aimés uniquement</span>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={draft.showLiked || false}
            onChange={(e) => onChange({ ...draft, showLiked: e.target.checked })}
          />
          <span className="slider" />
        </label>
      </div>

      <div className="filter-block toggle-row">
        <div className="filter-label">
          <Map size={16} />
          <span>Filtrer par carte</span>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={draft.useMapFilter || false}
            onChange={(e) => onChange({ ...draft, useMapFilter: e.target.checked })}
          />
          <span className="slider" />
        </label>
      </div>

    </div>
  );
};


export default FilterPanel;
