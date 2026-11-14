import test from 'node:test';
import assert from 'node:assert/strict';
import { AirbnbScraper } from '../../packages/pricing-sdk/src/scrapers/airbnb.js';
import { BookingScraper } from '../../packages/pricing-sdk/src/scrapers/booking.js';
import { AgodaScraper } from '../../packages/pricing-sdk/src/scrapers/agoda.js';

test('AirbnbScraper parses fixture, filters strictly to 2BR and within 10km Haversine', async () => {
  const scraper = new AirbnbScraper({ mode: 'fixture' });
  const listings = await scraper.fetchListings();

  assert.ok(listings.length >= 2, `Expected at least 2 listings, got ${listings.length}`);
  for (const l of listings) {
    assert.equal(l.bedrooms, 2, 'Must strictly be 2 bedrooms');
    assert.equal(l.source, 'airbnb');
    assert.ok(l.distance_km <= 10.0, `Distance ${l.distance_km}km must be <= 10.0km`);
    assert.ok(l.price_per_night > 0);
  }

  // Confirm Makati (55km) and 1BR listings were excluded
  const ids = listings.map(l => l.id);
  assert.ok(!ids.includes('abnb_203'), '1BR listing must be excluded');
  assert.ok(!ids.includes('abnb_204'), 'Makati listing (>10km) must be excluded');
});

test('BookingScraper parses fixture and filters correctly', async () => {
  const scraper = new BookingScraper({ mode: 'fixture' });
  const listings = await scraper.fetchListings();

  assert.ok(listings.length >= 2);
  for (const l of listings) {
    assert.equal(l.bedrooms, 2);
    assert.equal(l.source, 'booking');
    assert.ok(l.distance_km <= 10.0);
  }
});

test('AgodaScraper parses fixture and filters out listings > 10km', async () => {
  const scraper = new AgodaScraper({ mode: 'fixture' });
  const listings = await scraper.fetchListings();

  assert.equal(listings.length, 1);
  assert.equal(listings[0].id, 'ago_401');
  assert.equal(listings[0].bedrooms, 2);
  assert.equal(listings[0].source, 'agoda');
  assert.ok(listings[0].distance_km <= 10.0);
});
