const FilterPanel = ({ draft, onChange, onReset, massifs = [] }) => {


  const updateRange = (key, value) => {
    const [min, max] = draft.altitude;
    const next = key === 'min' ? [Math.min(value, max), max] : [min, Math.max(value, min)];
    onChange({ ...draft, altitude: next });
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

      <div className="filter-block" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <label>Inclure refuges fermés</label>
        <input
          type="checkbox"
          checked={draft.includeClosed}
          onChange={(e) => onChange({ ...draft, includeClosed: e.target.checked })}
        />
      </div>

      <div className="filter-block" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <label>Favoris uniquement</label>
        <input
          type="checkbox"
          checked={draft.showFavorites || false}
          onChange={(e) => onChange({ ...draft, showFavorites: e.target.checked })}
        />
      </div>

      <div className="filter-block" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <label>Aimés uniquement</label>
        <input
          type="checkbox"
          checked={draft.showLiked || false}
          onChange={(e) => onChange({ ...draft, showLiked: e.target.checked })}
        />
      </div>

      <div className="filter-block" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <label>Filtrer par carte</label>
        <input
          type="checkbox"
          checked={draft.useMapFilter || false}
          onChange={(e) => onChange({ ...draft, useMapFilter: e.target.checked })}
        />
      </div>

    </div>
  );
};


export default FilterPanel;
