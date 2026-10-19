import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

// Automatically uses your live Render backend URL in production, or localhost in VS Code
const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export default function App() {
  const isPartnerPortal = new URLSearchParams(window.location.search).get("role") === "partner";

  // Consumer State
  const [userPos, setUserPos] = useState({ lat: 28.6315, lng: 77.2195 });
  const [userSpeedKmh, setUserSpeedKmh] = useState(0);
  const [gpsLocked, setGpsLocked] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [spots, setSpots] = useState([]);
  const [filter, setFilter] = useState("all");
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [routeInfo, setRouteInfo] = useState(null);
  const [vehicleNo, setVehicleNo] = useState("");
  const [hours, setHours] = useState(1);
  const [activePass, setActivePass] = useState(null);

  // Hands-Free Live Navigation State
  const [navSteps, setNavSteps] = useState([]);
  const [navActive, setNavActive] = useState(false);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [distToNextTurnM, setDistToNextTurnM] = useState(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const announced150mRef = useRef(false);

  // Map Refs
  const mapRef = useRef(null);
  const markersLayerRef = useRef(null);
  const routeLayerRef = useRef(null);
  const routeCoordsRef = useRef([]);

  // Partner & Live Camera State (?role=partner)
  const [ledger, setLedger] = useState(null);
  const videoRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [autoScan, setAutoScan] = useState(false);
  const [cvResult, setCvResult] = useState(null);
  const [camConfig, setCamConfig] = useState({
    spot_id: "CP_BLK_A",
    name: "CP Inner Circle — Block A Curb",
    lat: 28.6328,
    lng: 77.2197,
    strip_width_meters: 14.0,
  });
  const [newLot, setNewLot] = useState({
    name: "",
    spot_type: "mall",
    lat: 28.6315,
    lng: 77.2195,
    total_slots: 25,
    price_per_hour: 40,
  });

  function speakInstruction(text) {
    if (!voiceEnabled || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.02;
    window.speechSynthesis.speak(utterance);
  }

  function formatManeuver(step) {
    const type = step.maneuver?.type || "continue";
    const modifier = step.maneuver?.modifier || "";
    const road = step.name ? ` onto ${step.name}` : "";
    if (type === "depart") return `Head ${modifier || "straight"}${road}`;
    if (type === "arrive") return `You have arrived at your parking spot`;
    if (type === "turn") return `Turn ${modifier}${road}`;
    if (type === "roundabout" || type === "rotary") return `Take rotary exit${road}`;
    return `Continue ${modifier || "straight"}${road}`;
  }

  // 1. Continuous High-Frequency Live GPS Tracking (100% Hands-Free)
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const speedMs = pos.coords.speed || 0;
        setUserPos(coords);
        setUserSpeedKmh(Math.max(0, Math.round(speedMs * 3.6)));
        setGpsLocked(true);
      },
      () => setGpsLocked(false),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 8000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // 2. Live Hands-Free Turn-by-Turn Engine (Camera Lock + Live Countdown + Auto-Reroute)
  useEffect(() => {
    if (!navActive || navSteps.length === 0) return;

    // A. Keep Map Camera Locked onto Moving Car
    if (mapRef.current) {
      mapRef.current.panTo([userPos.lat, userPos.lng], { animate: true });
    }

    const userLatLng = L.latLng(userPos.lat, userPos.lng);

    // B. Calculate Live Distance in Meters to Next Turn Maneuver
    const targetIdx = Math.min(currentStepIdx + 1, navSteps.length - 1);
    const targetStep = navSteps[targetIdx];

    if (targetStep?.location) {
      const [turnLng, turnLat] = targetStep.location;
      const dMeters = Math.round(userLatLng.distanceTo(L.latLng(turnLat, turnLng)));
      setDistToNextTurnM(dMeters);

      // Speak pre-turn warning at <= 150 meters
      if (dMeters <= 150 && dMeters > 35 && !announced150mRef.current) {
        announced150mRef.current = true;
        speakInstruction(`In ${dMeters} meters, ${targetStep.instruction}`);
      }

      // Automatically switch to the next turn when car enters within 30 meters of intersection
      if (dMeters <= 30) {
        if (targetIdx === navSteps.length - 1) {
          speakInstruction("You have arrived at your parking destination.");
          setNavActive(false);
        } else {
          setCurrentStepIdx(targetIdx);
          announced150mRef.current = false;
          speakInstruction(`${targetStep.instruction}`);
        }
        return;
      }
    }

    // C. Live Off-Route Detection (Auto-Reroutes if driver strays > 65m from path)
    if (routeCoordsRef.current.length > 0 && selectedSpot) {
      let minRouteDist = Infinity;
      for (const pt of routeCoordsRef.current) {
        const d = userLatLng.distanceTo(L.latLng(pt[0], pt[1]));
        if (d < minRouteDist) minRouteDist = d;
      }
      if (minRouteDist > 65) {
        speakInstruction("Recalculating route from your current position.");
        buildLiveRoute(userPos, selectedSpot, true);
      }
    }
  }, [userPos, navActive, currentStepIdx, navSteps]);

  // 3. Initialize OpenStreetMap
  useEffect(() => {
    if (isPartnerPortal) {
      loadLedger();
      return;
    }
    const container = L.DomUtil.get("parkgrid-map");
    if (container != null) container._leaflet_id = null;

    const map = L.map("parkgrid-map", { zoomControl: true }).setView([userPos.lat, userPos.lng], 14);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => map.remove();
  }, [isPartnerPortal]);

  function fetchSpots(lat, lng) {
    fetch(`${API_BASE}/api/spots?lat=${lat}&lng=${lng}`)
      .then((r) => r.json())
      .then((d) => setSpots(d.spots || []))
      .catch((e) => console.error(e));
  }

  useEffect(() => {
    if (!isPartnerPortal) fetchSpots(userPos.lat, userPos.lng);
  }, [gpsLocked, isPartnerPortal, activePass]);

  // 4. Render Map Pins
  useEffect(() => {
    if (!mapRef.current || !markersLayerRef.current) return;
    markersLayerRef.current.clearLayers();

    const carIcon = L.divIcon({
      className: "user-car-marker",
      html: `<div class="car-core"></div>`,
      iconSize: [22, 22],
    });
    L.marker([userPos.lat, userPos.lng], { icon: carIcon })
      .addTo(markersLayerRef.current)
      .bindPopup("<b>Your Live Car GPS</b>");

    const filtered = spots.filter((s) => filter === "all" || s.spot_type === filter);
    filtered.forEach((spot) => {
      if (spot.available_slots <= 0) return;
      const isMall = spot.spot_type === "mall";
      const badge = L.divIcon({
        className: "spot-pin-wrapper",
        html: `<div class="map-pill ${isMall ? "pill-mall" : "pill-street"}">
                 ${isMall ? `🏢 ₹${spot.price_per_hour} (${spot.available_slots})` : `🛰️ ${spot.available_slots} free • ${spot.gap_meters}m`}
               </div>`,
        iconSize: [96, 30],
      });

      const m = L.marker([spot.lat, spot.lng], { icon: badge }).addTo(markersLayerRef.current);
      m.on("click", () => {
        setSelectedSpot(spot);
        setNavActive(false);
        buildLiveRoute(userPos, spot, false);
      });
    });
  }, [spots, filter, userPos]);

  // 5. Build OSRM Route & Extract Live Coordinates
  async function buildLiveRoute(origin, spot, keepNavActive = false) {
    if (!mapRef.current || !routeLayerRef.current) return;
    routeLayerRef.current.clearLayers();

    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${spot.lng},${spot.lat}?overview=full&geometries=geojson&steps=true`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const coords = route.geometry.coordinates.map((c) => [c[1], c[0]]);
        routeCoordsRef.current = coords;

        const polyline = L.polyline(coords, {
          color: spot.spot_type === "mall" ? "#2563eb" : "#16a34a",
          weight: 6,
          opacity: 0.9,
        }).addTo(routeLayerRef.current);

        if (!keepNavActive) {
          mapRef.current.fitBounds(polyline.getBounds(), { padding: [60, 60] });
        }

        const rawSteps = route.legs?.[0]?.steps || [];
        const parsedSteps = rawSteps.map((s) => ({
          instruction: formatManeuver(s),
          distanceMeters: Math.round(s.distance),
          location: s.maneuver?.location,
        }));

        setNavSteps(parsedSteps);
        setCurrentStepIdx(0);
        announced150mRef.current = false;
        setRouteInfo({
          distanceKm: (route.distance / 1000).toFixed(1),
          durationMin: Math.max(1, Math.round(route.duration / 60)),
        });
      }
    } catch (e) {
      console.error("Routing error:", e);
    }
  }

  function startHandsFreeNavigation() {
    if (navSteps.length === 0) return;
    setNavActive(true);
    setCurrentStepIdx(0);
    announced150mRef.current = false;
    if (mapRef.current) {
      mapRef.current.flyTo([userPos.lat, userPos.lng], 17);
    }
    speakInstruction(`Live GPS navigation started. ${navSteps[0].instruction}`);
  }

  async function handleSearchPlace(e) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`
    );
    const data = await res.json();
    if (data && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      mapRef.current?.flyTo([lat, lng], 15);
      fetchSpots(lat, lng);
    } else {
      alert("Location not found.");
    }
  }

  async function handleBook(e) {
    e.preventDefault();
    const res = await fetch(`${API_BASE}/api/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spot_id: selectedSpot.id,
        spot_name: selectedSpot.name,
        price_per_hour: selectedSpot.price_per_hour,
        vehicle_number: vehicleNo,
        hours: Number(hours),
      }),
    });
    const data = await res.json();
    if (!res.ok) return alert(data.detail || "Booking failed");
    setActivePass({ ...data, lat: selectedSpot.lat, lng: selectedSpot.lng });
    startHandsFreeNavigation();
  }

  async function handleCheckoutPass() {
    if (!activePass) return;
    await fetch(`${API_BASE}/api/bookings/${activePass.booking_id}/checkout`, { method: "POST" });
    setActivePass(null);
    fetchSpots(userPos.lat, userPos.lng);
  }

  // Partner & Camera Functions
  async function loadLedger() {
    const res = await fetch(`${API_BASE}/api/partner/ledger`);
    setLedger(await res.json());
  }

  async function startLiveCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 640, height: 360 },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
      }
    } catch (err) {
      alert("Camera permission error: " + err.message);
    }
  }

  async function captureAndAnalyzeFrame() {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 360;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const base64Frame = canvas.toDataURL("image/jpeg", 0.8);

    const res = await fetch(`${API_BASE}/api/gods-eye/analyze-frame`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...camConfig,
        lat: Number(camConfig.lat),
        lng: Number(camConfig.lng),
        strip_width_meters: Number(camConfig.strip_width_meters),
        image_base64: base64Frame,
      }),
    });
    setCvResult(await res.json());
  }

  useEffect(() => {
    if (!autoScan || !cameraActive) return;
    const timer = setInterval(captureAndAnalyzeFrame, 3000);
    return () => clearInterval(timer);
  }, [autoScan, cameraActive, camConfig]);

  async function handleAddPartnerSpot(e) {
    e.preventDefault();
    await fetch(`${API_BASE}/api/partner/add-spot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...newLot,
        lat: Number(newLot.lat),
        lng: Number(newLot.lng),
        total_slots: Number(newLot.total_slots),
        price_per_hour: Number(newLot.price_per_hour),
      }),
    });
    alert("Parking Lot Published to Live Map!");
    setNewLot({ ...newLot, name: "" });
  }

  if (isPartnerPortal) {
    return (
      <div className="partner-shell">
        <header className="partner-topbar">
          <div>
            <h1>ParkGrid Partner & Live God's Eye OpenCV Console</h1>
            <p>Real-Time Webcam/CCTV Curb Scanner & 10% Mall Commission Ledger</p>
          </div>
          <a href="/" className="switch-app-btn">← Back to Driver Map</a>
        </header>

        {ledger && (
          <div className="kpi-row">
            <div className="kpi-box">
              <span className="kpi-label">Total Bookings</span>
              <strong className="kpi-value">{ledger.total_bookings}</strong>
            </div>
            <div className="kpi-box">
              <span className="kpi-label">Gross Volume</span>
              <strong className="kpi-value">₹{ledger.gross_revenue}</strong>
            </div>
            <div className="kpi-box kpi-green">
              <span className="kpi-label">Mall Partner Payout (10%)</span>
              <strong className="kpi-value">₹{ledger.mall_10pct_share}</strong>
            </div>
            <div className="kpi-box">
              <span className="kpi-label">ParkGrid Net (90%)</span>
              <strong className="kpi-value">₹{ledger.platform_90pct_net}</strong>
            </div>
          </div>
        )}

        <div className="partner-columns">
          <div className="panel-card">
            <h2>🛰️ Live Camera God's Eye Curb Detector (OpenCV)</h2>
            <p className="panel-desc">
              Mount a phone or IP camera overlooking a parking curb. OpenCV measures the largest continuous free gap in meters and updates the driver map every 3 seconds.
            </p>
            <div className="camera-stage">
              <video ref={videoRef} autoPlay playsInline muted className="webcam-feed" />
              {cvResult?.annotated_frame && (
                <img src={cvResult.annotated_frame} alt="OpenCV Output" className="opencv-overlay" />
              )}
            </div>
            <div className="cam-controls">
              {!cameraActive ? (
                <button onClick={startLiveCamera} className="btn-blue">
                  🎥 Turn On Live Camera
                </button>
              ) : (
                <>
                  <button onClick={captureAndAnalyzeFrame} className="btn-blue">
                    📸 Scan Curb Frame Now
                  </button>
                  <button
                    onClick={() => setAutoScan(!autoScan)}
                    className={autoScan ? "btn-red" : "btn-green"}
                  >
                    {autoScan ? "⏹ Stop Auto-Scan" : "▶ Start Live 3s Loop"}
                  </button>
                </>
              )}
            </div>
            {cvResult && (
              <div className={`cv-status-banner ${cvResult.fits_car ? "status-ok" : "status-tight"}`}>
                <strong>Measured Gap: {cvResult.gap_meters}m</strong>
                <span>
                  {cvResult.fits_car
                    ? `✅ ${cvResult.slots_detected} Spot(s) Live on Map`
                    : "❌ Under 4.8m — Marked Full"}
                </span>
              </div>
            )}
            <div className="cam-Inputs">
              <div>
                <label>Street / Curb Name</label>
                <input
                  value={camConfig.name}
                  onChange={(e) => setCamConfig({ ...camConfig, name: e.target.value })}
                />
              </div>
              <div>
                <label>Camera Field Width (Meters)</label>
                <input
                  type="number"
                  value={camConfig.strip_width_meters}
                  onChange={(e) => setCamConfig({ ...camConfig, strip_width_meters: e.target.value })}
                />
              </div>
              <div>
                <label>GPS Lat</label>
                <input
                  type="number"
                  step="any"
                  value={camConfig.lat}
                  onChange={(e) => setCamConfig({ ...camConfig, lat: e.target.value })}
                />
              </div>
              <div>
                <label>GPS Lng</label>
                <input
                  type="number"
                  step="any"
                  value={camConfig.lng}
                  onChange={(e) => setCamConfig({ ...camConfig, lng: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="panel-card">
            <h2>🏢 Register New Partner Mall / Lot</h2>
            <form onSubmit={handleAddPartnerSpot} className="add-lot-form">
              <input
                placeholder="Mall or Parking Lot Name"
                value={newLot.name}
                onChange={(e) => setNewLot({ ...newLot, name: e.target.value })}
                required
              />
              <div className="form-split">
                <select
                  value={newLot.spot_type}
                  onChange={(e) => setNewLot({ ...newLot, spot_type: e.target.value })}
                >
                  <option value="mall">Partner Mall (Paid Pre-Book)</option>
                  <option value="street">Open Street Zone (Free)</option>
                </select>
                <input
                  type="number"
                  placeholder="Hourly Rate (₹)"
                  value={newLot.price_per_hour}
                  onChange={(e) => setNewLot({ ...newLot, price_per_hour: e.target.value })}
                />
              </div>
              <div className="form-split">
                <input
                  type="number"
                  step="any"
                  placeholder="Latitude"
                  value={newLot.lat}
                  onChange={(e) => setNewLot({ ...newLot, lat: e.target.value })}
                  required
                />
                <input
                  type="number"
                  step="any"
                  placeholder="Longitude"
                  value={newLot.lng}
                  onChange={(e) => setNewLot({ ...newLot, lng: e.target.value })}
                  required
                />
              </div>
              <button type="submit" className="btn-blue">
                + Publish Parking Lot
              </button>
            </form>

            <h2 style={{ marginTop: "24px" }}>💰 Live 10% Mall Commission Ledger</h2>
            <div className="table-scroll">
              <table className="clean-table">
                <thead>
                  <tr>
                    <th>Pass</th>
                    <th>Location</th>
                    <th>Car No</th>
                    <th>Paid</th>
                    <th>Mall 10%</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger?.bookings?.map((b) => (
                    <tr key={b.id}>
                      <td>#{b.id}</td>
                      <td>{b.spot_name}</td>
                      <td><span className="plate-tag">{b.vehicle_number}</span></td>
                      <td>₹{b.gross_amount}</td>
                      <td className="payout-col">₹{b.mall_share_10pct}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const visibleSpots = spots.filter((s) => filter === "all" || s.spot_type === filter);
  const upcomingStep = navSteps[Math.min(currentStepIdx + 1, navSteps.length - 1)] || navSteps[0];

  return (
    <div className="app-layout">
      <aside className="left-sidebar">
        <div className="sidebar-header">
          <div className="logo-bar">
            <div>
              <span className="brand-logo">ParkGrid</span>
              <span className={`gps-badge ${gpsLocked ? "gps-live" : ""}`}>
                {gpsLocked ? `● Live GPS (${userSpeedKmh} km/h)` : "● Acquiring GPS..."}
              </span>
            </div>
            <button
              className="locate-me-btn"
              onClick={() => {
                mapRef.current?.flyTo([userPos.lat, userPos.lng], 15);
                fetchSpots(userPos.lat, userPos.lng);
              }}
            >
              🎯 My Car
            </button>
          </div>

          <form onSubmit={handleSearchPlace} className="search-box">
            <input
              type="text"
              placeholder="Search area (e.g. Connaught Place, Hazratganj)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button type="submit">Go</button>
          </form>

          <div className="filter-tabs">
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
              All ({spots.length})
            </button>
            <button className={filter === "mall" ? "active" : ""} onClick={() => setFilter("mall")}>
              🏢 Partner Malls
            </button>
            <button
              className={filter === "street" ? "active" : ""}
              onClick={() => setFilter("street")}
            >
              🛰️ God's Eye Curb
            </button>
          </div>
        </div>

        {activePass && (
          <div className="digital-pass">
            <div className="pass-top">
              <span className="pass-badge">ACTIVE PASS #{activePass.booking_id}</span>
              <button onClick={handleCheckoutPass} className="checkout-btn">
                Release Slot
              </button>
            </div>
            <h4>{activePass.spot_name}</h4>
            <div className="pass-meta">
              <span>Car: <b>{activePass.vehicle_number}</b></span>
              <span>Paid: <b>₹{activePass.gross_amount}</b></span>
            </div>
          </div>
        )}

        <div className="sidebar-content">
          {selectedSpot ? (
            <div className="selected-card">
              <button
                className="back-link"
                onClick={() => {
                  setSelectedSpot(null);
                  setNavActive(false);
                }}
              >
                ← Back to all {visibleSpots.length} nearby spots
              </button>

              <span className={`type-pill ${selectedSpot.spot_type}`}>
                {selectedSpot.spot_type === "mall"
                  ? "VERIFIED MALL PARTNER"
                  : `GOD'S EYE CURB GAP • ${selectedSpot.gap_meters}m`}
              </span>
              <h2>{selectedSpot.name}</h2>

              <div className="route-stats">
                <div>
                  <small>Distance</small>
                  <strong>{routeInfo ? `${routeInfo.distanceKm} km` : `${selectedSpot.distance_km} km`}</strong>
                </div>
                {routeInfo && (
                  <div>
                    <small>Drive ETA</small>
                    <strong>{routeInfo.durationMin} mins</strong>
                  </div>
                )}
                <div>
                  <small>Available Bays</small>
                  <strong>{selectedSpot.available_slots} open</strong>
                </div>
              </div>

              {navSteps.length > 0 && (
                <button
                  type="button"
                  onClick={startHandsFreeNavigation}
                  className="btn-green full"
                  style={{ marginBottom: "14px" }}
                >
                  🧭 {navActive ? "Hands-Free GPS Tracking Active" : `Start Hands-Free Live Navigation (${routeInfo?.durationMin} min)`}
                </button>
              )}

              {selectedSpot.spot_type === "mall" ? (
                <form onSubmit={handleBook} className="booking-form">
                  <label>Vehicle Registration Number</label>
                  <input
                    type="text"
                    placeholder="e.g. DL 01 AB 1234"
                    value={vehicleNo}
                    onChange={(e) => setVehicleNo(e.target.value)}
                    required
                  />
                  <label>Parking Duration</label>
                  <select value={hours} onChange={(e) => setHours(e.target.value)}>
                    <option value={1}>1 Hour — ₹{selectedSpot.price_per_hour}</option>
                    <option value={2}>2 Hours — ₹{selectedSpot.price_per_hour * 2}</option>
                    <option value={3}>3 Hours — ₹{selectedSpot.price_per_hour * 3}</option>
                  </select>

                  <button type="submit" className="btn-blue full">
                    Lock Bay & Auto-Navigate — ₹{selectedSpot.price_per_hour * hours}
                  </button>
                </form>
              ) : (
                <div className="street-box">
                  <p>
                    🛰️ Curb clearance verified at <b>{selectedSpot.gap_meters}m</b> with{" "}
                    <b>{selectedSpot.available_slots} open bay(s)</b>.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="spots-list">
              {visibleSpots.map((spot) => (
                <div
                  key={spot.id}
                  className="spot-item"
                  onClick={() => {
                    setSelectedSpot(spot);
                    setNavActive(false);
                    buildLiveRoute(userPos, spot, false);
                  }}
                >
                  <div className="spot-info">
                    <span className={`type-pill ${spot.spot_type}`}>
                      {spot.spot_type === "mall"
                        ? "MALL PARTNER"
                        : `CURB GAP • ${spot.gap_meters}m`}
                    </span>
                    <h3>{spot.name}</h3>
                    <p>
                      {spot.distance_km} km away • <b>{spot.available_slots} spots open</b>
                    </p>
                  </div>
                  <div className="spot-rate">
                    {spot.spot_type === "mall" ? (
                      <>
                        <strong>₹{spot.price_per_hour}</strong>
                        <small>/hr</small>
                      </>
                    ) : (
                      <strong className="free-tag">FREE</strong>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* RIGHT STAGE: Map + Hands-Free Auto-Tracking Navigation Banner */}
      <main className="map-stage">
        {navActive && upcomingStep && (
          <div
            style={{
              position: "absolute",
              top: "16px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 1000,
              background: "#065f46",
              color: "#ffffff",
              padding: "16px 22px",
              borderRadius: "16px",
              boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
              minWidth: "350px",
              maxWidth: "92%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "18px",
            }}
          >
            <div>
              <div style={{ fontSize: "0.75rem", color: "#a7f3d0", fontWeight: 700 }}>
                LIVE GPS AUTO-TRACKING • {userSpeedKmh} KM/H •{" "}
                {distToNextTurnM !== null ? `IN ${distToNextTurnM} METERS` : "FOLLOW ROUTE"}
              </div>
              <div style={{ fontSize: "1.15rem", fontWeight: 800, marginTop: "4px" }}>
                ↱ {upcomingStep.instruction}
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button
                onClick={() => setVoiceEnabled(!voiceEnabled)}
                style={{
                  background: "#047857",
                  color: "#fff",
                  border: "none",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  cursor: "pointer",
                }}
              >
                {voiceEnabled ? "🔊" : "🔇"}
              </button>
              <button
                onClick={() => {
                  setNavActive(false);
                  window.speechSynthesis?.cancel();
                }}
                style={{
                  background: "#dc2626",
                  color: "#fff",
                  border: "none",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Exit
              </button>
            </div>
          </div>
        )}
        <div id="parkgrid-map" className="leaflet-full" />
      </main>
    </div>
  );
}