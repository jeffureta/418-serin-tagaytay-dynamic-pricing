import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export class DatabaseManager {
  /**
   * @param {Object} [options]
   * @param {string} [options.path] - Database file path or ':memory:'
   */
  constructor(options = {}) {
    const dbPath = options.path || resolve(process.cwd(), 'data/condo_suite.db');
    this.path = dbPath;

    if (dbPath !== ':memory:') {
      const dir = dirname(dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  initSchema() {
    this.db.exec(`
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
      CREATE INDEX IF NOT EXISTS idx_listings_scraped_at ON listings(scraped_at);
      CREATE INDEX IF NOT EXISTS idx_listings_distance ON listings(distance_km);

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
      CREATE INDEX IF NOT EXISTS idx_aggregates_date ON daily_aggregates(date);

      CREATE TABLE IF NOT EXISTS pricing_guardrails (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        floor_price REAL NOT NULL,
        ceiling_price REAL NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS annual_baseline_rates (
        date TEXT PRIMARY KEY,
        horizon TEXT NOT NULL,
        season TEXT NOT NULL,
        notes TEXT,
        baseline_iqm REAL NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_annual_baseline_date ON annual_baseline_rates(date);
    `);

    // Ensure default guardrails row exists (Floor: 2800, Ceiling: 8500)
    const existing = this.db.prepare('SELECT id FROM pricing_guardrails WHERE id = 1').get();
    if (!existing) {
      this.db.prepare(`
        INSERT INTO pricing_guardrails (id, floor_price, ceiling_price, updated_at)
        VALUES (1, 2800.0, 8500.0, ?)
      `).run(new Date().toISOString());
    }
  }

  query(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  getGuardrails() {
    const row = this.db.prepare('SELECT floor_price, ceiling_price, updated_at FROM pricing_guardrails WHERE id = 1').get();
    return row ? { floor_price: row.floor_price, ceiling_price: row.ceiling_price, updated_at: row.updated_at } : { floor_price: 2800, ceiling_price: 8500 };
  }

  updateGuardrails({ floor_price, ceiling_price }) {
    const current = this.getGuardrails();
    const newFloor = typeof floor_price === 'number' ? floor_price : current.floor_price;
    const newCeiling = typeof ceiling_price === 'number' ? ceiling_price : current.ceiling_price;
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE pricing_guardrails
      SET floor_price = ?, ceiling_price = ?, updated_at = ?
      WHERE id = 1
    `).run(newFloor, newCeiling, now);

    return { floor_price: newFloor, ceiling_price: newCeiling, updated_at: now };
  }

  insertListing(listing) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO listings (
        id, source, title, bedrooms, price_per_night, currency,
        latitude, longitude, distance_km, url, scraped_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      listing.id,
      listing.source,
      listing.title,
      listing.bedrooms,
      listing.price_per_night,
      listing.currency || 'PHP',
      listing.latitude ?? null,
      listing.longitude ?? null,
      listing.distance_km ?? null,
      listing.url,
      listing.scraped_at || new Date().toISOString()
    );
  }

  getListings({ maxDistanceKm = 10.0, bedrooms = 2, source = null } = {}) {
    let sql = 'SELECT * FROM listings WHERE 1=1';
    const params = [];

    if (typeof maxDistanceKm === 'number') {
      sql += ' AND distance_km <= ?';
      params.push(maxDistanceKm);
    }
    if (typeof bedrooms === 'number') {
      sql += ' AND bedrooms = ?';
      params.push(bedrooms);
    }
    if (source) {
      sql += ' AND source = ?';
      params.push(source);
    }

    sql += ' ORDER BY price_per_night ASC';
    return this.db.prepare(sql).all(...params);
  }

  insertAnnualBaseline(baseline) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO annual_baseline_rates (
        date, horizon, season, notes, baseline_iqm, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      baseline.date,
      baseline.horizon,
      baseline.season || 'REGULAR',
      baseline.notes || '',
      baseline.baseline_iqm,
      new Date().toISOString()
    );
  }

  getAnnualBaseline(date) {
    return this.db.prepare('SELECT * FROM annual_baseline_rates WHERE date = ?').get(date) || null;
  }

  insertDailyAggregate(agg) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO daily_aggregates (
        date, platform, horizon, listing_count, average_price,
        median_price, iqm_price, recommended_price, search_center, radius_km
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      agg.date,
      agg.platform,
      agg.horizon,
      agg.listing_count,
      agg.average_price,
      agg.median_price,
      agg.iqm_price,
      agg.recommended_price,
      agg.search_center,
      agg.radius_km
    );
  }

  getDailyAggregate(date, platform = 'all') {
    return this.db.prepare('SELECT * FROM daily_aggregates WHERE date = ? AND platform = ?').get(date, platform) || null;
  }

  close() {
    this.db.close();
  }
}
