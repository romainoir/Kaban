// --- Config ---
const mapStyle = 'https://tiles.openfreemap.org/styles/liberty';
const startCenter = [2.2137, 46.2276];
const startZoom = 5;

// --- Icons (SVG data URIs) ---
const REFUGE_ICON = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="%23ffffff" stroke-width="3"><path fill="%232e7d32" d="M8 30L32 12l24 18v20a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z"/><path d="M24 52V34a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v18"/><path d="M12 32l20-15 20 15"/></svg>';
const WEBCAM_ICON = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="%23ffffff" stroke-width="3"><circle cx="28" cy="28" r="16" fill="%233b82f6"/><circle cx="28" cy="28" r="7" fill="none"/><path d="M44 22l12-6v24l-12-6" fill="%233b82f6" stroke-linejoin="round"/><path d="M14 48h28" stroke-linecap="round"/></svg>';

// --- Globals ---
let map;
const markers = new Map(); // Key -> Marker
const clusterThumbCache = new Map(); // Key -> URL

// --- Init ---
function initMap() {
    // Try to restore saved map position
    const savedCenter = localStorage.getItem('mapCenter');
    const savedZoom = localStorage.getItem('mapZoom');

    const initialCenter = savedCenter ? JSON.parse(savedCenter) : startCenter;
    const initialZoom = savedZoom ? parseFloat(savedZoom) : startZoom;

    map = new maplibregl.Map({
        container: 'map',
        style: mapStyle,
        center: initialCenter,
        zoom: initialZoom,
        renderWorldCopies: false
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', () => {
        loadData();
    });

    // Sync markers on move
    map.on('move', () => requestSync(false));
    map.on('zoom', () => requestSync(false));
    map.on('idle', () => requestSync(true));

    // Save map position when it changes
    map.on('moveend', () => {
        const center = map.getCenter();
        const zoom = map.getZoom();
        localStorage.setItem('mapCenter', JSON.stringify([center.lng, center.lat]));
        localStorage.setItem('mapZoom', zoom.toString());
    });
}

// --- Data Loading ---
function loadData() {
    // Webcams
    fetch('skaping_webcam.json')
        .then(r => r.json())
        .then(data => {
            const features = normalizeWebcams(data);
            addSource('webcams', features);
        })
        .catch(e => console.error('Webcams error:', e));

    // Refuges
    fetch('refuges_enriched.json')
        .then(r => r.json())
        .then(data => {
            addSource('refuges', data.features || []);
        })
        .catch(e => console.error('Refuges error:', e));
}

function normalizeWebcams(json) {
    if (json.type === 'FeatureCollection') return json.features;
    const out = [];
    const list = Array.isArray(json) ? json : [];
    list.forEach(item => {
        const lon = parseFloat(item.longitude || item.lon);
        const lat = parseFloat(item.latitude || item.lat);
        if (!isFinite(lon) || !isFinite(lat)) return;

        let thumb = '';
        if (item.point_of_views) {
            const pov = item.point_of_views.find(p => p.type === 'image') || item.point_of_views[0];
            if (pov) {
                thumb = pov.preview?.thumb || pov.latest_media?.thumb || '';
            }
        }

        out.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: {
                id: String(item.id),
                title: item.label || item.address || 'Webcam',
                thumb: thumb,
                url: item.url || '#',
                fov: item.fov,
                bearing: item.bearing
            }
        });
    });
    return out;
}

function addSource(id, features) {
    const fc = { type: 'FeatureCollection', features: features };
    map.addSource(id, {
        type: 'geojson',
        data: fc,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 60
    });

    // Add invisible layers to track clusters/points
    map.addLayer({ id: `ml-${id}-clusters`, type: 'circle', source: id, filter: ['has', 'point_count'], paint: { 'circle-opacity': 0, 'circle-radius': 1 } });
    map.addLayer({ id: `ml-${id}-points`, type: 'circle', source: id, filter: ['!', ['has', 'point_count']], paint: { 'circle-opacity': 0, 'circle-radius': 1 } });
}

// --- Marker Sync ---
let lastSync = 0;
let syncTimeout;
let pendingSync = false;

function requestSync(immediate) {
    if (syncTimeout) clearTimeout(syncTimeout);
    if (immediate) {
        syncMarkers();
    } else {
        syncTimeout = setTimeout(syncMarkers, 50);
    }
}

function syncMarkers() {
    if (!map) return;

    // Check if layers exist before querying
    const layersToCheck = ['ml-webcams-clusters', 'ml-webcams-points', 'ml-refuges-clusters', 'ml-refuges-points'];
    const existingLayers = layersToCheck.filter(id => map.getLayer(id));

    if (existingLayers.length === 0) return;

    const features = map.queryRenderedFeatures({ layers: existingLayers });

    const nextMarkers = new Set();

    features.forEach(f => {
        const isCluster = !!f.properties.cluster_id;
        const source = f.source; // 'webcams' or 'refuges'
        const id = isCluster ? `c-${source}-${f.properties.cluster_id}` : `p-${source}-${f.properties.id || f.id}`;

        nextMarkers.add(id);

        if (!markers.has(id)) {
            let marker;
            if (isCluster) {
                marker = source === 'webcams' ? createWebcamCluster(f) : createRefugeCluster(f);
            } else {
                marker = source === 'webcams' ? createWebcamMarker(f) : createRefugeMarker(f);
            }
            marker.addTo(map);
            markers.set(id, marker);
        } else {
            // Update position if needed (smooth drift fix)
            const m = markers.get(id);
            m.setLngLat(f.geometry.coordinates);
        }
    });

    // Remove old
    for (const [id, marker] of markers) {
        if (!nextMarkers.has(id)) {
            marker.remove();
            markers.delete(id);
        }
    }
}

// --- Marker Creators ---

function createWebcamMarker(f) {
    const el = document.createElement('div');
    el.className = 'marker-container';

    const wrap = document.createElement('div');
    wrap.className = 'cam-wrap';

    // FOV
    const fov = f.properties.fov || 90;
    const bearing = f.properties.bearing || 0;
    const fovEl = document.createElement('div');
    fovEl.className = 'cam-fov';
    fovEl.style.transform = `rotate(${bearing - fov / 2}deg)`;
    // CSS conic gradient handles the arc
    wrap.appendChild(fovEl);

    const marker = document.createElement('div');
    marker.className = 'cam-marker';
    const img = document.createElement('img');
    const photo = f.properties.thumb || '';
    img.src = photo || WEBCAM_ICON;
    img.referrerPolicy = 'no-referrer';
    marker.appendChild(img);
    wrap.appendChild(marker);

    el.appendChild(wrap);

    // Events
    setupHover(el, photo, f.properties.title);
    el.addEventListener('click', () => {
        openViewer({
            title: f.properties.title,
            url: f.properties.url,
            thumb: photo || WEBCAM_ICON,
            isWebcam: true
        });
        map.easeTo({ center: f.geometry.coordinates, zoom: 14 });
    });

    return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(f.geometry.coordinates);
}

function createWebcamCluster(f) {
    const cid = f.properties.cluster_id;
    const count = f.properties.point_count;

    const el = document.createElement('div');
    el.className = 'marker-container';

    const box = document.createElement('div');
    box.className = 'cluster-cam';

    // Count
    const span = document.createElement('div');
    span.className = 'cluster-count';
    span.textContent = count;
    box.appendChild(span);

    const addFallbackIcon = () => {
        if (box.querySelector('.cluster-icon')) return;
        const icon = document.createElement('img');
        icon.className = 'cluster-icon';
        icon.src = WEBCAM_ICON;
        icon.referrerPolicy = 'no-referrer';
        box.appendChild(icon);
        box.classList.add('no-photo');
    };

    const addThumb = (url) => {
        const img = document.createElement('img');
        img.src = url;
        img.referrerPolicy = 'no-referrer';
        box.appendChild(img);
        box.classList.remove('no-photo');
    };

    // Image
    const cacheKey = `webcams:${cid}`;
    const cached = clusterThumbCache.get(cacheKey);
    if (cached) {
        addThumb(cached);
    } else {
        // Fetch leaves
        map.getSource('webcams').getClusterLeaves(cid, 1, 0).then(leaves => {
            if (leaves[0]) {
                const url = leaves[0].properties.thumb;
                if (url) {
                    preloadImage(url).then(ok => {
                        if (ok) {
                            clusterThumbCache.set(cacheKey, url);
                            addThumb(url);
                        } else {
                            addFallbackIcon();
                        }
                    });
                } else {
                    addFallbackIcon();
                }
            } else {
                addFallbackIcon();
            }
        }).catch(addFallbackIcon);
    }

    el.appendChild(box);
    el.addEventListener('click', () => {
        map.getSource('webcams').getClusterExpansionZoom(cid).then(zoom => {
            map.easeTo({ center: f.geometry.coordinates, zoom });
        });
    });

    return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(f.geometry.coordinates);
}

function createRefugeMarker(f) {
    const p = f.properties;
    const el = document.createElement('div');
    el.className = 'marker-container';

    const hut = document.createElement('div');
    hut.className = 'hut-marker';

    // Status
    const status = (p.etat?.valeur || '').toLowerCase();
    if (status.includes('ferm') || status.includes('détru')) {
        hut.classList.add('is-closed');
    }

    const photos = extractPhotos(p);
    const photo = getRefugePrimaryPhoto(p);
    const thumb = photo || REFUGE_ICON;
    const title = p.nom || p.name || 'Refuge';

    // Image or Icon
    if (thumb) {
        hut.style.backgroundImage = `url('${thumb}')`;
    } else {
        const icon = document.createElement('img');
        icon.className = 'icon';
        icon.src = REFUGE_ICON;
        hut.appendChild(icon);
    }

    // Badge
    if (p.places?.valeur) {
        const badge = document.createElement('div');
        badge.className = 'hut-badge';
        badge.textContent = p.places.valeur;
        hut.appendChild(badge);
    }

    el.appendChild(hut);

    // Events
    setupHover(el, photo, title);
    el.addEventListener('click', (e) => {
        e.stopPropagation();
        openViewer({
            title: title,
            url: p.lien,
            thumb: thumb,
            photos: photos
        });
        map.easeTo({ center: f.geometry.coordinates, zoom: 14 });
    });

    return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(f.geometry.coordinates);
}

function createRefugeCluster(f) {
    const cid = f.properties.cluster_id;
    const count = f.properties.point_count;

    const el = document.createElement('div');
    el.className = 'marker-container';

    const box = document.createElement('div');
    box.className = 'cluster-hut';

    const span = document.createElement('span');
    span.textContent = count;
    box.appendChild(span);

    const cacheKey = `refuges:${cid}`;
    const cached = clusterThumbCache.get(cacheKey);

    const setFallback = () => {
        box.classList.add('no-photo');
        box.style.backgroundImage = `url('${REFUGE_ICON}')`;
    };

    const setImage = (url) => {
        box.classList.remove('no-photo');
        box.style.backgroundImage = `url('${url}')`;
    };

    if (cached) {
        setImage(cached);
    } else {
        map.getSource('refuges').getClusterLeaves(cid, 10, 0).then(leaves => {
            const leaf = leaves.find(l => getRefugePrimaryPhoto(l.properties));
            if (leaf) {
                const url = getRefugePrimaryPhoto(leaf.properties);
                if (url) {
                    preloadImage(url).then(ok => {
                        if (ok) {
                            clusterThumbCache.set(cacheKey, url);
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
        }).catch(setFallback);
    }

    el.appendChild(box);
    el.addEventListener('click', () => {
        map.getSource('refuges').getClusterExpansionZoom(cid).then(zoom => {
            map.easeTo({ center: f.geometry.coordinates, zoom });
        });
    });

    return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(f.geometry.coordinates);
}

// --- Utils ---
function preloadImage(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
    });
}

// Normalizes photos property to an array
function extractPhotos(p) {
    let photos = p.photos;
    if (typeof photos === 'string') {
        try { photos = JSON.parse(photos); } catch (e) { photos = []; }
    }
    if (!Array.isArray(photos)) photos = [];
    return photos;
}

// Picks the last photo when available, fallback to thumbnail
function getRefugePrimaryPhoto(p) {
    const photos = extractPhotos(p);
    if (photos.length) return photos[photos.length - 1];
    return p.thumbnail || '';
}

// --- Hover ---
const hoverPreview = document.getElementById('hoverPreview');
let hoverShown = false;
const lastMouse = { x: 0, y: 0 };

function setupHover(el, url, title) {
    if (!url) return;
    el.addEventListener('mouseenter', (e) => {
        lastMouse.x = e.clientX;
        lastMouse.y = e.clientY;
        showHover(url, title);
    });
    el.addEventListener('mousemove', (e) => {
        lastMouse.x = e.clientX;
        lastMouse.y = e.clientY;
        updateHoverPos();
    });
    el.addEventListener('mouseleave', hideHover);
}

function showHover(url, title) {
    hoverPreview.innerHTML = '';

    // Add title if provided
    if (title) {
        const titleEl = document.createElement('div');
        titleEl.className = 'hover-title';
        titleEl.textContent = title;
        hoverPreview.appendChild(titleEl);
    }

    const img = document.createElement('img');
    img.referrerPolicy = 'no-referrer';
    img.src = url;
    hoverPreview.appendChild(img);
    hoverPreview.classList.add('open');
    hoverShown = true;
    updateHoverPos();
}

function hideHover() {
    hoverPreview.classList.remove('open');
    hoverShown = false;
}

function updateHoverPos() {
    if (!hoverShown) return;
    hoverPreview.style.left = lastMouse.x + 'px';
    hoverPreview.style.top = lastMouse.y + 'px';
}

// --- Viewer ---
const viewer = document.getElementById('viewer');

function openViewer(props) {
    const { title, url, thumb, photos = [] } = props;

    const panel = document.createElement('div');
    panel.className = 'viewer-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'viewer-header';
    header.innerHTML = `<div class="viewer-title">${title}</div><button class="close-btn">×</button>`;
    header.querySelector('.close-btn').onclick = closeViewer;
    panel.appendChild(header);

    // Content
    const content = document.createElement('div');
    content.className = 'viewer-content';
    const mainImg = document.createElement('img');
    mainImg.className = 'main-img';
    mainImg.referrerPolicy = 'no-referrer';
    content.appendChild(mainImg);

    if (url && url !== '#') {
        const link = document.createElement('a');
        link.className = 'external-link';
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.innerHTML = `<span>Voir source</span><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42L17.59 5H14V3z"/><path d="M5 5h6v2H7v10h10v-4h2v6H5z"/></svg>`;
        content.appendChild(link);
    }
    panel.appendChild(content);

    // Gallery
    let allPhotos = [];
    if (thumb) allPhotos.push(thumb);
    if (photos.length) allPhotos = [...allPhotos, ...photos];
    allPhotos = [...new Set(allPhotos.filter(Boolean))];

    let currentIndex = 0;

    // Footer
    const footer = document.createElement('div');
    footer.className = 'viewer-footer';

    const updateImage = () => {
        mainImg.src = allPhotos[currentIndex];

        const thumbs = footer.querySelectorAll('.thumb-btn');
        thumbs.forEach((t, i) => {
            if (i === currentIndex) t.classList.add('active');
            else t.classList.remove('active');

            // Center active thumbnail
            if (i === currentIndex) {
                t.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        });
    };

    if (allPhotos.length > 1) {
        // Nav Buttons
        const prevBtn = document.createElement('button');
        prevBtn.className = 'nav-btn prev';
        prevBtn.innerHTML = '‹';
        prevBtn.onclick = (e) => { e.stopPropagation(); currentIndex = (currentIndex - 1 + allPhotos.length) % allPhotos.length; updateImage(); };

        const nextBtn = document.createElement('button');
        nextBtn.className = 'nav-btn next';
        nextBtn.innerHTML = '›';
        nextBtn.onclick = (e) => { e.stopPropagation(); currentIndex = (currentIndex + 1) % allPhotos.length; updateImage(); };

        content.appendChild(prevBtn);
        content.appendChild(nextBtn);

        // Thumbs
        allPhotos.forEach((src, i) => {
            const btn = document.createElement('button');
            btn.className = 'thumb-btn';
            const img = document.createElement('img');
            img.src = src;
            img.referrerPolicy = 'no-referrer';
            btn.appendChild(img);
            btn.onclick = (e) => { e.stopPropagation(); currentIndex = i; updateImage(); };
            btn.onmouseenter = () => { currentIndex = i; updateImage(); };
            footer.appendChild(btn);
        });
        panel.appendChild(footer);
    }

    viewer.innerHTML = '';
    viewer.appendChild(panel);
    viewer.classList.add('open');
    updateImage();
}

function closeViewer() {
    viewer.classList.remove('open');
    setTimeout(() => { viewer.innerHTML = ''; }, 300);
}

viewer.addEventListener('click', (e) => {
    if (e.target === viewer) closeViewer();
});
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeViewer();
});

initMap();
