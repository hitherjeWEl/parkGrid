"""
God's Eye View Homography & Dynamic Gap Detection Engine
=========================================================
Transforms camera pixel coordinates to metric plane coordinates via
OpenCV homography, detects usable parking gaps along unmarked curbs,
checks pre-mapped bay occupancy, and renders top-down JPEG overlays.
"""

import math
import uuid
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------

class CalibrationConfig(BaseModel):
    """4 source pixel points -> 4 destination metric plane points."""
    src_points: list  # [[px1,py1],[px2,py2],[px3,py3],[px4,py4]]
    dst_points: list  # [[mx1,my1],[mx2,my2],[mx3,my3],[mx4,my4]] in meters
    anchor_lat: float  # geo anchor latitude  (28.6315 for CP demo)
    anchor_lng: float  # geo anchor longitude (77.2167 for CP demo)
    meters_per_pixel: float  # scale factor


class SlotInfo(BaseModel):
    slot_id: str
    lat: float
    lng: float
    status: str  # "available" | "occupied" | "too_tight"
    gap_meters: float
    usable_length_meters: float
    slot_type: str  # "dynamic_street" | "premapped_bay"
    label: str  # e.g. "5.2m Curb Gap - Fits Hatchback/Sedan"
    zone_id: str


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_METERS_PER_DEG_LAT: float = 111_320.0

# Vehicle category thresholds (length in metres)
_VEHICLE_CATEGORIES: List[Tuple[float, str]] = [
    (3.8, "Hatchback"),
    (4.5, "Sedan"),
    (5.0, "SUV"),
    (6.0, "Large SUV / Pickup"),
]


def _vehicle_label(gap_m: float) -> str:
    """Return a human-friendly label describing which vehicles fit a gap."""
    fits: List[str] = []
    for max_len, name in _VEHICLE_CATEGORIES:
        if gap_m >= max_len + 0.6:  # require 0.6 m buffer for manoeuvring
            fits.append(name)
    if not fits:
        return f"{gap_m:.1f}m Curb Gap - Too Tight"
    return f"{gap_m:.1f}m Curb Gap - Fits {'/'.join(fits)}"


# ---------------------------------------------------------------------------
# GodsEyeEngine
# ---------------------------------------------------------------------------

class GodsEyeEngine:
    """Core engine that owns calibration state, performs transforms, detects
    gaps, and produces visual overlays."""

    def __init__(self, config: CalibrationConfig) -> None:
        src = np.array(config.src_points, dtype=np.float32)
        dst = np.array(config.dst_points, dtype=np.float32)

        # Homography: pixel -> metric
        self.H: np.ndarray = cv2.getPerspectiveTransform(src, dst)
        # Inverse homography: metric -> pixel
        self.H_inv: np.ndarray = cv2.getPerspectiveTransform(dst, src)

        self.meters_per_pixel: float = config.meters_per_pixel
        self.anchor_lat: float = config.anchor_lat
        self.anchor_lng: float = config.anchor_lng

        # Mutable runtime state
        self.zones: Dict[str, dict] = {}  # zone_id -> zone meta
        self.premapped_bays: List[dict] = []
        self.vehicle_footprints: Dict[str, List[dict]] = {}  # zone_id -> [footprint]
        self.cached_slots: List[SlotInfo] = []

    # ----- coordinate transforms -----

    def pixel_to_metric(self, px: float, py: float) -> Tuple[float, float]:
        """Transform pixel coords to metric plane coords using homography."""
        pt = np.array([[[px, py]]], dtype=np.float64)
        transformed = cv2.perspectiveTransform(pt, self.H)
        mx: float = float(transformed[0, 0, 0])
        my: float = float(transformed[0, 0, 1])
        return mx, my

    def metric_to_pixel(self, mx: float, my: float) -> Tuple[int, int]:
        """Inverse transform: metric -> pixel."""
        pt = np.array([[[mx, my]]], dtype=np.float64)
        transformed = cv2.perspectiveTransform(pt, self.H_inv)
        return int(round(transformed[0, 0, 0])), int(round(transformed[0, 0, 1]))

    def metric_to_latlon(self, mx: float, my: float) -> Tuple[float, float]:
        """Convert metric plane coords to lat/lon using the geo anchor.

        Convention: +mx → East, +my → North  (standard ENU frame).
        """
        lat_offset = my / _METERS_PER_DEG_LAT
        lng_offset = mx / (_METERS_PER_DEG_LAT * math.cos(math.radians(self.anchor_lat)))
        return self.anchor_lat + lat_offset, self.anchor_lng + lng_offset

    def latlon_to_metric(self, lat: float, lng: float) -> Tuple[float, float]:
        """Inverse of metric_to_latlon."""
        my = (lat - self.anchor_lat) * _METERS_PER_DEG_LAT
        mx = (lng - self.anchor_lng) * _METERS_PER_DEG_LAT * math.cos(
            math.radians(self.anchor_lat)
        )
        return mx, my

    # ----- Scenario 1: pre-mapped bay occupancy -----

    def check_premapped_bay(
        self,
        bay_polygon: list,
        occupancy_grid: list,
        zone_id: str = "cp_inner_circle",
    ) -> SlotInfo:
        """Check occupancy of a pre-mapped 4-point polygon bay.

        *bay_polygon*: list of 4 [lat, lng] corner pairs.
        *occupancy_grid*: list of vehicle centre [lat, lng] points that are
        currently detected inside the field of view.
        """
        # Convert polygon corners to metric
        corners_m = [self.latlon_to_metric(p[0], p[1]) for p in bay_polygon]
        cx = sum(c[0] for c in corners_m) / len(corners_m)
        cy = sum(c[1] for c in corners_m) / len(corners_m)

        # Compute bay dimensions (use the two longest side-lengths)
        side_lengths: List[float] = []
        n = len(corners_m)
        for i in range(n):
            dx = corners_m[(i + 1) % n][0] - corners_m[i][0]
            dy = corners_m[(i + 1) % n][1] - corners_m[i][1]
            side_lengths.append(math.hypot(dx, dy))
        side_lengths.sort(reverse=True)
        bay_length = side_lengths[0] if side_lengths else 5.0

        # Check if any vehicle centre falls inside the polygon (ray-cast)
        poly_np = np.array(corners_m, dtype=np.float32).reshape((-1, 1, 2))
        occupied = False
        for veh in occupancy_grid:
            vmx, vmy = self.latlon_to_metric(veh[0], veh[1])
            dist = cv2.pointPolygonTest(poly_np, (vmx, vmy), False)
            if dist >= 0:
                occupied = True
                break

        centre_lat, centre_lng = self.metric_to_latlon(cx, cy)

        status = "occupied" if occupied else "available"
        label = (
            f"Bay Occupied"
            if occupied
            else f"{bay_length:.1f}m Mapped Bay - Available"
        )

        return SlotInfo(
            slot_id=f"bay-{uuid.uuid4().hex[:8]}",
            lat=round(centre_lat, 7),
            lng=round(centre_lng, 7),
            status=status,
            gap_meters=round(bay_length, 2),
            usable_length_meters=round(bay_length, 2) if not occupied else 0.0,
            slot_type="premapped_bay",
            label=label,
            zone_id=zone_id,
        )

    # ----- Scenario 2: dynamic curb gap detection -----

    def detect_curb_gaps(
        self,
        vehicle_footprints: list,
        zone_id: str,
    ) -> List[SlotInfo]:
        """Detect usable parking gaps along an unmarked curb.

        *vehicle_footprints*: ordered list of dicts, each with keys
            ``front_m`` (float) and ``rear_m`` (float) representing linear
            positions along the curb in metres, plus ``lat`` / ``lng`` of
            the vehicle centre.  Must be sorted by ``front_m`` ascending.

        Clearance rules:
            >=8.5 m  → 2 dynamic slots
            4.8-8.5  → 1 dynamic slot at midpoint
            <4.5 m   → unusable
        """
        slots: List[SlotInfo] = []
        if not vehicle_footprints:
            return slots

        for i in range(len(vehicle_footprints) - 1):
            rear_of_current = vehicle_footprints[i]["rear_m"]
            front_of_next = vehicle_footprints[i + 1]["front_m"]
            clearance = front_of_next - rear_of_current

            # Midpoint lat/lng by averaging neighbouring vehicle centres
            mid_lat = (
                vehicle_footprints[i]["lat"] + vehicle_footprints[i + 1]["lat"]
            ) / 2.0
            mid_lng = (
                vehicle_footprints[i]["lng"] + vehicle_footprints[i + 1]["lng"]
            ) / 2.0

            if clearance >= 8.5:
                # Two slots – offset ±quarter from midpoint
                quarter = clearance / 4.0
                mx_mid, my_mid = self.latlon_to_metric(mid_lat, mid_lng)

                lat1, lng1 = self.metric_to_latlon(mx_mid - quarter, my_mid)
                lat2, lng2 = self.metric_to_latlon(mx_mid + quarter, my_mid)

                half_gap = clearance / 2.0
                for idx, (lt, lg) in enumerate([(lat1, lng1), (lat2, lng2)]):
                    slots.append(
                        SlotInfo(
                            slot_id=f"dyn-{uuid.uuid4().hex[:8]}",
                            lat=round(lt, 7),
                            lng=round(lg, 7),
                            status="available",
                            gap_meters=round(clearance, 2),
                            usable_length_meters=round(half_gap, 2),
                            slot_type="dynamic_street",
                            label=_vehicle_label(half_gap),
                            zone_id=zone_id,
                        )
                    )

            elif clearance >= 4.8:
                # One slot at midpoint
                usable = clearance - 0.3  # 15 cm buffer each end
                slots.append(
                    SlotInfo(
                        slot_id=f"dyn-{uuid.uuid4().hex[:8]}",
                        lat=round(mid_lat, 7),
                        lng=round(mid_lng, 7),
                        status="available",
                        gap_meters=round(clearance, 2),
                        usable_length_meters=round(usable, 2),
                        slot_type="dynamic_street",
                        label=_vehicle_label(usable),
                        zone_id=zone_id,
                    )
                )

            elif clearance >= 4.5:
                # Marginal – flag as too_tight
                slots.append(
                    SlotInfo(
                        slot_id=f"dyn-{uuid.uuid4().hex[:8]}",
                        lat=round(mid_lat, 7),
                        lng=round(mid_lng, 7),
                        status="too_tight",
                        gap_meters=round(clearance, 2),
                        usable_length_meters=0.0,
                        slot_type="dynamic_street",
                        label=f"{clearance:.1f}m Curb Gap - Too Tight",
                        zone_id=zone_id,
                    )
                )
            # else: clearance < 4.5 → ignore entirely

        return slots

    # ----- overlay rendering -----

    def generate_topdown_overlay(
        self,
        width: int,
        height: int,
        slots: List[SlotInfo],
        vehicles: list,
    ) -> bytes:
        """Render a top-down JPEG overlay.

        *vehicles*: list of dicts with ``lat``, ``lng``, ``length_m``,
        ``width_m`` keys.
        """
        canvas = np.zeros((height, width, 3), dtype=np.uint8)
        canvas[:] = (30, 30, 30)  # dark grey background

        # Draw a metric grid (every 5 m)
        grid_step_m = 5.0
        grid_color = (60, 60, 60)
        for gx in np.arange(-50, 51, grid_step_m):
            px1, py1 = self._metric_to_canvas(gx, -50, width, height)
            px2, py2 = self._metric_to_canvas(gx, 50, width, height)
            cv2.line(canvas, (px1, py1), (px2, py2), grid_color, 1)
        for gy in np.arange(-50, 51, grid_step_m):
            px1, py1 = self._metric_to_canvas(-50, gy, width, height)
            px2, py2 = self._metric_to_canvas(50, gy, width, height)
            cv2.line(canvas, (px1, py1), (px2, py2), grid_color, 1)

        # Draw vehicles (red rectangles)
        for v in vehicles:
            vmx, vmy = self.latlon_to_metric(v["lat"], v["lng"])
            half_l = v.get("length_m", 4.5) / 2.0
            half_w = v.get("width_m", 1.8) / 2.0
            corners = [
                self._metric_to_canvas(vmx - half_l, vmy - half_w, width, height),
                self._metric_to_canvas(vmx + half_l, vmy - half_w, width, height),
                self._metric_to_canvas(vmx + half_l, vmy + half_w, width, height),
                self._metric_to_canvas(vmx - half_l, vmy + half_w, width, height),
            ]
            pts = np.array(corners, dtype=np.int32).reshape((-1, 1, 2))
            cv2.fillPoly(canvas, [pts], (0, 0, 180))
            cv2.polylines(canvas, [pts], True, (0, 0, 255), 2)

        # Draw slots
        for slot in slots:
            smx, smy = self.latlon_to_metric(slot.lat, slot.lng)
            cx, cy = self._metric_to_canvas(smx, smy, width, height)
            if slot.status == "available":
                color = (0, 200, 0)
                radius = max(8, int(slot.usable_length_meters * 2))
                cv2.circle(canvas, (cx, cy), radius, color, 2)
                cv2.putText(
                    canvas,
                    f"{slot.usable_length_meters:.1f}m",
                    (cx - 15, cy - radius - 5),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.4,
                    (0, 255, 0),
                    1,
                )
            elif slot.status == "occupied":
                cv2.circle(canvas, (cx, cy), 8, (0, 0, 255), -1)
            elif slot.status == "too_tight":
                cv2.circle(canvas, (cx, cy), 6, (0, 165, 255), 2)
                cv2.putText(
                    canvas,
                    "tight",
                    (cx - 12, cy - 10),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.3,
                    (0, 165, 255),
                    1,
                )

        # Title
        cv2.putText(
            canvas,
            "God's Eye - Top Down View",
            (10, 25),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (255, 255, 255),
            2,
        )

        # Legend
        cv2.putText(canvas, "Green: Available", (10, height - 40),
                     cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 200, 0), 1)
        cv2.putText(canvas, "Red: Occupied", (10, height - 22),
                     cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)

        _, jpeg = cv2.imencode(".jpg", canvas, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return bytes(jpeg)

    # ----- internal helpers -----

    @staticmethod
    def _metric_to_canvas(
        mx: float, my: float, w: int, h: int
    ) -> Tuple[int, int]:
        """Map metric coords (range roughly -50..+50) to canvas pixels."""
        scale_x = w / 100.0
        scale_y = h / 100.0
        px = int((mx + 50) * scale_x)
        py = int((50 - my) * scale_y)  # flip Y axis
        return max(0, min(w - 1, px)), max(0, min(h - 1, py))


# ---------------------------------------------------------------------------
# Demo Scene Builder
# ---------------------------------------------------------------------------

def build_cp_demo_scene() -> Tuple[GodsEyeEngine, List[SlotInfo], List[dict]]:
    """Construct a realistic Connaught Place inner-circle demo scene.

    Returns the configured engine, the detected slot list, and the list
    of vehicle dicts used in the simulation.
    """

    # Calibration: a 640x480 camera view mapped to a 100x75 metre patch
    config = CalibrationConfig(
        src_points=[[0, 0], [640, 0], [640, 480], [0, 480]],
        dst_points=[[0, 0], [100, 0], [100, 75], [0, 75]],
        anchor_lat=28.6315,
        anchor_lng=77.2167,
        meters_per_pixel=100.0 / 640.0,
    )

    engine = GodsEyeEngine(config)
    engine.zones["cp_inner_circle"] = {
        "zone_id": "cp_inner_circle",
        "name": "Connaught Place Inner Circle",
        "anchor_lat": 28.6315,
        "anchor_lng": 77.2167,
        "curb_length_m": 90.0,
    }

    # ---- Simulated vehicles along the inner-circle curb ----
    # Positions given as linear metres along the curb (front_m, rear_m)
    # and approximate lat/lng for each vehicle centre.
    # The curb runs roughly E-W at anchor latitude.

    _m_per_deg_lng = _METERS_PER_DEG_LAT * math.cos(math.radians(28.6315))

    def _offset_lng(offset_m: float) -> float:
        return 77.2167 + offset_m / _m_per_deg_lng

    base_lat = 28.6315

    # 10 vehicles spaced along ~90 m of curb, with deliberate gaps
    raw_vehicles = [
        {"front_m": 0.0,  "rear_m": 4.2,  "length_m": 4.2, "width_m": 1.75, "name": "Maruti Swift"},
        {"front_m": 4.2,  "rear_m": 8.5,  "length_m": 4.3, "width_m": 1.79, "name": "Honda City"},
        # --- gap 8.5 → 14.8 = 6.3 m  (1 slot) ---
        {"front_m": 14.8, "rear_m": 19.6, "length_m": 4.8, "width_m": 1.85, "name": "Hyundai Creta"},
        # --- gap 19.6 → 30.5 = 10.9 m (2 slots) ---
        {"front_m": 30.5, "rear_m": 34.7, "length_m": 4.2, "width_m": 1.76, "name": "Maruti Baleno"},
        {"front_m": 34.7, "rear_m": 39.4, "length_m": 4.7, "width_m": 1.82, "name": "Tata Nexon"},
        # --- gap 39.4 → 44.5 = 5.1 m  (1 slot) ---
        {"front_m": 44.5, "rear_m": 49.3, "length_m": 4.8, "width_m": 1.84, "name": "Kia Seltos"},
        {"front_m": 49.3, "rear_m": 53.1, "length_m": 3.8, "width_m": 1.68, "name": "Maruti Alto"},
        # --- gap 53.1 → 62.0 = 8.9 m  (2 slots) ---
        {"front_m": 62.0, "rear_m": 66.5, "length_m": 4.5, "width_m": 1.80, "name": "Honda Amaze"},
        # --- gap 66.5 → 72.3 = 5.8 m  (1 slot) ---
        {"front_m": 72.3, "rear_m": 77.0, "length_m": 4.7, "width_m": 1.83, "name": "MG Astor"},
        {"front_m": 77.0, "rear_m": 81.6, "length_m": 4.6, "width_m": 1.81, "name": "Hyundai Verna"},
    ]

    # Enrich with lat/lng (centre of vehicle along curb)
    vehicles: List[dict] = []
    for v in raw_vehicles:
        centre_m = (v["front_m"] + v["rear_m"]) / 2.0
        vehicles.append(
            {
                "front_m": v["front_m"],
                "rear_m": v["rear_m"],
                "lat": base_lat,
                "lng": round(_offset_lng(centre_m), 7),
                "length_m": v["length_m"],
                "width_m": v["width_m"],
                "name": v["name"],
            }
        )

    engine.vehicle_footprints["cp_inner_circle"] = vehicles

    # ---- Dynamic gap detection ----
    street_slots = engine.detect_curb_gaps(vehicles, "cp_inner_circle")

    # ---- Pre-mapped bays (4 designated bays along a side lane) ----
    bay_offset_lat = 28.6317  # slightly north of the curb
    bay_base_lng = 77.2170
    bay_spacing_m = 6.0  # metres between bay centres
    bay_length_m = 5.0
    bay_width_m = 2.5

    # Vehicles parked in bays 1 and 3 (bays 0 and 2 available)
    occupied_bay_indices = {1, 3}
    occ_grid: List[list] = []

    bay_slots: List[SlotInfo] = []
    for bi in range(4):
        cx_m = bi * bay_spacing_m
        cx_lng = bay_base_lng + cx_m / _m_per_deg_lng

        half_l = bay_length_m / 2.0 / _METERS_PER_DEG_LAT
        half_w = bay_width_m / 2.0 / _m_per_deg_lng

        poly = [
            [bay_offset_lat - half_l, cx_lng - half_w],
            [bay_offset_lat - half_l, cx_lng + half_w],
            [bay_offset_lat + half_l, cx_lng + half_w],
            [bay_offset_lat + half_l, cx_lng - half_w],
        ]

        if bi in occupied_bay_indices:
            occ_grid.append([bay_offset_lat, cx_lng])

        slot = engine.check_premapped_bay(poly, occ_grid, zone_id="cp_inner_circle")
        bay_slots.append(slot)

        engine.premapped_bays.append(
            {"index": bi, "polygon": poly, "slot": slot}
        )

    all_slots = street_slots + bay_slots
    engine.cached_slots = all_slots

    return engine, all_slots, vehicles
