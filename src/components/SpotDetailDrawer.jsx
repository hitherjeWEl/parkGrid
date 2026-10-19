import React, { useState } from 'react';
import { 
  MapPin, 
  Zap, 
  Navigation, 
  Play, 
  ExternalLink, 
  ArrowLeft,
  CreditCard,
  Car
} from 'lucide-react';

export default function SpotDetailDrawer({
  spot,
  onBack,
  routeInfo,
  onStartNavigation,
  onStartSimulation,
  isNavigating,
  isSimulating,
  onBook,
}) {
  const [vehicleNo, setVehicleNo] = useState('DL 01 AB 7892');
  const [vehicleType, setVehicleType] = useState('Sedan');
  const [hours, setHours] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const isPaid = spot.spot_type === 'mall' || spot.price_per_hour > 0;
  const totalPrice = isPaid ? spot.price_per_hour * Number(hours) : 0;

  async function handleSubmitBooking(e) {
    e.preventDefault();
    if (!vehicleNo.trim()) return;
    setSubmitting(true);
    try {
      await onBook({
        spot_id: spot.id,
        spot_name: spot.name,
        price_per_hour: spot.price_per_hour,
        vehicle_number: vehicleNo.toUpperCase(),
        vehicle_type: vehicleType,
        hours: Number(hours),
      });
    } finally {
      setSubmitting(false);
    }
  }

  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}`;

  return (
    <div className="spot-detail-drawer">
      <button className="back-link-btn" onClick={onBack}>
        <ArrowLeft size={16} />
        <span>Back to parking options</span>
      </button>

      <div className="detail-header">
        <div className="pill-cluster">
          <span className={`badge-pill ${isPaid ? 'pill-paid' : 'pill-free'}`}>
            {isPaid ? 'PAID PARKING' : 'FREE PARKING'}
          </span>
          {Boolean(spot.has_ev) && (
            <span className="badge-pill pill-ev">
              <Zap size={11} />
              <span>EV CHARGER</span>
            </span>
          )}
        </div>
        <h2 className="detail-title">{spot.name}</h2>
        <p className="detail-address">
          <MapPin size={14} className="inline-icon" />
          <span>{spot.address || 'Central Parking Zone'}</span>
        </p>
      </div>

      {/* Real-time Route Stats */}
      <div className="route-stats-grid">
        <div className="stat-box">
          <span className="stat-lbl">Distance</span>
          <strong className="stat-val">
            {routeInfo ? `${routeInfo.distanceKm} km` : `${spot.distance_km} km`}
          </strong>
        </div>
        <div className="stat-box">
          <span className="stat-lbl">Drive Time</span>
          <strong className="stat-val">
            {routeInfo ? `${routeInfo.durationMin} mins` : '~5 mins'}
          </strong>
        </div>
        <div className="stat-box">
          <span className="stat-lbl">Available Now</span>
          <strong className="stat-val text-emerald">
            {spot.available_slots} / {spot.total_slots} open
          </strong>
        </div>
        <div className="stat-box">
          <span className="stat-lbl">Parking Rate</span>
          <strong className="stat-val">
            {isPaid ? `₹${spot.price_per_hour}/hr` : 'Free'}
          </strong>
        </div>
      </div>

      {/* Navigation & Simulation Control Buttons */}
      <div className="action-button-row">
        <button
          type="button"
          className="btn-primary"
          onClick={onStartNavigation}
        >
          <Navigation size={18} />
          <span>{isNavigating ? 'GPS Guidance Active' : 'Start Navigation'}</span>
        </button>

        <button
          type="button"
          className="btn-secondary"
          onClick={onStartSimulation}
          title="Preview the drive with automatic route navigation"
        >
          <Play size={16} />
          <span>{isSimulating ? 'Stop Preview' : 'Preview Route'}</span>
        </button>
      </div>

      {/* Open in Native Maps Link */}
      <a
        href={googleMapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="external-map-link"
      >
        <span>Open in Google Maps / Apple Maps</span>
        <ExternalLink size={14} />
      </a>

      {/* Booking Form (Paid) or Space Info (Free) */}
      {isPaid ? (
        <form onSubmit={handleSubmitBooking} className="drawer-booking-form">
          <div className="form-card-header">
            <div>
              <strong>Reserve Parking Spot</strong>
              <p>Locks your parking spot for 15 minutes while you drive there.</p>
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="vehNo">Vehicle License Plate</label>
            <div className="input-with-action">
              <input
                id="vehNo"
                type="text"
                placeholder="e.g. DL 01 AB 1234"
                value={vehicleNo}
                onChange={(e) => setVehicleNo(e.target.value)}
                required
              />
              <button
                type="button"
                className="fill-test-btn"
                onClick={() => setVehicleNo('DL 08 CK 2024')}
                title="Use sample vehicle plate"
              >
                Sample
              </button>
            </div>
          </div>

          <div className="form-row-split">
            <div className="form-field">
              <label htmlFor="vehType">Vehicle Size</label>
              <select
                id="vehType"
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value)}
              >
                <option value="Sedan">Sedan</option>
                <option value="Hatchback">Hatchback</option>
                <option value="SUV">SUV</option>
                <option value="Two-Wheeler">Two-Wheeler</option>
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="duration">Duration</label>
              <select
                id="duration"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              >
                <option value={1}>1 Hour (₹{spot.price_per_hour})</option>
                <option value={2}>2 Hours (₹{spot.price_per_hour * 2})</option>
                <option value={3}>3 Hours (₹{spot.price_per_hour * 3})</option>
                <option value={4}>4 Hours (₹{spot.price_per_hour * 4})</option>
              </select>
            </div>
          </div>

          <div className="pricing-breakdown">
            <div className="price-line">
              <span>Duration: {hours} hr(s)</span>
              <span>₹{totalPrice}</span>
            </div>
            <div className="price-line highlight">
              <span>Total Amount</span>
              <strong>₹{totalPrice}</strong>
            </div>
          </div>

          <button
            type="submit"
            className="btn-confirm-booking"
            disabled={submitting}
          >
            <CreditCard size={18} />
            <span>{submitting ? 'Reserving...' : `Confirm & Reserve — ₹${totalPrice}`}</span>
          </button>
        </form>
      ) : (
        <div className="street-telemetry-box">
          <div className="street-header">
            <Car size={18} className="text-emerald" />
            <div>
              <strong>Free Parking Space Details</strong>
              <p>Real-time street availability verified</p>
            </div>
          </div>

          <div className="telemetry-readouts">
            <div className="t-row">
              <span>Available Parking Spaces</span>
              <strong className="text-emerald">{spot.available_slots} Open Space(s)</strong>
            </div>
            <div className="t-row">
              <span>Vehicle Fit Compatibility</span>
              <strong>{spot.compatible_vehicles?.join(' • ') || 'All standard vehicles'}</strong>
            </div>
            <div className="t-row">
              <span>Pricing</span>
              <strong className="text-emerald">Free of Charge</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
