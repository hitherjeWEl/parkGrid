import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  ArrowLeft,
  Car,
  CheckCircle2,
  Clock3,
  Navigation,
  Search,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_CENTER = [28.6139, 77.209];

const markerIcon = new L.Icon({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

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

function App() {
  const [appState, setAppState] = useState('search');
  const [searchMode, setSearchMode] = useState('street');
  const [destination, setDestination] = useState('');
  const [destinationPoint, setDestinationPoint] = useState(DEFAULT_CENTER);
  const [carLength, setCarLength] = useState('Compact (< 4m)');
  const [suggestions, setSuggestions] = useState([]);
  const [parkingSpot, setParkingSpot] = useState(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

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
  };

  const openNavigation = () => {
    if (!parkingSpot) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${parkingSpot.lat},${parkingSpot.lon}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="app">
      <header className="navbar">
        <div className="brand">
          <Navigation className="brand-icon" size={29} strokeWidth={2.6} />
          <h1 className="brand-name">ParkGrid</h1>
        </div>
      </header>

      <main className="main">
        {appState === 'search' ? (
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
        ) : (
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

              <button className="navigate-button" onClick={openNavigation} type="button">
                Navigate to space
              </button>
            </aside>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
