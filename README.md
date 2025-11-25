# 🏔️ Refuge Explorer

A modern, interactive web application for exploring mountain refuges in the French Alps. Built with React and MapLibre GL, featuring advanced filtering, 3D terrain visualization, and intelligent refuge ranking.

![Refuge Explorer](https://img.shields.io/badge/React-18.3-blue) ![MapLibre](https://img.shields.io/badge/MapLibre-GL-green) ![Vite](https://img.shields.io/badge/Vite-5.4-purple)

## ✨ Features

### 🗺️ Interactive Map
- **3D Terrain Visualization** with hillshading
- **Smart Clustering** for better performance with 1300+ refuges
- **Custom Markers** with refuge thumbnails
- **Massif Polygon Overlay** when filtering by mountain range
- **Map-based Filtering** (optional) to show only refuges in the visible area

### 🔍 Advanced Filtering
- **Massif Selection** - Filter by 490+ mountain ranges (automatically computed via point-in-polygon)
- **Altitude Range** - Find refuges at your preferred elevation
- **Capacity** - Filter by number of available places
- **Amenities** - Water, wood/heating, latrines, mattresses, blankets
- **Status** - Include/exclude closed or destroyed refuges
- **Personal Lists** - Favorites (⭐), Liked (❤️), and No-Go (🚫) lists

### 🎯 Smart Ranking
- **Spider Chart** to define your ideal refuge profile
- **Match Score** based on 5 criteria:
  - Comfort (capacity, wood, latrines)
  - Water availability
  - Accessibility (altitude-based)
  - Information richness (remarks, details)
  - Visual appeal (photos)
- **Automatic Sorting** - Disliked refuges always appear last

### 📱 Responsive Design
- **Adaptive Layout** - Works on desktop, tablet, and mobile
- **Three Panel Modes** - Collapsed, Normal, Expanded
- **View Modes** - Grid or List view for refuge cards
- **Glass Morphism UI** - Modern, premium design aesthetic

### 🎨 Rich Refuge Details
- **Photo Gallery** with lightbox
- **Detailed Information** - Altitude, capacity, type, amenities
- **User Comments** from refuges.info
- **Direct Links** to refuges.info for more information
- **Location Search** via Nominatim (OpenStreetMap)

## 🚀 Getting Started

### Prerequisites
- Node.js 16+ and npm

### Installation

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/refuge-explorer.git
cd refuge-explorer
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser to `http://localhost:5173`

### Building for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

## 📊 Data Sources

- **Refuge Data**: [refuges.info](https://www.refuges.info) API
- **Massif Polygons**: refuges.info polygon API (type=1 for massifs)
- **Base Map**: IGN Géoportail vector tiles
- **Terrain**: Mapterhorn DEM tiles
- **Geocoding**: Nominatim (OpenStreetMap)

## 🛠️ Technology Stack

- **React 18.3** - UI framework
- **Vite 5.4** - Build tool and dev server
- **MapLibre GL** - Interactive maps
- **Framer Motion** - Smooth animations
- **Lucide React** - Icon library
- **LocalStorage** - Persistent user preferences

## 📁 Project Structure

```
refuge-explorer/
├── public/
│   ├── refuges_enriched.json  # Main refuge dataset
│   └── massifs.json            # Massif polygon data
├── src/
│   ├── components/
│   │   ├── FilterPanel.jsx     # Filter controls
│   │   ├── GeoFilterMap.jsx    # Map component
│   │   ├── RefugeCard.jsx      # Refuge list item
│   │   ├── RefugeModal.jsx     # Refuge detail modal
│   │   └── SpiderChart.jsx     # Preference visualization
│   ├── App.jsx                 # Main application
│   ├── index.css               # Global styles
│   └── main.jsx                # Entry point
├── fetch_massifs.js            # Script to update massif data
└── inspect_page.js             # Scraping utility
```

## 🔧 Configuration

### Updating Massif Data

To refresh the massif polygon data:

```bash
node fetch_massifs.js
```

This will fetch the latest massif boundaries from refuges.info and save them to `public/massifs.json`.

## 🎨 Customization

### Styling
The app uses CSS custom properties for theming. Edit `src/index.css` to customize:
- Colors (`--primary`, `--success`, `--warning`, etc.)
- Glass morphism effects
- Spacing and typography

### Map Style
Change the base map by modifying the style URL in `GeoFilterMap.jsx`:
```javascript
style: 'YOUR_MAPLIBRE_STYLE_URL'
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

This project is open source and available under the MIT License.

## 🙏 Acknowledgments

- [refuges.info](https://www.refuges.info) for the comprehensive refuge database
- [IGN Géoportail](https://www.geoportail.gouv.fr) for base map tiles
- [Mapterhorn](https://tiles.mapterhorn.com) for terrain data
- The open-source community for amazing tools and libraries

## 📧 Contact

For questions or suggestions, please open an issue on GitHub.

---

**Built with ❤️ for mountain enthusiasts**
