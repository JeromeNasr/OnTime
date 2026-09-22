import React, { useState, useEffect, useRef } from 'react';
import {
  Compass,
  Crosshair,
  Battery,
  Wifi,
  WifiOff,
  ChevronDown,
  PhoneCall,
  ExternalLink,
  Play,
  Square,
  AlertCircle,
  Clock,
  Car,
  Eye,
  EyeOff,
  Gauge,
} from 'lucide-react';
import { Driver, Trip, TripStatus } from '../types';
import { SpeedometerGauge } from './SpeedometerGauge';
import { SIMULATED_ROUTES } from '../data/jbeilData';
import { flushOfflineGpsQueue } from '../services/api';
import { StatusChip } from './StatusChip';

interface DriverPhoneViewProps {
  currentDriver: Driver;
  currentTrip?: Trip | null;
  onUpdateLocation: (location: {
    lat: number;
    lng: number;
    speed: number;
    heading: number;
    accuracy: number;
    batteryLevel?: number;
    networkStatus?: 'wifi' | '4g' | '3g' | 'offline';
    isSimulated?: boolean;
  }) => void;
  onStartTrip: () => void;
  onEndTrip: () => void;
  onUpdateTripStatus: (tripId: string, status: TripStatus) => void;
  onToggleStatus: (status: Driver['status']) => void;
  onToggleLocationSharing?: (enabled: boolean) => void;
  onToggleSpeedometer?: (enabled: boolean) => void;
}

export const DriverPhoneView: React.FC<DriverPhoneViewProps> = ({
  currentDriver,
  currentTrip,
  onUpdateLocation,
  onStartTrip,
  onEndTrip,
  onUpdateTripStatus,
  onToggleStatus,
  onToggleLocationSharing,
  onToggleSpeedometer,
}) => {
  // Tracking Mode: Real Phone GPS (Default for real operations) vs Demo Campus Route
  const [gpsMode, setGpsMode] = useState<'real' | 'simulated'>('real');
  const [isSimulating, setIsSimulating] = useState(false);
  const [isTrackingPaused] = useState(false);
  const [selectedRouteKey, setSelectedRouteKey] = useState<keyof typeof SIMULATED_ROUTES>('lauCampusLoop');
  const [simSpeedFactor, setSimSpeedFactor] = useState(1);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Device telemetry
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  // References
  const watchIdRef = useRef<number | null>(null);
  const simIndexRef = useRef(0);
  const simIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSendTimeRef = useRef<number>(0);
  const prevCoordRef = useRef<{ lat: number; lng: number; time: number } | null>(null);

  // Read Battery API on Android Chrome
  useEffect(() => {
    // @ts-expect-error - navigator.getBattery standard Web API
    if (navigator.getBattery) {
      // @ts-expect-error - battery API
      navigator.getBattery().then((battery: { level: number; addEventListener: (type: string, fn: () => void) => void }) => {
        setBatteryLevel(Math.round(battery.level * 100));
        battery.addEventListener('levelchange', () => {
          setBatteryLevel(Math.round(battery.level * 100));
        });
      }).catch(() => {
        // Battery API not permitted
      });
    }

    const handleOnline = () => {
      setIsOnline(true);
      flushOfflineGpsQueue();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Real GPS Geolocation Watcher with Jitter Filter & Adaptive Interval
  useEffect(() => {
    if (gpsMode !== 'real') {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    if (!('geolocation' in navigator)) {
      setGpsError('Geolocation is not supported by your browser or device.');
      return;
    }

    setGpsError(null);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (isTrackingPaused) return;

        const now = Date.now();
        const accuracy = Math.round(pos.coords.accuracy || 10);

        if (accuracy > 50) {
          return;
        }

        let speedKmH = 0;
        if (pos.coords.speed !== null && pos.coords.speed >= 0) {
          speedKmH = pos.coords.speed * 3.6;
        } else if (prevCoordRef.current) {
          const dtSec = (now - prevCoordRef.current.time) / 1000;
          if (dtSec > 0.5) {
            const dKm = haversineDistanceKm(
              prevCoordRef.current.lat,
              prevCoordRef.current.lng,
              pos.coords.latitude,
              pos.coords.longitude
            );
            speedKmH = (dKm / dtSec) * 3600;
          }
        }

        if (speedKmH > 150) {
          return;
        }

        let heading = pos.coords.heading || 0;
        if (!heading && prevCoordRef.current) {
          heading = calculateBearing(
            prevCoordRef.current.lat,
            prevCoordRef.current.lng,
            pos.coords.latitude,
            pos.coords.longitude
          );
        }

        prevCoordRef.current = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          time: now,
        };

        const minIntervalMs = speedKmH > 40 ? 1000 : speedKmH > 10 ? 2000 : 3500;
        if (now - lastSendTimeRef.current >= minIntervalMs) {
          lastSendTimeRef.current = now;
          onUpdateLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            speed: Math.round(speedKmH * 10) / 10,
            heading: Math.round(heading),
            accuracy,
            batteryLevel: batteryLevel || 95,
            networkStatus: isOnline ? '4g' : 'offline',
            isSimulated: false,
          });
        }
      },
      (err) => {
        setGpsError(`GPS Notice: ${err.message}. Switch to 'Simulate Route' for virtual testing.`);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [gpsMode, isTrackingPaused, isOnline, batteryLevel]);

  // Route Simulation Timer
  useEffect(() => {
    if (gpsMode !== 'simulated' || !isSimulating || isTrackingPaused) {
      if (simIntervalRef.current) {
        clearInterval(simIntervalRef.current);
        simIntervalRef.current = null;
      }
      return;
    }

    const route = SIMULATED_ROUTES[selectedRouteKey] || SIMULATED_ROUTES.lauCampusLoop;
    const baseIntervalMs = Math.round(1500 / simSpeedFactor);

    simIntervalRef.current = setInterval(() => {
      simIndexRef.current = (simIndexRef.current + 1) % route.length;
      const point = route[simIndexRef.current];

      const nextIdx = (simIndexRef.current + 1) % route.length;
      const nextPoint = route[nextIdx];
      const bearing = calculateBearing(point.lat, point.lng, nextPoint.lat, nextPoint.lng);

      const speedVariation = Math.sin(simIndexRef.current * 0.7) * 2 * simSpeedFactor;
      const currentSpeed = Math.max(0, Math.round(point.speed * simSpeedFactor + speedVariation));

      onUpdateLocation({
        lat: point.lat,
        lng: point.lng,
        speed: currentSpeed,
        heading: Math.round(bearing),
        accuracy: 6,
        batteryLevel: batteryLevel || 88,
        networkStatus: '4g',
        isSimulated: true,
      });
    }, baseIntervalMs);

    return () => {
      if (simIntervalRef.current) {
        clearInterval(simIntervalRef.current);
        simIntervalRef.current = null;
      }
    };
  }, [gpsMode, isSimulating, isTrackingPaused, selectedRouteKey, simSpeedFactor, batteryLevel]);

  function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const toDeg = (rad: number) => (rad * 180) / Math.PI;
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x =
      Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  const isTripActive = !!currentTrip && currentTrip.status !== 'COMPLETED' && currentTrip.status !== 'CANCELLED';
  const tripStatusUpper = (currentTrip?.status || '').toUpperCase();

  const headingVal = `${Math.round(currentDriver.currentLocation.heading || 0)}°`;
  const accuracyVal = `${Math.round(currentDriver.currentLocation.accuracy || 8)}m`;
  const batteryVal = batteryLevel !== null ? `${batteryLevel}%` : '92%';
  const networkVal = isOnline ? (currentDriver.currentLocation.networkStatus || '4G').toUpperCase() : 'Offline';

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5 pb-12">
      {/* Top Driver Status Bar */}
      <div className="flex items-center justify-between px-1">
        <div>
          <div className="text-xs text-[#94a3b8]">Logged in as</div>
          <div className="text-sm font-semibold text-white flex items-center gap-2">
            <span>{currentDriver.name}</span>
            {currentDriver.isLeadDriver && (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/10 text-white font-medium">
                Lead
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              onToggleStatus(
                currentDriver.status === 'AVAILABLE' || currentDriver.status === 'available'
                  ? 'offline'
                  : 'available'
              )
            }
            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
              currentDriver.status === 'AVAILABLE' || currentDriver.status === 'available'
                ? 'bg-[#22c55e]/15 text-[#22c55e]'
                : 'bg-white/10 text-[#94a3b8]'
            }`}
          >
            {currentDriver.status === 'AVAILABLE' || currentDriver.status === 'available'
              ? 'Available'
              : 'Offline'}
          </button>
        </div>
      </div>

      {/* GPS Mode Segmented Control */}
      <div className="bg-[#13131a] p-1 rounded-lg border border-white/[0.06] flex items-center">
        <button
          id="btn-gps-mode-real"
          onClick={() => setGpsMode('real')}
          className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
            gpsMode === 'real'
              ? 'bg-[#1e1e28] text-white shadow-xs'
              : 'text-[#94a3b8] hover:text-white'
          }`}
        >
          Real Phone GPS
        </button>
        <button
          id="btn-gps-mode-sim"
          onClick={() => setGpsMode('simulated')}
          className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
            gpsMode === 'simulated'
              ? 'bg-[#1e1e28] text-white shadow-xs'
              : 'text-[#94a3b8] hover:text-white'
          }`}
        >
          Simulated Route
        </button>
      </div>

      {/* Broadcasting Privacy Controls: Location Sharing & Speedometer Toggle */}
      <div className="bg-[#13131a] border border-white/[0.06] rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-2.5">
        {/* Location Sharing Toggle */}
        <div className="w-full sm:w-auto flex items-center justify-between sm:justify-start gap-3">
          <div className="flex items-center gap-2">
            {currentDriver.locationSharingEnabled !== false ? (
              <Eye className="w-4 h-4 text-emerald-400" />
            ) : (
              <EyeOff className="w-4 h-4 text-rose-400" />
            )}
            <div>
              <div className="text-xs font-medium text-white">Public Map Visibility</div>
              <div className="text-[10px] text-[#64748b]">
                {currentDriver.locationSharingEnabled !== false ? 'Broadcasting live on customer map' : 'Hidden from public map'}
              </div>
            </div>
          </div>
          {onToggleLocationSharing && (
            <button
              id="btn-toggle-location-sharing"
              type="button"
              onClick={() => onToggleLocationSharing(currentDriver.locationSharingEnabled === false)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                currentDriver.locationSharingEnabled !== false
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30'
              }`}
            >
              {currentDriver.locationSharingEnabled !== false ? 'Live ON' : 'Paused'}
            </button>
          )}
        </div>

        {/* Speedometer Telemetry Toggle */}
        <div className="w-full sm:w-auto flex items-center justify-between sm:justify-start gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-white/[0.06]">
          <div className="flex items-center gap-2">
            <Gauge className={`w-4 h-4 ${currentDriver.speedometerEnabled !== false ? 'text-blue-400' : 'text-[#64748b]'}`} />
            <div>
              <div className="text-xs font-medium text-white">Speedometer</div>
              <div className="text-[10px] text-[#64748b]">
                {currentDriver.speedometerEnabled !== false ? 'Speed visible to public' : 'Speed telemetry hidden'}
              </div>
            </div>
          </div>
          {onToggleSpeedometer && (
            <button
              id="btn-toggle-speedometer"
              type="button"
              onClick={() => onToggleSpeedometer(currentDriver.speedometerEnabled === false)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                currentDriver.speedometerEnabled !== false
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30'
                  : 'bg-white/10 text-slate-400 border border-white/10 hover:bg-white/15'
              }`}
            >
              {currentDriver.speedometerEnabled !== false ? 'Speed ON' : 'Speed OFF'}
            </button>
          )}
        </div>
      </div>

      {gpsError && (
        <div className="p-3 bg-[#13131a] border border-[#ef4444]/30 rounded-lg text-xs text-[#ef4444] flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{gpsError}</span>
        </div>
      )}

      {/* Hero Speedometer Card */}
      <div className="bg-[#13131a] border border-white/[0.06] rounded-xl p-6 flex flex-col items-center justify-center">
        <SpeedometerGauge speedKmH={currentDriver.currentLocation.speed} speedLimit={80} />

        {/* 2-Column Telemetry Stat Row: Heading, Accuracy, Battery, Network */}
        <div className="w-full grid grid-cols-2 gap-2.5 mt-4 pt-4 border-t border-white/[0.06]">
          <div className="bg-[#0a0a0f] p-3 rounded-lg border border-white/[0.06] flex items-center gap-3">
            <div className="text-[#94a3b8]">
              <Compass className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[11px] text-[#4a5568]">Heading</div>
              <div className="text-sm font-semibold text-white font-mono tabular-nums">{headingVal}</div>
            </div>
          </div>

          <div className="bg-[#0a0a0f] p-3 rounded-lg border border-white/[0.06] flex items-center gap-3">
            <div className="text-[#94a3b8]">
              <Crosshair className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[11px] text-[#4a5568]">Accuracy</div>
              <div className="text-sm font-semibold text-white font-mono tabular-nums">{accuracyVal}</div>
            </div>
          </div>

          <div className="bg-[#0a0a0f] p-3 rounded-lg border border-white/[0.06] flex items-center gap-3">
            <div className="text-[#94a3b8]">
              <Battery className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[11px] text-[#4a5568]">Battery</div>
              <div className="text-sm font-semibold text-white font-mono tabular-nums">{batteryVal}</div>
            </div>
          </div>

          <div className="bg-[#0a0a0f] p-3 rounded-lg border border-white/[0.06] flex items-center gap-3">
            <div className="text-[#94a3b8]">
              {isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4 text-[#ef4444]" />}
            </div>
            <div>
              <div className="text-[11px] text-[#4a5568]">Network</div>
              <div className="text-sm font-semibold text-white font-mono">{networkVal}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Simulation Route Controls (When in Simulated Mode) */}
      {gpsMode === 'simulated' && (
        <div className="bg-[#13131a] border border-white/[0.06] rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="select-sim-route" className="text-[#94a3b8]">Route</label>
            <div className="relative">
              <select
                id="select-sim-route"
                value={selectedRouteKey}
                onChange={(e) => setSelectedRouteKey(e.target.value as keyof typeof SIMULATED_ROUTES)}
                className="appearance-none bg-[#0a0a0f] text-white text-xs pl-3 pr-7 py-1.5 rounded-lg border border-white/[0.06] focus:border-[#3b82f6] outline-none cursor-pointer"
              >
                <option value="lauCampusLoop">LAU Byblos & Blat Dorm Loop</option>
                <option value="oldSoukRoute">Jbeil Old Port to LAU Campus</option>
                <option value="highwayRoute">Byblos Highway - Mastita Link</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-[#94a3b8] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 text-xs">
            <span className="text-[#94a3b8]">Speed factor: {simSpeedFactor}x</span>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.25"
                value={simSpeedFactor}
                onChange={(e) => setSimSpeedFactor(parseFloat(e.target.value))}
                className="w-20 accent-[#3b82f6]"
              />
              <button
                id="btn-toggle-simulation"
                onClick={() => setIsSimulating(!isSimulating)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  isSimulating
                    ? 'bg-[#ef4444]/15 text-[#ef4444] border border-[#ef4444]/30'
                    : 'bg-[#3b82f6] text-white'
                }`}
              >
                {isSimulating ? 'Pause Drive' : 'Start Drive'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Start / End Trip Buttons */}
      <div className="flex flex-col gap-2">
        {isTripActive ? (
          <div className="flex flex-col gap-2">
            <div className="bg-[#13131a] border border-white/[0.06] rounded-xl p-3 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-[#94a3b8]">
                <Clock className="w-3.5 h-3.5 text-[#22c55e]" />
                <span>Trip in progress</span>
              </div>
              <div className="font-mono text-white">
                {currentTrip?.roadDistanceKm ? `${currentTrip.roadDistanceKm.toFixed(1)} km estimated` : 'Live route'}
              </div>
            </div>
            <button
              id="btn-end-trip-log"
              onClick={onEndTrip}
              className="w-full py-3.5 bg-[#ef4444] hover:bg-red-600 text-white font-medium rounded-lg text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <Square className="w-4 h-4 fill-current" />
              End Trip
            </button>
          </div>
        ) : (
          <button
            id="btn-start-trip-log"
            onClick={onStartTrip}
            className="w-full py-3.5 bg-[#3b82f6] hover:bg-blue-600 text-white font-medium rounded-lg text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" />
            Start Trip
          </button>
        )}
      </div>

      {/* Active Trip Card */}
      {currentTrip ? (
        <div className="bg-[#13131a] border border-white/[0.06] rounded-xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[11px] font-mono text-[#4a5568]">TRIP #{currentTrip.id.slice(-6)}</span>
              <h3 className="text-sm font-bold text-white mt-0.5">{currentTrip.studentName}</h3>
            </div>
            <StatusChip status={currentTrip.status} />
          </div>

          {/* Vertical Timeline (dot → line → dot) */}
          <div className="relative pl-6 flex flex-col gap-4 text-xs">
            {/* Connecting line */}
            <div className="absolute left-[7px] top-[9px] bottom-[9px] w-[2px] bg-white/[0.1]" />

            {/* Pickup */}
            <div className="relative">
              <div className="absolute -left-6 top-[3px] w-3 h-3 rounded-full bg-[#22c55e] border-2 border-[#13131a]" />
              <div className="text-[10px] text-[#4a5568] uppercase font-medium">Pickup (Dorm)</div>
              <div className="text-slate-200 mt-0.5">{currentTrip.pickupAddress}</div>
            </div>

            {/* Destination */}
            <div className="relative">
              <div className="absolute -left-6 top-[3px] w-3 h-3 rounded-full bg-[#ef4444] border-2 border-[#13131a]" />
              <div className="text-[10px] text-[#4a5568] uppercase font-medium">Destination (Campus)</div>
              <div className="text-slate-200 mt-0.5">{currentTrip.dropoffAddress}</div>
            </div>
          </div>

          {/* Maps Navigation link (No call button - student tracks driver location automatically) */}
          <div className="pt-1 border-t border-white/[0.06]">
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${
                tripStatusUpper.includes('PICK') || tripStatusUpper === 'ASSIGNED' || tripStatusUpper === 'CREATED'
                  ? `${currentTrip.pickupCoords.lat},${currentTrip.pickupCoords.lng}`
                  : `${currentTrip.dropoffCoords.lat},${currentTrip.dropoffCoords.lng}`
              }`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full h-11 bg-[#0a0a0f] hover:bg-[#1a1a24] text-slate-200 text-xs font-medium rounded-lg flex items-center justify-center gap-2 border border-white/[0.06] transition-colors"
            >
              <ExternalLink className="w-4 h-4 text-[#3b82f6]" />
              <span>Navigate in Google Maps ({tripStatusUpper.includes('PICK') || tripStatusUpper === 'ASSIGNED' ? 'To Pickup' : 'To Campus'})</span>
            </a>
          </div>

          {/* Status Action Buttons - Large touch targets for driver safety */}
          <div className="flex flex-col gap-2 pt-2 border-t border-white/[0.06]">
            {(tripStatusUpper === 'ASSIGNED' || tripStatusUpper === 'CREATED') && (
              <button
                id="btn-trip-enroute-pickup"
                onClick={() => onUpdateTripStatus(currentTrip.id, 'EN_ROUTE_PICKUP')}
                className="w-full h-12 bg-[#3b82f6] hover:bg-blue-600 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Depart for Student Pickup
              </button>
            )}

            {(tripStatusUpper === 'EN_ROUTE_PICKUP') && (
              <button
                id="btn-trip-arrived-pickup"
                onClick={() => onUpdateTripStatus(currentTrip.id, 'AT_PICKUP')}
                className="w-full h-12 bg-[#f59e0b] hover:bg-amber-600 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Arrived at Student Dorm
              </button>
            )}

            {(tripStatusUpper === 'AT_PICKUP') && (
              <button
                id="btn-trip-confirm-pickup"
                onClick={() => onUpdateTripStatus(currentTrip.id, 'IN_TRANSIT')}
                className="w-full h-12 bg-[#3b82f6] hover:bg-blue-600 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Student Picked Up • Depart for Campus
              </button>
            )}

            {tripStatusUpper === 'IN_TRANSIT' && (
              <button
                id="btn-trip-delivered"
                onClick={() => onUpdateTripStatus(currentTrip.id, 'COMPLETED')}
                className="w-full h-12 bg-[#22c55e] hover:bg-green-600 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Arrived at Campus Gate • Complete Trip
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-[#13131a] border border-dashed border-white/[0.06] rounded-xl p-8 text-center text-[#4a5568]">
          <Car className="w-7 h-7 mx-auto mb-2 text-[#4a5568]" />
          <p className="text-xs font-medium text-[#94a3b8]">No Active Trip Assigned</p>
          <p className="text-[11px] text-[#4a5568] mt-1">
            Dorm transportation trips dispatched to your taxi will appear here automatically.
          </p>
        </div>
      )}
    </div>
  );
};
