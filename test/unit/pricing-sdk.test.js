import test from 'node:test';
import assert from 'node:assert/strict';
import { CondoPricingClient } from '../../packages/pricing-sdk/src/index.js';

test('CondoPricingClient initializes with in-memory database', () => {
  const client = new CondoPricingClient({ dbPath: ':memory:' });
  assert.ok(client);
  const guardrails = client.getGuardrails();
  assert.equal(guardrails.floor_price, 2800);
  assert.equal(guardrails.ceiling_price, 8500);
  client.close();
});

test('CondoPricingClient seeds 365-day annual baseline records', () => {
  const client = new CondoPricingClient({ dbPath: ':memory:' });
  const count = client.seedAnnualBaselines();
  assert.equal(count, 365);

  const christmas = client.getAnnualBaseline('2026-12-25');
  assert.ok(christmas);
  assert.equal(christmas.horizon, 'PEAK');
  assert.equal(christmas.baseline_iqm, 7000);

  client.close();
});

test('CondoPricingClient runs scrape pipeline and computes pure IQM recommendation', async () => {
  const client = new CondoPricingClient({ dbPath: ':memory:' });
  client.seedAnnualBaselines();

  const scrapeResult = await client.runScrapePipeline({ mode: 'fixture' });
  assert.ok(scrapeResult.totalListings >= 4);

  // Compute recommendation for a weekend
  const quote = client.getRecommendedPrice({ date: '2026-11-20' });
  assert.ok(quote.recommended_price >= 2800 && quote.recommended_price <= 8500);
  assert.equal(quote.source, 'scraped_iqm');
  assert.equal(quote.undercut, undefined);
  assert.equal(quote.discount, undefined);

  client.close();
});

test('CondoPricingClient falls back to 365-day baseline when no listings match date', () => {
  const client = new CondoPricingClient({ dbPath: ':memory:' });
  client.seedAnnualBaselines();

  // No scraped listings inserted, so queries must cleanly fallback to 365 baseline
  const quote = client.getRecommendedPrice({ date: '2026-12-25' });
  assert.equal(quote.source, 'annual_baseline');
  assert.equal(quote.recommended_price, 7000);
  assert.equal(quote.horizon, 'PEAK');

  client.close();
});
