import React, { useState, useEffect, useRef } from 'react';
import {
  Navigation,
  Play,
  Square,
  Compass,
  PhoneCall,
  CheckCircle2,
  PackageCheck,
  Radio,
  Sliders,
  AlertCircle,
  Clock,
  MapPin,
  Car,
} from 'lucide-react';
import { Driver, Order } from '../types';
import { SpeedometerGauge } from './SpeedometerGauge';
import { SIMULATED_ROUTES } from '../data/northLebanonData';

interface DriverPhoneViewProps {
  currentDriver: Driver;
  activeOrder?: Order | null;
  onUpdateLocation: (location: {
    lat: number;
    lng: number;
    speed: number;
    heading: number;
    accuracy: number;
  }) => void;
  onStartTrip: () => void;
  onEndTrip: () => void;
  onUpdateOrderStatus: (orderId: string, status: Order['status']) => void;
  onToggleStatus: (status: Driver['status']) => void;
}

export const DriverPhoneView: React.FC<DriverPhoneViewProps> = ({
  currentDriver,
  activeOrder,
  onUpdateLocation,
  onStartTrip,
  onEndTrip,
  onUpdateOrderStatus,
  onToggleStatus,
}) => {
  // Tracking Mode: Real GPS or Simulation
  const [gpsMode, setGpsMode] = useState<'real' | 'simulated'>('simulated');
  const [isSimulating, setIsSimulating] = useState(false);
  const [selectedRouteKey, setSelectedRouteKey] = useState<keyof typeof SIMULATED_ROUTES>('tripoliMina');
  const [simSpeedFactor, setSimSpeedFactor] = useState(1);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Watch position ID
  const watchIdRef = useRef<number | null>(null);
  const simIndexRef = useRef(0);
  const simIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Real GPS Geolocation Watcher
  useEffect(() => {
    if (gpsMode !== 'real') {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    if (!('geolocation' in navigator)) {
      setGpsError('Geolocation is not supported by your browser/phone.');
      return;
    }

    setGpsError(null);
    let prevCoord: { lat: number; lng: number; time: number } | null = null;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        let speedKmH = 0;
        if (pos.coords.speed !== null && pos.coords.speed >= 0) {
          speedKmH = pos.coords.speed * 3.6; // convert m/s to km/h
        } else if (prevCoord) {
          // calculate speed from distance over time
          const dt = (pos.timestamp - prevCoord.time) / 1000; // seconds
          if (dt > 1) {
            const dKm = haversineDistanceKm(
              prevCoord.lat,
              prevCoord.lng,
              pos.coords.latitude,
              pos.coords.longitude
            );
            speedKmH = (dKm / (dt / 3600));
          }
        }

        prevCoord = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          time: pos.timestamp,
        };

        const heading = pos.coords.heading !== null && !isNaN(pos.coords.heading)
          ? pos.coords.heading
          : currentDriver.currentLocation.heading;

        onUpdateLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speed: Math.max(0, Math.min(speedKmH, 160)),
          heading: heading || 0,
          accuracy: Math.round(pos.coords.accuracy || 5),
        });
      },
      (err) => {
        console.warn('GPS error:', err.message);
        setGpsError(`${err.message}. Switch to Simulated GPS for instant testing.`);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 1000,
      }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [gpsMode]);

  // Simulation Runner
  useEffect(() => {
    if (gpsMode !== 'simulated' || !isSimulating) {
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
      return;
    }

    const route = SIMULATED_ROUTES[selectedRouteKey];
    simIntervalRef.current = setInterval(() => {
      simIndexRef.current = (simIndexRef.current + 1) % route.length;
      const point = route[simIndexRef.current];
      const nextPoint = route[(simIndexRef.current + 1) % route.length];

      // calculate heading bearing
      const heading = calculateBearing(point.lat, point.lng, nextPoint.lat, nextPoint.lng);
      const randomizedSpeed = Math.max(15, point.speed * simSpeedFactor + (Math.random() * 6 - 3));

      onUpdateLocation({
        lat: point.lat,
        lng: point.lng,
        speed: Math.round(randomizedSpeed),
        heading: Math.round(heading),
        accuracy: 4,
      });
    }, 2500);

    return () => {
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    };
  }, [gpsMode, isSimulating, selectedRouteKey, simSpeedFactor]);

  function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
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

  function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number) {
    const y = Math.sin(((lon2 - lon1) * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180);
    const x =
      Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
      Math.sin((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.cos(((lon2 - lon1) * Math.PI) / 180);
    const brng = (Math.atan2(y, x) * 180) / Math.PI;
    return (brng + 360) % 360;
  }

  const isTripActive = Boolean(currentDriver.activeTrip);
  const tripDurationMinutes = isTripActive
    ? Math.floor((Date.now() - (currentDriver.activeTrip?.startTime || Date.now())) / 60000)
    : 0;

  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-4 pb-12">
      {/* Driver Mobile Phone Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-400 flex items-center justify-center text-slate-950 font-black shadow-lg shadow-amber-500/20">
              <Car className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-base text-slate-100">{currentDriver.name}</h2>
                {currentDriver.isLeadDriver && (
                  <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold px-1.5 py-0.5 rounded">
                    LEAD
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                {currentDriver.vehicleModel} • <span className="font-mono text-slate-300 font-semibold">{currentDriver.plateNumber}</span>
              </p>
            </div>
          </div>

          {/* Status badge & toggle */}
          <div className="flex flex-col items-end gap-1">
            <button
              id="btn-driver-status-toggle"
              onClick={() =>
                onToggleStatus(currentDriver.status === 'available' ? 'busy' : 'available')
              }
              className={`px-3 py-1 text-xs font-bold rounded-full transition-all border ${
                currentDriver.status === 'busy'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  : currentDriver.status === 'available'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              ● {currentDriver.status.toUpperCase()}
            </button>
            <span className="text-[10px] text-slate-500 font-mono">
              Net: {currentDriver.networkCode}
            </span>
          </div>
        </div>
      </div>

      {/* Speedometer Cluster */}
      <SpeedometerGauge
        speedKmH={currentDriver.currentLocation.speed}
        maxSpeedKmH={currentDriver.activeTrip?.maxSpeedKmH || 0}
        speedLimit={currentDriver.currentLocation.speed > 60 ? 90 : 50}
      />

      {/* GPS Telemetry Diagnostics Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              GPS Navigation & Speedometer Feed
            </h3>
          </div>

          {/* Mode Switcher: Real vs Simulated */}
          <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800">
            <button
              id="btn-gps-mode-real"
              onClick={() => setGpsMode('real')}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-all ${
                gpsMode === 'real'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Phone GPS
            </button>
            <button
              id="btn-gps-mode-sim"
              onClick={() => setGpsMode('simulated')}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-all ${
                gpsMode === 'simulated'
                  ? 'bg-amber-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Simulate Route
            </button>
          </div>
        </div>

        {gpsError && (
          <div className="mb-3 p-2.5 bg-rose-950/60 border border-rose-800/80 rounded-xl text-xs text-rose-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{gpsError}</span>
          </div>
        )}

        {/* Live GPS Coordinates & Heading */}
        <div className="grid grid-cols-3 gap-2 text-center mb-3">
          <div className="bg-slate-950 p-2 rounded-xl border border-slate-850">
            <div className="text-[10px] text-slate-500 uppercase">Latitude</div>
            <div className="text-xs font-mono font-bold text-slate-200">
              {currentDriver.currentLocation.lat.toFixed(4)}° N
            </div>
          </div>
          <div className="bg-slate-950 p-2 rounded-xl border border-slate-850">
            <div className="text-[10px] text-slate-500 uppercase">Longitude</div>
            <div className="text-xs font-mono font-bold text-slate-200">
              {currentDriver.currentLocation.lng.toFixed(4)}° E
            </div>
          </div>
          <div className="bg-slate-950 p-2 rounded-xl border border-slate-850">
            <div className="text-[10px] text-slate-500 uppercase">Heading</div>
            <div className="text-xs font-mono font-bold text-slate-200 flex items-center justify-center gap-1">
              <Compass className="w-3 h-3 text-cyan-400" />
              {Math.round(currentDriver.currentLocation.heading)}°
            </div>
          </div>
        </div>

        {/* Simulation Controls when in Simulation Mode */}
        {gpsMode === 'simulated' && (
          <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 flex flex-col gap-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">North Lebanon Route:</span>
              <select
                id="select-sim-route"
                value={selectedRouteKey}
                onChange={(e) => setSelectedRouteKey(e.target.value as keyof typeof SIMULATED_ROUTES)}
                className="bg-slate-900 text-slate-200 text-xs px-2 py-1 rounded border border-slate-700 outline-none"
              >
                <option value="tripoliMina">Tripoli Port & Mina Corniche</option>
                <option value="coastalHighway">Tripoli-Batroun Highway (Coastal)</option>
                <option value="zghartaRoute">Tripoli - Zgharta Loop</option>
              </select>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                <Sliders className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs text-slate-400">Speed: {simSpeedFactor}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.25"
                value={simSpeedFactor}
                onChange={(e) => setSimSpeedFactor(parseFloat(e.target.value))}
                className="w-24 accent-amber-500"
              />

              <button
                id="btn-toggle-simulation"
                onClick={() => setIsSimulating(!isSimulating)}
                className={`px-3 py-1 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all ${
                  isSimulating
                    ? 'bg-rose-600 text-white hover:bg-rose-700'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-600/20'
                }`}
              >
                {isSimulating ? (
                  <>
                    <Square className="w-3 h-3 fill-current" /> Pause Drive
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3 fill-current" /> Start Drive
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Trip History Logger Controller */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Trip History Logger
            </h3>
            <p className="text-[11px] text-slate-500">
              Logs GPS path, distance, duration & speedometer metrics
            </p>
          </div>
          {isTripActive && (
            <span className="flex items-center gap-1 text-xs font-mono font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2 py-0.5 rounded-full animate-pulse">
              <Clock className="w-3 h-3" /> {tripDurationMinutes} min
            </span>
          )}
        </div>

        {isTripActive ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 bg-slate-950 p-3 rounded-xl border border-slate-850">
              <div>
                <div className="text-[10px] text-slate-500 uppercase">Distance Covered</div>
                <div className="text-lg font-bold font-mono text-emerald-400">
                  {currentDriver.activeTrip?.distanceKm.toFixed(2)} <span className="text-xs text-slate-400">km</span>
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase">Top Speed</div>
                <div className="text-lg font-bold font-mono text-amber-400">
                  {Math.round(currentDriver.activeTrip?.maxSpeedKmH || 0)} <span className="text-xs text-slate-400">km/h</span>
                </div>
              </div>
            </div>

            <button
              id="btn-end-trip-log"
              onClick={onEndTrip}
              className="w-full py-3 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-lg shadow-rose-600/20 flex items-center justify-center gap-2 transition-all"
            >
              <Square className="w-4 h-4 fill-current" /> End & Save Trip Log
            </button>
          </div>
        ) : (
          <button
            id="btn-start-trip-log"
            onClick={onStartTrip}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 transition-all"
          >
            <Play className="w-4 h-4 fill-current" /> Start Logging New Trip
          </button>
        )}
      </div>

      {/* Active Order Assigned by Lead Driver */}
      {activeOrder ? (
        <div className="bg-slate-900 border-2 border-emerald-500/40 rounded-2xl p-4 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-emerald-500 text-slate-950 text-[10px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-wider">
            {activeOrder.status.replace('_', ' ')}
          </div>

          <div className="flex items-center gap-2 mb-3">
            <Navigation className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-sm text-slate-100">Assigned Order #{activeOrder.id}</h3>
          </div>

          <div className="space-y-2.5 mb-4">
            <div className="flex items-start gap-2.5">
              <MapPin className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Pickup</div>
                <div className="text-xs font-semibold text-slate-200">{activeOrder.pickupAddress}</div>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <MapPin className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Drop-off Destination</div>
                <div className="text-xs font-semibold text-slate-200">{activeOrder.dropoffAddress}</div>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs">
              <span className="text-slate-400">Package:</span>{' '}
              <span className="font-medium text-slate-200">{activeOrder.packageInfo}</span>
            </div>
          </div>

          {/* Customer Call & Actions */}
          <div className="flex items-center gap-2 mb-3">
            <a
              href={`tel:${activeOrder.customerPhone}`}
              className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 border border-slate-700 transition-colors"
            >
              <PhoneCall className="w-3.5 h-3.5 text-emerald-400" /> Call {activeOrder.customerName}
            </a>
          </div>

          {/* Status Stepper Actions */}
          <div className="grid grid-cols-2 gap-2">
            {activeOrder.status === 'assigned' && (
              <button
                id="btn-order-pickup"
                onClick={() => onUpdateOrderStatus(activeOrder.id, 'picked_up')}
                className="col-span-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow"
              >
                <PackageCheck className="w-4 h-4" /> Confirm Picked Up
              </button>
            )}

            {activeOrder.status === 'picked_up' && (
              <button
                id="btn-order-transit"
                onClick={() => onUpdateOrderStatus(activeOrder.id, 'in_transit')}
                className="col-span-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow"
              >
                <Navigation className="w-4 h-4" /> Start Transit to Customer
              </button>
            )}

            {activeOrder.status === 'in_transit' && (
              <button
                id="btn-order-delivered"
                onClick={() => onUpdateOrderStatus(activeOrder.id, 'delivered')}
                className="col-span-2 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-black rounded-xl flex items-center justify-center gap-1.5 shadow"
              >
                <CheckCircle2 className="w-4 h-4" /> Mark Order Delivered
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-dashed border-slate-800 rounded-2xl p-6 text-center text-slate-500">
          <Car className="w-8 h-8 mx-auto text-slate-600 mb-2" />
          <p className="text-xs font-medium text-slate-400">No Active Order Assigned</p>
          <p className="text-[11px] text-slate-500 mt-1">
            The Lead Driver or Dispatcher can assign orders to your car from the Central Console.
          </p>
        </div>
      )}
    </div>
  );
};
