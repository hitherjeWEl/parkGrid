import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';

import Navbar from './components/Navbar';
import SpotCard from './components/SpotCard';
import SpotDetailDrawer from './components/SpotDetailDrawer';
import ActivePassCard from './components/ActivePassCard';
import NavigationBanner from './components/NavigationBanner';
import DeveloperConsole from './components/DeveloperConsole';
import MobileBottomNav from './components/MobileBottomNav';

import { 
  Search, 
  MapPin, 
  LocateFixed, 
  Sparkles, 
  Building2,
  Zap,
  X
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const CITIES = [
  {"name": "Connaught Place, New Delhi", "lat": 28.6315, "lng": 77.2195, "desc": "Central Delhi"},
  {"name": "Saket District Centre, South Delhi", "lat": 28.5283, "lng": 77.2185, "desc": "South Delhi Commercial Hub"},
  {"name": "DLF CyberHub, Gurugram", "lat": 28.4952, "lng": 77.0890, "desc": "Cyber City Tech Corridor"},
  {"name": "Hazratganj, Lucknow", "lat": 26.8505, "lng": 80.9463, "desc": "Heritage Market & Parking Hub"},
  {"name": "Phoenix Palassio, Lucknow", "lat": 26.8143, "lng": 81.0076, "desc": "Amar Shaheed Path"},
  {"name": "BKC, Mumbai", "lat": 19.0657, "lng": 72.8687, "desc": "Bandra Kurla Business District"},
  {"name": "Indiranagar, Bengaluru", "lat": 12.9719, "lng": 77.6412, "desc": "100 Feet Road Grid"},
];

export default function App() {
  // Check if URL specifies developer mode
  const initialIsDev = 
    window.location.pathname.startsWith('/developer') ||
    new URLSearchParams(window.location.search).get('mode') === 'developer' ||
    new URLSearchParams(window.location.search).get('role') === 'developer' ||
    new URLSearchParams(window.location.search).get('role') === 'partner';

  const [isDeveloperMode, setIsDeveloperMode] = useState(initialIsDev);

  // Civilian Geolocation State
  const [userPos, setUserPos] = useState({ lat: 28.6315, lng: 77.2195 });
  const [userSpeedKmh, setUserSpeedKmh] = useState(0);
  const [gpsLocked, setGpsLocked] = useState(false);
  const [selectedCity, setSelectedCity] = useState(CITIES[0].name);

  // Search & Spots
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [spots, setSpots] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('all'); // 'all' | 'paid' | 'free' | 'ev'
  const [vehicleFilter, setVehicleFilter] = useState('all'); // 'all' | 'Hatchback' | 'Sedan' | 'SUV' | 'Two-Wheeler'
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [loadingSpots, setLoadingSpots] = useState(false);

  // Navigation & Routing State
  const [routeInfo, setRouteInfo] = useState(null);
  const [navSteps, setNavSteps] = useState([]);
  const [navActive, setNavActive] = useState(false);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [distToNextTurnM, setDistToNextTurnM] = useState(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [isSimulating, setIsSimulating] = useState(false);
  const simulationTimerRef = useRef(null);

  // Digital Pass State (persisted in localStorage)
  const [activePass, setActivePass] = useState(() => {
    try {
      const saved = localStorage.getItem('parkgrid_active_pass');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Mobile Drawer State ('collapsed' | 'half' | 'expanded')
  const [mobileDrawerState, setMobileDrawerState] = useState('half');

  // Map References
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const routeLayerRef = useRef(null);
  const carMarkerRef = useRef(null);
  const routeCoordsRef = useRef([]);

  // Save active pass to localStorage
  useEffect(() => {
    if (activePass) {
      localStorage.setItem('parkgrid_active_pass', JSON.stringify(activePass));
    } else {
      localStorage.removeItem('parkgrid_active_pass');
    }
  }, [activePass]);

  // Voice Guidance (Civilian navigation)
  const speakInstruction = useCallback((text) => {
    if (!voiceEnabled || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Speech synthesis error:', e);
    }
  }, [voiceEnabled]);

  function formatManeuver(step) {
    const type = step.maneuver?.type || 'continue';
    const modifier = step.maneuver?.modifier || '';
    const road = step.name ? ` onto ${step.name}` : '';
    if (type === 'depart') return `Head ${modifier || 'forward'}${road}`;
    if (type === 'arrive') return `You have arrived at your parking location`;
    if (type === 'turn') return `Turn ${modifier || 'ahead'}${road}`;
    if (type === 'roundabout' || type === 'rotary') return `Take roundabout exit${road}`;
    return `Continue ${modifier || 'straight'}${road}`;
  }

  // 1. Live GPS Tracking via Geolocation API
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (isSimulating) return;

        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const speedMs = pos.coords.speed || 0;
        setUserPos(coords);
        setUserSpeedKmh(Math.max(0, Math.round(speedMs * 3.6)));
        setGpsLocked(true);
      },
      (err) => {
        console.info('GPS not locked, running on default city anchor:', err.message);
        setGpsLocked(false);
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 9000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [isSimulating]);

  // 2. Fetch Spots from Backend
  const fetchSpots = useCallback((lat, lng) => {
    setLoadingSpots(true);
    let backendSpotType = 'all';
    if (categoryFilter === 'paid') backendSpotType = 'mall';
    if (categoryFilter === 'free') backendSpotType = 'street';

    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      radius_km: '15.0',
      vehicle_type: vehicleFilter,
      spot_type: backendSpotType,
    });
    if (categoryFilter === 'ev') params.set('has_ev', 'true');

    fetch(`${API_BASE}/api/spots?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setSpots(data.spots || []);
      })
      .catch((e) => console.error('Error fetching parking spots:', e))
      .finally(() => setLoadingSpots(false));
  }, [categoryFilter, vehicleFilter]);

  // Initial load & when filters change
  useEffect(() => {
    fetchSpots(userPos.lat, userPos.lng);
  }, [userPos.lat, userPos.lng, fetchSpots]);

  // 3. Select Spot & Generate Route
  const handleSelectSpot = useCallback(async (spot) => {
    setSelectedSpot(spot);
    setMobileDrawerState('half');
    if (!mapRef.current || !routeLayerRef.current) return;

    routeLayerRef.current.clearLayers();

    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${userPos.lng},${userPos.lat};${spot.lng},${spot.lat}?overview=full&geometries=geojson&steps=true`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const coords = route.geometry.coordinates.map((c) => [c[1], c[0]]);
        routeCoordsRef.current = coords;

        const isPaid = spot.spot_type === 'mall' || spot.price_per_hour > 0;
        const polyline = L.polyline(coords, {
          color: isPaid ? '#2563eb' : '#10b981',
          weight: 6,
          opacity: 0.9,
          dashArray: isPaid ? null : '8, 8',
        }).addTo(routeLayerRef.current);

        mapRef.current.fitBounds(polyline.getBounds(), { padding: [70, 70] });

        const rawSteps = route.legs?.[0]?.steps || [];
        const parsed = rawSteps.map((s) => ({
          instruction: formatManeuver(s),
          distanceMeters: Math.round(s.distance),
          location: s.maneuver?.location,
        }));

        setNavSteps(parsed);
        setCurrentStepIdx(0);
        setRouteInfo({
          distanceKm: (route.distance / 1000).toFixed(1),
          durationMin: Math.max(1, Math.round(route.duration / 60)),
        });
      }
    } catch (err) {
      console.error('OSRM route fetch failed:', err);
    }
  }, [userPos]);

  // 4. Initialize Leaflet Map (Civilian UI only)
  useEffect(() => {
    if (isDeveloperMode || !mapContainerRef.current) return;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([userPos.lat, userPos.lng], 14);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);

    // Initial Car Marker
    const carIcon = L.divIcon({
      className: 'user-car-marker-container',
      html: `
        <div class="user-car-pulse"></div>
        <div class="user-car-dot"></div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    carMarkerRef.current = L.marker([userPos.lat, userPos.lng], { icon: carIcon, zIndexOffset: 1000 })
      .addTo(map)
      .bindPopup('<b>Your Live Vehicle Position</b>');

    mapRef.current = map;

    return () => {
      if (map) {
        map.remove();
        mapRef.current = null;
      }
    };
  }, [isDeveloperMode, userPos.lat, userPos.lng]);

  // Invalidate map size on window resize
  useEffect(() => {
    const handleResize = () => {
      if (mapRef.current) mapRef.current.invalidateSize();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Update Car Marker position when userPos changes
  useEffect(() => {
    if (carMarkerRef.current) {
      carMarkerRef.current.setLatLng([userPos.lat, userPos.lng]);
    }
  }, [userPos]);

  // 5. Render Parking Spot Pins on Map
  useEffect(() => {
    if (!mapRef.current || !markersLayerRef.current) return;
    markersLayerRef.current.clearLayers();

    spots.forEach((spot) => {
      const isPaid = spot.spot_type === 'mall' || spot.price_per_hour > 0;
      const isCurSelected = selectedSpot?.id === spot.id;

      const badgeHtml = isPaid
        ? `<div class="map-pill pill-mall ${isCurSelected ? 'active-pin' : ''}">
             <span class="pill-icon">🏢</span>
             <span class="pill-text">₹${spot.price_per_hour}</span>
             <span class="pill-count">(${spot.available_slots})</span>
           </div>`
        : `<div class="map-pill pill-street ${isCurSelected ? 'active-pin' : ''}">
             <span class="pill-icon">🅿️</span>
             <span class="pill-text">Free</span>
             <span class="pill-count">(${spot.available_slots})</span>
           </div>`;

      const badgeIcon = L.divIcon({
        className: 'spot-pin-anchor',
        html: badgeHtml,
        iconSize: [96, 32],
        iconAnchor: [48, 16],
      });

      const marker = L.marker([spot.lat, spot.lng], { icon: badgeIcon })
        .addTo(markersLayerRef.current);

      marker.on('click', () => {
        handleSelectSpot(spot);
      });
    });
  }, [spots, selectedSpot, handleSelectSpot]);

  // 6. Start Live Turn-by-Turn Navigation
  function handleStartNavigation() {
    if (navSteps.length === 0) return;
    setNavActive(true);
    setMobileDrawerState('collapsed');
    if (mapRef.current) {
      mapRef.current.flyTo([userPos.lat, userPos.lng], 17, { animate: true, duration: 1.2 });
    }
    speakInstruction(`Starting navigation. ${navSteps[0]?.instruction || 'Follow highlighted route.'}`);
  }

  // 7. Interactive Test Drive Simulation
  function handleStartSimulation() {
    if (isSimulating) {
      if (simulationTimerRef.current) clearInterval(simulationTimerRef.current);
      setIsSimulating(false);
      return;
    }

    if (routeCoordsRef.current.length === 0) {
      alert('Select a parking spot first to build the route before running simulation.');
      return;
    }

    setIsSimulating(true);
    setNavActive(true);
    setMobileDrawerState('collapsed');
    speakInstruction('Route preview started.');

    const coords = [...routeCoordsRef.current];
    let stepIndex = 0;
    const totalPoints = coords.length;

    simulationTimerRef.current = setInterval(() => {
      if (stepIndex >= totalPoints) {
        clearInterval(simulationTimerRef.current);
        setIsSimulating(false);
        setUserSpeedKmh(0);
        speakInstruction('You have arrived at your parking destination.');
        return;
      }

      const pt = coords[stepIndex];
      setUserPos({ lat: pt[0], lng: pt[1] });
      setUserSpeedKmh(Math.floor(28 + Math.random() * 12));

      if (mapRef.current) {
        mapRef.current.panTo([pt[0], pt[1]], { animate: true });
      }

      const targetManeuver = navSteps[currentStepIdx + 1] || navSteps[currentStepIdx];
      if (targetManeuver?.location) {
        const [turnLng, turnLat] = targetManeuver.location;
        const d = Math.round(L.latLng(pt[0], pt[1]).distanceTo(L.latLng(turnLat, turnLng)));
        setDistToNextTurnM(d);

        if (d <= 40 && currentStepIdx + 1 < navSteps.length) {
          setCurrentStepIdx((prev) => prev + 1);
          speakInstruction(navSteps[currentStepIdx + 1].instruction);
        }
      }

      stepIndex += 1;
    }, 450);
  }

  useEffect(() => {
    return () => {
      if (simulationTimerRef.current) clearInterval(simulationTimerRef.current);
    };
  }, []);

  // 8. Search Place Autocomplete
  async function handleSearch(e) {
    e?.preventDefault();
    if (!searchQuery.trim()) return;

    try {
      const res = await fetch(`${API_BASE}/api/geocode/suggest?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      if (data.suggestions && data.suggestions.length > 0) {
        setSearchResults(data.suggestions);
      }
    } catch (err) {
      console.error('Search suggestion error:', err);
    }
  }

  function handleSelectSearchResult(place) {
    setSearchResults([]);
    setSearchQuery(place.name);
    setUserPos({ lat: place.lat, lng: place.lng });
    if (mapRef.current) {
      mapRef.current.flyTo([place.lat, place.lng], 15, { animate: true });
    }
    fetchSpots(place.lat, place.lng);
  }

  // 9. Select City Preset
  function handleSelectCity(cityName) {
    setSelectedCity(cityName);
    const found = CITIES.find((c) => c.name === cityName);
    if (found) {
      setUserPos({ lat: found.lat, lng: found.lng });
      if (mapRef.current) {
        mapRef.current.flyTo([found.lat, found.lng], 14.5, { animate: true });
      }
      fetchSpots(found.lat, found.lng);
    }
  }

  // 10. Booking Creation
  async function handleBook(bookingData) {
    const res = await fetch(`${API_BASE}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingData),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.detail || 'Reservation could not be completed.');
      return;
    }

    setActivePass(data);
    fetchSpots(userPos.lat, userPos.lng);
    handleStartNavigation();
  }

  // 11. Checkout & Release Pass
  async function handleCheckoutPass() {
    if (!activePass) return;
    await fetch(`${API_BASE}/api/bookings/${activePass.booking_id}/checkout`, { method: 'POST' });
    setActivePass(null);
    fetchSpots(userPos.lat, userPos.lng);
    alert('Parking bay released. Thank you!');
  }

  // Mode Toggle helper
  function toggleDeveloperMode() {
    const nextDev = !isDeveloperMode;
    setIsDeveloperMode(nextDev);
    window.history.pushState(null, '', nextDev ? '/developer' : '/');
  }

  const visibleSpots = spots;
  const currentStep = navSteps[currentStepIdx] || navSteps[0];

  return (
    <div className={`app-shell ${isDeveloperMode ? 'in-dev-mode' : 'in-civilian-mode'}`}>
      {/* Top Navbar */}
      <Navbar
        isDeveloperMode={isDeveloperMode}
        onToggleDeveloperMode={toggleDeveloperMode}
        gpsLocked={gpsLocked}
        userSpeedKmh={userSpeedKmh}
        onLocateMe={() => {
          if (mapRef.current) mapRef.current.flyTo([userPos.lat, userPos.lng], 15);
          fetchSpots(userPos.lat, userPos.lng);
        }}
        selectedCity={selectedCity}
        onSelectCity={handleSelectCity}
        cities={CITIES}
        vehicleFilter={vehicleFilter}
        setVehicleFilter={setVehicleFilter}
        hasActivePass={Boolean(activePass)}
        onOpenPass={() => {
          if (activePass && mapRef.current) {
            mapRef.current.flyTo([activePass.lat, activePass.lng], 16);
          }
        }}
      />

      {/* Main Workspace */}
      {isDeveloperMode ? (
        /* ============================================================== */
        /* DEVELOPER USER INTERFACE                                       */
        /* ============================================================== */
        <DeveloperConsole
          onSwitchToCivilian={() => {
            setIsDeveloperMode(false);
            window.history.pushState(null, '', '/');
          }}
          userPos={userPos}
          onSpotCreated={() => fetchSpots(userPos.lat, userPos.lng)}
        />
      ) : (
        /* ============================================================== */
        /* CIVILIAN USER INTERFACE (Driver Public App)                    */
        /* ============================================================== */
        <div className="workspace-layout">
          {/* Left Sidebar / Mobile Bottom Sheet Drawer */}
          <aside className={`sidebar-container drawer-${mobileDrawerState}`}>
            {/* Mobile Drag Handle */}
            <div 
              className="drawer-drag-handle-bar"
              onClick={() => {
                setMobileDrawerState((prev) => 
                  prev === 'collapsed' ? 'half' : prev === 'half' ? 'expanded' : 'collapsed'
                );
              }}
            >
              <div className="drag-handle" />
              <span className="drawer-state-hint">
                {mobileDrawerState === 'collapsed' ? '▲ Tap to view parking spaces' : '▼ Tap to minimize'}
              </span>
            </div>

            {/* Sidebar Search & Civilian Filter Chips */}
            <div className="sidebar-search-block">
              <form onSubmit={handleSearch} className="unified-search-box">
                <Search size={16} className="search-icon" />
                <input
                  type="text"
                  placeholder="Search destination, street or landmark..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button 
                    type="button" 
                    className="clear-search-btn"
                    onClick={() => { setSearchQuery(''); setSearchResults([]); }}
                  >
                    <X size={14} />
                  </button>
                )}
                <button type="submit" className="search-action-btn">
                  Find
                </button>
              </form>

              {/* Autocomplete Dropdown */}
              {searchResults.length > 0 && (
                <div className="search-autocomplete-list">
                  {searchResults.map((p, idx) => (
                    <div
                      key={idx}
                      className="autocomplete-item"
                      onClick={() => handleSelectSearchResult(p)}
                    >
                      <MapPin size={14} className="text-emerald" />
                      <div>
                        <strong>{p.name}</strong>
                        <p>{p.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Civilian Category Filter Chips */}
              <div className="category-chips-row">
                <button
                  className={`category-chip ${categoryFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setCategoryFilter('all')}
                >
                  All ({spots.length})
                </button>
                <button
                  className={`category-chip ${categoryFilter === 'paid' ? 'active' : ''}`}
                  onClick={() => setCategoryFilter('paid')}
                >
                  <Building2 size={13} />
                  <span>Paid</span>
                </button>
                <button
                  className={`category-chip ${categoryFilter === 'free' ? 'active' : ''}`}
                  onClick={() => setCategoryFilter('free')}
                >
                  <MapPin size={13} />
                  <span>Free</span>
                </button>
                <button
                  className={`category-chip ${categoryFilter === 'ev' ? 'active' : ''}`}
                  onClick={() => setCategoryFilter('ev')}
                >
                  <Zap size={13} />
                  <span>EV Ready</span>
                </button>
              </div>
            </div>

            {/* Active Digital Pass Header Card (if booked) */}
            {activePass && (
              <div className="active-pass-pinned-wrapper">
                <ActivePassCard
                  pass={activePass}
                  onCheckout={handleCheckoutPass}
                  onNavigateToPass={() => {
                    if (mapRef.current) {
                      mapRef.current.flyTo([activePass.lat, activePass.lng], 16);
                    }
                    handleStartNavigation();
                  }}
                />
              </div>
            )}

            {/* Sidebar Scrollable Body: Spot Details or Spot List */}
            <div className="sidebar-scrollable-content">
              {selectedSpot ? (
                <SpotDetailDrawer
                  spot={selectedSpot}
                  onBack={() => {
                    setSelectedSpot(null);
                    setNavActive(false);
                    if (routeLayerRef.current) routeLayerRef.current.clearLayers();
                  }}
                  routeInfo={routeInfo}
                  onStartNavigation={handleStartNavigation}
                  onStartSimulation={handleStartSimulation}
                  isNavigating={navActive}
                  isSimulating={isSimulating}
                  onBook={handleBook}
                />
              ) : (
                <div className="spots-cards-list">
                  {loadingSpots ? (
                    <div className="loading-spots-state">
                      <Sparkles size={24} className="spin-slow text-emerald" />
                      <p>Checking available parking spaces...</p>
                    </div>
                  ) : visibleSpots.length > 0 ? (
                    visibleSpots.map((spot) => (
                      <SpotCard
                        key={spot.id}
                        spot={spot}
                        isSelected={selectedSpot?.id === spot.id}
                        onSelect={handleSelectSpot}
                        userVehicleType={vehicleFilter}
                      />
                    ))
                  ) : (
                    <div className="empty-spots-state">
                      <MapPin size={28} />
                      <h4>No parking spaces found here</h4>
                      <p>Try switching to another area or adjusting vehicle sizing filter.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>

          {/* Map Canvas Stage */}
          <main className="map-viewport-stage">
            {/* Floating Live Navigation HUD Banner */}
            {navActive && currentStep && (
              <NavigationBanner
                currentStep={currentStep}
                distToNextTurnM={distToNextTurnM}
                userSpeedKmh={userSpeedKmh}
                voiceEnabled={voiceEnabled}
                onToggleVoice={() => setVoiceEnabled(!voiceEnabled)}
                onExitNav={() => {
                  setNavActive(false);
                  setIsSimulating(false);
                  if (simulationTimerRef.current) clearInterval(simulationTimerRef.current);
                  window.speechSynthesis?.cancel();
                }}
                isSimulating={isSimulating}
              />
            )}

            {/* Floating Map Action (Civilian GPS Centering) */}
            <div className="floating-map-controls">
              <button
                className="float-action-btn"
                onClick={() => {
                  if (mapRef.current) mapRef.current.flyTo([userPos.lat, userPos.lng], 16);
                  fetchSpots(userPos.lat, userPos.lng);
                }}
                title="Center on My GPS"
              >
                <LocateFixed size={18} />
              </button>
            </div>

            {/* Leaflet Full-Screen Container */}
            <div ref={mapContainerRef} className="leaflet-map-canvas" />
          </main>
        </div>
      )}

      {/* Mobile Sticky Bottom Navigation Bar (Civilian Mode) */}
      {!isDeveloperMode && (
        <MobileBottomNav
          activeView="map"
          onSelectView={(view) => {
            if (view === 'developer') toggleDeveloperMode();
            if (view === 'pass' && activePass && mapRef.current) {
              mapRef.current.flyTo([activePass.lat, activePass.lng], 16);
            }
          }}
          hasActivePass={Boolean(activePass)}
        />
      )}
    </div>
  );
}