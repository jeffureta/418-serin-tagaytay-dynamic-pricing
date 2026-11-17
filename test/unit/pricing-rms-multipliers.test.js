import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectHorizon,
  calculateLeadTimeFactor,
  computeRecommendedPrice
} from '../../packages/shared-core/src/pricing-engine.js';
import { CondoPricingClient } from '../../packages/pricing-sdk/src/index.js';

test('detectHorizon correctly classifies Philippine and Tagaytay peak dates and weekends', () => {
  assert.equal(detectHorizon('2026-12-24'), 'PEAK'); // Christmas Eve
  assert.equal(detectHorizon('2026-12-25'), 'PEAK'); // Christmas Day
  assert.equal(detectHorizon('2026-12-26'), 'WEEKEND'); // Saturday
  assert.equal(detectHorizon('2026-12-27'), 'WEEKDAY'); // Sunday -> Tagaytay regular
  assert.equal(detectHorizon('2026-12-31'), 'PEAK'); // New Year's Eve
  assert.equal(detectHorizon('2026-01-01'), 'PEAK'); // New Year's Day
});

test('calculateLeadTimeFactor applies far-out premium, standard window, and near-term decay', () => {
  // > 45 days out
  assert.equal(calculateLeadTimeFactor('2026-12-25', '2026-10-01'), 1.10);
  // 15 - 45 days out
  assert.equal(calculateLeadTimeFactor('2026-12-25', '2026-11-20'), 1.00);
  // 7 - 14 days out
  assert.equal(calculateLeadTimeFactor('2026-12-25', '2026-12-15'), 0.97);
  // < 7 days out
  assert.equal(calculateLeadTimeFactor('2026-12-25', '2026-12-22'), 0.95);
});

test('computeRecommendedPrice applies Multiplicative RMS: Dec 25, 26, 27 have distinct rates', () => {
  const listings = [
    { price_per_night: 3500 },
    { price_per_night: 4000 },
    { price_per_night: 4200 },
    { price_per_night: 4500 }
  ];
  const asOfDate = '2026-11-17';

  const dec25 = computeRecommendedPrice({
    listings,
    date: '2026-12-25',
    asOfDate
  });

  const dec26 = computeRecommendedPrice({
    listings,
    date: '2026-12-26',
    asOfDate
  });

  const dec27 = computeRecommendedPrice({
    listings,
    date: '2026-12-27',
    asOfDate
  });

  // Verify non-identical prices
  assert.notEqual(dec25.recommended_price, dec26.recommended_price);
  assert.notEqual(dec26.recommended_price, dec27.recommended_price);
  assert.notEqual(dec25.recommended_price, dec27.recommended_price);

  // Dec 25 is PEAK (1.65 multiplier), Dec 26 is WEEKEND (1.25 multiplier), Dec 27 is WEEKDAY (1.00 multiplier)
  assert.equal(dec25.horizon, 'PEAK');
  assert.equal(dec25.horizon_multiplier, 1.65);
  assert.equal(dec26.horizon, 'WEEKEND');
  assert.equal(dec26.horizon_multiplier, 1.25);
  assert.equal(dec27.horizon, 'WEEKDAY');
  assert.equal(dec27.horizon_multiplier, 1.00);

  // Dec 25 must be higher than Dec 26, which is higher than Dec 27
  assert.ok(dec25.recommended_price > dec26.recommended_price);
  assert.ok(dec26.recommended_price > dec27.recommended_price);
});

test('CondoPricingClient getRecommendedPrice returns audit breakdown with horizon and lead factors', () => {
  const client = new CondoPricingClient({ dbPath: ':memory:' });
  client.seedAnnualBaselines();

  const quote25 = client.getRecommendedPrice({ date: '2026-12-25', asOfDate: '2026-11-17' });
  const quote26 = client.getRecommendedPrice({ date: '2026-12-26', asOfDate: '2026-11-17' });
  const quote27 = client.getRecommendedPrice({ date: '2026-12-27', asOfDate: '2026-11-17' });

  assert.equal(quote25.horizon, 'PEAK');
  assert.equal(quote26.horizon, 'WEEKEND');
  assert.equal(quote27.horizon, 'WEEKDAY');

  // Verify distinct prices
  assert.notEqual(quote25.recommended_price, quote26.recommended_price);
  assert.notEqual(quote26.recommended_price, quote27.recommended_price);

  assert.ok(quote25.recommended_price >= 6000, 'Christmas Day should reflect peak holiday rate');
  assert.ok(quote26.recommended_price >= 5000, 'Holiday Weekend should reflect weekend rate');
  assert.ok(quote27.recommended_price >= 4000, 'Post-holiday weekday should reflect baseline rate');

  client.close();
});

test('CondoPricingClient getStayQuote calculates total due and daily breakdown across range', () => {
  const client = new CondoPricingClient({ dbPath: ':memory:' });
  client.seedAnnualBaselines();

  const stayQuote = client.getStayQuote({
    checkInDate: '2026-12-25',
    checkOutDate: '2026-12-28',
    asOfDate: '2026-11-17'
  });

  assert.equal(stayQuote.nights, 3);
  assert.equal(stayQuote.breakdown.length, 3);
  assert.equal(stayQuote.breakdown[0].date, '2026-12-25');
  assert.equal(stayQuote.breakdown[1].date, '2026-12-26');
  assert.equal(stayQuote.breakdown[2].date, '2026-12-27');

  const expectedTotal = stayQuote.breakdown.reduce((sum, item) => sum + item.recommended_price, 0);
  assert.equal(stayQuote.stay_subtotal, expectedTotal);

  client.close();
});
