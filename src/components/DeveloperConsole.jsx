import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Camera, 
  PlusCircle, 
  TrendingUp, 
  Play, 
  Square, 
  RefreshCw, 
  CheckCircle2, 
  LocateFixed, 
  Search, 
  ArrowLeft,
  Video,
  Radio
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function DeveloperConsole({ onSwitchToCivilian, userPos, onSpotCreated }) {
  const [activeDevTab, setActiveDevTab] = useState('cctv'); // 'cctv' | 'add-slot' | 'ledger'

  // Webcam & CCTV State
  const videoRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [autoScan, setAutoScan] = useState(false);
  const [useDeviceCam, setUseDeviceCam] = useState(false);
  const [selectedCctvPreset, setSelectedCctvPreset] = useState('cctv_cp');
  const [customRtspUrl, setCustomRtspUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [cvResult, setCvResult] = useState(null);

  const [camConfig, setCamConfig] = useState({
    spot_id: 'CCTV_DEV_01',
    name: 'Parking Lot CCTV #1 (Central Curb)',
    lat: userPos?.lat || 28.6328,
    lng: userPos?.lng || 77.2197,
    strip_width_meters: 14.0,
  });

  // Add Slot Form State
  const [newSlot, setNewSlot] = useState({
    name: '',
    spot_type: 'mall', // 'mall' (paid) or 'street' (free)
    lat: userPos?.lat || 28.6315,
    lng: userPos?.lng || 77.2195,
    total_slots: 20,
    price_per_hour: 40,
    address: '',
    has_ev: false,
  });
  const [publishing, setPublishing] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState(false);

  // Ledger State
  const [ledger, setLedger] = useState(null);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [ledgerSearch, setLedgerSearch] = useState('');

  // CCTV presets for parking lots
  const CCTV_PRESETS = [
    { id: 'cctv_cp', name: 'Parking Lot CCTV #1 — Connaught Place North Deck', lat: 28.6328, lng: 77.2197, width: 14.0 },
    { id: 'cctv_saket', name: 'Parking Lot CCTV #2 — Saket District Retail Strip', lat: 28.5283, lng: 77.2185, width: 16.0 },
    { id: 'cctv_lko', name: 'Parking Lot CCTV #3 — Hazratganj Multi-Level Gate Cam', lat: 26.8505, lng: 80.9463, width: 12.0 },
  ];

  // Load ledger
  const loadLedger = useCallback(() => {
    setLoadingLedger(true);
    fetch(`${API_BASE}/api/partner/ledger`)
      .then((r) => r.json())
      .then((d) => setLedger(d))
      .catch((e) => console.error('Ledger fetch error:', e))
      .finally(() => setLoadingLedger(false));
  }, []);

  useEffect(() => {
    if (activeDevTab === 'ledger') loadLedger();
  }, [activeDevTab, loadLedger]);

  // Frame Capture & Analysis using OpenCV backend
  const captureAndAnalyze = useCallback(async () => {
    setAnalyzing(true);
    try {
      let b64 = null;
      if (useDeviceCam && videoRef.current && cameraActive) {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth || 640;
        canvas.height = videoRef.current.videoHeight || 360;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        b64 = canvas.toDataURL('image/jpeg', 0.85);
      }

      const res = await fetch(`${API_BASE}/api/gods-eye/analyze-frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spot_id: camConfig.spot_id,
          name: camConfig.name,
          lat: Number(camConfig.lat),
          lng: Number(camConfig.lng),
          strip_width_meters: Number(camConfig.strip_width_meters),
          image_base64: b64,
          use_demo_cctv: !useDeviceCam || !cameraActive,
        }),
      });

      const data = await res.json();
      setCvResult(data);
      if (onSpotCreated) onSpotCreated();
    } catch (err) {
      console.error('Frame analysis error:', err);
    } finally {
      setAnalyzing(false);
    }
  }, [useDeviceCam, cameraActive, camConfig, onSpotCreated]);

  // Start device webcam
  async function startWebcam() {
    try {
      setUseDeviceCam(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 360 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
      }
    } catch {
      alert('Camera access denied or unavailable. Switched to parking lot CCTV simulation feed.');
      setUseDeviceCam(false);
    }
  }

  function stopWebcam() {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setAutoScan(false);
  }

  // Auto scan loop
  useEffect(() => {
    if (!autoScan) return;
    const interval = setInterval(captureAndAnalyze, 3000);
    return () => clearInterval(interval);
  }, [autoScan, captureAndAnalyze]);

  useEffect(() => {
    return () => stopWebcam();
  }, []);

  // Handle Preset Change
  function handleSelectCctvPreset(presetId) {
    setSelectedCctvPreset(presetId);
    const p = CCTV_PRESETS.find((x) => x.id === presetId);
    if (p) {
      setCamConfig({
        spot_id: p.id,
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        strip_width_meters: p.width,
      });
    }
  }

  // Handle Add New Slot
  async function handleCreateSlot(e) {
    e.preventDefault();
    if (!newSlot.name.trim()) return;
    setPublishing(true);
    try {
      const res = await fetch(`${API_BASE}/api/partner/add-spot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSlot.name,
          spot_type: newSlot.spot_type,
          lat: Number(newSlot.lat),
          lng: Number(newSlot.lng),
          total_slots: Number(newSlot.total_slots),
          price_per_hour: newSlot.spot_type === 'street' ? 0 : Number(newSlot.price_per_hour),
          address: newSlot.address,
          has_ev: Boolean(newSlot.has_ev),
        }),
      });

      if (res.ok) {
        setPublishSuccess(true);
        setNewSlot({
          name: '',
          spot_type: 'mall',
          lat: userPos?.lat || 28.6315,
          lng: userPos?.lng || 77.2195,
          total_slots: 20,
          price_per_hour: 40,
          address: '',
          has_ev: false,
        });
        if (onSpotCreated) onSpotCreated();
        setTimeout(() => setPublishSuccess(false), 4500);
      }
    } catch (err) {
      alert('Failed to deploy parking slot: ' + err.message);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="dev-console-shell">
      {/* Dev Top Bar */}
      <div className="dev-topbar">
        <div className="dev-title-block">
          <button className="btn-back-civilian" onClick={onSwitchToCivilian}>
            <ArrowLeft size={16} />
            <span>Back to Civilian Map</span>
          </button>
          <div>
            <h1>Developer & CCTV Vision Control Console</h1>
            <p>Parking Lot Webcam Feeds, IP CCTV Streams & Slot Deployment</p>
          </div>
        </div>

        <div className="dev-tab-nav">
          <button
            className={`dev-tab-btn ${activeDevTab === 'cctv' ? 'active' : ''}`}
            onClick={() => setActiveDevTab('cctv')}
          >
            <Video size={16} />
            <span>Webcam & CCTV Feeds</span>
          </button>

          <button
            className={`dev-tab-btn ${activeDevTab === 'add-slot' ? 'active' : ''}`}
            onClick={() => setActiveDevTab('add-slot')}
          >
            <PlusCircle size={16} />
            <span>Add Parking Slot</span>
          </button>

          <button
            className={`dev-tab-btn ${activeDevTab === 'ledger' ? 'active' : ''}`}
            onClick={() => setActiveDevTab('ledger')}
          >
            <TrendingUp size={16} />
            <span>Slot Ledger & Bookings</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="dev-body-content">
        {/* ============================================================== */}
        {/* TAB 1: WEBCAM & PARKING LOT CCTV FEEDS                         */}
        {/* ============================================================== */}
        {activeDevTab === 'cctv' && (
          <div className="dev-cctv-pane">
            <div className="dev-cctv-toolbar">
              <div className="source-picker">
                <span className="source-label">Camera Source:</span>
                <button
                  className={`source-chip ${!useDeviceCam ? 'active' : ''}`}
                  onClick={() => {
                    stopWebcam();
                    setUseDeviceCam(false);
                  }}
                >
                  <Radio size={14} />
                  <span>Parking Lot CCTV Presets / IP Streams</span>
                </button>
                <button
                  className={`source-chip ${useDeviceCam ? 'active' : ''}`}
                  onClick={startWebcam}
                >
                  <Camera size={14} />
                  <span>Device Webcam / Mobile Camera</span>
                </button>
              </div>

              <div className="cctv-actions">
                <button
                  className="btn-dev-action"
                  onClick={captureAndAnalyze}
                  disabled={analyzing}
                >
                  <RefreshCw size={15} className={analyzing ? 'spin-slow' : ''} />
                  <span>{analyzing ? 'OpenCV Processing...' : 'Scan Frame Now'}</span>
                </button>

                <button
                  className={`btn-auto-toggle ${autoScan ? 'active' : ''}`}
                  onClick={() => setAutoScan(!autoScan)}
                >
                  {autoScan ? <Square size={14} /> : <Play size={14} />}
                  <span>{autoScan ? 'Stop Live 3s Loop' : 'Start Live 3s Loop'}</span>
                </button>
              </div>
            </div>

            {/* If using CCTV Presets */}
            {!useDeviceCam && (
              <div className="cctv-preset-bar">
                <div className="preset-selector">
                  <label>Select Parking Lot Camera Feed:</label>
                  <select
                    value={selectedCctvPreset}
                    onChange={(e) => handleSelectCctvPreset(e.target.value)}
                  >
                    {CCTV_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.width}m width)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rtsp-custom-input">
                  <label>Live IP / RTSP Camera Stream URL (Coming Time):</label>
                  <input
                    type="text"
                    placeholder="rtsp://admin:pass@192.168.1.100:554/live/ch0"
                    value={customRtspUrl}
                    onChange={(e) => setCustomRtspUrl(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Video & OpenCV Dual Display */}
            <div className="dev-video-grid">
              <div className="dev-video-card">
                <div className="card-top-title">
                  <div className="flex-row gap-8">
                    <span className="live-rec-dot">● LIVE</span>
                    <span>Raw Camera Stream Preview</span>
                  </div>
                  <span className="feed-source-tag">
                    {useDeviceCam ? 'WEBCAM 640x360' : 'CCTV CAM-01 STREAM'}
                  </span>
                </div>

                <div className="video-viewport">
                  {useDeviceCam ? (
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="dev-video-element"
                    />
                  ) : (
                    <div className="simulated-cctv-overlay">
                      <div className="cctv-time-stamp">
                        CAM 01 — {camConfig.name} • 1080P/30FPS
                      </div>
                      <p>Parking Lot Video Stream Active</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="dev-video-card">
                <div className="card-top-title">
                  <span>OpenCV Computer Vision Analysis Output</span>
                  <span className="cv-engine-tag">CANNY EDGES + COLUMN DENSITY</span>
                </div>

                <div className="video-viewport">
                  {cvResult?.annotated_frame ? (
                    <img
                      src={cvResult.annotated_frame}
                      alt="OpenCV Annotated HUD"
                      className="dev-annotated-img"
                    />
                  ) : (
                    <div className="cv-awaiting-placeholder">
                      <Camera size={36} />
                      <p>Click "Scan Frame Now" or "Start Live 3s Loop" to analyze parking occupancy.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Telemetry Output HUD */}
            {cvResult && (
              <div className={`dev-hud-card ${cvResult.fits_car ? 'success' : 'alert'}`}>
                <div className="hud-metric">
                  <span className="h-lbl">Measured Free Gap</span>
                  <strong className="h-val">{cvResult.gap_meters} Meters</strong>
                </div>

                <div className="hud-metric">
                  <span className="h-lbl">Slots Detected</span>
                  <strong className="h-val">{cvResult.slots_detected} Space(s)</strong>
                </div>

                <div className="hud-metric">
                  <span className="h-lbl">Vehicle Size Fit</span>
                  <strong className="h-val text-emerald">
                    {cvResult.compatible_vehicles?.join(' • ') || 'Under minimum'}
                  </strong>
                </div>

                <div className="hud-metric sync-status">
                  <span className="h-lbl">Database Status</span>
                  <strong className="h-val">
                    {cvResult.fits_car ? '✅ PUBLISHED TO CIVILIAN MAP' : 'MARKED FULL'}
                  </strong>
                </div>
              </div>
            )}

            {/* Calibration Form */}
            <div className="dev-calib-card">
              <h3>Camera Geometry & Calibration Settings</h3>
              <div className="calib-inputs-row">
                <div className="c-input">
                  <label>Spot / Facility Name</label>
                  <input
                    type="text"
                    value={camConfig.name}
                    onChange={(e) => setCamConfig({ ...camConfig, name: e.target.value })}
                  />
                </div>
                <div className="c-input">
                  <label>Field Width in Meters</label>
                  <input
                    type="number"
                    value={camConfig.strip_width_meters}
                    onChange={(e) => setCamConfig({ ...camConfig, strip_width_meters: e.target.value })}
                  />
                </div>
                <div className="c-input">
                  <label>Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={camConfig.lat}
                    onChange={(e) => setCamConfig({ ...camConfig, lat: e.target.value })}
                  />
                </div>
                <div className="c-input">
                  <label>Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={camConfig.lng}
                    onChange={(e) => setCamConfig({ ...camConfig, lng: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 2: ADD NEW PARKING SLOT                                    */}
        {/* ============================================================== */}
        {activeDevTab === 'add-slot' && (
          <div className="dev-add-slot-pane">
            <div className="add-slot-card">
              <h2>Deploy New Parking Slot to Live Grid</h2>
              <p>Register any parking lot, garage, or street zone so it immediately becomes searchable on the civilian map.</p>

              {publishSuccess && (
                <div className="slot-success-banner">
                  <CheckCircle2 size={18} />
                  <span>Parking slot successfully published and live for civilian drivers!</span>
                </div>
              )}

              <form onSubmit={handleCreateSlot} className="dev-slot-form">
                <div className="form-group">
                  <label>Parking Spot / Facility Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Metro Station Block D Parking"
                    value={newSlot.name}
                    onChange={(e) => setNewSlot({ ...newSlot, name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-row-2">
                  <div className="form-group">
                    <label>Parking Type</label>
                    <select
                      value={newSlot.spot_type}
                      onChange={(e) => setNewSlot({ ...newSlot, spot_type: e.target.value })}
                    >
                      <option value="mall">Paid Parking Spot</option>
                      <option value="street">Free Parking Space</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Hourly Rate (₹)</label>
                    <input
                      type="number"
                      placeholder="40"
                      value={newSlot.price_per_hour}
                      onChange={(e) => setNewSlot({ ...newSlot, price_per_hour: e.target.value })}
                      disabled={newSlot.spot_type === 'street'}
                    />
                  </div>
                </div>

                <div className="form-row-2">
                  <div className="form-group">
                    <label>Total Available Slots</label>
                    <input
                      type="number"
                      value={newSlot.total_slots}
                      onChange={(e) => setNewSlot({ ...newSlot, total_slots: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group checkbox-align">
                    <label className="checkbox-wrap">
                      <input
                        type="checkbox"
                        checked={newSlot.has_ev}
                        onChange={(e) => setNewSlot({ ...newSlot, has_ev: e.target.checked })}
                      />
                      <span>Includes Fast EV Charging Hub</span>
                    </label>
                  </div>
                </div>

                <div className="form-group">
                  <label>Address / Street Description</label>
                  <input
                    type="text"
                    placeholder="e.g. Ring Road, Near Gate 2"
                    value={newSlot.address}
                    onChange={(e) => setNewSlot({ ...newSlot, address: e.target.value })}
                  />
                </div>

                <div className="form-row-2">
                  <div className="form-group">
                    <label>GPS Latitude</label>
                    <input
                      type="number"
                      step="any"
                      value={newSlot.lat}
                      onChange={(e) => setNewSlot({ ...newSlot, lat: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>GPS Longitude</label>
                    <input
                      type="number"
                      step="any"
                      value={newSlot.lng}
                      onChange={(e) => setNewSlot({ ...newSlot, lng: e.target.value })}
                      required
                    />
                  </div>
                </div>

                {userPos && (
                  <button
                    type="button"
                    className="btn-dev-gps"
                    onClick={() => setNewSlot({ ...newSlot, lat: userPos.lat, lng: userPos.lng })}
                  >
                    <LocateFixed size={14} />
                    <span>Set Coordinates to Current GPS ({userPos.lat.toFixed(4)}, {userPos.lng.toFixed(4)})</span>
                  </button>
                )}

                <button type="submit" className="btn-deploy-slot" disabled={publishing}>
                  {publishing ? 'Publishing...' : '+ Deploy Parking Slot to Live Grid'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 3: SLOT INVENTORY & BOOKINGS LEDGER                        */}
        {/* ============================================================== */}
        {activeDevTab === 'ledger' && (
          <div className="dev-ledger-pane">
            <div className="kpi-grid">
              <div className="kpi-card">
                <span className="kpi-title">Total Bookings</span>
                <span className="kpi-num">{ledger?.total_bookings || 0}</span>
                <span className="kpi-sub">{ledger?.active_bookings || 0} currently active</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-title">Gross Volume</span>
                <span className="kpi-num">₹{ledger?.gross_revenue || '0.00'}</span>
                <span className="kpi-sub">Total Transactions</span>
              </div>
              <div className="kpi-card kpi-emerald">
                <span className="kpi-title">Partner Settlement</span>
                <span className="kpi-num">₹{ledger?.mall_10pct_share || '0.00'}</span>
                <span className="kpi-sub highlight">10% Operator Share</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-title">Platform Net</span>
                <span className="kpi-num">₹{ledger?.platform_90pct_net || '0.00'}</span>
                <span className="kpi-sub">90% Cloud Infrastructure</span>
              </div>
            </div>

            <div className="dev-ledger-table-card">
              <div className="table-top-bar">
                <h3>Live Bookings & Reservation Telemetry</h3>
                <div className="dev-search-box">
                  <Search size={14} />
                  <input
                    type="text"
                    placeholder="Filter by plate, location, or pass ID..."
                    value={ledgerSearch}
                    onChange={(e) => setLedgerSearch(e.target.value)}
                  />
                </div>
              </div>

              <div className="ledger-table-container">
                <table className="ledger-table">
                  <thead>
                    <tr>
                      <th>Pass ID</th>
                      <th>Facility</th>
                      <th>License Plate</th>
                      <th>Paid</th>
                      <th>Operator Share</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingLedger ? (
                      <tr>
                        <td colSpan={6} className="empty-table-cell">
                          Loading bookings telemetry...
                        </td>
                      </tr>
                    ) : ledger?.bookings?.filter((b) => {
                      if (!ledgerSearch.trim()) return true;
                      const q = ledgerSearch.toLowerCase();
                      return (
                        b.spot_name?.toLowerCase().includes(q) ||
                        b.vehicle_number?.toLowerCase().includes(q) ||
                        b.booking_code?.toLowerCase().includes(q)
                      );
                    }).map((b) => (
                      <tr key={b.id}>
                        <td className="pass-col">#{b.booking_code || b.id}</td>
                        <td>{b.spot_name}</td>
                        <td><span className="plate-badge">{b.vehicle_number}</span></td>
                        <td>₹{b.gross_amount}</td>
                        <td className="payout-cell">₹{b.mall_share_10pct}</td>
                        <td>
                          <span className={`status-pill ${b.status?.toLowerCase()}`}>
                            {b.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
