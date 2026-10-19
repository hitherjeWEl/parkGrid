import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  PlusCircle, 
  Search, 
  CheckCircle2, 
  ArrowLeft,
  RefreshCw,
  LocateFixed
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function PartnerPortal({ onBackToMap, userPos, onSpotAdded }) {
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');

  const [newLot, setNewLot] = useState({
    name: '',
    spot_type: 'mall',
    lat: userPos?.lat || 28.6315,
    lng: userPos?.lng || 77.2195,
    total_slots: 25,
    price_per_hour: 50,
    address: '',
    has_ev: false,
  });
  const [publishing, setPublishing] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState(false);

  function loadLedger() {
    setLoading(true);
    fetch(`${API_BASE}/api/partner/ledger`)
      .then((r) => r.json())
      .then((data) => setLedger(data))
      .catch((e) => console.error('Ledger fetch error:', e))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadLedger();
  }, []);

  async function handleAddSpot(e) {
    e.preventDefault();
    if (!newLot.name.trim()) return;
    setPublishing(true);
    try {
      const res = await fetch(`${API_BASE}/api/partner/add-spot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newLot,
          lat: Number(newLot.lat),
          lng: Number(newLot.lng),
          total_slots: Number(newLot.total_slots),
          price_per_hour: Number(newLot.price_per_hour),
          has_ev: Boolean(newLot.has_ev),
        }),
      });
      if (res.ok) {
        setPublishSuccess(true);
        setNewLot({
          name: '',
          spot_type: 'mall',
          lat: userPos?.lat || 28.6315,
          lng: userPos?.lng || 77.2195,
          total_slots: 25,
          price_per_hour: 50,
          address: '',
          has_ev: false,
        });
        loadLedger();
        if (onSpotAdded) onSpotAdded();
        setTimeout(() => setPublishSuccess(false), 4000);
      }
    } catch (err) {
      alert('Error publishing parking lot: ' + err.message);
    } finally {
      setPublishing(false);
    }
  }

  const filteredBookings = ledger?.bookings?.filter((b) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return (
      b.spot_name?.toLowerCase().includes(q) ||
      b.vehicle_number?.toLowerCase().includes(q) ||
      b.booking_code?.toLowerCase().includes(q)
    );
  }) || [];

  return (
    <div className="partner-portal-wrapper">
      {/* Top Bar */}
      <div className="partner-portal-header">
        <div className="portal-title-block">
          <button className="back-to-map-btn" onClick={onBackToMap}>
            <ArrowLeft size={16} />
            <span>Driver Map</span>
          </button>
          <div>
            <h1>Mall Partner & Operator Revenue Console</h1>
            <p>10% Commission Settlement Engine, Slot Inventories & Onboarding</p>
          </div>
        </div>

        <button className="refresh-ledger-btn" onClick={loadLedger} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin-slow' : ''} />
          <span>Refresh Data</span>
        </button>
      </div>

      {/* KPI Cards Row */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-title">Total Bookings</span>
          <div className="kpi-val-row">
            <span className="kpi-num">{ledger?.total_bookings || 0}</span>
            <span className="kpi-sub">
              {ledger?.active_bookings || 0} active hold
            </span>
          </div>
        </div>

        <div className="kpi-card">
          <span className="kpi-title">Gross Volume</span>
          <div className="kpi-val-row">
            <span className="kpi-num">₹{ledger?.gross_revenue || '0.00'}</span>
            <span className="kpi-sub">Total Driver Spend</span>
          </div>
        </div>

        <div className="kpi-card kpi-emerald">
          <span className="kpi-title">Mall Partner 10% Share</span>
          <div className="kpi-val-row">
            <span className="kpi-num">₹{ledger?.mall_10pct_share || '0.00'}</span>
            <span className="kpi-sub highlight">Auto-credited to Malls</span>
          </div>
        </div>

        <div className="kpi-card">
          <span className="kpi-title">Platform Net (90%)</span>
          <div className="kpi-val-row">
            <span className="kpi-num">₹{ledger?.platform_90pct_net || '0.00'}</span>
            <span className="kpi-sub">ParkGrid Cloud Infrastructure</span>
          </div>
        </div>
      </div>

      {/* Two-Column Main Content */}
      <div className="partner-two-col">
        {/* Left Column: Onboard New Lot */}
        <div className="partner-col-card">
          <div className="col-header">
            <PlusCircle size={18} className="text-emerald" />
            <h3>Onboard New Parking Lot or Smart Street Zone</h3>
          </div>
          <p className="col-desc">
            Register a partner mall or automated street curb sensor at exact GPS coordinates to publish it immediately to all drivers.
          </p>

          {publishSuccess && (
            <div className="publish-success-banner">
              <CheckCircle2 size={16} />
              <span>Location successfully published to live driver map!</span>
            </div>
          )}

          <form onSubmit={handleAddSpot} className="onboard-form">
            <div className="form-group">
              <label>Parking Facility Name</label>
              <input
                type="text"
                placeholder="e.g. Pacific Mall Tagore Garden"
                value={newLot.name}
                onChange={(e) => setNewLot({ ...newLot, name: e.target.value })}
                required
              />
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label>Facility Type</label>
                <select
                  value={newLot.spot_type}
                  onChange={(e) => setNewLot({ ...newLot, spot_type: e.target.value })}
                >
                  <option value="mall">Partner Mall (Paid Pre-Book)</option>
                  <option value="street">Smart Street Zone (Free)</option>
                </select>
              </div>

              <div className="form-group">
                <label>Hourly Rate (₹)</label>
                <input
                  type="number"
                  value={newLot.price_per_hour}
                  onChange={(e) => setNewLot({ ...newLot, price_per_hour: e.target.value })}
                  disabled={newLot.spot_type === 'street'}
                />
              </div>
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label>Total Slot Capacity</label>
                <input
                  type="number"
                  value={newLot.total_slots}
                  onChange={(e) => setNewLot({ ...newLot, total_slots: e.target.value })}
                  required
                />
              </div>

              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={newLot.has_ev}
                    onChange={(e) => setNewLot({ ...newLot, has_ev: e.target.checked })}
                  />
                  <span>Fast EV Charging Hub</span>
                </label>
              </div>
            </div>

            <div className="form-group">
              <label>Address / Street Description</label>
              <input
                type="text"
                placeholder="e.g. Najafgarh Rd, Subhash Nagar"
                value={newLot.address}
                onChange={(e) => setNewLot({ ...newLot, address: e.target.value })}
              />
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label>Latitude</label>
                <input
                  type="number"
                  step="any"
                  value={newLot.lat}
                  onChange={(e) => setNewLot({ ...newLot, lat: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>Longitude</label>
                <input
                  type="number"
                  step="any"
                  value={newLot.lng}
                  onChange={(e) => setNewLot({ ...newLot, lng: e.target.value })}
                  required
                />
              </div>
            </div>

            {userPos && (
              <button
                type="button"
                className="btn-use-gps"
                onClick={() => setNewLot({ ...newLot, lat: userPos.lat, lng: userPos.lng })}
              >
                <LocateFixed size={14} />
                <span>Set to My Current GPS ({userPos.lat.toFixed(4)}, {userPos.lng.toFixed(4)})</span>
              </button>
            )}

            <button type="submit" className="btn-submit-lot" disabled={publishing}>
              {publishing ? 'Publishing...' : '+ Publish Facility to Live Grid'}
            </button>
          </form>
        </div>

        {/* Right Column: Ledger Table */}
        <div className="partner-col-card">
          <div className="col-header flex-between">
            <div className="flex-row gap-8">
              <TrendingUp size={18} className="text-emerald" />
              <h3>10% Mall Revenue Ledger</h3>
            </div>
            <div className="table-search">
              <Search size={14} />
              <input
                type="text"
                placeholder="Search car plate or mall..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
            </div>
          </div>

          <div className="ledger-table-container">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Pass ID</th>
                  <th>Parking Facility</th>
                  <th>Vehicle Plate</th>
                  <th>Paid</th>
                  <th>Mall 10%</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredBookings.length > 0 ? (
                  filteredBookings.map((b) => (
                    <tr key={b.id}>
                      <td className="pass-col">#{b.booking_code || b.id}</td>
                      <td>{b.spot_name}</td>
                      <td>
                        <span className="plate-badge">{b.vehicle_number}</span>
                      </td>
                      <td>₹{b.gross_amount}</td>
                      <td className="payout-cell">₹{b.mall_share_10pct}</td>
                      <td>
                        <span className={`status-pill ${b.status?.toLowerCase()}`}>
                          {b.status}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="empty-table-cell">
                      No matching transactions recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
