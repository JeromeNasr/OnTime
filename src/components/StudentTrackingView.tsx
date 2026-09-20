import React, { useState, useEffect } from 'react';
import { MapPin, Car, AlertCircle, CheckCircle2, XCircle, Clock, ShieldCheck } from 'lucide-react';
import { PublicTrackingResponse, TripStatus, StudentTrackingState } from '../types';
import { MapComponent } from './MapComponent';
import { api } from '../services/api';
import { joinTripRoom, getSocket } from '../services/socket';

interface StudentTrackingViewProps {
  initialTrackingCode?: string;
}

export const StudentTrackingView: React.FC<StudentTrackingViewProps> = ({
  initialTrackingCode,
}) => {
  const [trackingCode, setTrackingCode] = useState(initialTrackingCode || 'TRK-8821');
  const [trackingData, setTrackingData] = useState<PublicTrackingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsAgo, setSecondsAgo] = useState<number>(0);

  const fetchTracking = async (code: string) => {
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.trackTrip(code.trim());
      setTrackingData(data);
      setSecondsAgo(data.lastUpdatedSecondsAgo || 0);
      joinTripRoom(code.trim());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'No active shuttle taxi found with this tracking link.';
      setError(msg);
      setTrackingData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTracking(trackingCode);
  }, []);

  // Smooth client-side timer for "seconds ago" freshness
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsAgo((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Real-time socket event handling
  useEffect(() => {
    const socket = getSocket();

    const handleEtaUpdate = (payload: {
      tripId?: string;
      driverLocation?: { lat: number; lng: number; speed: number; heading: number; timestamp: number };
      etaMinutes: number;
      roadDistanceKm: number;
      polyline: [number, number][];
    }) => {
      setTrackingData((prev) => {
        if (!prev) return prev;
        setSecondsAgo(0);
        return {
          ...prev,
          etaMinutes: payload.etaMinutes,
          distanceKm: payload.roadDistanceKm,
          roadRoute: payload.polyline && payload.polyline.length > 0 ? payload.polyline : prev.roadRoute,
          taxiLocation: payload.driverLocation
            ? {
                lat: payload.driverLocation.lat,
                lng: payload.driverLocation.lng,
                speed: payload.driverLocation.speed,
                heading: payload.driverLocation.heading,
                timestamp: payload.driverLocation.timestamp,
              }
            : prev.taxiLocation,
          lastUpdated: Date.now(),
        };
      });
    };

    const handleStatusChanged = (payload: { tripId?: string; status: TripStatus }) => {
      setTrackingData((prev) => {
        if (!prev) return prev;
        const isFinished = payload.status === 'COMPLETED' || payload.status === 'CANCELLED';
        setSecondsAgo(0);
        return {
          ...prev,
          status: payload.status,
          tripStatus: payload.status,
          taxiLocation: isFinished ? null : prev.taxiLocation,
          roadRoute: isFinished ? [] : prev.roadRoute,
          lastUpdated: Date.now(),
        };
      });
    };

    socket.on('trip:eta_update', handleEtaUpdate);
    socket.on('trip:status_changed', handleStatusChanged);

    return () => {
      socket.off('trip:eta_update', handleEtaUpdate);
      socket.off('trip:status_changed', handleStatusChanged);
    };
  }, []);

  // Derive display status
  const currentStatus: TripStatus = trackingData?.status || trackingData?.tripStatus || 'CREATED';
  const isCompleted = currentStatus === 'COMPLETED';
  const isCancelled = currentStatus === 'CANCELLED';
  const isAtPickup = currentStatus === 'AT_PICKUP';
  const isInTransit = currentStatus === 'IN_TRANSIT';
  const isEnRoute = currentStatus === 'EN_ROUTE_PICKUP' || currentStatus === 'ASSIGNED' || currentStatus === 'DRIVER_ACCEPTED';

  let statusTitle = 'Assigning Dorm Taxi...';
  let statusBadgeColor = 'bg-white/10 text-slate-300 border-white/10';

  if (isCompleted) {
    statusTitle = 'Trip Completed';
    statusBadgeColor = 'bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/30';
  } else if (isCancelled) {
    statusTitle = 'Trip Cancelled';
    statusBadgeColor = 'bg-[#ef4444]/15 text-[#ef4444] border-[#ef4444]/30';
  } else if (isInTransit) {
    statusTitle = 'On The Way To Campus';
    statusBadgeColor = 'bg-[#3b82f6]/15 text-[#3b82f6] border-[#3b82f6]/30';
  } else if (isAtPickup) {
    statusTitle = 'Taxi Arrived Outside';
    statusBadgeColor = 'bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/30';
  } else if (isEnRoute) {
    statusTitle = 'Taxi En Route to Dorm';
    statusBadgeColor = 'bg-[#3b82f6]/15 text-[#3b82f6] border-[#3b82f6]/30';
  }

  // Freshness calculation
  const gpsFreshness = secondsAgo <= 15 ? 'FRESH' : secondsAgo <= 120 ? 'STALE' : 'OFFLINE';

  // Construct mock driver for MapComponent compatibility
  const activeTaxiForMap = trackingData?.taxiLocation
    ? [
        {
          id: 'active-taxi',
          name: trackingData.driver?.name || 'Assigned Taxi',
          phone: '',
          vehicleModel: trackingData.vehicle?.makeModel || 'Dorm Shuttle',
          plateNumber: trackingData.vehicle?.plateNumber || '',
          networkCode: 'FLEET',
          isLeadDriver: false,
          status: 'IN_TRANSIT' as const,
          totalTrips: 0,
          rating: 5,
          currentLocation: {
            lat: trackingData.taxiLocation.lat,
            lng: trackingData.taxiLocation.lng,
            speed: trackingData.taxiLocation.speed,
            heading: trackingData.taxiLocation.heading,
            accuracy: 5,
            timestamp: trackingData.taxiLocation.timestamp,
          },
        },
      ]
    : [];

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-4 pb-16 px-3 sm:px-0">
      {/* Top Header: Security Verified & Code */}
      <div className="flex items-center justify-between bg-[#13131a] border border-white/[0.06] rounded-xl px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#22c55e]" />
          <span className="text-xs font-semibold text-white tracking-wide uppercase">Your Taxi</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-[#94a3b8]">#{trackingData?.trackingCode || trackingCode}</span>
          <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${statusBadgeColor}`}>
            {statusTitle}
          </span>
        </div>
      </div>

      {loading && !trackingData && (
        <div className="bg-[#13131a] border border-white/[0.06] rounded-xl p-8 text-center text-[#94a3b8]">
          <div className="w-6 h-6 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs">Locating your assigned dorm taxi...</p>
        </div>
      )}

      {error && (
        <div className="bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-[#ef4444] shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-semibold text-[#ef4444]">Tracking Link Expired or Not Found</div>
            <div className="text-[11px] text-[#94a3b8] mt-0.5">{error}</div>
          </div>
        </div>
      )}

      {trackingData && (
        <>
          {/* Primary ETA Hero Banner */}
          {!isCompleted && !isCancelled && (
            <div className="bg-[#13131a] border border-white/[0.06] rounded-xl p-5 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-[#94a3b8] uppercase font-medium">Estimated Arrival</div>
                <div className="text-3xl font-black text-white tracking-tight mt-0.5">
                  {isAtPickup ? (
                    <span className="text-[#22c55e] text-2xl font-bold">Taxi Waiting Outside</span>
                  ) : trackingData.etaMinutes !== null && trackingData.etaMinutes > 0 ? (
                    `${trackingData.etaMinutes} min`
                  ) : (
                    'Arriving now'
                  )}
                </div>
                {trackingData.distanceKm !== null && trackingData.distanceKm > 0 && !isAtPickup && (
                  <div className="text-xs text-[#94a3b8] mt-1 font-medium">
                    {trackingData.distanceKm.toFixed(1)} km away from pickup
                  </div>
                )}
              </div>

              {/* GPS Freshness Badge */}
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5 bg-[#0a0a0f] border border-white/[0.06] px-2.5 py-1 rounded-full text-[10px]">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      gpsFreshness === 'FRESH'
                        ? 'bg-[#22c55e] animate-pulse'
                        : gpsFreshness === 'STALE'
                        ? 'bg-[#f59e0b]'
                        : 'bg-[#ef4444]'
                    }`}
                  />
                  <span className="text-[#94a3b8]">
                    {gpsFreshness === 'FRESH'
                      ? `Live (${secondsAgo}s)`
                      : gpsFreshness === 'STALE'
                      ? `Signal ${secondsAgo}s ago`
                      : 'Signal offline'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Map View: Taxi location, pickup, destination, road route */}
          <div className="w-full h-80 sm:h-96 rounded-xl overflow-hidden border border-white/[0.06] relative shadow-lg">
            <MapComponent
              drivers={activeTaxiForMap}
              selectedDriverId={activeTaxiForMap[0]?.id}
              routePath={trackingData.roadRoute}
              focusLocation={
                trackingData.taxiLocation
                  ? { lat: trackingData.taxiLocation.lat, lng: trackingData.taxiLocation.lng }
                  : { lat: trackingData.pickup.lat, lng: trackingData.pickup.lng }
              }
              height="100%"
              className="w-full h-full"
            />
          </div>

          {/* Vehicle & Trip Route Card */}
          <div className="bg-[#13131a] border border-white/[0.06] rounded-xl p-5 flex flex-col gap-4">
            {/* Vehicle info */}
            {trackingData.vehicle && (
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#1e1e28] border border-white/[0.08] flex items-center justify-center text-[#3b82f6]">
                    <Car className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">{trackingData.vehicle.makeModel}</div>
                    <div className="text-[11px] text-[#94a3b8] mt-0.5">
                      Driver: {trackingData.driver?.name || 'Assigned Driver'}
                    </div>
                  </div>
                </div>
                <div className="bg-[#0a0a0f] border border-white/[0.08] px-3 py-1.5 rounded-lg text-center">
                  <div className="text-[9px] text-[#4a5568] uppercase font-bold">Plate</div>
                  <div className="font-mono text-xs font-bold text-white tracking-wider">
                    {trackingData.vehicle.plateNumber || 'T-TAXIS'}
                  </div>
                </div>
              </div>
            )}

            {/* Route Addresses */}
            <div className="relative pl-6 flex flex-col gap-4 text-xs">
              <div className="absolute left-[7px] top-[10px] bottom-[10px] w-[2px] bg-white/[0.1]" />

              <div className="relative">
                <div className="absolute -left-6 top-[3px] w-3.5 h-3.5 rounded-full bg-[#22c55e] border-2 border-[#13131a]" />
                <div className="text-[10px] text-[#94a3b8] uppercase font-medium">Pickup Location (Dorm)</div>
                <div className="text-white font-medium mt-0.5">{trackingData.pickup.address}</div>
              </div>

              <div className="relative">
                <div className="absolute -left-6 top-[3px] w-3.5 h-3.5 rounded-full bg-[#ef4444] border-2 border-[#13131a]" />
                <div className="text-[10px] text-[#94a3b8] uppercase font-medium">Destination</div>
                <div className="text-white font-medium mt-0.5">{trackingData.destination.address}</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
