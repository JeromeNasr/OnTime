// Real Road Routing Engine using OpenStreetMap OSRM
export interface RouteResult {
  distanceKm: number;
  durationMinutes: number;
  polyline: [number, number][]; // [lat, lng] format for Leaflet
  source: 'OSRM_REAL_ROAD' | 'STRAIGHT_LINE_FALLBACK';
}

// In-memory cache for repeated route queries to minimize latency
const routeCache = new Map<string, { result: RouteResult; timestamp: number }>();
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes cache

export async function calculateRoadRoute(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): Promise<RouteResult> {
  const cacheKey = `${startLat.toFixed(4)},${startLng.toFixed(4)}->${endLat.toFixed(4)},${endLng.toFixed(4)}`;
  const cached = routeCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }

  const osrmBase = process.env.OSRM_URL || 'https://router.project-osrm.org';
  const url = `${osrmBase}/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500); // 3.5s timeout

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const distanceKm = Math.round((route.distance / 1000) * 10) / 10;
        const durationMinutes = Math.max(1, Math.round(route.duration / 60));

        // Convert GeoJSON [lng, lat] to Leaflet [lat, lng]
        const polyline: [number, number][] = route.geometry.coordinates.map(
          (c: [number, number]) => [c[1], c[0]]
        );

        const result: RouteResult = {
          distanceKm,
          durationMinutes,
          polyline,
          source: 'OSRM_REAL_ROAD',
        };

        routeCache.set(cacheKey, { result, timestamp: Date.now() });
        return result;
      }
    }
  } catch (err) {
    console.warn('OSRM service call fallback to straight line estimate:', err);
  }

  // Honest Fallback: Straight-line distance estimate without fabricated fake road paths
  return calculateStraightLineFallback(startLat, startLng, endLat, endLng);
}

function calculateStraightLineFallback(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): RouteResult {
  const straightDist = haversineKm(lat1, lon1, lat2, lon2);
  // Real terrain road factor is approximately 1.25x straight line
  const distanceKm = Math.round(straightDist * 1.25 * 10) / 10;

  // Baseline vehicle transit speed estimate is ~35 km/h
  const avgSpeedKmH = 35;
  const durationMinutes = Math.max(1, Math.round((distanceKm / avgSpeedKmH) * 60));

  // No random points or fake roads; strictly honest straight connection
  return {
    distanceKm,
    durationMinutes,
    polyline: [
      [lat1, lon1],
      [lat2, lon2],
    ],
    source: 'STRAIGHT_LINE_FALLBACK',
  };
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
