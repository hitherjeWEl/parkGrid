"""
Mall Partnership & Reservation Engine
======================================
Manages partner mall parking inventories, slot reservations with a
15-minute hold window, and a transparent 10 / 90 revenue split
(mall partner share / platform net revenue).
"""

import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------

class PartnerSlot(BaseModel):
    slot_id: str
    partner_id: str
    floor: str
    bay_number: str
    status: str  # "available" | "reserved" | "occupied"
    reserved_until: Optional[datetime] = None
    reserved_by: Optional[str] = None


class MallPartner(BaseModel):
    partner_id: str
    name: str
    lat: float
    lng: float
    total_slots: int
    base_price: float  # per hour in INR
    slots: List[PartnerSlot]


class Booking(BaseModel):
    booking_id: str
    slot_id: str
    partner_id: str
    user_id: str
    gross_amount: float
    mall_partner_share: float  # 10 %
    platform_net_revenue: float  # 90 %
    reserved_at: datetime
    expires_at: datetime
    status: str  # "active" | "expired" | "completed"


# ---------------------------------------------------------------------------
# Haversine
# ---------------------------------------------------------------------------

def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres between two lat/lon points."""
    R = 6_371_000  # Earth radius in metres
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ---------------------------------------------------------------------------
# PartnerEngine
# ---------------------------------------------------------------------------

class PartnerEngine:
    """Manages mall partner inventories, bookings, and revenue ledger."""

    def __init__(self) -> None:
        self.partners: Dict[str, MallPartner] = {}
        self.bookings: List[Booking] = []
        self._init_demo_partners()

    # ----- demo seed data -----

    def _init_demo_partners(self) -> None:
        """Seed four demo partners around New Delhi."""
        demo_specs = [
            {
                "name": "Select CityWalk",
                "lat": 28.5685,
                "lng": 77.3219,
                "total_slots": 12,
                "base_price": 80.0,
                "floors": ["B1", "B2"],
            },
            {
                "name": "DLF Avenue Saket",
                "lat": 28.5274,
                "lng": 77.2190,
                "total_slots": 10,
                "base_price": 60.0,
                "floors": ["B1", "B2"],
            },
            {
                "name": "Ambience Mall Vasant Kunj",
                "lat": 28.5433,
                "lng": 77.1523,
                "total_slots": 14,
                "base_price": 70.0,
                "floors": ["B1", "B2", "B3"],
            },
            {
                "name": "CP Central Lot",
                "lat": 28.6320,
                "lng": 77.2180,
                "total_slots": 8,
                "base_price": 100.0,
                "floors": ["G", "B1"],
            },
        ]

        for spec in demo_specs:
            pid = f"partner-{uuid.uuid4().hex[:8]}"
            slots: List[PartnerSlot] = []

            slot_idx = 0
            for floor in spec["floors"]:
                per_floor = spec["total_slots"] // len(spec["floors"])
                for bay in range(1, per_floor + 1):
                    sid = f"ps-{uuid.uuid4().hex[:8]}"
                    # Mark roughly 60 % as available for demo realism
                    status = "available" if (slot_idx % 5 != 0) else "occupied"
                    slots.append(
                        PartnerSlot(
                            slot_id=sid,
                            partner_id=pid,
                            floor=floor,
                            bay_number=f"{floor}-{bay:02d}",
                            status=status,
                        )
                    )
                    slot_idx += 1

            self.partners[pid] = MallPartner(
                partner_id=pid,
                name=spec["name"],
                lat=spec["lat"],
                lng=spec["lng"],
                total_slots=spec["total_slots"],
                base_price=spec["base_price"],
                slots=slots,
            )

    # ----- reservation -----

    def reserve_slot(
        self, slot_id: str, user_id: str, gross_amount: float
    ) -> Booking:
        """Lock *slot_id* for 15 minutes.

        Revenue split: mall partner 10 %, platform 90 %.

        Raises ``ValueError`` if the slot doesn't exist or is unavailable.
        """
        self.cleanup_expired()

        target_slot: Optional[PartnerSlot] = None
        owner_partner: Optional[MallPartner] = None
        for partner in self.partners.values():
            for slot in partner.slots:
                if slot.slot_id == slot_id:
                    target_slot = slot
                    owner_partner = partner
                    break
            if target_slot is not None:
                break

        if target_slot is None:
            raise ValueError(f"Slot {slot_id} not found in any partner inventory.")
        if target_slot.status != "available":
            raise ValueError(
                f"Slot {slot_id} is currently '{target_slot.status}', not available."
            )

        now = datetime.now(tz=timezone.utc)
        expires = now + timedelta(minutes=15)

        target_slot.status = "reserved"
        target_slot.reserved_until = expires
        target_slot.reserved_by = user_id

        mall_share = round(gross_amount * 0.10, 2)
        platform_net = round(gross_amount * 0.90, 2)

        booking = Booking(
            booking_id=f"bk-{uuid.uuid4().hex[:8]}",
            slot_id=slot_id,
            partner_id=owner_partner.partner_id,  # type: ignore[union-attr]
            user_id=user_id,
            gross_amount=gross_amount,
            mall_partner_share=mall_share,
            platform_net_revenue=platform_net,
            reserved_at=now,
            expires_at=expires,
            status="active",
        )
        self.bookings.append(booking)
        return booking

    # ----- radius search -----

    def get_available_slots(
        self, lat: float, lng: float, radius_m: float
    ) -> List[dict]:
        """Return available partner slots within *radius_m* of (lat, lng).

        Each result dict includes the slot info plus ``distance_m`` and
        partner metadata.
        """
        self.cleanup_expired()

        results: List[dict] = []
        for partner in self.partners.values():
            dist = haversine_meters(lat, lng, partner.lat, partner.lng)
            if dist > radius_m:
                continue
            for slot in partner.slots:
                if slot.status == "available":
                    results.append(
                        {
                            "slot_id": slot.slot_id,
                            "partner_id": partner.partner_id,
                            "partner_name": partner.name,
                            "floor": slot.floor,
                            "bay_number": slot.bay_number,
                            "status": slot.status,
                            "base_price_inr": partner.base_price,
                            "lat": partner.lat,
                            "lng": partner.lng,
                            "distance_m": round(dist, 1),
                            "slot_type": "partner_mall",
                        }
                    )

        results.sort(key=lambda r: r["distance_m"])
        return results

    # ----- ledger / telemetry -----

    def get_partner_ledger(
        self, partner_id: Optional[str] = None
    ) -> dict:
        """Revenue telemetry.

        If *partner_id* is given, returns ledger for that partner only;
        otherwise returns an aggregate across all partners.
        """
        filtered = (
            [b for b in self.bookings if b.partner_id == partner_id]
            if partner_id
            else self.bookings
        )

        total_gross = sum(b.gross_amount for b in filtered)
        total_mall_share = sum(b.mall_partner_share for b in filtered)
        total_platform = sum(b.platform_net_revenue for b in filtered)
        active = [b for b in filtered if b.status == "active"]
        completed = [b for b in filtered if b.status == "completed"]
        expired = [b for b in filtered if b.status == "expired"]

        partner_breakdown: Dict[str, dict] = {}
        for b in filtered:
            pid = b.partner_id
            if pid not in partner_breakdown:
                pname = (
                    self.partners[pid].name
                    if pid in self.partners
                    else "unknown"
                )
                partner_breakdown[pid] = {
                    "partner_id": pid,
                    "partner_name": pname,
                    "bookings": 0,
                    "gross": 0.0,
                    "mall_share": 0.0,
                    "platform_net": 0.0,
                }
            partner_breakdown[pid]["bookings"] += 1
            partner_breakdown[pid]["gross"] += b.gross_amount
            partner_breakdown[pid]["mall_share"] += b.mall_partner_share
            partner_breakdown[pid]["platform_net"] += b.platform_net_revenue

        return {
            "total_bookings": len(filtered),
            "active_bookings": len(active),
            "completed_bookings": len(completed),
            "expired_bookings": len(expired),
            "total_gross_inr": round(total_gross, 2),
            "total_mall_partner_share_inr": round(total_mall_share, 2),
            "total_platform_net_revenue_inr": round(total_platform, 2),
            "partner_breakdown": list(partner_breakdown.values()),
        }

    # ----- expiry cleanup -----

    def cleanup_expired(self) -> int:
        """Release expired reservations. Returns count of released slots."""
        now = datetime.now(tz=timezone.utc)
        released = 0
        for booking in self.bookings:
            if booking.status == "active" and booking.expires_at <= now:
                booking.status = "expired"
                # Release the slot back to available
                for partner in self.partners.values():
                    for slot in partner.slots:
                        if slot.slot_id == booking.slot_id:
                            slot.status = "available"
                            slot.reserved_until = None
                            slot.reserved_by = None
                            released += 1
                            break
        return released
