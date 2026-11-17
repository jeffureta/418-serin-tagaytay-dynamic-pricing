import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseManager } from '../../shared-core/src/db.js';
import {
  computeRecommendedPrice,
  detectHorizon,
  calculateLeadTimeFactor,
  calculateIQM,
  calculateMedian,
  HORIZON_MULTIPLIERS,
  TAGAYTAY_PEAK_DATES
} from '../../shared-core/src/pricing-engine.js';
import { AirbnbScraper } from './scrapers/airbnb.js';
import { BookingScraper } from './scrapers/booking.js';
import { AgodaScraper } from './scrapers/agoda.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class CondoPricingClient {
  /**
   * @param {Object} [options]
   * @param {string} [options.dbPath] - Database path or ':memory:'
   */
  constructor(options = {}) {
    this.db = new DatabaseManager({ path: options.dbPath });
  }

  getGuardrails() {
    return this.db.getGuardrails();
  }

  updateGuardrails({ floor_price, ceiling_price }) {
    return this.db.updateGuardrails({ floor_price, ceiling_price });
  }

  seedAnnualBaselines(fixturePath = null) {
    const path = fixturePath || resolve(__dirname, '../fixtures/tagaytay_annual_baseline_365.json');
    if (!existsSync(path)) {
      throw new Error(`Annual baseline fixture not found at: ${path}`);
    }
    const days = JSON.parse(readFileSync(path, 'utf8'));
    for (const d of days) {
      this.db.insertAnnualBaseline(d);
    }
    return days.length;
  }

  getAnnualBaseline(date) {
    return this.db.getAnnualBaseline(date);
  }

  async runScrapePipeline({ mode = 'live' } = {}) {
    const airbnb = new AirbnbScraper({ mode });
    const booking = new BookingScraper({ mode });
    const agoda = new AgodaScraper({ mode });

    const [airListings, bookListings, agoListings] = await Promise.all([
      airbnb.fetchListings(),
      booking.fetchListings(),
      agoda.fetchListings()
    ]);

    const all = [...airListings, ...bookListings, ...agoListings];
    for (const l of all) {
      this.db.insertListing(l);
    }

    return {
      totalListings: all.length,
      bySource: {
        airbnb: airListings.length,
        booking: bookListings.length,
        agoda: agoListings.length
      }
    };
  }

  getListings({ maxDistanceKm = 10.0, bedrooms = 2, source = null } = {}) {
    return this.db.getListings({ maxDistanceKm, bedrooms, source });
  }

  getRecommendedPrice({ date, asOfDate = null, horizon = null }) {
    const effectiveDate = date || new Date().toISOString().slice(0, 10);
    const guardrails = this.getGuardrails();
    const annualBaseline = this.getAnnualBaseline(effectiveDate);
    const listings = this.db.getListings({ maxDistanceKm: 10.0, bedrooms: 2 });

    const calculation = computeRecommendedPrice({
      listings,
      guardrails,
      date: effectiveDate,
      asOfDate,
      annualBaseline
    });

    if (horizon) {
      calculation.horizon = horizon;
    }

    return calculation;
  }

  getStayQuote({ checkInDate, checkOutDate, asOfDate = null }) {
    if (!checkInDate || !checkOutDate) {
      throw new Error('Both checkInDate and checkOutDate are required.');
    }

    const start = new Date(checkInDate + 'T00:00:00Z');
    const end = new Date(checkOutDate + 'T00:00:00Z');

    if (end <= start) {
      throw new Error('checkOutDate must be after checkInDate.');
    }

    const breakdown = [];
    let current = new Date(start);
    let subtotal = 0;

    while (current < end) {
      const dateStr = current.toISOString().slice(0, 10);
      const quote = this.getRecommendedPrice({ date: dateStr, asOfDate });
      breakdown.push(quote);
      subtotal += quote.recommended_price;
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return {
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      nights: breakdown.length,
      stay_subtotal: subtotal,
      average_nightly_rate: Math.round(subtotal / breakdown.length),
      breakdown
    };
  }

  close() {
    this.db.close();
  }
}

export {
  computeRecommendedPrice,
  detectHorizon,
  calculateLeadTimeFactor,
  calculateIQM,
  calculateMedian,
  HORIZON_MULTIPLIERS,
  TAGAYTAY_PEAK_DATES
};
