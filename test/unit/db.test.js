import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseManager } from '../../packages/shared-core/src/db.js';

test('DatabaseManager initializes tables in memory without error', () => {
  const db = new DatabaseManager({ path: ':memory:' });
  assert.ok(db);

  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;");
  const tableNames = tables.map(t => t.name);

  assert.ok(tableNames.includes('listings'), 'listings table must exist');
  assert.ok(tableNames.includes('daily_aggregates'), 'daily_aggregates table must exist');
  assert.ok(tableNames.includes('pricing_guardrails'), 'pricing_guardrails table must exist');
  assert.ok(tableNames.includes('annual_baseline_rates'), 'annual_baseline_rates table must exist');

  db.close();
});

test('pricing_guardrails defaults to Floor 2800 and Ceiling 8500 with NO undercut or discount fields', () => {
  const db = new DatabaseManager({ path: ':memory:' });
  const guardrails = db.getGuardrails();

  assert.equal(guardrails.floor_price, 2800);
  assert.equal(guardrails.ceiling_price, 8500);
  assert.equal(guardrails.undercut, undefined);
  assert.equal(guardrails.discount, undefined);

  // Update guardrails
  db.updateGuardrails({ floor_price: 3000, ceiling_price: 9000 });
  const updated = db.getGuardrails();
  assert.equal(updated.floor_price, 3000);
  assert.equal(updated.ceiling_price, 9000);

  db.close();
});

test('listings table inserts and queries filtered 2BR listings accurately', () => {
  const db = new DatabaseManager({ path: ':memory:' });

  db.insertListing({
    id: 'airbnb_101',
    source: 'airbnb',
    title: 'Wind Residences 2BR Tagaytay View',
    bedrooms: 2,
    price_per_night: 4200,
    currency: 'PHP',
    latitude: 14.0987,
    longitude: 120.9456,
    distance_km: 2.5,
    url: 'https://airbnb.com/rooms/101',
    scraped_at: '2026-11-14T10:00:00Z'
  });

  const listings = db.getListings({ maxDistanceKm: 10.0, bedrooms: 2 });
  assert.equal(listings.length, 1);
  assert.equal(listings[0].id, 'airbnb_101');
  assert.equal(listings[0].price_per_night, 4200);

  db.close();
});

test('annual_baseline_rates inserts and queries date baseline', () => {
  const db = new DatabaseManager({ path: ':memory:' });

  db.insertAnnualBaseline({
    date: '2026-12-25',
    horizon: 'PEAK',
    season: 'CHRISTMAS_HOLIDAY',
    notes: 'Christmas Day Peak',
    baseline_iqm: 6500
  });

  const baseline = db.getAnnualBaseline('2026-12-25');
  assert.ok(baseline);
  assert.equal(baseline.date, '2026-12-25');
  assert.equal(baseline.horizon, 'PEAK');
  assert.equal(baseline.baseline_iqm, 6500);

  // Missing date returns null
  assert.equal(db.getAnnualBaseline('2099-01-01'), null);

  db.close();
});
