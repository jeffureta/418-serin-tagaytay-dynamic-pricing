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

HORIZON_MULTIPLIERS = {
    "PEAK": 1.65,
    "WEEKEND": 1.25,
    "WEEKDAY": 1.00
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

def calculate_lead_time_factor(target_date_str: str, as_of_date_str: Optional[str] = None) -> float:
    if as_of_date_str:
        as_of = datetime.fromisoformat(f"{as_of_date_str}T00:00:00+00:00")
    else:
        as_of = datetime.now(timezone.utc)
    target = datetime.fromisoformat(f"{target_date_str}T00:00:00+00:00")
    lead_days = math.ceil((target - as_of).total_seconds() / 86400.0)

    if lead_days > 45:
        return 1.10
    elif lead_days >= 15:
        return 1.00
    elif lead_days >= 7:
        return 0.97
    else:
        return 0.95

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
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_listings_scraped_at ON listings(scraped_at);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_listings_distance ON listings(distance_km);")

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS daily_aggregates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                platform TEXT NOT NULL,
                horizon TEXT NOT NULL,
                listing_count INTEGER NOT NULL,
                average_price REAL NOT NULL,
                median_price REAL NOT NULL,
                iqm_price REAL NOT NULL,
                recommended_price REAL NOT NULL,
                search_center TEXT NOT NULL,
                radius_km REAL NOT NULL,
                UNIQUE(date, platform)
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_aggregates_date ON daily_aggregates(date);")

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
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_annual_baseline_date ON annual_baseline_rates(date);")

        cursor.execute("SELECT id FROM pricing_guardrails WHERE id = 1")
        if not cursor.fetchone():
            now = datetime.now(timezone.utc).isoformat()
            cursor.execute("""
                INSERT INTO pricing_guardrails (id, floor_price, ceiling_price, updated_at)
                VALUES (1, 2800.0, 8500.0, ?)
            """, (now,))
        self.conn.commit()

    def get_guardrails(self) -> Dict[str, Any]:
        cursor = self.conn.cursor()
        cursor.execute("SELECT floor_price, ceiling_price, updated_at FROM pricing_guardrails WHERE id = 1")
        row = cursor.fetchone()
        return dict(row) if row else {"floor_price": 2800.0, "ceiling_price": 8500.0, "updated_at": ""}

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

    def get_recommended_price(self, date: Optional[str] = None, as_of_date: Optional[str] = None) -> Dict[str, Any]:
        target_date = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        horizon = detect_horizon(target_date)
        horizon_multiplier = HORIZON_MULTIPLIERS.get(horizon, 1.00)
        lead_factor = calculate_lead_time_factor(target_date, as_of_date)
        guardrails = self.get_guardrails()

        cursor = self.conn.cursor()
        cursor.execute("SELECT price_per_night FROM listings WHERE bedrooms = 2 AND distance_km <= 10.0")
        rows = cursor.fetchall()
        prices = [r["price_per_night"] for r in rows if r["price_per_night"] > 0]

        unmultiplied_annual = False
        season = "REGULAR"

        if prices:
            base_iqm = calculate_iqm(prices)
            source = "scraped_iqm"
        else:
            baseline = self.get_annual_baseline(target_date)
            if baseline:
                base_iqm = baseline["baseline_iqm"]
                source = "annual_baseline"
                unmultiplied_annual = True
                season = baseline.get("season", "REGULAR")
            else:
                base_iqm = 6000.0 if horizon == "PEAK" else (4500.0 if horizon == "WEEKEND" else 3500.0)
                source = "horizon_default"
                unmultiplied_annual = True

        if unmultiplied_annual:
            raw_price = round(base_iqm * lead_factor)
        else:
            raw_price = round(base_iqm * horizon_multiplier * lead_factor)

        # Clamping strictly with ZERO undercuts and ZERO discounts
        floor = guardrails["floor_price"]
        ceiling = guardrails["ceiling_price"]

        effective_floor = floor
        if horizon == "PEAK":
            effective_floor = max(floor, 6000.0)
        elif horizon == "WEEKEND":
            effective_floor = max(floor, 4000.0)

        final_price = max(effective_floor, min(float(raw_price), ceiling))
        clamped = "floor" if raw_price < effective_floor else ("ceiling" if raw_price > ceiling else None)

        return {
            "date": target_date,
            "horizon": horizon,
            "season": season,
            "raw_iqm": base_iqm,
            "horizon_multiplier": horizon_multiplier,
            "lead_factor": lead_factor,
            "recommended_price": final_price,
            "clamped": clamped,
            "source": source,
            "listing_count": len(prices),
            "guardrails": {
                "floor_price": floor,
                "ceiling_price": ceiling,
                "effective_floor": effective_floor
            }
        }

    def get_stay_quote(self, check_in_date: str, check_out_date: str, as_of_date: Optional[str] = None) -> Dict[str, Any]:
        d1 = datetime.fromisoformat(f"{check_in_date}T00:00:00+00:00")
        d2 = datetime.fromisoformat(f"{check_out_date}T00:00:00+00:00")

        if d2 <= d1:
            raise ValueError("check_out_date must be after check_in_date.")

        breakdown = []
        curr = d1
        subtotal = 0.0

        while curr < d2:
            date_str = curr.strftime("%Y-%m-%d")
            quote = self.get_recommended_price(date=date_str, as_of_date=as_of_date)
            breakdown.append(quote)
            subtotal += quote["recommended_price"]
            curr = curr.replace(day=curr.day + 1) if curr.day < 28 else datetime.fromtimestamp(curr.timestamp() + 86400, timezone.utc)

        return {
            "check_in_date": check_in_date,
            "check_out_date": check_out_date,
            "nights": len(breakdown),
            "stay_subtotal": subtotal,
            "average_nightly_rate": round(subtotal / len(breakdown), 2),
            "breakdown": breakdown
        }

    def close(self):
        self.conn.close()
