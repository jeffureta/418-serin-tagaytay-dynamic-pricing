import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateIQM,
  calculateMedian,
  detectHorizon,
  computeRecommendedPrice
} from '../../packages/shared-core/src/pricing-engine.js';

test('detectHorizon classifies days correctly', () => {
  // Sunday to Thursday are WEEKDAY
  assert.equal(detectHorizon('2026-11-15'), 'WEEKDAY'); // Sunday
  assert.equal(detectHorizon('2026-11-16'), 'WEEKDAY'); // Monday
  assert.equal(detectHorizon('2026-11-19'), 'WEEKDAY'); // Thursday

  // Friday & Saturday are WEEKEND
  assert.equal(detectHorizon('2026-11-20'), 'WEEKEND'); // Friday
  assert.equal(detectHorizon('2026-11-21'), 'WEEKEND'); // Saturday

  // Holidays are PEAK
  assert.equal(detectHorizon('2026-12-25'), 'PEAK'); // Christmas
  assert.equal(detectHorizon('2026-12-31'), 'PEAK'); // New Year's Eve
  assert.equal(detectHorizon('2026-01-01'), 'PEAK'); // New Year's Day
});

test('calculateMedian computes median accurately', () => {
  assert.equal(calculateMedian([4000, 3000, 5000]), 4000);
  assert.equal(calculateMedian([3000, 4000, 5000, 6000]), 4500);
  assert.equal(calculateMedian([]), 0);
  assert.equal(calculateMedian([4200]), 4200);
});

test('calculateIQM eliminates outer 25% extremes', () => {
  // Array of 8 values: [2000, 3000, 4000, 4200, 4400, 4600, 8000, 20000]
  // 2000 and 20000 are extreme outliers.
  // Middle 50% values (between Q1 and Q3) give realistic representative market IQM.
  const prices = [2000, 3000, 4000, 4200, 4400, 4600, 8000, 20000];
  const iqm = calculateIQM(prices);

  assert.ok(iqm > 3800 && iqm < 5000, `Expected IQM between 3800 and 5000, got ${iqm}`);
});

test('computeRecommendedPrice has ZERO discounts/undercuts and strictly clamps to guardrails', () => {
  const guardrails = { floor_price: 2800, ceiling_price: 8500 };

  // 1. Normal market price: IQM 4500 -> recommended is strictly 4500 (NO -500 undercut)
  const res1 = computeRecommendedPrice({
    listings: [
      { price_per_night: 4200 },
      { price_per_night: 4400 },
      { price_per_night: 4600 },
      { price_per_night: 4800 }
    ],
    guardrails,
    date: '2026-11-20'
  });
  assert.equal(res1.recommended_price, 4500);
  assert.equal(res1.source, 'scraped_iqm');
  assert.equal(res1.undercut, undefined);
  assert.equal(res1.discount, undefined);

  // 2. Below floor: IQM 2200 -> clamped to Floor 2800
  const res2 = computeRecommendedPrice({
    listings: [{ price_per_night: 2200 }],
    guardrails,
    date: '2026-11-16'
  });
  assert.equal(res2.recommended_price, 2800);
  assert.equal(res2.clamped, 'floor');

  // 3. Above ceiling: IQM 12000 -> clamped to Ceiling 8500
  const res3 = computeRecommendedPrice({
    listings: [{ price_per_night: 12000 }],
    guardrails,
    date: '2026-12-31'
  });
  assert.equal(res3.recommended_price, 8500);
  assert.equal(res3.clamped, 'ceiling');
});

test('computeRecommendedPrice uses 365-day annual baseline when 0 listings exist', () => {
  const guardrails = { floor_price: 2800, ceiling_price: 8500 };

  const annualBaseline = {
    date: '2026-12-25',
    horizon: 'PEAK',
    season: 'CHRISTMAS_HOLIDAY',
    baseline_iqm: 6500
  };

  const res = computeRecommendedPrice({
    listings: [],
    guardrails,
    date: '2026-12-25',
    annualBaseline
  });

  assert.equal(res.recommended_price, 6500);
  assert.equal(res.source, 'annual_baseline');
  assert.equal(res.horizon, 'PEAK');
});
