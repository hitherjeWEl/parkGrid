import React from 'react';
import { 
  Building2, 
  MapPin, 
  Zap, 
  Car, 
  ChevronRight 
} from 'lucide-react';

export default function SpotCard({ spot, isSelected, onSelect, userVehicleType }) {
  const isPaid = spot.spot_type === 'mall' || spot.price_per_hour > 0;
  const fitsUserCar = 
    !userVehicleType || 
    userVehicleType === 'all' || 
    spot.compatible_vehicles?.includes(userVehicleType) || 
    isPaid;

  return (
    <div 
      className={`spot-card ${isSelected ? 'selected' : ''} ${!fitsUserCar ? 'dimmed' : ''}`}
      onClick={() => onSelect(spot)}
    >
      <div className="spot-card-header">
        <div className="pill-cluster">
          <span className={`badge-pill ${isPaid ? 'pill-paid' : 'pill-free'}`}>
            {isPaid ? (
              <>
                <Building2 size={12} />
                <span>PAID</span>
              </>
            ) : (
              <>
                <MapPin size={12} />
                <span>FREE PARKING</span>
              </>
            )}
          </span>

          {Boolean(spot.has_ev) && (
            <span className="badge-pill pill-ev" title="EV Charging Available">
              <Zap size={11} />
              <span>EV CHARGER</span>
            </span>
          )}
        </div>

        <div className="spot-pricing">
          {isPaid ? (
            <>
              <span className="rate-num">₹{spot.price_per_hour}</span>
              <span className="rate-unit">/hr</span>
            </>
          ) : (
            <span className="free-badge">FREE</span>
          )}
        </div>
      </div>

      <h3 className="spot-title">{spot.name}</h3>
      
      {spot.address && (
        <p className="spot-subtext">
          <span>{spot.address}</span>
        </p>
      )}

      <div className="spot-meta-row">
        <div className="meta-item">
          <span className="meta-label">Distance</span>
          <span className="meta-val">{spot.distance_km} km away</span>
        </div>

        <div className="meta-item">
          <span className="meta-label">Bays Available</span>
          <span className={`meta-val ${spot.available_slots > 0 ? 'text-emerald' : 'text-rose'}`}>
            {spot.available_slots} / {spot.total_slots} open
          </span>
        </div>

        <div className="meta-item">
          <span className="meta-label">Parking Zone</span>
          <span className="meta-val text-truncate">{spot.floor_bay || 'Standard'}</span>
        </div>
      </div>

      {/* Vehicle Fit Sizing Information */}
      {spot.compatible_vehicles && spot.compatible_vehicles.length > 0 && (
        <div className="vehicle-fit-bar">
          <Car size={13} className="inline-icon" />
          <span>Vehicle Sizing: <b>{spot.compatible_vehicles.join(' • ')}</b></span>
          {!fitsUserCar && (
            <span className="tight-alert">⚠️ May be tight for {userVehicleType}</span>
          )}
        </div>
      )}

      <div className="card-footer-action">
        <span className="action-hint">
          {isPaid ? 'Select & Reserve Spot' : 'Get Directions & View Space'}
        </span>
        <ChevronRight size={16} className="arrow-icon" />
      </div>
    </div>
  );
}
