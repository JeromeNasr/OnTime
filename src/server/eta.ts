import { calculateRoadRoute, RouteResult, haversineKm } from './routing';

export interface EtaCalculationInput {
  tripId?: string;
  driverLocation?: { lat: number; lng: number; speed: number; heading?: number };
  destinationCoords: { lat: number; lng: number };
}

export interface EtaCalculationResult {
  etaMinutes: number;
  roadDistanceKm: number;
  polyline: [number, number][];
  trafficLevel: 'Normal' | 'Moderate' | 'Heavy';
  trafficAssessmentBasis: string;
  confidence: number; // 0-1
  lastCalculatedAt: number;
  source: 'OSRM_REAL_ROAD' | 'STRAIGHT_LINE_FALLBACK';
}

interface CachedEtaEntry {
  result: EtaCalculationResult;
  lastDriverLocation: { lat: number; lng: number };
  timestamp: number;
}

// In-memory throttling & smoothing cache
const etaCache = new Map<string, CachedEtaEntry>();
const THROTTLE_MIN_DISTANCE_KM = 0.05; // 50 meters
const THROTTLE_MIN_INTERVAL_MS = 1000 * 15; // 15 seconds minimum between full recalculations

/**
 * Honest ETA Engine:
 * Combines:
 * 1. True road routing distance and route geometry via OSRM
 * 2. Recent driver GPS speed (when actively in motion)
 * 3. Throttled recalculations to prevent unnecessary network overhead
 * 4. Exponential smoothing filter against previous ETA to prevent wild fluctuations
 */
export async function calculateDynamicEta(params: EtaCalculationInput): Promise<EtaCalculationResult> {
  const tripKey = params.tripId || 'default-trip';
  const { driverLocation, destinationCoords } = params;

  if (!driverLocation) {
    return {
      etaMinutes: 10,
      roadDistanceKm: 3.0,
      polyline: [],
      trafficLevel: 'Normal',
      trafficAssessmentBasis: 'Estimated arrival (awaiting driver GPS)',
      confidence: 0.5,
      lastCalculatedAt: Date.now(),
      source: 'STRAIGHT_LINE_FALLBACK',
    };
  }

  // Check cache for throttling
  const cached = etaCache.get(tripKey);
  const now = Date.now();
  if (cached) {
    const movedKm = haversineKm(
      driverLocation.lat,
      driverLocation.lng,
      cached.lastDriverLocation.lat,
      cached.lastDriverLocation.lng
    );

    // If driver moved less than 50m and last check was recent (< 15s), return cached smoothed estimate
    if (movedKm < THROTTLE_MIN_DISTANCE_KM && now - cached.timestamp < THROTTLE_MIN_INTERVAL_MS) {
      return cached.result;
    }
  }

  // 1. Compute true road route
  const route: RouteResult = await calculateRoadRoute(
    driverLocation.lat,
    driverLocation.lng,
    destinationCoords.lat,
    destinationCoords.lng
  );

  // 2. Base duration from road network
  const baseMinutes = route.durationMinutes;

  // 3. Driver movement adjustment:
  // If driver is currently moving at a valid travel speed (> 10 km/h), blend it with road baseline
  let rawEtaMinutes = baseMinutes;
  if (driverLocation.speed > 10 && driverLocation.speed < 120 && route.distanceKm > 0) {
    const gpsBasedMinutes = (route.distanceKm / driverLocation.speed) * 60;
    // 70% road geometry baseline, 30% observed speed
    rawEtaMinutes = Math.max(1, Math.round(baseMinutes * 0.7 + gpsBasedMinutes * 0.3));
  }

  // 4. Exponential smoothing against previous ETA
  let smoothedEta = rawEtaMinutes;
  if (cached && now - cached.timestamp < 1000 * 60 * 10) {
    const prevEta = cached.result.etaMinutes;
    // Prevent sudden erratic jumps (smooth by 50% if sudden shift > 3 min)
    if (Math.abs(rawEtaMinutes - prevEta) > 3) {
      smoothedEta = Math.max(1, Math.round(prevEta * 0.5 + rawEtaMinutes * 0.5));
    }
  }

  const assessmentBasis =
    route.source === 'OSRM_REAL_ROAD'
      ? 'Estimated arrival (road routing + recent GPS)'
      : 'Estimated arrival (straight-line fallback)';

  const result: EtaCalculationResult = {
    etaMinutes: smoothedEta,
    roadDistanceKm: route.distanceKm,
    polyline: route.polyline,
    trafficLevel: 'Normal',
    trafficAssessmentBasis: assessmentBasis,
    confidence: route.source === 'OSRM_REAL_ROAD' ? 0.95 : 0.7,
    lastCalculatedAt: now,
    source: route.source,
  };

  etaCache.set(tripKey, {
    result,
    lastDriverLocation: { lat: driverLocation.lat, lng: driverLocation.lng },
    timestamp: now,
  });

  return result;
}
