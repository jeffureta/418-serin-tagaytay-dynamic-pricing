import test from 'node:test';
import assert from 'node:assert/strict';
import { haversineDistanceKm, isWithinTagaytayRadius, SERIN_EAST_COORDS } from '../../packages/shared-core/src/geo.js';

test('SERIN_EAST_COORDS is exact location of Unit 418', () => {
  assert.equal(SERIN_EAST_COORDS.latitude, 14.11528);
  assert.equal(SERIN_EAST_COORDS.longitude, 120.96205);
});

test('haversineDistanceKm returns 0 for identical coordinates', () => {
  const dist = haversineDistanceKm(14.11528, 120.96205, 14.11528, 120.96205);
  assert.equal(dist, 0);
});

test('haversineDistanceKm calculates accurate distance to nearby Tagaytay landmarks', () => {
  // Ayala Malls Serin (approx 200m away)
  const ayalaMallsSerin = { lat: 14.1145, lon: 120.9615 };
  const d1 = haversineDistanceKm(SERIN_EAST_COORDS.latitude, SERIN_EAST_COORDS.longitude, ayalaMallsSerin.lat, ayalaMallsSerin.lon);
  assert.ok(d1 < 0.3, `Expected distance < 0.3km, got ${d1}`);

  // Picnic Grove (approx 5.5km away)
  const picnicGrove = { lat: 14.1353, lon: 121.0031 };
  const d2 = haversineDistanceKm(SERIN_EAST_COORDS.latitude, SERIN_EAST_COORDS.longitude, picnicGrove.lat, picnicGrove.lon);
  assert.ok(d2 > 4.5 && d2 < 6.5, `Expected distance between 4.5 and 6.5km, got ${d2}`);

  // Manila / Makati (approx 55km away, should be far outside radius)
  const makati = { lat: 14.5547, lon: 121.0244 };
  const d3 = haversineDistanceKm(SERIN_EAST_COORDS.latitude, SERIN_EAST_COORDS.longitude, makati.lat, makati.lon);
  assert.ok(d3 > 45, `Expected distance > 45km, got ${d3}`);
});

test('isWithinTagaytayRadius filters correctly for 10km radius', () => {
  // Serin East itself is within radius
  assert.equal(isWithinTagaytayRadius(14.11528, 120.96205), true);

  // Picnic Grove (approx 5.5km) is within 10km
  assert.equal(isWithinTagaytayRadius(14.1353, 121.0031), true);

  // Crosswinds Tagaytay (approx 8.5km) is within 10km
  assert.equal(isWithinTagaytayRadius(14.1438, 121.0360), true);

  // Silang town center / Dasmariñas border (> 12km) is outside 10km
  assert.equal(isWithinTagaytayRadius(14.2285, 120.9742), false);

  // Invalid coordinates return false gracefully
  assert.equal(isWithinTagaytayRadius(null, null), false);
  assert.equal(isWithinTagaytayRadius(undefined, 120.96), false);
  assert.equal(isWithinTagaytayRadius(NaN, 120.96), false);
});
