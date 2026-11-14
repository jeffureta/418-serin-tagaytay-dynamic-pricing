import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineDistanceKm, isWithinTagaytayRadius, SERIN_EAST_COORDS } from '../../../shared-core/src/geo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class BaseScraper {
  /**
   * @param {Object} [options]
   * @param {'fixture'|'live'} [options.mode='live']
   * @param {string} [options.source='ota']
   * @param {string} [options.fixturePath]
   */
  constructor(options = {}) {
    this.mode = options.mode || 'live';
    this.source = options.source || 'ota';
    this.fixturePath = options.fixturePath || '';
    this.timeoutMs = options.timeoutMs || 15000;
  }

  loadFixture() {
    if (!this.fixturePath || !existsSync(this.fixturePath)) {
      return [];
    }
    const content = readFileSync(this.fixturePath, 'utf8');
    return JSON.parse(content);
  }

  filterListings(rawListings) {
    const valid = [];
    for (const item of rawListings) {
      if (item.bedrooms !== 2) continue;

      let distance = item.distance_km;
      if (typeof distance !== 'number' && typeof item.latitude === 'number' && typeof item.longitude === 'number') {
        distance = haversineDistanceKm(
          SERIN_EAST_COORDS.latitude,
          SERIN_EAST_COORDS.longitude,
          item.latitude,
          item.longitude
        );
      }

      if (typeof distance === 'number' && distance <= 10.0) {
        valid.push({
          id: item.id,
          source: this.source,
          title: item.title,
          bedrooms: 2,
          price_per_night: item.price_per_night,
          currency: item.currency || 'PHP',
          latitude: item.latitude ?? null,
          longitude: item.longitude ?? null,
          distance_km: Math.round(distance * 100) / 100,
          url: item.url,
          scraped_at: new Date().toISOString()
        });
      }
    }
    return valid;
  }

  async fetchListings() {
    if (this.mode === 'fixture') {
      const raw = this.loadFixture();
      return this.filterListings(raw);
    }

    // Live mode with 15s timeout and graceful fixture fallback
    try {
      const liveData = await this.scrapeLiveWithTimeout();
      return this.filterListings(liveData);
    } catch {
      // Fallback cleanly to fixture if live scrape fails or times out
      const raw = this.loadFixture();
      return this.filterListings(raw);
    }
  }

  async scrapeLiveWithTimeout() {
    // Sub-classes implement live Playwright scraping here.
    // Base implementation falls back to fixture.
    return this.loadFixture();
  }
}
