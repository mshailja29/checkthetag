/**
 * Pure-JS geohash + Haversine helpers for Firestore geo-queries.
 */

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

function encodeGeohash(lat, lng, precision = 9) {
    let latRange = [-90, 90];
    let lngRange = [-180, 180];
    let hash = "";
    let bit = 0;
    let ch = 0;
    let isLng = true;

    while (hash.length < precision) {
        const range = isLng ? lngRange : latRange;
        const val = isLng ? lng : lat;
        const mid = (range[0] + range[1]) / 2;
        if (val >= mid) {
            ch |= 1 << (4 - bit);
            range[0] = mid;
        } else {
            range[1] = mid;
        }
        isLng = !isLng;
        if (++bit === 5) {
            hash += BASE32[ch];
            bit = 0;
            ch = 0;
        }
    }
    return hash;
}

function decodeGeohash(hash) {
    let latRange = [-90, 90];
    let lngRange = [-180, 180];
    let isLng = true;
    for (const c of hash) {
        const idx = BASE32.indexOf(c);
        for (let bit = 4; bit >= 0; bit--) {
            const range = isLng ? lngRange : latRange;
            const mid = (range[0] + range[1]) / 2;
            if ((idx >> bit) & 1) range[0] = mid;
            else range[1] = mid;
            isLng = !isLng;
        }
    }
    return {
        lat: (latRange[0] + latRange[1]) / 2,
        lng: (lngRange[0] + lngRange[1]) / 2,
    };
}

function neighborsGeohash(hash) {
    // simplified: return hash prefix range for Firestore queries
    return hash;
}

/**
 * Haversine distance in miles.
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 3958.8; // Earth radius in miles
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Return geohash precision for a given radius in miles.
 */
function precisionForRadius(radiusMiles) {
    if (radiusMiles <= 0.5) return 6;
    if (radiusMiles <= 2) return 5;
    if (radiusMiles <= 10) return 4;
    if (radiusMiles <= 50) return 3;
    return 2;
}

/**
 * Generate Firestore-compatible query bounds for a geo-radius search.
 * Returns array of [startHash, endHash] pairs.
 */
function geohashQueryBounds(lat, lng, radiusMiles) {
    const precision = precisionForRadius(radiusMiles);
    const centerHash = encodeGeohash(lat, lng, precision);
    // Simple approach: query for the center prefix
    const startHash = centerHash;
    const endHash = centerHash + "~";
    return [[startHash, endHash]];
}

module.exports = {
    encodeGeohash,
    decodeGeohash,
    neighborsGeohash,
    haversineDistance,
    precisionForRadius,
    geohashQueryBounds,
};
