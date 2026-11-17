#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { CondoPricingClient } from '../packages/pricing-sdk/src/index.js';

const USAGE = `
Usage: condo-price <command> [options]

Commands:
  pull            Scrape competitor listings from OTAs (Airbnb, Booking.com, Agoda)
  benchmark       Compute recommended dynamic price for a specific date or stay range
  seed-annual     Seed 365-day annual empirical research baseline rates
  annual          Retrieve annual baseline rate for a specific date
  guardrails      View or update pricing guardrails (floor, ceiling)
  listings        View stored 2BR competitor listings within 10km

Options:
  --help, -h      Show help
  --json          Output results as JSON
  --date          Target date (YYYY-MM-DD)
  --from          Check-in date for stay quote (YYYY-MM-DD)
  --to            Check-out date for stay quote (YYYY-MM-DD)
  --as-of         Simulation/as-of reference date (YYYY-MM-DD)
  --mode          'fixture' or 'live' (default: fixture)
  --set-floor     Update floor price (default: 2800)
  --set-ceiling   Update ceiling price (default: 8500)
  --limit         Number of listings to display (default: 20)
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(USAGE);
    process.exit(0);
  }

  const isJson = args.includes('--json');

  // Parse CLI flags
  function getFlagValue(name) {
    const idx = args.indexOf(name);
    if (idx !== -1 && idx + 1 < args.length) {
      return args[idx + 1];
    }
    return null;
  }

  const client = new CondoPricingClient();

  try {
    switch (command) {
      case 'seed-annual': {
        const count = client.seedAnnualBaselines();
        if (isJson) {
          console.log(JSON.stringify({ success: true, count, message: `Seeded ${count} days of empirical baseline rates.` }));
        } else {
          console.log(`✅ Successfully seeded ${count} days of 365-day empirical baseline rates into data/condo_suite.db`);
        }
        break;
      }

      case 'pull': {
        const mode = getFlagValue('--mode') || (args.includes('--live') ? 'live' : 'fixture');
        const res = await client.runScrapePipeline({ mode });
        if (isJson) {
          console.log(JSON.stringify({ success: true, mode, ...res }));
        } else {
          console.log(`✅ Scraped and filtered ${res.totalListings} 2BR listings within 10km (Mode: ${mode})`);
          console.log(`   Airbnb: ${res.bySource.airbnb} | Booking.com: ${res.bySource.booking} | Agoda: ${res.bySource.agoda}`);
        }
        break;
      }

      case 'benchmark': {
        const fromDate = getFlagValue('--from');
        const toDate = getFlagValue('--to');
        const asOfDate = getFlagValue('--as-of');

        if (fromDate && toDate) {
          const stayQuote = client.getStayQuote({
            checkInDate: fromDate,
            checkOutDate: toDate,
            asOfDate
          });

          if (isJson) {
            console.log(JSON.stringify(stayQuote, null, 2));
          } else {
            console.log(`\n======================================================`);
            console.log(`Unit 418 Serin East Dynamic Stay Quote (${stayQuote.check_in_date} to ${stayQuote.check_out_date})`);
            console.log(`======================================================`);
            console.log(`Nights:            ${stayQuote.nights}`);
            console.log(`Average Nightly:   ₱${stayQuote.average_nightly_rate.toLocaleString()}`);
            console.log(`STAY SUBTOTAL:     ₱${stayQuote.stay_subtotal.toLocaleString()}`);
            console.log(`------------------------------------------------------`);
            console.log(`Daily Breakdown:`);
            for (const b of stayQuote.breakdown) {
              console.log(`  ${b.date} [${b.horizon.padEnd(7)}] IQM: ₱${b.raw_iqm} | Mult: ${b.horizon_multiplier}x | Lead: ${b.lead_factor}x -> ₱${b.recommended_price.toLocaleString()}`);
            }
            console.log(`======================================================\n`);
          }
          break;
        }

        const date = getFlagValue('--date') || new Date().toISOString().slice(0, 10);
        const quote = client.getRecommendedPrice({ date, asOfDate });
        if (isJson) {
          console.log(JSON.stringify(quote, null, 2));
        } else {
          console.log(`\n======================================================`);
          console.log(`Unit 418 Serin East Dynamic Benchmark (${quote.date})`);
          console.log(`======================================================`);
          console.log(`Horizon:           ${quote.horizon} (Season: ${quote.season || 'REGULAR'})`);
          console.log(`Source:            ${quote.source}`);
          console.log(`Scraped Listings:  ${quote.listing_count}`);
          console.log(`Base Market IQM:   ₱${quote.raw_iqm.toLocaleString()}`);
          console.log(`RMS Multipliers:   Horizon: ${quote.horizon_multiplier}x | Lead Factor: ${quote.lead_factor}x`);
          console.log(`RECOMMENDED PRICE: ₱${quote.recommended_price.toLocaleString()}`);
          if (quote.clamped) {
            console.log(`Guardrail Notice:  Clamped to ${quote.clamped} (Floor: ₱${quote.guardrails.floor_price} | Ceiling: ₱${quote.guardrails.ceiling_price})`);
          }
          console.log(`Discount/Undercut: None (Pure Market Benchmark & RMS)`);
          console.log(`======================================================\n`);
        }
        break;
      }

      case 'annual': {
        const date = getFlagValue('--date') || new Date().toISOString().slice(0, 10);
        const baseline = client.getAnnualBaseline(date);
        if (isJson) {
          console.log(JSON.stringify(baseline || { date, error: 'Not found' }));
        } else if (baseline) {
          console.log(`\n📅 365 Baseline for ${baseline.date}:`);
          console.log(`   Horizon:      ${baseline.horizon}`);
          console.log(`   Season:       ${baseline.season}`);
          console.log(`   Baseline IQM: ₱${baseline.baseline_iqm.toLocaleString()}`);
          console.log(`   Notes:        ${baseline.notes}\n`);
        } else {
          console.log(`⚠️ No 365 baseline record found for ${date}. Run 'condo-price seed-annual' first.`);
        }
        break;
      }

      case 'guardrails': {
        const floorStr = getFlagValue('--set-floor');
        const ceilingStr = getFlagValue('--set-ceiling');

        if (floorStr || ceilingStr) {
          const updates = {};
          if (floorStr) updates.floor_price = parseFloat(floorStr);
          if (ceilingStr) updates.ceiling_price = parseFloat(ceilingStr);
          const updated = client.updateGuardrails(updates);
          if (isJson) {
            console.log(JSON.stringify(updated));
          } else {
            console.log(`✅ Updated Guardrails: Floor: ₱${updated.floor_price} | Ceiling: ₱${updated.ceiling_price}`);
          }
        } else {
          const current = client.getGuardrails();
          if (isJson) {
            console.log(JSON.stringify(current));
          } else {
            console.log(`\n🛡️ Active Guardrails for Unit 418 Serin:`);
            console.log(`   Floor Price:   ₱${current.floor_price}`);
            console.log(`   Ceiling Price: ₱${current.ceiling_price}`);
            console.log(`   Last Updated:  ${current.updated_at}\n`);
          }
        }
        break;
      }

      case 'listings': {
        const limit = parseInt(getFlagValue('--limit') || '20', 10);
        const listings = client.getListings({ maxDistanceKm: 10.0, bedrooms: 2 });
        const slice = listings.slice(0, limit);
        if (isJson) {
          console.log(JSON.stringify(slice, null, 2));
        } else {
          console.log(`\n🏨 Stored 2BR Listings within 10km (Showing ${slice.length} of ${listings.length}):`);
          for (const l of slice) {
            console.log(`   [${l.source.toUpperCase()}] ₱${l.price_per_night} | ${l.distance_km}km | ${l.title}`);
          }
          console.log('');
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.log(USAGE);
        process.exit(1);
    }
  } finally {
    client.close();
  }
}

main().catch(err => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
