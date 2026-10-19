import base64
import math
import sqlite3
import time
from typing import Optional
import cv2
import numpy as np
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="ParkGrid Live API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = "parkgrid_live.db"


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS parking_spots (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            spot_type TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            total_slots INTEGER DEFAULT 1,
            available_slots INTEGER DEFAULT 1,
            gap_meters REAL DEFAULT 5.0,
            price_per_hour REAL DEFAULT 0,
            updated_at INTEGER
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            spot_id TEXT NOT NULL,
            spot_name TEXT NOT NULL,
            vehicle_number TEXT NOT NULL,
            hours INTEGER NOT NULL,
            gross_amount REAL NOT NULL,
            mall_share_10pct REAL NOT NULL,
            platform_share_90pct REAL NOT NULL,
            status TEXT DEFAULT 'ACTIVE',
            created_at INTEGER NOT NULL
        )
    """)

    cur.execute("SELECT COUNT(*) as cnt FROM parking_spots")
    if cur.fetchone()["cnt"] == 0:
        now = int(time.time())
        seed = [
            # Connaught Place (CP) Delhi — Multi-Block Street & Underground Grid
            ("CP_BLK_A", "CP Inner Circle — Block A Curb", "street", 28.6328, 77.2197, 8, 5, 5.8, 0.0, now),
            ("CP_BLK_B", "CP Inner Circle — Block B Curb", "street", 28.6336, 77.2212, 10, 6, 6.4, 0.0, now),
            ("CP_BLK_C", "CP Inner Circle — Block C Curb", "street", 28.6322, 77.2224, 12, 4, 5.2, 0.0, now),
            ("CP_BLK_E", "CP Inner Circle — Block E Curb", "street", 28.6305, 77.2208, 9, 7, 8.9, 0.0, now),
            ("CP_BLK_F", "CP Middle Circle — Block F Radial Rd", "street", 28.6311, 77.2182, 14, 9, 6.1, 0.0, now),
            ("CP_JANPATH", "CP Outer Circle — Janpath Lane", "street", 28.6289, 77.2185, 15, 8, 5.5, 0.0, now),
            ("CP_PALIKA", "Palika Bazar Underground Multi-Level (Partner)", "mall", 28.6315, 77.2195, 120, 42, 5.0, 40.0, now),
            ("CP_BKS", "Baba Kharak Singh Marg Automated Lot (Partner)", "mall", 28.6301, 77.2142, 90, 31, 5.0, 30.0, now),
            # South Delhi Partner Malls
            ("MALL_DEL_SCW", "Select CityWalk Saket (Partner)", "mall", 28.5283, 77.2185, 65, 24, 5.0, 60.0, now),
            ("MALL_DEL_DLF", "DLF Avenue Saket (Partner)", "mall", 28.5272, 77.2159, 50, 19, 5.0, 50.0, now),
            # Lucknow Real Locations
            ("MALL_LKO_PAL", "Phoenix Palassio Mall (Partner)", "mall", 26.8143, 81.0076, 80, 28, 5.0, 40.0, now),
            ("MALL_LKO_LULU", "Lulu Mall Lucknow (Partner)", "mall", 26.7845, 80.9904, 110, 46, 5.0, 40.0, now),
            ("MALL_LKO_WAVE", "Wave Mall Gomti Nagar (Partner)", "mall", 26.8673, 80.9754, 45, 15, 5.0, 50.0, now),
            ("STREET_LKO_HAZ", "Hazratganj Multi-Level / Curb Strip", "street", 26.8505, 80.9463, 12, 7, 6.2, 0.0, now),
        ]
        cur.executemany("INSERT INTO parking_spots VALUES (?,?,?,?,?,?,?,?,?,?)", seed)
        conn.commit()
    conn.close()


init_db()


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


class BookingRequest(BaseModel):
    spot_id: str
    spot_name: str
    price_per_hour: float
    vehicle_number: str
    hours: int = 1


class NewPartnerSpot(BaseModel):
    name: str
    spot_type: str  # 'mall' or 'street'
    lat: float
    lng: float
    total_slots: int = 10
    price_per_hour: float = 40.0


class LiveCameraFrameRequest(BaseModel):
    spot_id: str
    name: str
    lat: float
    lng: float
    image_base64: str
    strip_width_meters: float = 15.0  # Real-world width visible in camera frame


@app.get("/api/spots")
async def get_spots(lat: float, lng: float):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM parking_spots")
    db_spots = [dict(r) for r in cur.fetchall()]
    conn.close()

    results = []
    for s in db_spots:
        s["distance_km"] = round(haversine_km(lat, lng, s["lat"], s["lng"]), 2)
        results.append(s)

    # Fetch real OpenStreetMap parking lots within 8km of the queried coordinates
    try:
        query = f'[out:json][timeout:5];(node["amenity"="parking"](around:8000,{lat},{lng});way["amenity"="parking"](around:8000,{lat},{lng}););out center 35;'
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://overpass-api.de/api/interpreter",
                data={"data": query},
                timeout=5.0,
            )
            if resp.status_code == 200:
                for el in resp.json().get("elements", []):
                    elat = el.get("lat") or el.get("center", {}).get("lat")
                    elon = el.get("lon") or el.get("center", {}).get("lon")
                    if not elat or not elon:
                        continue
                    tags = el.get("tags", {})
                    name = tags.get("name", f"Public Parking Lot #{str(el['id'])[-4:]}")
                    fee = tags.get("fee", "no")
                    stype = "mall" if fee == "yes" else "street"
                    results.append({
                        "id": f"OSM_{el['id']}",
                        "name": name,
                        "spot_type": stype,
                        "lat": elat,
                        "lng": elon,
                        "total_slots": 20 if stype == "mall" else 3,
                        "available_slots": 8 if stype == "mall" else 1,
                        "gap_meters": 5.0 if stype == "mall" else 5.4,
                        "price_per_hour": 30.0 if stype == "mall" else 0.0,
                        "distance_km": round(haversine_km(lat, lng, elat, elon), 2),
                    })
    except Exception:
        pass

    results.sort(key=lambda x: x["distance_km"])
    return {"spots": results}


@app.post("/api/book")
def create_booking(req: BookingRequest):
    if not req.vehicle_number.strip():
        raise HTTPException(status_code=400, detail="Enter a valid vehicle number")

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM parking_spots WHERE id = ?", (req.spot_id,))
    spot = cur.fetchone()

    if spot:
        if spot["available_slots"] <= 0:
            conn.close()
            raise HTTPException(status_code=400, detail="Lot is currently full")
        cur.execute(
            "UPDATE parking_spots SET available_slots = available_slots - 1 WHERE id = ?",
            (req.spot_id,),
        )

    gross = round(req.price_per_hour * req.hours, 2)
    mall_10 = round(gross * 0.10, 2)
    net_90 = round(gross * 0.90, 2)
    now = int(time.time())

    cur.execute(
        """
        INSERT INTO bookings 
        (spot_id, spot_name, vehicle_number, hours, gross_amount, mall_share_10pct, platform_share_90pct, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
        """,
        (req.spot_id, req.spot_name, req.vehicle_number.upper().strip(), req.hours, gross, mall_10, net_90, now),
    )
    booking_id = cur.lastrowid
    conn.commit()
    conn.close()

    return {
        "booking_id": booking_id,
        "spot_id": req.spot_id,
        "spot_name": req.spot_name,
        "vehicle_number": req.vehicle_number.upper().strip(),
        "hours": req.hours,
        "gross_amount": gross,
        "mall_share_10pct": mall_10,
        "platform_share_90pct": net_90,
        "created_at": now,
    }


@app.post("/api/bookings/{booking_id}/checkout")
def checkout_booking(booking_id: int):
    """Releases the locked slot back to the pool when a driver checks out."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,))
    b = cur.fetchone()
    if not b:
        conn.close()
        raise HTTPException(status_code=404, detail="Booking not found")

    cur.execute("UPDATE bookings SET status = 'COMPLETED' WHERE id = ?", (booking_id,))
    cur.execute(
        "UPDATE parking_spots SET available_slots = available_slots + 1 WHERE id = ?",
        (b["spot_id"],),
    )
    conn.commit()
    conn.close()
    return {"status": "COMPLETED"}


@app.post("/api/partner/add-spot")
def add_real_spot(spot: NewPartnerSpot):
    """Allows onboarding a real Mall Partner or Street Zone at exact GPS coordinates."""
    conn = get_db()
    cur = conn.cursor()
    spot_id = f"REAL_{int(time.time())}"
    cur.execute(
        "INSERT INTO parking_spots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            spot_id,
            spot.name,
            spot.spot_type,
            spot.lat,
            spot.lng,
            spot.total_slots,
            spot.total_slots,
            5.2,
            spot.price_per_hour if spot.spot_type == "mall" else 0.0,
            int(time.time()),
        ),
    )
    conn.commit()
    conn.close()
    return {"id": spot_id, "status": "added"}


@app.post("/api/gods-eye/analyze-frame")
def analyze_live_camera_frame(req: LiveCameraFrameRequest):
    """
    REAL OpenCV Computer Vision Pipeline:
    1. Decodes the live base64 frame from the webcam/IP camera.
    2. Crops the horizontal parking curb Region of Interest (ROI).
    3. Runs Gaussian blur + Canny edge detection + morphological closing to identify cars/obstacles.
    4. Scans column-by-column edge density to find the longest continuous empty curb gap.
    5. Converts that pixel gap into real meters and updates the live map database.
    """
    try:
        header, encoded = (
            req.image_base64.split(",", 1)
            if "," in req.image_base64
            else ("", req.image_base64)
        )
        img_bytes = base64.b64decode(encoded)
        np_arr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("Invalid camera frame")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Frame decode error: {str(e)}")

    h, w, _ = frame.shape
    # Focus on the middle horizontal parking strip (30% to 75% height)
    roi = frame[int(h * 0.30) : int(h * 0.75), :]
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (7, 7), 0)
    edges = cv2.Canny(blurred, 50, 150)

    # Dilate edges to merge vehicle bodies into solid blocks
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)

    # Calculate vertical column occupancy density across the width of the camera view
    col_density = np.mean(closed > 0, axis=0)
    is_empty_col = col_density < 0.12  # Columns with <12% edge texture are open curb/asphalt

    # Find longest contiguous empty segment in pixels
    max_empty_px = 0
    curr_px = 0
    best_start = 0
    temp_start = 0

    for i, empty in enumerate(is_empty_col):
        if empty:
            if curr_px == 0:
                temp_start = i
            curr_px += 1
            if curr_px > max_empty_px:
                max_empty_px = curr_px
                best_start = temp_start
        else:
            curr_px = 0

    meters_per_px = req.strip_width_meters / float(w)
    largest_gap_meters = round(max_empty_px * meters_per_px, 2)

    # Standard car (~3.8m) + 1.0m maneuvering clearance = 4.8m minimum
    if largest_gap_meters >= 9.0:
        slots_detected = 2
    elif largest_gap_meters >= 4.8:
        slots_detected = 1
    else:
        slots_detected = 0

    # Draw visual telemetry overlay on the frame and return annotated preview
    annotated = frame.copy()
    roi_y1, roi_y2 = int(h * 0.30), int(h * 0.75)
    cv2.rectangle(annotated, (0, roi_y1), (w, roi_y2), (255, 255, 0), 2)

    if max_empty_px > 10:
        x1 = best_start
        x2 = best_start + max_empty_px
        color = (0, 220, 0) if slots_detected > 0 else (0, 0, 255)
        cv2.rectangle(annotated, (x1, roi_y1), (x2, roi_y2), color, 3)
        cv2.putText(
            annotated,
            f"GAP: {largest_gap_meters}m ({slots_detected} Slots)",
            (max(10, x1), roi_y1 - 12),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            color,
            2,
        )

    _, buffer = cv2.imencode(".jpg", annotated)
    annotated_b64 = "data:image/jpeg;base64," + base64.b64encode(buffer).decode("utf-8")

    # Persist real-time camera finding into SQLite database
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT OR REPLACE INTO parking_spots
        (id, name, spot_type, lat, lng, total_slots, available_slots, gap_meters, price_per_hour, updated_at)
        VALUES (?, ?, 'street', ?, ?, ?, ?, ?, 0.0, ?)
        """,
        (
            req.spot_id,
            req.name,
            req.lat,
            req.lng,
            max(1, slots_detected),
            slots_detected,
            largest_gap_meters,
            int(time.time()),
        ),
    )
    conn.commit()
    conn.close()

    return {
        "spot_id": req.spot_id,
        "gap_meters": largest_gap_meters,
        "slots_detected": slots_detected,
        "fits_car": slots_detected > 0,
        "annotated_frame": annotated_b64,
    }


@app.get("/api/partner/ledger")
def get_ledger():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM bookings ORDER BY created_at DESC")
    bookings = [dict(r) for r in cur.fetchall()]
    gross = sum(b["gross_amount"] for b in bookings)
    mall_10 = sum(b["mall_share_10pct"] for b in bookings)
    conn.close()
    return {
        "total_bookings": len(bookings),
        "gross_revenue": round(gross, 2),
        "mall_10pct_share": round(mall_10, 2),
        "platform_90pct_net": round(gross - mall_10, 2),
        "bookings": bookings,
    }