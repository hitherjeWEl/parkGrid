# ParkGrid Pro — Smart Urban Parking & God's Eye AI Vision Platform

A production-grade, highly interactive smart parking application optimized for both mobile and desktop browsers. Features real-time GPS turn-by-turn navigation, interactive test drive route simulation, 15-minute guaranteed bay holds with dynamic digital QR passes, God's Eye OpenCV metric homography radar & CCTV curb scanner, and a 10% mall partner revenue settlement ledger.

---

## 🌟 Key Features

### 1. Driver Experience (Desktop & Mobile)
- **High-Accuracy Geolocation & Speed Tracking**: Continuous live vehicle tracking with real-time velocity in km/h.
- **Hands-Free Turn-by-Turn GPS Navigation**: Full OSRM routing with upcoming maneuver directions, distance countdown in meters, and Web Speech API audio voice announcements.
- **Interactive "Test Drive" Route Simulation**: Allows users on desktop or in testing to watch their vehicle animate along the route polyline with simulated driving speed, turning prompts, and arrival at the parking bay.
- **Vehicle Sizing Compatibility**: Dynamic clearance matching for **Hatchbacks (3.8m)**, **Sedans (4.5m)**, and **SUVs (5.0m)**. Automatically flags spots that are too tight.
- **15-Minute Guaranteed Hold Digital Pass**: Locks dedicated parking bays (e.g. `Level B1 • Bay 04`) with a real-time countdown timer, vehicle plate tag, dynamic QR barcode, and one-tap checkout slot release.
- **Native Navigation Handoff**: 1-click deep links to Google Maps and Apple Maps.
- **Multi-City Fast Jumpers**: Instant teleportation to Connaught Place (Delhi), Saket District Centre (South Delhi), DLF CyberHub (Gurugram), Hazratganj (Lucknow), Phoenix Palassio (Lucknow), BKC (Mumbai), and Indiranagar (Bengaluru).

### 2. God's Eye Computer Vision Engine (`gods_eye_engine.py`)
- **Top-Down Metric Homography Radar**: OpenCV perspective transformation mapping camera pixels to ground metric coordinates (`meters_per_pixel = 0.156 m/px`). Renders real-time JPEG bird's-eye overlays with metric distance grid lines, parked vehicles in red, and open bays in green.
- **Live CCTV & Smartphone Curb Scanner**:
  - Connects to your phone's back camera / webcam OR runs on 1-click synthetic CCTV feeds.
  - OpenCV pipeline: Gaussian blur → Canny edge detection → Morphological closing → Column density scan.
  - Accurately measures the continuous curb gap in meters and determines vehicle fit.
  - "Publish to Live Map" pushes detected curb spots directly into the live driver database.

### 3. Mall Partner Hub & 10% Settlement Ledger (`partner_engine.py`)
- **Transparent Revenue Model**: 10% gross mall partner share vs. 90% platform net revenue.
- **Live KPI Dashboard**: Real-time counters for Total Bookings, Gross Volume, Mall Partner Commission, and Active Holds.
- **Facility Onboarding**: Register new partner malls or automated street curb sensors with custom pricing, capacity, EV charging, and exact GPS coordinates.

---

## 🚀 Quick Start

### 1. Production Mode (Single-Process Serving)
Build the frontend and run the FastAPI server, which serves both the API and the React SPA:

```powershell
# Build the optimized production assets
npm run build

# Start the unified production server
backend\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```
Open **`http://127.0.0.1:8000`** in any desktop or mobile browser.

---

### 2. Development Mode (Hot Reloading)

#### Terminal 1 — Backend:
```powershell
backend\.venv\Scripts\Activate.ps1
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

#### Terminal 2 — Frontend:
```powershell
npm run dev
```
Open **`http://localhost:5173`**. Requests to `/api/*` are automatically proxied to the backend.

---

## 🧪 Verification & Automated Testing

Run the end-to-end integration test suite:

```powershell
backend\.venv\Scripts\python.exe backend\test_production.py
```

Runs automated checks across:
1. Static SPA index serving
2. Spatial Haversine distance search & filters
3. God's Eye OpenCV top-down metric homography overlay generation
4. Live CCTV frame gap measurement pipeline
5. 15-minute guaranteed hold reservation
6. Partner 10% commission revenue ledger
7. Checkout bay release
8. System health telemetry

---

## 📱 Mobile Browser Optimization

- Mobile-first responsive bottom-sheet drawer with 3 snap states: `peek (72px)`, `half (45vh)`, and `expanded (85vh)`.
- Touch-friendly sticky bottom navigation bar (`Explore`, `God's Eye`, `My Pass`, `Partner`).
- Safe-area viewport inset padding and zero horizontal overflow.
