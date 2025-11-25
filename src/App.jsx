import React, { useState, useEffect, useMemo, useRef } from 'react';
import RefugeCard from './components/RefugeCard';
import SpiderChart from './components/SpiderChart';
import RefugeModal from './components/RefugeModal';
import GeoFilterMap from './components/GeoFilterMap';
import FilterPanel from './components/FilterPanel';
import { Mountain, LayoutGrid, List, X, ChevronDown, Filter, Search, User, ChevronLeft, ChevronRight, Ban } from 'lucide-react';

const isPointInPolygon = (point, geometry) => {
  if (!geometry) return false;
  const [x, y] = point;
  let inside = false;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polys) {
    const ring = poly[0];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    if (inside) return true;
  }
  return inside;
};

const calcBBox = (geometry) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const coords = geometry.type === 'Polygon' ? geometry.coordinates.flat(1) : geometry.coordinates.flat(2);
  coords.forEach(([x, y]) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });
  return [minX, minY, maxX, maxY];
};

const createDefaultFilters = () => ({
  massif: 'all',
  altitude: [0, 3500],
  equipments: { water: false, wood: false, heating: false, latrines: false, mattress: false, blankets: false },
  capacity: 0,
  includeClosed: false,
  useMapFilter: false,
});

function App() {
  const [refuges, setRefuges] = useState([]);
  const [selectedRefuge, setSelectedRefuge] = useState(null);
  const [viewMode, setViewMode] = useState('grid');
  const [mapBounds, setMapBounds] = useState(null);
  const [useMapFilter, setUseMapFilter] = useState(false);
  const [filters, setFilters] = useState(createDefaultFilters);
  const [preferences, setPreferences] = useState({
    comfort: 50,
    water: 50,
    access: 50,
    info: 50,
    view: 50,
  });
  const scrollRestoreRef = useRef({ body: '', html: '' });
  const [showSpider, setShowSpider] = useState(true);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [mapView, setMapView] = useState({ center: [6.4, 45.2], zoom: 6 });

  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showSortModal, setShowSortModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimeoutRef = useRef(null);
  const [panelMode, setPanelMode] = useState('normal'); // 'collapsed', 'normal', 'expanded'

  // Disable map filter when map is hidden (expanded mode) or when a massif is selected
  useEffect(() => {
    if (panelMode === 'expanded' && useMapFilter) {
      setUseMapFilter(false);
      setFilters(prev => ({ ...prev, useMapFilter: false }));
    }
  }, [panelMode]);

  // Disable map filter when a specific massif is selected (to avoid double-filtering)
  useEffect(() => {
    if (filters.massif !== 'all' && useMapFilter) {
      setUseMapFilter(false);
      setFilters(prev => ({ ...prev, useMapFilter: false }));
    }
  }, [filters.massif]);

  const [starredRefuges, setStarredRefuges] = useState(() => {
    const saved = localStorage.getItem('starred_refuges');
    return saved ? JSON.parse(saved) : [];
  });

  const [likedRefuges, setLikedRefuges] = useState(() => {
    const saved = localStorage.getItem('liked_refuges');
    return saved ? JSON.parse(saved) : [];
  });

  const [dislikedRefuges, setDislikedRefuges] = useState(() => {
    const saved = localStorage.getItem('disliked_refuges');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('starred_refuges', JSON.stringify(starredRefuges));
  }, [starredRefuges]);

  useEffect(() => {
    localStorage.setItem('liked_refuges', JSON.stringify(likedRefuges));
  }, [likedRefuges]);

  useEffect(() => {
    localStorage.setItem('disliked_refuges', JSON.stringify(dislikedRefuges));
  }, [dislikedRefuges]);

  const toggleStar = (id) => {
    setStarredRefuges((prev) => {
      if (prev.includes(id)) return prev.filter((i) => i !== id);
      return [...prev, id];
    });
  };

  const toggleLike = (id) => {
    setLikedRefuges((prev) => {
      if (prev.includes(id)) return prev.filter((i) => i !== id);
      return [...prev, id];
    });
  };

  const toggleDislike = (id) => {
    setDislikedRefuges((prev) => {
      if (prev.includes(id)) return prev.filter((i) => i !== id);
      return [...prev, id];
    });
  };

  useEffect(() => {
    if (selectedRefuge) {
      scrollRestoreRef.current = {
        body: document.body.style.overflow,
        html: document.documentElement.style.overflow,
      };
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = scrollRestoreRef.current.body;
      document.documentElement.style.overflow = scrollRestoreRef.current.html;
    }
    return () => {
      document.body.style.overflow = scrollRestoreRef.current.body;
      document.documentElement.style.overflow = scrollRestoreRef.current.html;
    };
  }, [selectedRefuge]);

  // Lock body scroll when mobile filters are open
  useEffect(() => {
    if (isMobileFiltersOpen) {
      document.body.style.overflow = 'hidden';
    } else if (!selectedRefuge) {
      document.body.style.overflow = '';
    }
  }, [isMobileFiltersOpen, selectedRefuge]);

  // Lock scroll when map overlay is open
  useEffect(() => {
    if (mapExpanded) {
      document.body.style.overflow = 'hidden';
    } else if (!selectedRefuge && !isMobileFiltersOpen) {
      document.body.style.overflow = '';
    }
  }, [mapExpanded, selectedRefuge, isMobileFiltersOpen]);

  useEffect(() => {
    fetch('/refuges_enriched.json')
      .then((res) => res.json())
      .then((data) => {
        const processed = data.features.map((f) => {
          const p = f.properties;
          const details = p.details || {};

          let comfort = 0;
          if (p.places?.valeur > 0) comfort += 40;
          if (details.wood && !details.wood.toLowerCase().includes('non')) comfort += 30;
          if (details.latrines) comfort += 30;
          if (p.type?.valeur?.includes('cabane')) comfort += 10;

          let water = 0;
          if (details.water && !details.water.toLowerCase().includes('non')) water = 100;
          else if (details.water?.toLowerCase().includes('proximite')) water = 50;

          const alt = p.coord?.alt || 1500;
          let access = Math.max(0, 100 - ((alt - 500) / 2500) * 100);

          let info = 0;
          if (p.remarks) info += Math.min(80, p.remarks.length / 5);
          if (p.details && Object.keys(p.details).length > 2) info += 20;

          let view = 0;
          if (p.photos && p.photos.length > 0) view = 100;

          return {
            ...f,
            attributes: { comfort, water, access, info, view },
          };
        });
        setRefuges(processed);
      })
      .catch((err) => console.error('Failed to load data', err));
  }, []);

  const [massifsData, setMassifsData] = useState(null);

  // Load massifs and pre-calculate bboxes
  useEffect(() => {
    fetch('/massifs.json')
      .then(res => res.json())
      .then(data => {
        data.features.forEach(f => {
          f.bbox = calcBBox(f.geometry);
        });
        setMassifsData(data);
      })
      .catch(console.error);
  }, []);

  // Map refuge ID to Massif ID
  const refugeMassifMap = useMemo(() => {
    if (!refuges.length || !massifsData) return {};
    const map = {};

    refuges.forEach(r => {
      if (r.properties.massif?.id) {
        map[r.properties.id] = r.properties.massif.id.toString();
        return;
      }

      const point = r.geometry.coordinates;
      for (const feature of massifsData.features) {
        const [minX, minY, maxX, maxY] = feature.bbox;
        const [x, y] = point;
        if (x < minX || x > maxX || y < minY || y > maxY) continue;

        if (isPointInPolygon(point, feature.geometry)) {
          map[r.properties.id] = feature.properties.id.toString();
          break;
        }
      }
    });
    return map;
  }, [refuges, massifsData]);

  // Compute available massifs for filter
  const availableMassifs = useMemo(() => {
    if (!massifsData) return [{ id: 'all', label: 'Tous les massifs' }];
    const usedIds = new Set(Object.values(refugeMassifMap));
    return [
      { id: 'all', label: 'Tous les massifs' },
      ...massifsData.features
        .filter(f => usedIds.has(f.properties.id.toString()))
        .map(f => ({ id: f.properties.id.toString(), label: f.properties.nom }))
        .sort((a, b) => a.label.localeCompare(b.label))
    ];
  }, [massifsData, refugeMassifMap]);

  const selectedMassifPolygon = useMemo(() => {
    if (!massifsData || filters.massif === 'all') return null;
    return massifsData.features.find(f => f.properties.id.toString() === filters.massif)?.geometry;
  }, [massifsData, filters.massif]);

  const refugesAfterFiltersNoMap = useMemo(() => {
    const isYes = (val) => val && !val.toLowerCase().includes('non');

    return refuges.filter((r) => {
      const p = r.properties;
      const coords = r.geometry?.coordinates || [];
      const [lon, lat] = coords;
      const alt = p.coord?.alt ?? 0;
      const places = p.places?.valeur ?? 0;
      const details = p.details || {};
      const status = (p.status || '').toLowerCase();
      if (!filters.includeClosed && (status.includes('ferm') || status.includes('detru'))) return false;

      // Filter by massif if not "all"
      if (filters.massif !== 'all') {
        const mid = refugeMassifMap[r.properties.id];
        if (!mid || mid !== filters.massif) return false;
      }

      if (alt < filters.altitude[0] || alt > filters.altitude[1]) return false;
      if (places < filters.capacity) return false;

      const eq = filters.equipments;
      if (eq.water && !isYes(details.water || '')) return false;
      if (eq.wood && !isYes(details.wood || details.heating || '')) return false;
      if (eq.heating && !isYes(details.heating || details.wood || '')) return false;
      if (eq.latrines && !isYes(details.latrines || '')) return false;
      if (eq.mattress && !isYes(details.mattress || '')) return false;
      if (eq.blankets && !isYes(details.blankets || '')) return false;

      if (filters.showFavorites && !starredRefuges.includes(r.properties.id)) return false;
      if (filters.showLiked && !likedRefuges.includes(r.properties.id)) return false;

      return true;
    });
  }, [refuges, filters, starredRefuges, likedRefuges]);

  const refugesAfterMap = useMemo(() => {
    if (!useMapFilter || !mapBounds) return refugesAfterFiltersNoMap;
    return refugesAfterFiltersNoMap.filter((r) => {
      const coords = r.geometry?.coordinates;
      if (!coords || coords.length < 2) return false;
      const [lon, lat] = coords;
      return lat >= mapBounds.south && lat <= mapBounds.north && lon >= mapBounds.west && lon <= mapBounds.east;
    });
  }, [refugesAfterFiltersNoMap, mapBounds, useMapFilter]);

  // Sync useMapFilter from filters
  useEffect(() => {
    if (filters.useMapFilter !== useMapFilter) {
      setUseMapFilter(filters.useMapFilter);
    }
  }, [filters.useMapFilter]);

  const rankedRefuges = useMemo(() => {
    if (refugesAfterMap.length === 0) return [];

    return refugesAfterMap
      .map((refuge) => {
        const attr = refuge.attributes;
        const diff =
          Math.abs(attr.comfort - preferences.comfort) +
          Math.abs(attr.water - preferences.water) +
          Math.abs(attr.access - preferences.access) +
          Math.abs(attr.info - preferences.info) +
          Math.abs(attr.view - preferences.view);

        const matchScore = Math.max(0, 100 - diff / 5);
        const isDisliked = dislikedRefuges.includes(refuge.properties.id);

        return { ...refuge, matchScore, isDisliked };
      })
      .sort((a, b) => {
        // Disliked refuges always go to the end
        if (a.isDisliked && !b.isDisliked) return 1;
        if (!a.isDisliked && b.isDisliked) return -1;
        // Otherwise sort by match score
        return b.matchScore - a.matchScore;
      });
  }, [refugesAfterMap, preferences, dislikedRefuges]);

  const displayedRefuges = rankedRefuges;

  const updateFilters = (next) => {
    setFilters({
      ...next,
      altitude: [...next.altitude],
      equipments: { ...next.equipments },
    });
  };

  const resetFilters = () => {
    const fresh = createDefaultFilters();
    setFilters(fresh);
  };

  const handleBoundsChange = (bounds) => {
    setMapBounds(bounds);
  };

  const clearMapFilter = () => {
    setMapBounds(null);
    setUseMapFilter(false);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1`
      );
      const data = await response.json();

      if (data && data.length > 0) {
        const result = data[0];
        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);

        // Update map view to focus on the searched location
        setMapView({
          center: [lon, lat],
          zoom: 12
        });
      }
    } catch (error) {
      console.error('Search error:', error);
    }
  };

  // Fetch search suggestions
  const fetchSuggestions = async (query) => {
    if (!query.trim() || query.length < 3) {
      setSearchSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=fr,ch,it`
      );
      const data = await response.json();
      setSearchSuggestions(data);
      setShowSuggestions(data.length > 0);
    } catch (error) {
      console.error('Suggestions error:', error);
    }
  };

  // Handle search input change with debouncing
  const handleSearchInputChange = (value) => {
    setSearchQuery(value);

    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Set new timeout for fetching suggestions
    searchTimeoutRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 300);
  };

  // Handle suggestion selection
  const handleSuggestionClick = (suggestion) => {
    const lat = parseFloat(suggestion.lat);
    const lon = parseFloat(suggestion.lon);

    setSearchQuery(suggestion.display_name);
    setShowSuggestions(false);
    setSearchSuggestions([]);

    setMapView({
      center: [lon, lat],
      zoom: 12
    });
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <header style={{
        height: '64px',
        background: 'var(--card-bg)',
        borderBottom: '1px solid var(--card-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 1.5rem',
        zIndex: 50
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img src="/logo.png" alt="Kaban" style={{ width: '40px', height: '40px', objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
          <h1 style={{ fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.03em' }}>Kaban</h1>
        </div>

        <div style={{
          flex: 1,
          maxWidth: '600px',
          margin: '0 auto',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div style={{
            width: '100%',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid var(--card-border)',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            padding: '4px',
            paddingLeft: '1rem'
          }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSearch();
                  setShowSuggestions(false);
                } else if (e.key === 'Escape') {
                  setShowSuggestions(false);
                }
              }}
              onFocus={() => searchQuery.length >= 3 && searchSuggestions.length > 0 && setShowSuggestions(true)}
              placeholder="Où souhaitez-vous bivouaquer ? (Massif, sommet...)"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                flex: 1,
                outline: 'none',
                fontSize: '0.95rem'
              }}
            />
            <button
              onClick={() => setShowFilters(!showFilters)}
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                borderRadius: '6px',
                padding: '0.4rem 0.8rem',
                color: 'var(--text-primary)',
                fontWeight: '600',
                cursor: 'pointer',
                marginRight: '4px',
                fontSize: '0.9rem'
              }}
            >
              Filtres
            </button>
            <button
              onClick={handleSearch}
              style={{
                background: 'var(--accent)',
                border: 'none',
                borderRadius: '6px',
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#fff'
              }}>
              <Search size={20} />
            </button>
          </div>

          {/* Search Suggestions Dropdown */}
          {showSuggestions && searchSuggestions.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: '8px',
              background: 'var(--card-bg)',
              border: '1px solid var(--card-border)',
              borderRadius: '8px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
              backdropFilter: 'blur(12px)',
              maxHeight: '300px',
              overflowY: 'auto',
              zIndex: 1000
            }}>
              {searchSuggestions.map((suggestion, index) => (
                <div
                  key={suggestion.place_id}
                  onClick={() => handleSuggestionClick(suggestion)}
                  style={{
                    padding: '0.75rem 1rem',
                    cursor: 'pointer',
                    borderBottom: index < searchSuggestions.length - 1 ? '1px solid var(--card-border)' : 'none',
                    transition: 'background 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '4px' }}>
                    {suggestion.display_name.split(',')[0]}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {suggestion.display_name}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Main Layout */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

        {/* Filters Overlay */}
        {showFilters && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '40%',
            minWidth: '400px',
            maxWidth: '550px',
            height: '100%',
            background: 'var(--card-bg)',
            backdropFilter: 'blur(12px)',
            borderRight: '1px solid var(--card-border)',
            zIndex: 40,
            padding: '1.5rem',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3>Filtres</h3>
              <button onClick={() => setShowFilters(false)} className="btn ghost" style={{ padding: '4px' }}><X size={18} /></button>
            </div>
            <FilterPanel
              draft={filters}
              onChange={setFilters}
              onReset={() => setFilters(createDefaultFilters())}
              showFavorites={filters.showFavorites}
              onToggleFavorites={() => setFilters(prev => ({ ...prev, showFavorites: !prev.showFavorites }))}
              showLiked={filters.showLiked}
              onToggleLiked={() => setFilters(prev => ({ ...prev, showLiked: !prev.showLiked }))}
              massifs={availableMassifs}
            />
          </div>
        )}

        {/* Left Sidebar (List) */}
        <div style={{
          width: panelMode === 'collapsed' ? '60px' : panelMode === 'expanded' ? '100%' : '40%',
          minWidth: panelMode === 'collapsed' ? '60px' : '400px',
          maxWidth: panelMode === 'expanded' ? '100%' : '550px',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--card-border)',
          background: 'var(--bg-color)',
          zIndex: 10,
          position: 'relative',
          transition: 'width 0.3s ease'
        }}>
          {/* Collapse/Expand Control */}
          <div
            style={{
              position: 'absolute',
              right: panelMode === 'expanded' ? '0' : '-24px',
              top: '50%',
              transform: 'translateY(-50%)',
              width: '24px',
              height: '80px',
              background: 'var(--card-bg)',
              border: '1px solid var(--card-border)',
              borderLeft: panelMode === 'expanded' ? '1px solid var(--card-border)' : 'none',
              borderRight: panelMode === 'expanded' ? 'none' : '1px solid var(--card-border)',
              borderRadius: panelMode === 'expanded' ? '12px 0 0 12px' : '0 12px 12px 0',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 20,
              boxShadow: '4px 0 12px rgba(0,0,0,0.1)',
              overflow: 'hidden',
              transition: 'right 0.3s ease, border-radius 0.3s ease'
            }}
          >
            {/* Expand (Right) */}
            <button
              onClick={() => {
                if (panelMode === 'collapsed') setPanelMode('normal');
                else if (panelMode === 'normal') setPanelMode('expanded');
              }}
              disabled={panelMode === 'expanded'}
              style={{
                flex: 1,
                width: '100%',
                border: 'none',
                background: 'transparent',
                cursor: panelMode === 'expanded' ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: panelMode === 'expanded' ? 'var(--text-secondary)' : 'var(--text-primary)',
                padding: 0,
                opacity: panelMode === 'expanded' ? 0.3 : 1,
                transition: 'background 0.2s'
              }}
              className={panelMode !== 'expanded' ? 'hover-bg' : ''}
            >
              <ChevronRight size={16} />
            </button>

            <div style={{ width: '12px', height: '1px', background: 'var(--card-border)' }} />

            {/* Collapse (Left) */}
            <button
              onClick={() => {
                if (panelMode === 'expanded') setPanelMode('normal');
                else if (panelMode === 'normal') setPanelMode('collapsed');
              }}
              disabled={panelMode === 'collapsed'}
              style={{
                flex: 1,
                width: '100%',
                border: 'none',
                background: 'transparent',
                cursor: panelMode === 'collapsed' ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: panelMode === 'collapsed' ? 'var(--text-secondary)' : 'var(--text-primary)',
                padding: 0,
                opacity: panelMode === 'collapsed' ? 0.3 : 1,
                transition: 'background 0.2s'
              }}
              className={panelMode !== 'collapsed' ? 'hover-bg' : ''}
            >
              <ChevronLeft size={16} />
            </button>
          </div>

          {panelMode !== 'collapsed' && (
            <>
              {/* List Header */}
              <div style={{ padding: '1.5rem 1.5rem 0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h2 style={{ fontSize: '1.25rem' }}>
                    {displayedRefuges.length} cabanes
                  </h2>
                  <button
                    onClick={() => setShowSortModal(true)}
                    className="btn ghost"
                    style={{ fontSize: '0.9rem', padding: '0.4rem 0.8rem' }}
                  >
                    Trier par
                  </button>
                </div>
                {panelMode === 'expanded' && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                    <button
                      className={`btn ${viewMode === 'list' ? '' : 'ghost'}`}
                      onClick={() => setViewMode('list')}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                    >
                      <List size={16} /> Liste
                    </button>
                    <button
                      className={`btn ${viewMode === 'grid' ? '' : 'ghost'}`}
                      onClick={() => setViewMode('grid')}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                    >
                      <LayoutGrid size={16} /> Grille
                    </button>
                  </div>
                )}
              </div>

              {/* Scrollable List */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '0 1.5rem 1.5rem' }}>
                <div style={{
                  display: panelMode === 'expanded' && viewMode === 'grid' ? 'grid' : 'flex',
                  gridTemplateColumns: panelMode === 'expanded' && viewMode === 'grid' ? 'repeat(auto-fill, minmax(300px, 1fr))' : undefined,
                  flexDirection: 'column',
                  gap: '1rem'
                }}>
                  {displayedRefuges.map((refuge) => (
                    <RefugeCard
                      key={refuge.properties.id}
                      refuge={refuge}
                      score={refuge.matchScore}
                      onSelect={setSelectedRefuge}
                      layout={panelMode === 'expanded' ? viewMode : 'list'}
                      isLiked={likedRefuges.includes(refuge.properties.id)}
                      onToggleLike={() => toggleLike(refuge.properties.id)}
                      isStarred={starredRefuges.includes(refuge.properties.id)}
                      onToggleStar={() => toggleStar(refuge.properties.id)}
                      isDisliked={dislikedRefuges.includes(refuge.properties.id)}
                      onToggleDislike={() => toggleDislike(refuge.properties.id)}
                    />
                  ))}
                  {displayedRefuges.length === 0 && (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                      Aucun refuge ne correspond à vos critères.
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right Side (Map) */}
        <div style={{
          flex: 1,
          position: 'relative',
          display: panelMode === 'expanded' ? 'none' : 'flex'
        }}>
          <GeoFilterMap
            refuges={refugesAfterFiltersNoMap}
            onBoundsChange={handleBoundsChange}
            activeBounds={mapBounds}
            useMapFilter={useMapFilter}
            onToggleMapFilter={setUseMapFilter}
            onResetBounds={clearMapFilter}
            compact={false}
            title=""
            subtitle=""
            showControls={true}
            initialView={mapView}
            onViewChange={setMapView}
            onSelectMarker={setSelectedRefuge}
            selectedMassif={filters.massif !== 'all' ? filters.massif : null}
            selectedMassifPolygon={selectedMassifPolygon}
          />
        </div>
      </div>

      <RefugeModal
        refuge={selectedRefuge}
        onClose={() => setSelectedRefuge(null)}
        isStarred={selectedRefuge ? starredRefuges.includes(selectedRefuge.properties.id) : false}
        onToggleStar={() => selectedRefuge && toggleStar(selectedRefuge.properties.id)}
        isLiked={selectedRefuge ? likedRefuges.includes(selectedRefuge.properties.id) : false}
        onToggleLike={() => selectedRefuge && toggleLike(selectedRefuge.properties.id)}
        isDisliked={selectedRefuge ? dislikedRefuges.includes(selectedRefuge.properties.id) : false}
        onToggleDislike={() => selectedRefuge && toggleDislike(selectedRefuge.properties.id)}
      />

      {/* Sort Modal */}
      {
        showSortModal && (
          <div
            onClick={() => setShowSortModal(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.7)',
              backdropFilter: 'blur(8px)',
              zIndex: 1400,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2rem'
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--card-border)',
                borderRadius: '16px',
                padding: '2rem',
                maxWidth: '800px',
                width: '100%',
                maxHeight: '80vh',
                overflowY: 'auto'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2 style={{ margin: 0 }}>Définir votre refuge idéal</h2>
                <button
                  onClick={() => setShowSortModal(false)}
                  className="btn ghost"
                  style={{ padding: '4px' }}
                >
                  <X size={24} />
                </button>
              </div>
              <SpiderChart preferences={preferences} setPreferences={setPreferences} />
            </div>
          </div>
        )
      }
    </div >
  );
}

export default App;
