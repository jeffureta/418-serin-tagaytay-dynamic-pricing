/**
 * Geographical coordinates and Haversine distance calculations
 * for Unit 418 Serin East Tagaytay and competitor listings.
 */

export const SERIN_EAST_COORDS = Object.freeze({
  latitude: 14.11528,
  longitude: 120.96205,
  name: 'Unit 418 Serin East Tagaytay'
});

const EARTH_RADIUS_KM = 6371.0;

/**
 * Calculates Great-Circle distance between two coordinates in kilometers using Haversine formula.
 *
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance in kilometers
 */
export function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  if (
    typeof lat1 !== 'number' || typeof lon1 !== 'number' ||
    typeof lat2 !== 'number' || typeof lon2 !== 'number' ||
    Number.isNaN(lat1) || Number.isNaN(lon1) ||
    Number.isNaN(lat2) || Number.isNaN(lon2)
  ) {
    return Infinity;
  }

  if (lat1 === lat2 && lon1 === lon2) {
    return 0;
  }

  const toRad = (angle) => (angle * Math.PI) / 180.0;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Checks if a given coordinate is within Tagaytay radius (default 10.0km) from Unit 418 Serin East.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} [maxKm=10.0]
 * @returns {boolean}
 */
export function isWithinTagaytayRadius(lat, lon, maxKm = 10.0) {
  const dist = haversineDistanceKm(SERIN_EAST_COORDS.latitude, SERIN_EAST_COORDS.longitude, lat, lon);
  return dist <= maxKm;
}
