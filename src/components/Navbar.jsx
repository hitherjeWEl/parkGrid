import React from 'react';
import { 
  Navigation, 
  Car, 
  MapPin, 
  LocateFixed, 
  Ticket,
  Code2,
  ArrowLeft
} from 'lucide-react';

export default function Navbar({
  isDeveloperMode,
  onToggleDeveloperMode,
  gpsLocked,
  userSpeedKmh,
  onLocateMe,
  selectedCity,
  onSelectCity,
  cities,
  vehicleFilter,
  setVehicleFilter,
  hasActivePass,
  onOpenPass,
}) {
  if (isDeveloperMode) {
    return (
      <header className="app-navbar dev-navbar">
        <div className="nav-left">
          <div className="brand-group" onClick={onToggleDeveloperMode}>
            <div className="brand-icon-wrapper dev-badge-icon">
              <Code2 size={20} />
            </div>
            <div className="brand-text">
              <span className="brand-title">ParkGrid</span>
              <span className="brand-badge dev-badge">DEVELOPER UI</span>
            </div>
          </div>
          <span className="dev-header-note">CCTV Streams • Slot Deployment • Real-Time Database</span>
        </div>

        <div className="nav-right">
          <button 
            className="btn-switch-civilian"
            onClick={onToggleDeveloperMode}
          >
            <ArrowLeft size={16} />
            <span>Switch to Civilian UI</span>
          </button>
        </div>
      </header>
    );
  }

  return (
    <header className="app-navbar">
      <div className="nav-left">
        <div className="brand-group">
          <div className="brand-icon-wrapper">
            <Navigation className="brand-icon" size={20} />
            <span className="radar-ping" />
          </div>
          <div className="brand-text">
            <span className="brand-title">ParkGrid</span>
          </div>
        </div>

        {/* GPS Status Indicator */}
        <button 
          className={`gps-pill ${gpsLocked ? 'gps-locked' : 'gps-searching'}`}
          onClick={onLocateMe}
          title="Click to center map on your live vehicle position"
        >
          <LocateFixed size={14} className={gpsLocked ? 'spin-slow' : 'pulse-slow'} />
          <span>{gpsLocked ? `GPS Live • ${userSpeedKmh} km/h` : 'Acquiring GPS...'}</span>
        </button>

        {/* City Quick Jumper */}
        <div className="city-jumper">
          <MapPin size={14} className="city-icon" />
          <select 
            value={selectedCity} 
            onChange={(e) => onSelectCity(e.target.value)}
            className="city-select"
            aria-label="Select City or Region"
          >
            {cities.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name.split(',')[0]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="nav-right">
        {/* Vehicle Sizing Selector */}
        <div className="vehicle-selector">
          <Car size={15} className="v-icon" />
          <select
            value={vehicleFilter}
            onChange={(e) => setVehicleFilter(e.target.value)}
            className="v-select"
            aria-label="Filter by Vehicle Size"
          >
            <option value="all">Any Vehicle Size</option>
            <option value="Hatchback">Hatchback (3.8m)</option>
            <option value="Sedan">Sedan (4.5m)</option>
            <option value="SUV">SUV (5.0m)</option>
            <option value="Two-Wheeler">Two-Wheeler</option>
          </select>
        </div>

        {hasActivePass && (
          <button 
            className="nav-tab-btn pass-btn"
            onClick={onOpenPass}
          >
            <Ticket size={16} />
            <span>My Pass</span>
            <span className="count-badge">1</span>
          </button>
        )}

        {/* Discrete Developer Portal Switcher */}
        <button 
          className="btn-switch-dev"
          onClick={onToggleDeveloperMode}
          title="Open Developer & CCTV Stream Console"
        >
          <Code2 size={15} />
          <span>Developer UI</span>
        </button>
      </div>
    </header>
  );
}
