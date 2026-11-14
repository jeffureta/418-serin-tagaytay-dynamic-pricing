import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BaseScraper } from './base-scraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class BookingScraper extends BaseScraper {
  constructor(options = {}) {
    const fixturePath = options.fixturePath || resolve(__dirname, '../../fixtures/booking_sample.json');
    super({ ...options, source: 'booking', fixturePath });
  }
}
