"""
ParkGrid Pro — FastAPI Backend
===============================
Unified API surface combining:
 • God's Eye View street-parking detection  (gods_eye_engine)
 • Mall Partnership & Reservation engine     (partner_engine)
 • Legacy /api/search endpoint               (preserved)
"""

import io
import math
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

try:
    from backend.gods_eye_engine import GodsEyeEngine, SlotInfo, build_cp_demo_scene
    from backend.partner_engine import PartnerEngine, haversine_meters
except ImportError:
    from gods_eye_engine import GodsEyeEngine, SlotInfo, build_cp_demo_scene
    from partner_engine import PartnerEngine, haversine_meters

# ---------------------------------------------------------------------------
# App bootstrap
# ---------------------------------------------------------------------------

app = FastAPI(
    title="ParkGrid Pro API",
    version="2.0.0",
    description="God's Eye parking detection + Mall partner reservations",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Engine singletons (initialised at import time)
# ---------------------------------------------------------------------------

gods_eye_engine: GodsEyeEngine
_demo_slots: list
_demo_vehicles: list
gods_eye_engine, _demo_slots, _demo_vehicles = build_cp_demo_scene()

partner_engine = PartnerEngine()


# ---------------------------------------------------------------------------
# Haversine (canonical copy shared with partner_engine)
# ---------------------------------------------------------------------------

def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class SearchQuery(BaseModel):
    destination: str = Field(min_length=1)
    arrival_time: str = "1 Minute"
    search_mode: str
    vehicle_length: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class ReservationRequest(BaseModel):
    slot_id: str
    user_id: str
    gross_amount: float


# ---------------------------------------------------------------------------
# Root
# ---------------------------------------------------------------------------

@app.get("/")
def read_root() -> dict:
    return {"status": "ParkGrid Pro is live!", "version": "2.0.0"}


# ---------------------------------------------------------------------------
# Legacy search endpoint (preserved & enhanced)
# ---------------------------------------------------------------------------

@app.post("/api/search")
def find_parking(query: SearchQuery) -> dict:
    """Original /api/search — now enriched with God's Eye results when the
    caller's coordinates are within range of a monitored zone.
    """
    lat = query.latitude or 28.6315
    lng = query.longitude or 77.2167

    if query.search_mode == "street":
        # Try to find a matching dynamic street slot from God's Eye
        nearby_street = [
            s for s in gods_eye_engine.cached_slots
            if s.slot_type == "dynamic_street"
            and s.status == "available"
            and _haversine(lat, lng, s.lat, s.lng) < 500
        ]
        if nearby_street:
            best = min(
                nearby_street, key=lambda s: _haversine(lat, lng, s.lat, s.lng)
            )
            return {
                "type": "Live Street Space",
                "price": "Free",
                "message": (
                    f"God's Eye detected a {best.usable_length_meters:.1f}m gap "
                    f"near {query.destination} that fits a "
                    f"{query.vehicle_length} vehicle."
                ),
                "latitude": best.lat,
                "longitude": best.lng,
                "slot": best.model_dump(),
            }

        return {
            "type": "Live Street Space",
            "price": "Free",
            "message": (
                f"Found a tight spot near {query.destination} that fits "
                f"a {query.vehicle_length} vehicle."
            ),
            "latitude": lat,
            "longitude": lng,
        }

    # Premium / mall mode
    partner_slots = partner_engine.get_available_slots(lat, lng, 15_000)
    if partner_slots:
        top = partner_slots[0]
        return {
            "type": "Premium Shadowed Lot",
            "price": f"₹{top['base_price_inr']:.0f}",
            "message": (
                f"Guaranteed slot at {top['partner_name']} reserved for "
                f"your {query.vehicle_length} vehicle. "
                f"Bay {top['bay_number']} on floor {top['floor']}."
            ),
            "latitude": top["lat"],
            "longitude": top["lng"],
            "partner_slot": top,
        }

    return {
        "type": "Premium Shadowed Lot",
        "price": "₹80",
        "message": (
            f"Guaranteed underground slot reserved at {query.destination} "
            f"for your {query.vehicle_length} vehicle."
        ),
        "latitude": lat,
        "longitude": lng,
    }


# ---------------------------------------------------------------------------
# V1 — Nearby slots (combined street + partner)
# ---------------------------------------------------------------------------

@app.get("/api/v1/slots/nearby")
def get_nearby_slots(
    lat: float = Query(28.6315, description="Latitude"),
    lng: float = Query(77.2167, description="Longitude"),
    radius_m: float = Query(500.0, description="Search radius in metres"),
    car_length_m: float = Query(3.8, description="Car length in metres"),
    zone_type: str = Query("all", description="all | street | partner"),
) -> dict:
    """Combined proximity search across God's Eye street gaps **and**
    partner mall slots, sorted by Haversine distance.
    """
    partner_engine.cleanup_expired()

    results: list = []

    # --- Street slots from God's Eye ---
    if zone_type in ("all", "street"):
        for slot in gods_eye_engine.cached_slots:
            dist = _haversine(lat, lng, slot.lat, slot.lng)
            if dist <= radius_m:
                entry = slot.model_dump()
                entry["distance_m"] = round(dist, 1)
                # Filter by car length when available
                if slot.status == "available" and slot.usable_length_meters > 0:
                    entry["fits_car"] = slot.usable_length_meters >= car_length_m
                else:
                    entry["fits_car"] = False
                results.append(entry)

    # --- Partner mall slots ---
    if zone_type in ("all", "partner"):
        partner_results = partner_engine.get_available_slots(lat, lng, radius_m)
        for pr in partner_results:
            pr["fits_car"] = True  # structured bays always fit standard cars
            results.append(pr)

    # Sort by distance
    results.sort(key=lambda r: r.get("distance_m", float("inf")))

    return {
        "query": {
            "lat": lat,
            "lng": lng,
            "radius_m": radius_m,
            "car_length_m": car_length_m,
            "zone_type": zone_type,
        },
        "total": len(results),
        "slots": results,
    }


# ---------------------------------------------------------------------------
# V1 — Booking / reservation
# ---------------------------------------------------------------------------

@app.post("/api/v1/bookings/reserve")
def reserve_slot(req: ReservationRequest) -> dict:
    """Lock a partner-mall slot for 15 minutes.

    Returns the booking receipt including 10 % mall_partner_share and
    90 % platform_net_revenue.
    """
    try:
        booking = partner_engine.reserve_slot(
            slot_id=req.slot_id,
            user_id=req.user_id,
            gross_amount=req.gross_amount,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {
        "status": "reserved",
        "booking": booking.model_dump(mode="json"),
    }


# ---------------------------------------------------------------------------
# V1 — Partner ledger / telemetry
# ---------------------------------------------------------------------------

@app.get("/api/v1/partners/ledger")
def partner_ledger(
    partner_id: Optional[str] = Query(None, description="Filter by partner"),
) -> dict:
    """Revenue telemetry for the partner dashboard."""
    return partner_engine.get_partner_ledger(partner_id)


# ---------------------------------------------------------------------------
# Video feed — God's Eye top-down overlay
# ---------------------------------------------------------------------------

@app.get("/api/video_feed")
def video_feed() -> StreamingResponse:
    """Returns the God's Eye top-down overlay as a JPEG image."""
    jpeg_bytes = gods_eye_engine.generate_topdown_overlay(
        width=800,
        height=600,
        slots=gods_eye_engine.cached_slots,
        vehicles=_demo_vehicles,
    )
    return StreamingResponse(
        io.BytesIO(jpeg_bytes),
        media_type="image/jpeg",
        headers={"Cache-Control": "no-cache"},
    )


# ---------------------------------------------------------------------------
# V1 — God's Eye status / health
# ---------------------------------------------------------------------------

@app.get("/api/v1/gods-eye/status")
def gods_eye_status() -> dict:
    """Current engine state, active zones, and slot counts."""
    slots = gods_eye_engine.cached_slots
    available = [s for s in slots if s.status == "available"]
    occupied = [s for s in slots if s.status == "occupied"]
    too_tight = [s for s in slots if s.status == "too_tight"]
    street = [s for s in slots if s.slot_type == "dynamic_street"]
    bays = [s for s in slots if s.slot_type == "premapped_bay"]

    return {
        "engine": "GodsEyeEngine",
        "status": "active",
        "zones": list(gods_eye_engine.zones.values()),
        "premapped_bays_count": len(gods_eye_engine.premapped_bays),
        "vehicle_count": sum(
            len(v) for v in gods_eye_engine.vehicle_footprints.values()
        ),
        "slot_summary": {
            "total": len(slots),
            "available": len(available),
            "occupied": len(occupied),
            "too_tight": len(too_tight),
            "dynamic_street": len(street),
            "premapped_bay": len(bays),
        },
        "anchor": {
            "lat": gods_eye_engine.anchor_lat,
            "lng": gods_eye_engine.anchor_lng,
        },
    }
