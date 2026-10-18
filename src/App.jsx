import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  Activity,
  ArrowLeft,
  Building2,
  Car,
  CheckCircle2,
  Clock3,
  DollarSign,
  Eye,
  Gauge,
  MapPin,
  Navigation,
  Search,
  ShieldCheck,
  Sparkles,
  Timer,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import './App.css';

/* ──────────────────────────── constants ──────────────────────────── */

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_CENTER = [28.6139, 77.209];
const CP_CENTER = [28.6315, 77.2167];

const VEHICLE_LENGTH_MAP = {
  'Compact (< 4m)': 3.6,
  'Sedan (4m - 4.5m)': 4.2,
  'SUV (> 4.5m)': 4.8,
};

const markerIcon = new L.Icon({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

/* ──────────────────────────── helpers ──────────────────────────── */

function MapController({ center }) {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();
    map.flyTo(center, 16, { animate: true, duration: 1.2 });
  }, [center, map]);

  return null;
}

async function fetchSuggestions(query, signal) {
  const params = new URLSearchParams({
    format: 'jsonv2',
    q: query,
    limit: '5',
    addressdetails: '1',
  });

  const response = await fetch(`${NOMINATIM_URL}?${params}`, {
    signal,
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) throw new Error('Location search failed.');
  return response.json();
}

function formatCurrency(amount) {
  return `₹${Number(amount).toFixed(2)}`;
}

function formatCountdown(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* ──────────────────────────── App ──────────────────────────── */

function App() {
  /* ── core state machine ── */
  const [appState, setAppState] = useState('search');

  /* ── search state ── */
  const [searchMode, setSearchMode] = useState('street');
  const [destination, setDestination] = useState('');
  const [destinationPoint, setDestinationPoint] = useState(DEFAULT_CENTER);
  const [carLength, setCarLength] = useState('Compact (< 4m)');
  const [suggestions, setSuggestions] = useState([]);
  const [parkingSpot, setParkingSpot] = useState(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  /* ── driving state ── */
  const [driverPos, setDriverPos] = useState(null);
  const [nearbySlots, setNearbySlots] = useState([]);
  const [simulating, setSimulating] = useState(false);
  const watchIdRef = useRef(null);
  const simIntervalRef = useRef(null);
  const slotPollRef = useRef(null);

  /* ── slot detail / reservation state ── */
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [reserving, setReserving] = useState(false);
  const [reservation, setReservation] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef(null);

  /* ── command center state ── */
  const [godsEyeImg, setGodsEyeImg] = useState('');
  const [godsEyeStatus, setGodsEyeStatus] = useState(null);

  /* ── partner portal state ── */
  const [partnerLedger, setPartnerLedger] = useState([]);

  /* ─────────── Nominatim autocomplete ─────────── */
  useEffect(() => {
    const query = destination.trim();
    if (query.length < 4) {
      setSuggestions([]);
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        setSuggestions(await fetchSuggestions(query, controller.signal));
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setLoadingSuggestions(false);
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [destination]);

  const selectedModeLabel = useMemo(
    () => (searchMode === 'street' ? 'Live Street Space' : 'Premium Shadowed Lot'),
    [searchMode],
  );

  const selectLocation = (location) => {
    const lat = Number.parseFloat(location.lat);
    const lon = Number.parseFloat(location.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    setDestination(location.display_name);
    setDestinationPoint([lat, lon]);
    setSuggestions([]);
    setError('');
  };

  /* ─────────── search handler ─────────── */
  const handleSearch = async () => {
    setSearching(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: destination.trim() || 'Current Location',
          arrival_time: '1 Minute',
          search_mode: searchMode,
          vehicle_length: carLength,
          latitude: destinationPoint[0],
          longitude: destinationPoint[1],
        }),
      });

      if (!response.ok) {
        throw new Error(`Parking service returned ${response.status}.`);
      }

      const data = await response.json();
      const spotLat = Number.isFinite(Number(data.latitude)) ? Number(data.latitude) : destinationPoint[0] + 0.0005;
      const spotLon = Number.isFinite(Number(data.longitude)) ? Number(data.longitude) : destinationPoint[1] + 0.0005;

      setParkingSpot({
        lat: spotLat,
        lon: spotLon,
        details: data,
      });
      setAppState('map');
    } catch (requestError) {
      console.error(requestError);
      setError('Could not reach ParkGrid. Start the FastAPI server and try again.');
    } finally {
      setSearching(false);
    }
  };

  const resetSearch = () => {
    setAppState('search');
    setParkingSpot(null);
    setError('');
    stopDriving();
    setSelectedSlot(null);
    setReservation(null);
  };

  const openNavigation = (lat, lng) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  /* ─────────── driving mode - GPS + simulation ─────────── */
  const startDriving = useCallback(() => {
    setAppState('driving');
    setSelectedSlot(null);
    setReservation(null);

    // Start real GPS
    if (navigator.geolocation) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          if (!simulating) {
            setDriverPos([pos.coords.latitude, pos.coords.longitude]);
          }
        },
        () => {
          // GPS error - silently ignore, simulation can be used instead
        },
        { enableHighAccuracy: true, maximumAge: 2000 },
      );
    }
  }, [simulating]);

  const stopDriving = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }
    if (slotPollRef.current) {
      clearInterval(slotPollRef.current);
      slotPollRef.current = null;
    }
    setSimulating(false);
    setDriverPos(null);
    setNearbySlots([]);
  }, []);

  const toggleSimulation = useCallback(() => {
    if (simulating) {
      if (simIntervalRef.current) {
        clearInterval(simIntervalRef.current);
        simIntervalRef.current = null;
      }
      setSimulating(false);
      return;
    }

    setSimulating(true);
    let pos = [...CP_CENTER];
    setDriverPos(pos);

    simIntervalRef.current = setInterval(() => {
      pos = [
        pos[0] + (Math.random() - 0.5) * 0.0006,
        pos[1] + (Math.random() - 0.5) * 0.0006,
      ];
      setDriverPos([...pos]);
    }, 2000);
  }, [simulating]);

  // Nearby slot polling when driving
  useEffect(() => {
    if (appState !== 'driving' || !driverPos) {
      if (slotPollRef.current) {
        clearInterval(slotPollRef.current);
        slotPollRef.current = null;
      }
      return;
    }

    const fetchSlots = async () => {
      try {
        const lengthM = VEHICLE_LENGTH_MAP[carLength] || 3.6;
        const params = new URLSearchParams({
          lat: String(driverPos[0]),
          lng: String(driverPos[1]),
          radius_m: '500',
          car_length_m: String(lengthM),
          zone_type: 'all',
        });
        const resp = await fetch(`${API_URL}/api/v1/slots/nearby?${params}`);
        if (resp.ok) {
          const data = await resp.json();
          setNearbySlots(Array.isArray(data) ? data : (data.slots || []));
        }
      } catch {
        // silently continue polling
      }
    };

    fetchSlots();
    slotPollRef.current = setInterval(fetchSlots, 3000);

    return () => {
      if (slotPollRef.current) {
        clearInterval(slotPollRef.current);
        slotPollRef.current = null;
      }
    };
  }, [appState, driverPos, carLength]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopDriving();
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [stopDriving]);

  /* ─────────── slot detail & reservation ─────────── */
  const handleSlotClick = (slot) => {
    setSelectedSlot(slot);
    setAppState('slot-detail');
  };

  const handleReserve = async () => {
    if (!selectedSlot) return;
    setReserving(true);
    try {
      const resp = await fetch(`${API_URL}/api/v1/bookings/reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot_id: selectedSlot.slot_id || selectedSlot.id || 'slot-1',
          user_id: 'user-app',
          gross_amount: selectedSlot.price || 0,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setReservation(data);
        setCountdown(15 * 60);

        if (countdownRef.current) clearInterval(countdownRef.current);
        countdownRef.current = setInterval(() => {
          setCountdown((prev) => {
            if (prev <= 1) {
              clearInterval(countdownRef.current);
              countdownRef.current = null;
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        setError('Reservation failed. Please try again.');
      }
    } catch {
      setError('Could not reach booking service.');
    } finally {
      setReserving(false);
    }
  };

  const closeDrawer = () => {
    setSelectedSlot(null);
    setReservation(null);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (driverPos) {
      setAppState('driving');
    } else {
      setAppState('search');
    }
  };

  /* ─────────── command center polling ─────────── */
  useEffect(() => {
    if (appState !== 'command-center') return;

    const fetchStatus = async () => {
      try {
        const resp = await fetch(`${API_URL}/api/v1/gods-eye/status`);
        if (resp.ok) setGodsEyeStatus(await resp.json());
      } catch {
        // continue polling
      }
    };

    const updateImage = () => {
      setGodsEyeImg(`${API_URL}/api/video_feed?t=${Date.now()}`);
    };

    fetchStatus();
    updateImage();

    const statusInterval = setInterval(fetchStatus, 5000);
    const imageInterval = setInterval(updateImage, 5000);

    return () => {
      clearInterval(statusInterval);
      clearInterval(imageInterval);
    };
  }, [appState]);

  /* ─────────── partner portal ─────────── */
  useEffect(() => {
    if (appState !== 'partner-portal') return;

    const fetchLedger = async () => {
      try {
        const resp = await fetch(`${API_URL}/api/v1/partners/ledger`);
        if (resp.ok) {
          const data = await resp.json();
          setPartnerLedger(Array.isArray(data) ? data : (data.partners || []));
        }
      } catch {
        // silently ignore
      }
    };

    fetchLedger();
    const interval = setInterval(fetchLedger, 10000);
    return () => clearInterval(interval);
  }, [appState]);

  /* ─────────── map center ─────────── */
  const mapCenter = useMemo(() => {
    if (appState === 'driving' && driverPos) return driverPos;
    if (appState === 'slot-detail' && selectedSlot) {
      return [selectedSlot.lat || selectedSlot.latitude || destinationPoint[0], selectedSlot.lng || selectedSlot.longitude || destinationPoint[1]];
    }
    return destinationPoint;
  }, [appState, driverPos, selectedSlot, destinationPoint]);

  /* ─────────── render helpers ─────────── */
  const slotColor = (slot) => {
    if (slot.zone_type === 'partner' || slot.type === 'partner') return '#fbbf24';
    return '#4ade80';
  };

  const slotLabel = (slot) => {
    if (slot.zone_type === 'partner' || slot.type === 'partner') {
      return `${slot.name || 'Mall Slot'} — ₹${slot.price || 80}/hr`;
    }
    const gap = slot.gap_length_m || slot.length || 0;
    return `${gap.toFixed(1)}m Curb Gap — Fits ${carLength.split(' ')[0]}`;
  };

  /* ═══════════════════════════ RENDER ═══════════════════════════ */
  return (
    <div className="app">
      {/* ─── navbar ─── */}
      <header className="navbar">
        <div className="brand">
          <Navigation className="brand-icon" size={29} strokeWidth={2.6} />
          <h1 className="brand-name">ParkGrid</h1>
        </div>
        <nav className="nav-tabs">
          <button
            className={`nav-tab ${appState === 'search' || appState === 'map' ? 'active' : ''}`}
            onClick={() => { resetSearch(); setAppState('search'); }}
            type="button"
          >
            <Search size={16} /> Search
          </button>
          <button
            className={`nav-tab ${appState === 'driving' || appState === 'slot-detail' ? 'active' : ''}`}
            onClick={() => { stopDriving(); startDriving(); }}
            type="button"
          >
            <Car size={16} /> Drive
          </button>
          <button
            className={`nav-tab ${appState === 'command-center' ? 'active' : ''}`}
            onClick={() => { stopDriving(); setAppState('command-center'); }}
            type="button"
          >
            <Eye size={16} /> Command Center
          </button>
          <button
            className={`nav-tab ${appState === 'partner-portal' ? 'active' : ''}`}
            onClick={() => { stopDriving(); setAppState('partner-portal'); }}
            type="button"
          >
            <Building2 size={16} /> Partner Portal
          </button>
        </nav>
      </header>

      <main className="main">
        {/* ═══════════════ SEARCH VIEW ═══════════════ */}
        {appState === 'search' && (
          <section className="search-page">
            <div className="hero-copy">
              <p className="eyebrow">Smart parking, without the hunt</p>
              <h2 className="hero-title">Find your <span>perfect spot.</span></h2>
              <p className="hero-subtitle">
                Search around your destination, choose your vehicle size, and let ParkGrid find the best available option.
              </p>
            </div>

            <div className="mode-switch">
              <div className="mode-group" role="tablist" aria-label="Parking type">
                <button
                  className={`mode-button ${searchMode === 'street' ? 'active' : ''}`}
                  onClick={() => setSearchMode('street')}
                  role="tab"
                  aria-selected={searchMode === 'street'}
                >
                  <Zap size={18} /> Live Street Space
                </button>
                <button
                  className={`mode-button premium ${searchMode === 'premium' ? 'active' : ''}`}
                  onClick={() => setSearchMode('premium')}
                  role="tab"
                  aria-selected={searchMode === 'premium'}
                >
                  <ShieldCheck size={18} /> Premium Lot
                </button>
              </div>
            </div>

            <div className="search-card">
              <div className="search-grid">
                <div className="field destination-field">
                  <label className="field-label" htmlFor="destination">Where to?</label>
                  <div className="input-row">
                    <Search className="field-icon" size={21} />
                    <input
                      id="destination"
                      className="destination-input"
                      value={destination}
                      onChange={(event) => setDestination(event.target.value)}
                      placeholder="e.g. Hauz Khas Village"
                      autoComplete="off"
                    />
                  </div>
                  {(loadingSuggestions || suggestions.length > 0) && (
                    <div className="suggestions" role="listbox">
                      {loadingSuggestions && <div className="suggestion">Searching locations…</div>}
                      {!loadingSuggestions && suggestions.map((location) => (
                        <button
                          key={`${location.place_id}-${location.lat}-${location.lon}`}
                          className="suggestion"
                          onClick={() => selectLocation(location)}
                          type="button"
                        >
                          {location.display_name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="vehicle">Vehicle size</label>
                  <div className="input-row">
                    <Car className="field-icon" size={21} />
                    <select id="vehicle" className="vehicle-select" value={carLength} onChange={(event) => setCarLength(event.target.value)}>
                      <option>Compact (&lt; 4m)</option>
                      <option>Sedan (4m - 4.5m)</option>
                      <option>SUV (&gt; 4.5m)</option>
                    </select>
                  </div>
                </div>

                <button className="search-button" onClick={handleSearch} disabled={searching} type="button">
                  <Navigation size={20} /> {searching ? 'Finding…' : 'Find Space'}
                </button>
              </div>

              {error && <div className="error-banner" role="alert">{error}</div>}
            </div>

            <div className="features">
              <div className="feature">
                <Zap size={20} />
                <h3>Fast discovery</h3>
                <p>Get a parking recommendation without manually scanning the map.</p>
              </div>
              <div className="feature">
                <Clock3 size={20} />
                <h3>Arrival aware</h3>
                <p>Built to keep arrival time and vehicle size in the search flow.</p>
              </div>
              <div className="feature">
                <Sparkles size={20} />
                <h3>One clear result</h3>
                <p>A focused result card keeps the next action simple.</p>
              </div>
            </div>
          </section>
        )}

        {/* ═══════════════ MAP RESULT VIEW ═══════════════ */}
        {appState === 'map' && (
          <section className="map-page">
            <button className="map-back" onClick={resetSearch} type="button" aria-label="Back to parking search">
              <ArrowLeft size={22} />
            </button>

            <div className="map">
              <MapContainer center={destinationPoint} zoom={15} zoomControl={true}>
                <TileLayer
                  attribution='&copy; OpenStreetMap contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapController center={destinationPoint} />
                {parkingSpot && (
                  <Marker position={[parkingSpot.lat, parkingSpot.lon]} icon={markerIcon}>
                    <Popup>Parking space secured.</Popup>
                  </Marker>
                )}
              </MapContainer>
            </div>

            <aside className="map-card">
              <div className="map-card-header">
                <CheckCircle2 className="success-icon" size={30} />
                <div>
                  <h2>{parkingSpot?.details.type || selectedModeLabel}</h2>
                  <p className="destination">{destination || 'Current Location'}</p>
                </div>
              </div>

              <div className="cost">
                <p className="cost-label">Cost</p>
                <p className="cost-value">{parkingSpot?.details.price || '—'}</p>
              </div>

              <p className="message">{parkingSpot?.details.message}</p>

              <button className="navigate-button" onClick={() => parkingSpot && openNavigation(parkingSpot.lat, parkingSpot.lon)} type="button">
                Navigate to space
              </button>
            </aside>
          </section>
        )}

        {/* ═══════════════ DRIVING VIEW ═══════════════ */}
        {(appState === 'driving' || appState === 'slot-detail') && (
          <section className="map-page">
            <div className="driving-controls">
              <button className="map-back" onClick={resetSearch} type="button" aria-label="Back to search">
                <ArrowLeft size={22} />
              </button>
              <button
                className={`sim-toggle ${simulating ? 'active' : ''}`}
                onClick={toggleSimulation}
                type="button"
              >
                <MapPin size={16} />
                {simulating ? 'Stop Simulation' : 'Simulate Driving in CP'}
              </button>
              <div className="field driving-vehicle-field">
                <Car className="field-icon" size={18} />
                <select className="vehicle-select" value={carLength} onChange={(e) => setCarLength(e.target.value)}>
                  <option>Compact (&lt; 4m)</option>
                  <option>Sedan (4m - 4.5m)</option>
                  <option>SUV (&gt; 4.5m)</option>
                </select>
              </div>
            </div>

            <div className="map">
              <MapContainer center={mapCenter} zoom={16} zoomControl={true}>
                <TileLayer
                  attribution='&copy; OpenStreetMap contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapController center={mapCenter} />

                {/* Driver position - blue pulsing circle */}
                {driverPos && (
                  <CircleMarker
                    center={driverPos}
                    radius={12}
                    pathOptions={{
                      color: '#3b82f6',
                      fillColor: '#3b82f6',
                      fillOpacity: 0.5,
                      weight: 3,
                      className: 'pulse-blue',
                    }}
                  >
                    <Popup>Your position</Popup>
                  </CircleMarker>
                )}

                {/* Nearby slots */}
                {nearbySlots.map((slot, idx) => (
                  <CircleMarker
                    key={slot.slot_id || slot.id || `slot-${idx}`}
                    center={[slot.lat || slot.latitude || 0, slot.lng || slot.longitude || 0]}
                    radius={9}
                    pathOptions={{
                      color: slotColor(slot),
                      fillColor: slotColor(slot),
                      fillOpacity: 0.55,
                      weight: 2,
                      className: (slot.zone_type === 'partner' || slot.type === 'partner') ? 'pulse-gold' : 'pulse-green',
                    }}
                    eventHandlers={{
                      click: () => handleSlotClick(slot),
                    }}
                  >
                    <Popup>{slotLabel(slot)}</Popup>
                  </CircleMarker>
                ))}
              </MapContainer>
            </div>

            {/* GPS indicator */}
            {driverPos && (
              <div className="gps-indicator">
                <span className="gps-dot" />
                GPS {simulating ? 'Simulated' : 'Active'} — {driverPos[0].toFixed(4)}, {driverPos[1].toFixed(4)}
              </div>
            )}

            {/* Slot count badge */}
            {nearbySlots.length > 0 && (
              <div className="slot-count-badge">
                <Activity size={16} /> {nearbySlots.length} slot{nearbySlots.length !== 1 ? 's' : ''} nearby
              </div>
            )}

            {/* ── Slot Detail Drawer ── */}
            {appState === 'slot-detail' && selectedSlot && (
              <div className="slot-drawer">
                <div className="drawer-handle" />
                <button className="drawer-close" onClick={closeDrawer} type="button">&times;</button>

                {!reservation ? (
                  <>
                    <div className="drawer-badge-row">
                      {(selectedSlot.zone_type === 'partner' || selectedSlot.type === 'partner') ? (
                        <span className="drawer-badge badge-gold"><Building2 size={14} /> Verified Mall Partner</span>
                      ) : (
                        <span className="drawer-badge badge-green"><Eye size={14} /> God&apos;s Eye Street</span>
                      )}
                    </div>

                    <h3 className="drawer-title">
                      {selectedSlot.name || `Street Gap #${selectedSlot.slot_id || selectedSlot.id || '?'}`}
                    </h3>

                    <div className="drawer-info-grid">
                      <div className="drawer-info-item">
                        <span className="drawer-info-label">Gap / Bay</span>
                        <span className="drawer-info-value">{(selectedSlot.gap_length_m || selectedSlot.length || 0).toFixed(1)}m</span>
                      </div>
                      <div className="drawer-info-item">
                        <span className="drawer-info-label">Price</span>
                        <span className="drawer-info-value">
                          {(selectedSlot.zone_type === 'partner' || selectedSlot.type === 'partner')
                            ? `₹${selectedSlot.price || 80}/hr`
                            : 'Free — Street'}
                        </span>
                      </div>
                      <div className="drawer-info-item">
                        <span className="drawer-info-label">Fits</span>
                        <span className="drawer-info-value">{carLength}</span>
                      </div>
                    </div>

                    <button
                      className="reserve-button"
                      onClick={handleReserve}
                      disabled={reserving}
                      type="button"
                    >
                      <Timer size={18} />
                      {reserving ? 'Reserving…' : `Reserve for 15 Min — ₹${selectedSlot.price || 0}`}
                    </button>

                    {(selectedSlot.zone_type === 'partner' || selectedSlot.type === 'partner') && (
                      <p className="revenue-split">
                        Mall Partner earns {formatCurrency((selectedSlot.price || 80) * 0.10)} (10%)
                      </p>
                    )}
                  </>
                ) : (
                  <div className="reservation-confirmed">
                    <CheckCircle2 className="confirmed-icon" size={40} />
                    <h3>Reservation Confirmed!</h3>
                    <p className="confirmed-slot">
                      {selectedSlot.name || `Slot ${selectedSlot.slot_id || selectedSlot.id || ''}`}
                    </p>

                    <div className="countdown-ring">
                      <Timer size={24} />
                      <span className="countdown-value">{formatCountdown(countdown)}</span>
                      <span className="countdown-label">remaining</span>
                    </div>

                    <button
                      className="navigate-button"
                      onClick={() => openNavigation(
                        selectedSlot.lat || selectedSlot.latitude || destinationPoint[0],
                        selectedSlot.lng || selectedSlot.longitude || destinationPoint[1],
                      )}
                      type="button"
                    >
                      <Navigation size={18} /> Navigate to Bay
                    </button>

                    {(selectedSlot.zone_type === 'partner' || selectedSlot.type === 'partner') && (
                      <p className="revenue-split">
                        Mall Partner earns {formatCurrency((selectedSlot.price || 80) * 0.10)} (10%)
                      </p>
                    )}
                  </div>
                )}

                {error && <div className="error-banner" role="alert">{error}</div>}
              </div>
            )}
          </section>
        )}

        {/* ═══════════════ COMMAND CENTER ═══════════════ */}
        {appState === 'command-center' && (
          <section className="command-center">
            <div className="cc-header">
              <Eye size={24} />
              <h2>God&apos;s Eye Command Center</h2>
            </div>
            <div className="cc-split">
              <div className="cc-left">
                <h3 className="cc-pane-title">Live Overhead Feed</h3>
                <div className="cc-image-container">
                  {godsEyeImg ? (
                    <img
                      src={godsEyeImg}
                      alt="God's Eye overhead view"
                      className="cc-feed-img"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div className="cc-no-feed">
                      <Eye size={48} />
                      <p>Connecting to feed…</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="cc-right">
                <h3 className="cc-pane-title">Detection Status</h3>
                {godsEyeStatus ? (
                  <div className="cc-status-grid">
                    <div className="cc-stat-card">
                      <Activity size={20} />
                      <div className="cc-stat-info">
                        <span className="cc-stat-value">{godsEyeStatus.active_zones ?? godsEyeStatus.activeZones ?? 0}</span>
                        <span className="cc-stat-label">Active Zones</span>
                      </div>
                    </div>
                    <div className="cc-stat-card">
                      <Gauge size={20} />
                      <div className="cc-stat-info">
                        <span className="cc-stat-value">{godsEyeStatus.total_slots ?? godsEyeStatus.totalSlots ?? 0}</span>
                        <span className="cc-stat-label">Total Slots</span>
                      </div>
                    </div>
                    <div className="cc-stat-card cc-stat-green">
                      <CheckCircle2 size={20} />
                      <div className="cc-stat-info">
                        <span className="cc-stat-value">{godsEyeStatus.available ?? 0}</span>
                        <span className="cc-stat-label">Available</span>
                      </div>
                    </div>
                    <div className="cc-stat-card cc-stat-red">
                      <Car size={20} />
                      <div className="cc-stat-info">
                        <span className="cc-stat-value">{godsEyeStatus.occupied ?? 0}</span>
                        <span className="cc-stat-label">Occupied</span>
                      </div>
                    </div>
                    <div className="cc-stat-card cc-stat-amber">
                      <Zap size={20} />
                      <div className="cc-stat-info">
                        <span className="cc-stat-value">{godsEyeStatus.too_tight ?? godsEyeStatus.tooTight ?? 0}</span>
                        <span className="cc-stat-label">Too Tight</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="cc-loading">
                    <Activity size={24} className="spin" />
                    <p>Loading status…</p>
                  </div>
                )}

                {godsEyeStatus?.gaps && Array.isArray(godsEyeStatus.gaps) && godsEyeStatus.gaps.length > 0 && (
                  <div className="cc-gaps-section">
                    <h4 className="cc-gaps-title">Dynamic Gaps Detected</h4>
                    <div className="cc-gaps-list">
                      {godsEyeStatus.gaps.map((gap, idx) => (
                        <div key={gap.id || `gap-${idx}`} className="cc-gap-item">
                          <MapPin size={14} />
                          <span className="cc-gap-length">{(gap.length_m || gap.length || 0).toFixed(1)}m</span>
                          <span className="cc-gap-status">{gap.status || 'available'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ═══════════════ PARTNER PORTAL ═══════════════ */}
        {appState === 'partner-portal' && (
          <section className="partner-portal">
            <div className="pp-header">
              <Building2 size={24} />
              <h2>Partner Portal Dashboard</h2>
            </div>

            {partnerLedger.length === 0 ? (
              <div className="pp-empty">
                <Building2 size={48} />
                <p>Loading partner data…</p>
              </div>
            ) : (
              <div className="pp-grid">
                {partnerLedger.map((partner, idx) => {
                  const totalSlots = partner.total_slots ?? partner.totalSlots ?? 0;
                  const occupied = partner.occupied ?? 0;
                  const available = partner.available ?? (totalSlots - occupied);
                  const occupancyPct = totalSlots > 0 ? ((occupied / totalSlots) * 100).toFixed(0) : 0;
                  const gross = partner.gross_revenue ?? partner.grossRevenue ?? 0;
                  const commission = gross * 0.10;
                  const bookings = partner.total_bookings ?? partner.totalBookings ?? 0;

                  return (
                    <div key={partner.partner_id || partner.id || `partner-${idx}`} className="pp-card">
                      <div className="pp-card-header">
                        <Building2 size={22} className="pp-card-icon" />
                        <div>
                          <h3 className="pp-card-name">{partner.name || `Partner ${idx + 1}`}</h3>
                          <p className="pp-card-location">
                            <MapPin size={13} /> {partner.location || partner.address || 'Location not set'}
                          </p>
                        </div>
                      </div>

                      <div className="pp-stats-row">
                        <div className="pp-stat">
                          <span className="pp-stat-val">{totalSlots}</span>
                          <span className="pp-stat-lbl">Total Slots</span>
                        </div>
                        <div className="pp-stat">
                          <span className="pp-stat-val pp-stat-occupied">{occupied}</span>
                          <span className="pp-stat-lbl">Occupied</span>
                        </div>
                        <div className="pp-stat">
                          <span className="pp-stat-val pp-stat-available">{available}</span>
                          <span className="pp-stat-lbl">Available</span>
                        </div>
                      </div>

                      <div className="pp-occupancy">
                        <div className="pp-occupancy-header">
                          <span>Occupancy</span>
                          <span className="pp-occupancy-pct">{occupancyPct}%</span>
                        </div>
                        <div className="pp-occupancy-bar">
                          <div className="pp-occupancy-fill" style={{ width: `${occupancyPct}%` }} />
                        </div>
                      </div>

                      <div className="pp-revenue-row">
                        <div className="pp-revenue-item">
                          <DollarSign size={16} />
                          <div>
                            <span className="pp-revenue-val">{formatCurrency(gross)}</span>
                            <span className="pp-revenue-lbl">Gross Revenue</span>
                          </div>
                        </div>
                        <div className="pp-revenue-item pp-commission">
                          <TrendingUp size={16} />
                          <div>
                            <span className="pp-commission-val">{formatCurrency(commission)}</span>
                            <span className="pp-revenue-lbl">10% Commission</span>
                          </div>
                        </div>
                      </div>

                      <div className="pp-bookings">
                        <Users size={15} />
                        <span>{bookings} total booking{bookings !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
