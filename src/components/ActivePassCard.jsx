import React, { useState, useEffect } from 'react';
import { 
  Ticket, 
  Clock, 
  ExternalLink, 
  Navigation, 
  QrCode
} from 'lucide-react';

export default function ActivePassCard({ pass, onCheckout, onNavigateToPass }) {
  const [secondsRemaining, setSecondsRemaining] = useState(
    pass.hold_seconds_remaining || 900
  );

  // Live countdown timer
  useEffect(() => {
    if (!pass.expires_at) return;
    const updateCountdown = () => {
      const now = Math.floor(Date.now() / 1000);
      const diff = Math.max(0, pass.expires_at - now);
      setSecondsRemaining(diff);
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [pass.expires_at]);

  const mins = Math.floor(secondsRemaining / 60);
  const secs = secondsRemaining % 60;
  const timeFormatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  const isUrgent = secondsRemaining < 180; // under 3 minutes

  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${pass.lat},${pass.lng}`;

  return (
    <div className="active-pass-card">
      <div className="pass-card-header">
        <div className="pass-title-group">
          <Ticket size={18} className="text-emerald" />
          <span className="pass-code">PASS #{pass.booking_code || pass.booking_id}</span>
        </div>
        <span className="pass-status-pill">GUARANTEED HOLD</span>
      </div>

      <div className="pass-body">
        <h3 className="pass-spot-name">{pass.spot_name}</h3>
        
        {/* Assigned Bay Badge */}
        <div className="bay-assignment-badge">
          <span className="bay-label">YOUR ASSIGNED BAY:</span>
          <strong className="bay-number">{pass.floor_bay_assigned || 'Level B1 • Bay 03'}</strong>
        </div>

        {/* 15-Minute Countdown Bar */}
        <div className={`countdown-container ${isUrgent ? 'urgent' : ''}`}>
          <div className="countdown-info">
            <Clock size={15} />
            <span>Hold Window Remaining:</span>
            <strong className="countdown-clock">{timeFormatted}</strong>
          </div>
          <div className="countdown-progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${Math.min(100, (secondsRemaining / 900) * 100)}%` }}
            />
          </div>
        </div>

        {/* Vehicle & Price Specs */}
        <div className="pass-specs-grid">
          <div className="spec-item">
            <span className="spec-label">Vehicle Plate</span>
            <span className="spec-val plate-font">{pass.vehicle_number}</span>
          </div>
          <div className="spec-item">
            <span className="spec-label">Vehicle Class</span>
            <span className="spec-val">{pass.vehicle_type || 'Sedan'}</span>
          </div>
          <div className="spec-item">
            <span className="spec-label">Time Booked</span>
            <span className="spec-val">{pass.hours} Hour(s)</span>
          </div>
          <div className="spec-item">
            <span className="spec-label">Gross Paid</span>
            <span className="spec-val text-emerald">₹{pass.gross_amount}</span>
          </div>
        </div>

        {/* Simulated QR Code & Barcode */}
        <div className="pass-qr-section">
          <div className="mock-qr-code">
            <QrCode size={56} />
          </div>
          <div className="qr-meta">
            <span className="qr-title">Scan at Gate Barcode Reader</span>
            <span className="qr-hash">{pass.booking_code || `PG-SEC-${pass.booking_id}`}</span>
            <span className="qr-hint">Instant gate arm release via ANPR</span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="pass-actions">
        <button 
          className="btn-pass-nav"
          onClick={onNavigateToPass}
        >
          <Navigation size={16} />
          <span>Auto-Navigate to Spot</span>
        </button>

        <a 
          href={googleMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-pass-maps"
        >
          <ExternalLink size={14} />
          <span>Google Maps</span>
        </a>

        <button 
          className="btn-pass-checkout"
          onClick={onCheckout}
        >
          <span>Release Bay / Checkout</span>
        </button>
      </div>
    </div>
  );
}
