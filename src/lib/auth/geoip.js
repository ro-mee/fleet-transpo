import geoip from 'geoip-lite';

/**
 * Derives an approximate human-readable location from an IP address.
 * 
 * @param {string} ip - The IP address to look up
 * @returns {string} - E.g. "Manila, Philippines" or "Unknown Location"
 */
export function getLocationFromIp(ip) {
  if (!ip) return 'Unknown Location';
  
  try {
    const geo = geoip.lookup(ip);
    if (geo && geo.country) {
      const city = geo.city || 'Unknown City';
      
      let countryName = geo.country;
      try {
        const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
        countryName = displayNames.of(geo.country) || geo.country;
      } catch (e) {
        // Fallback to raw code
      }

      return city !== 'Unknown City' ? `${city}, ${countryName}` : countryName;
    }
  } catch (error) {
    // Fail gracefully on lookup errors
  }
  
  return 'Unknown Location';
}
