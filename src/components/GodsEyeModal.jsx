import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Eye, 
  Camera, 
  RefreshCw, 
  Layers, 
  ShieldAlert, 
  CheckCircle2, 
  X, 
  Play, 
  Square
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function GodsEyeModal({ onClose, onSpotPublished }) {
  const [subTab, setSubTab] = useState('radar'); // 'radar' | 'camera'
  const [selectedZone, setSelectedZone] = useState('cp_inner_circle');
  const [zones, setZones] = useState([]);
  const [radarTimestamp, setRadarTimestamp] = useState(() => Date.now());
  const [zoneDetails, setZoneDetails] = useState(null);

  // Camera & OpenCV State
  const videoRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [autoScan, setAutoScan] = useState(false);
  const [cvResult, setCvResult] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [useDemoFeed, setUseDemoFeed] = useState(true);

  const [camConfig, setCamConfig] = useState({
    spot_id: 'CP_BLK_A',
    name: 'CP Inner Circle — Block A Curb',
    lat: 28.6328,
    lng: 77.2197,
    strip_width_meters: 14.0,
  });

  // Fetch zones on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/gods-eye/zones`)
      .then((r) => r.json())
      .then((data) => {
        if (data.zones && data.zones.length > 0) {
          setZones(data.zones);
        }
      })
      .catch((e) => console.error('Error fetching zones:', e));
  }, []);

  // Fetch zone details when selectedZone changes
  useEffect(() => {
    if (!selectedZone) return;
    fetch(`${API_BASE}/api/gods-eye/zones/${selectedZone}`)
      .then((r) => r.json())
      .then((data) => setZoneDetails(data))
      .catch((e) => console.error('Error fetching zone details:', e));
  }, [selectedZone, radarTimestamp]);

  const captureAndAnalyzeFrame = useCallback(async () => {
    setAnalyzing(true);
    try {
      let base64Frame = null;
      if (cameraActive && videoRef.current && !useDemoFeed) {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth || 640;
        canvas.height = videoRef.current.videoHeight || 360;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        base64Frame = canvas.toDataURL('image/jpeg', 0.85);
      }

      const res = await fetch(`${API_BASE}/api/gods-eye/analyze-frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...camConfig,
          lat: Number(camConfig.lat),
          lng: Number(camConfig.lng),
          strip_width_meters: Number(camConfig.strip_width_meters),
          image_base64: base64Frame,
          use_demo_cctv: useDemoFeed || !cameraActive,
        }),
      });

      const data = await res.json();
      setCvResult(data);
      if (onSpotPublished) onSpotPublished();
    } catch (err) {
      console.error('Frame analysis failed:', err);
    } finally {
      setAnalyzing(false);
    }
  }, [cameraActive, useDemoFeed, camConfig, onSpotPublished]);

  // Camera handling
  async function startDeviceCamera() {
    try {
      setUseDemoFeed(false);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 360 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
      }
    } catch {
      alert('Camera access denied or unavailable. Switching to live Simulated CCTV feed.');
      setUseDemoFeed(true);
    }
  }

  function stopDeviceCamera() {
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
    const timer = setInterval(captureAndAnalyzeFrame, 3000);
    return () => clearInterval(timer);
  }, [autoScan, captureAndAnalyzeFrame]);

  // Clean up camera on unmount
  useEffect(() => {
    return () => {
      stopDeviceCamera();
    };
  }, []);

  const overlayUrl = `${API_BASE}/api/gods-eye/overlay/${selectedZone}?t=${radarTimestamp}`;

  return (
    <div className="godseye-modal-overlay">
      <div className="godseye-modal-container">
        {/* Modal Top Bar */}
        <div className="godseye-modal-header">
          <div className="header-left">
            <div className="radar-badge">
              <Eye size={18} />
              <span className="live-ping" />
            </div>
            <div>
              <h2>God's Eye AI Vision Console</h2>
              <p>Top-Down Homography Radar & Real-Time OpenCV Curb Gap Measurement</p>
            </div>
          </div>

          <div className="header-right">
            <div className="subtab-toggle">
              <button
                className={`subtab-btn ${subTab === 'radar' ? 'active' : ''}`}
                onClick={() => setSubTab('radar')}
              >
                <Layers size={15} />
                <span>Top-Down Radar</span>
              </button>
              <button
                className={`subtab-btn ${subTab === 'camera' ? 'active' : ''}`}
                onClick={() => setSubTab('camera')}
              >
                <Camera size={15} />
                <span>Live CCTV Scanner</span>
              </button>
            </div>

            <button className="close-modal-btn" onClick={onClose} aria-label="Close God's Eye Console">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="godseye-modal-content">
          {subTab === 'radar' ? (
            <div className="radar-view-pane">
              <div className="radar-controls-bar">
                <div className="zone-picker-group">
                  <label htmlFor="zoneSelect">Monitored Zone:</label>
                  <select
                    id="zoneSelect"
                    value={selectedZone}
                    onChange={(e) => setSelectedZone(e.target.value)}
                  >
                    {zones.map((z) => (
                      <option key={z.zone_id} value={z.zone_id}>
                        {z.name} ({z.available_slots} / {z.total_slots_detected} open)
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  className="btn-refresh-radar"
                  onClick={() => setRadarTimestamp(Date.now())}
                >
                  <RefreshCw size={14} />
                  <span>Refresh Radar</span>
                </button>
              </div>

              <div className="radar-display-stage">
                <div className="radar-image-wrapper">
                  <img
                    src={overlayUrl}
                    alt="Top-Down Metric Homography Radar"
                    className="radar-overlay-img"
                  />
                  <div className="radar-scanline" />
                </div>

                {/* Radar Telemetry Sidebar */}
                <div className="radar-telemetry-sidebar">
                  <h3>Zone Telemetry</h3>

                  <div className="telemetry-card">
                    <div className="t-stat">
                      <span className="t-stat-label">Curb Strip</span>
                      <strong className="t-stat-val">
                        {zoneDetails?.curb_length_m || 90.0}m
                      </strong>
                    </div>
                    <div className="t-stat">
                      <span className="t-stat-label">Available Slots</span>
                      <strong className="t-stat-val text-emerald">
                        {zoneDetails?.slots?.filter((s) => s.status === 'available').length || 0} Open
                      </strong>
                    </div>
                    <div className="t-stat">
                      <span className="t-stat-label">Parked Vehicles</span>
                      <strong className="t-stat-val">
                        {zoneDetails?.vehicles?.length || 0} Detected
                      </strong>
                    </div>
                  </div>

                  <h4>Detected Curb Gaps</h4>
                  <div className="detected-gaps-list">
                    {zoneDetails?.slots?.map((s) => (
                      <div
                        key={s.slot_id}
                        className={`gap-item-row ${s.status === 'available' ? 'gap-avail' : 'gap-occ'}`}
                      >
                        <span className="gap-len">{s.gap_meters}m</span>
                        <div className="gap-details">
                          <span className="gap-label">{s.label}</span>
                          <span className="gap-status-badge">
                            {s.status === 'available' ? '✅ AVAILABLE' : 'OCCUPIED'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="radar-legend">
                    <div><span className="legend-box green" /> Available Curb Gap</div>
                    <div><span className="legend-box red" /> Parked Vehicle</div>
                    <div><span className="legend-box gray" /> 5-Meter Metric Grid</div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="camera-view-pane">
              <div className="camera-toolbar">
                <div className="feed-switch-group">
                  <button
                    className={`feed-btn ${useDemoFeed ? 'active' : ''}`}
                    onClick={() => {
                      stopDeviceCamera();
                      setUseDemoFeed(true);
                      captureAndAnalyzeFrame();
                    }}
                  >
                    🛰️ Simulated CCTV (1-Click Test)
                  </button>
                  <button
                    className={`feed-btn ${!useDemoFeed ? 'active' : ''}`}
                    onClick={startDeviceCamera}
                  >
                    📷 Use Device Camera
                  </button>
                </div>

                <div className="camera-action-group">
                  <button
                    className="btn-primary"
                    onClick={captureAndAnalyzeFrame}
                    disabled={analyzing}
                  >
                    <RefreshCw size={15} className={analyzing ? 'spin-slow' : ''} />
                    <span>{analyzing ? 'OpenCV Processing...' : 'Scan Frame Now'}</span>
                  </button>

                  <button
                    className={`btn-toggle-scan ${autoScan ? 'scanning' : ''}`}
                    onClick={() => setAutoScan(!autoScan)}
                  >
                    {autoScan ? <Square size={14} /> : <Play size={14} />}
                    <span>{autoScan ? 'Stop 3s Loop' : 'Start 3s Loop'}</span>
                  </button>
                </div>
              </div>

              <div className="camera-dual-stage">
                {/* Stage Left: Raw Camera or Demo Preview */}
                <div className="stage-frame-box">
                  <div className="stage-title">Raw Video Feed</div>
                  <div className="feed-container">
                    {!useDemoFeed ? (
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="live-video-element"
                      />
                    ) : (
                      <div className="demo-feed-placeholder">
                        <div className="cctv-hud-header">
                          <span>CAM-04 CP INNER CIRCLE [SYNTHETIC FEED]</span>
                          <span className="rec-dot">● REC</span>
                        </div>
                        <p>Simulating live high-angle CCTV street view</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Stage Right: OpenCV Annotated Telemetry Output */}
                <div className="stage-frame-box">
                  <div className="stage-title">
                    <span>OpenCV Computer Vision Output</span>
                    {cvResult && <span className="cv-tag">EDGE + DENSITY ANALYSIS</span>}
                  </div>
                  <div className="feed-container">
                    {cvResult?.annotated_frame ? (
                      <img
                        src={cvResult.annotated_frame}
                        alt="OpenCV Detection HUD"
                        className="opencv-annotated-img"
                      />
                    ) : (
                      <div className="awaiting-scan-notice">
                        <Camera size={32} />
                        <p>Click "Scan Frame Now" to run OpenCV edge & gap detection.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Real-time Status Card */}
              {cvResult && (
                <div className={`cv-result-card ${cvResult.fits_car ? 'res-success' : 'res-tight'}`}>
                  <div className="res-icon">
                    {cvResult.fits_car ? <CheckCircle2 size={24} /> : <ShieldAlert size={24} />}
                  </div>
                  <div className="res-details">
                    <h4>
                      {cvResult.fits_car
                        ? `Clearance Verified: ${cvResult.gap_meters} Meters`
                        : `Gap Too Tight: ${cvResult.gap_meters} Meters (Under 3.8m Minimum)`}
                    </h4>
                    <p>
                      Detected <b>{cvResult.slots_detected} open bay(s)</b>. Compatible with:{' '}
                      <b>{cvResult.compatible_vehicles?.join(', ') || 'No passenger cars'}</b>.
                    </p>
                  </div>
                  <div className="res-badge">
                    {cvResult.fits_car ? 'SYNCHRONIZED WITH DRIVER MAP' : 'FLAGGED FULL'}
                  </div>
                </div>
              )}

              {/* Calibration & Config Form */}
              <div className="camera-config-form">
                <div className="form-group">
                  <label>Monitored Street / Curb Name</label>
                  <input
                    type="text"
                    value={camConfig.name}
                    onChange={(e) => setCamConfig({ ...camConfig, name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Camera Field Width (Meters)</label>
                  <input
                    type="number"
                    value={camConfig.strip_width_meters}
                    onChange={(e) => setCamConfig({ ...camConfig, strip_width_meters: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>GPS Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={camConfig.lat}
                    onChange={(e) => setCamConfig({ ...camConfig, lat: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>GPS Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={camConfig.lng}
                    onChange={(e) => setCamConfig({ ...camConfig, lng: e.target.value })}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
