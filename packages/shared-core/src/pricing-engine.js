/**
 * Core Dynamic Pricing Engine for Unit 418 Serin East Tagaytay.
 * Multiplicative Revenue Management System (RMS) Model:
 * Price(d, L) = Base_IQM * Horizon_Multiplier * Lead_Factor
 * strictly clamped by Floor and Ceiling guardrails with ZERO undercuts and ZERO artificial discounts.
 */

// Tagaytay / Philippine Regular & Special Non-Working Holidays & Peak Calendar (Month-Day)
export const TAGAYTAY_PEAK_DATES = new Set([
  '01-01', // New Year's Day
  '01-02', // New Year Holiday
  '04-09', // Araw ng Kagitingan
  '05-01', // Labor Day
  '06-12', // Independence Day
  '08-21', // Ninoy Aquino Day
  '08-31', // National Heroes Day
  '11-01', // All Saints' Day
  '11-02', // All Souls' Day
  '11-30', // Bonifacio Day
  '12-08', // Feast of the Immaculate Conception
  '12-24', // Christmas Eve
  '12-25', // Christmas Day
  '12-30', // Rizal Day
  '12-31', // New Year's Eve
]);

export const HORIZON_MULTIPLIERS = {
  PEAK: 1.65,
  WEEKEND: 1.25,
  WEEKDAY: 1.00
};

/**
 * Detects whether a target date is WEEKDAY, WEEKEND, or PEAK.
 *
 * @param {string} dateStr YYYY-MM-DD
 * @returns {'WEEKDAY' | 'WEEKEND' | 'PEAK'}
 */
export function detectHorizon(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const monthDay = dateStr.slice(5); // MM-DD

  if (TAGAYTAY_PEAK_DATES.has(monthDay)) {
    return 'PEAK';
  }

  // 0 is Sunday, 5 is Friday, 6 is Saturday
  const day = d.getUTCDay();
  if (day === 5 || day === 6) {
    return 'WEEKEND';
  }

  return 'WEEKDAY';
}

/**
 * Calculates lead-time pacing factor based on booking window days.
 *
 * @param {string} targetDateStr YYYY-MM-DD
 * @param {string} [asOfDateStr] YYYY-MM-DD
 * @returns {number} Multiplier factor
 */
export function calculateLeadTimeFactor(targetDateStr, asOfDateStr = null) {
  const asOf = asOfDateStr
    ? new Date(asOfDateStr + 'T00:00:00Z')
    : new Date();
  const target = new Date(targetDateStr + 'T00:00:00Z');

  const diffMs = target.getTime() - asOf.getTime();
  const leadDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (leadDays > 45) {
    return 1.10; // Far-out hedge against early underpricing
  } else if (leadDays >= 15) {
    return 1.00; // Standard booking window
  } else if (leadDays >= 7) {
    return 0.97; // Short lead time pacing
  } else {
    return 0.95; // Near-term fill decay (strictly floor protected)
  }
}

/**
 * Calculates Median price.
 *
 * @param {number[]} prices
 * @returns {number}
 */
export function calculateMedian(prices) {
  if (!prices || prices.length === 0) return 0;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Computes Interquartile Mean (IQM) discarding outer 25% extremes.
 *
 * @param {number[]} prices
 * @returns {number}
 */
export function calculateIQM(prices) {
  if (!prices || prices.length === 0) return 0;
  if (prices.length <= 2) return calculateMedian(prices);

  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;

  const q1Index = Math.floor(n * 0.25);
  const q3Index = Math.ceil(n * 0.75);

  const iqmSlice = sorted.slice(q1Index, q3Index);
  if (iqmSlice.length === 0) return sorted[Math.floor(n / 2)];

  const sum = iqmSlice.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / iqmSlice.length);
}

/**
 * Computes the recommended dynamic price strictly benchmarked to market IQM
 * applying Multiplicative RMS multipliers:
 * Price = Base_IQM * Horizon_Multiplier * Lead_Factor
 * strictly clamped between guardrails.
 *
 * @param {Object} params
 * @param {Array<{price_per_night: number}>} params.listings
 * @param {Object} params.guardrails - { floor_price, ceiling_price }
 * @param {string} params.date - YYYY-MM-DD
 * @param {string} [params.asOfDate] - YYYY-MM-DD (Defaults to current date)
 * @param {Object} [params.annualBaseline] - { baseline_iqm, horizon, season }
 * @returns {Object}
 */
export function computeRecommendedPrice({
  listings = [],
  guardrails = { floor_price: 2800, ceiling_price: 8500 },
  date,
  asOfDate = null,
  annualBaseline = null
}) {
  const horizon = detectHorizon(date);
  const horizonMultiplier = HORIZON_MULTIPLIERS[horizon] || 1.00;
  const leadFactor = calculateLeadTimeFactor(date, asOfDate);

  const prices = listings.map(l => l.price_per_night).filter(p => typeof p === 'number' && p > 0);

  let basePrice = 0;
  let source = 'scraped_iqm';
  let unmultipliedFromAnnual = false;

  if (prices.length > 0) {
    basePrice = calculateIQM(prices);
    source = 'scraped_iqm';
  } else if (annualBaseline && typeof annualBaseline.baseline_iqm === 'number') {
    // Annual baseline rates already incorporate empirical horizon baseline
    basePrice = annualBaseline.baseline_iqm;
    source = 'annual_baseline';
    unmultipliedFromAnnual = true;
  } else {
    // Default baseline fallback if no scraped data and no 365 baseline record
    if (horizon === 'PEAK') basePrice = 6000;
    else if (horizon === 'WEEKEND') basePrice = 4500;
    else basePrice = 3500;
    source = 'horizon_default';
    unmultipliedFromAnnual = true;
  }

  // Calculate raw price via Multiplicative RMS
  let rawPrice = 0;
  if (unmultipliedFromAnnual) {
    // If baseline is already horizon-weighted, apply lead factor and ensure horizon floor
    rawPrice = Math.round(basePrice * leadFactor);
  } else {
    // If from raw scraped market IQM, apply both horizon multiplier and lead factor
    rawPrice = Math.round(basePrice * horizonMultiplier * leadFactor);
  }

  // Clamping strictly to Guardrails with ZERO undercuts and ZERO discounts
  const floor = guardrails.floor_price ?? 2800;
  const ceiling = guardrails.ceiling_price ?? 8500;

  // Horizon-aware floor protections to avoid diluting peak dates
  let effectiveFloor = floor;
  if (horizon === 'PEAK') effectiveFloor = Math.max(floor, 6000);
  else if (horizon === 'WEEKEND') effectiveFloor = Math.max(floor, 4000);

  let clamped = null;
  let finalPrice = rawPrice;

  if (finalPrice < effectiveFloor) {
    finalPrice = effectiveFloor;
    clamped = 'floor';
  } else if (finalPrice > ceiling) {
    finalPrice = ceiling;
    clamped = 'ceiling';
  }

  return {
    date,
    horizon,
    season: annualBaseline?.season || 'REGULAR',
    raw_iqm: basePrice,
    horizon_multiplier: horizonMultiplier,
    lead_factor: leadFactor,
    recommended_price: finalPrice,
    clamped,
    source,
    listing_count: prices.length,
    guardrails: {
      floor_price: floor,
      ceiling_price: ceiling,
      effective_floor: effectiveFloor
    }
  };
}
