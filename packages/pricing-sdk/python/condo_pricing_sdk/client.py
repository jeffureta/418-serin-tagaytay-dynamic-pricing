import sqlite3
import json
import os
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional

SERIN_EAST_COORDS = {"latitude": 14.11528, "longitude": 120.96205}
EARTH_RADIUS_KM = 6371.0

TAGAYTAY_PEAK_DATES = {
    "01-01", "01-02", "04-09", "05-01", "06-12",
    "08-21", "08-31", "11-01", "11-02", "11-30",
    "12-08", "12-24", "12-25", "12-30", "12-31"
}

def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    if lat1 == lat2 and lon1 == lon2:
        return 0.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (math.sin(d_lat / 2.0) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(d_lon / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return EARTH_RADIUS_KM * c

def detect_horizon(date_str: str) -> str:
    md = date_str[5:10]
    if md in TAGAYTAY_PEAK_DATES:
        return "PEAK"
    dt = datetime.fromisoformat(f"{date_str}T00:00:00+00:00")
    # weekday(): Monday is 0 and Sunday is 6. Friday is 4, Saturday is 5.
    if dt.weekday() in (4, 5):
        return "WEEKEND"
    return "WEEKDAY"

def calculate_iqm(prices: List[float]) -> float:
    if not prices:
        return 0.0
    if len(prices) <= 2:
        return sum(prices) / len(prices)
    sorted_p = sorted(prices)
    n = len(sorted_p)
    q1 = int(n * 0.25)
    q3 = int(math.ceil(n * 0.75))
    slice_p = sorted_p[q1:q3]
    if not slice_p:
        return sorted_p[n // 2]
    return round(sum(slice_p) / len(slice_p), 2)

class CondoPricingClient:
    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            repo_root = Path(__file__).resolve().parents[4]
            self.db_path = str(repo_root / "data" / "condo_suite.db")
            os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        else:
            self.db_path = db_path

        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self):
        cursor = self.conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS listings (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                title TEXT NOT NULL,
                bedrooms INTEGER NOT NULL,
                price_per_night REAL NOT NULL,
                currency TEXT NOT NULL DEFAULT 'PHP',
                latitude REAL,
                longitude REAL,
                distance_km REAL,
                url TEXT NOT NULL,
                scraped_at TEXT NOT NULL
            );
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS pricing_guardrails (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                floor_price REAL NOT NULL,
                ceiling_price REAL NOT NULL,
                updated_at TEXT NOT NULL
            );
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS annual_baseline_rates (
                date TEXT PRIMARY KEY,
                horizon TEXT NOT NULL,
                season TEXT NOT NULL,
                notes TEXT,
                baseline_iqm REAL NOT NULL,
                created_at TEXT NOT NULL
            );
        """)
        # Ensure default guardrails
        cursor.execute("SELECT id FROM pricing_guardrails WHERE id = 1")
        if not cursor.fetchone():
            now = datetime.now(timezone.utc).isoformat()
            cursor.execute(
                "INSERT INTO pricing_guardrails (id, floor_price, ceiling_price, updated_at) VALUES (1, 2800.0, 8500.0, ?)",
                (now,)
            )
        self.conn.commit()

    def get_guardrails(self) -> Dict[str, Any]:
        cursor = self.conn.cursor()
        cursor.execute("SELECT floor_price, ceiling_price, updated_at FROM pricing_guardrails WHERE id = 1")
        row = cursor.fetchone()
        if row:
            return {"floor_price": row["floor_price"], "ceiling_price": row["ceiling_price"], "updated_at": row["updated_at"]}
        return {"floor_price": 2800.0, "ceiling_price": 8500.0}

    def update_guardrails(self, floor_price: Optional[float] = None, ceiling_price: Optional[float] = None) -> Dict[str, Any]:
        curr = self.get_guardrails()
        new_floor = floor_price if floor_price is not None else curr["floor_price"]
        new_ceiling = ceiling_price if ceiling_price is not None else curr["ceiling_price"]
        now = datetime.now(timezone.utc).isoformat()
        cursor = self.conn.cursor()
        cursor.execute(
            "UPDATE pricing_guardrails SET floor_price = ?, ceiling_price = ?, updated_at = ? WHERE id = 1",
            (new_floor, new_ceiling, now)
        )
        self.conn.commit()
        return {"floor_price": new_floor, "ceiling_price": new_ceiling, "updated_at": now}

    def insert_listing(self, id: str, source: str, title: str, bedrooms: int, price_per_night: float,
                       currency: str = "PHP", latitude: Optional[float] = None, longitude: Optional[float] = None,
                       distance_km: Optional[float] = None, url: str = "", scraped_at: Optional[str] = None):
        if scraped_at is None:
            scraped_at = datetime.now(timezone.utc).isoformat()
        cursor = self.conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO listings (
                id, source, title, bedrooms, price_per_night, currency,
                latitude, longitude, distance_km, url, scraped_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (id, source, title, bedrooms, price_per_night, currency, latitude, longitude, distance_km, url, scraped_at))
        self.conn.commit()

    def seed_annual_baselines(self, fixture_path: Optional[str] = None) -> int:
        if fixture_path is None:
            base_dir = Path(__file__).resolve().parents[2]
            fixture_path = str(base_dir / "fixtures" / "tagaytay_annual_baseline_365.json")

        with open(fixture_path, "r", encoding="utf-8") as f:
            days = json.load(f)

        cursor = self.conn.cursor()
        now = datetime.now(timezone.utc).isoformat()
        for d in days:
            cursor.execute("""
                INSERT OR REPLACE INTO annual_baseline_rates (
                    date, horizon, season, notes, baseline_iqm, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
            """, (d["date"], d["horizon"], d.get("season", "REGULAR"), d.get("notes", ""), d["baseline_iqm"], now))
        self.conn.commit()
        return len(days)

    def get_annual_baseline(self, date: str) -> Optional[Dict[str, Any]]:
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM annual_baseline_rates WHERE date = ?", (date,))
        row = cursor.fetchone()
        return dict(row) if row else None

    def get_recommended_price(self, date: Optional[str] = None) -> Dict[str, Any]:
        target_date = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        horizon = detect_horizon(target_date)
        guardrails = self.get_guardrails()

        cursor = self.conn.cursor()
        cursor.execute("SELECT price_per_night FROM listings WHERE bedrooms = 2 AND distance_km <= 10.0")
        rows = cursor.fetchall()
        prices = [r["price_per_night"] for r in rows if r["price_per_night"] > 0]

        if prices:
            raw_iqm = calculate_iqm(prices)
            source = "scraped_iqm"
        else:
            baseline = self.get_annual_baseline(target_date)
            if baseline:
                raw_iqm = baseline["baseline_iqm"]
                source = "annual_baseline"
            else:
                raw_iqm = 6000.0 if horizon == "PEAK" else (4500.0 if horizon == "WEEKEND" else 3500.0)
                source = "horizon_default"

        # Clamping strictly with ZERO undercuts and ZERO discounts
        floor = guardrails["floor_price"]
        ceiling = guardrails["ceiling_price"]
        final_price = max(floor, min(raw_iqm, ceiling))
        clamped = "floor" if raw_iqm < floor else ("ceiling" if raw_iqm > ceiling else None)

        return {
            "date": target_date,
            "horizon": horizon,
            "raw_iqm": raw_iqm,
            "recommended_price": final_price,
            "clamped": clamped,
            "source": source,
            "listing_count": len(prices),
            "guardrails": {"floor_price": floor, "ceiling_price": ceiling}
        }

    def close(self):
        self.conn.close()
