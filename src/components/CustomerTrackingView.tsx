import React, { useState, useEffect } from 'react';
import { Search, MapPin, Car, AlertCircle, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Driver, Order, PublicTrackingResponse } from '../types';
import { MapComponent } from './MapComponent';
import { api } from '../services/api';
import { joinOrderRoom, getSocket } from '../services/socket';

interface CustomerTrackingViewProps {
  orders?: Order[];
  drivers?: Driver[];
  initialTrackingCode?: string;
  onSelectOrder?: (order: Order) => void;
}

export const CustomerTrackingView: React.FC<CustomerTrackingViewProps> = ({
  initialTrackingCode,
}) => {
  const [searchQuery, setSearchQuery] = useState(initialTrackingCode || 'TRK-8821');
  const [trackingData, setTrackingData] = useState<PublicTrackingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsAgo, setSecondsAgo] = useState<number>(0);

  const fetchTracking = async (code: string) => {
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.trackOrder(code.trim());
      setTrackingData(data);
      setSecondsAgo(data.lastUpdatedSecondsAgo || 0);
      joinOrderRoom(data.order.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to find active trip with this tracking link.';
      setError(msg);
      setTrackingData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTracking(searchQuery);
  }, []);

  // Timer to increment "seconds ago" smoothly on client
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsAgo((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Socket.io real-time updates for student tracking
  useEffect(() => {
    const socket = getSocket();

    const handleEtaUpdate = (payload: {
      orderId: string;
      driverLocation?: Driver['currentLocation'];
      etaMinutes: number;
      roadDistanceKm: number;
      polyline: [number, number][];
      trafficLevel: 'Normal' | 'Moderate' | 'Heavy';
      trafficSource: string;
    }) => {
      setTrackingData((prev) => {
        if (!prev || prev.order.id !== payload.orderId) return prev;
        setSecondsAgo(0);
        return {
          ...prev,
          liveEtaMinutes: payload.etaMinutes,
          distanceKm: payload.roadDistanceKm,
          roadRoute: payload.polyline && payload.polyline.length > 0 ? payload.polyline : prev.roadRoute,
          trafficCondition: payload.trafficLevel,
          driver: prev.driver && payload.driverLocation
            ? {
                ...prev.driver,
                currentLocation: payload.driverLocation,
              }
            : prev.driver,
        };
      });
    };

    const handleStatusChanged = (payload: { orderId: string; status: Order['status'] }) => {
      setTrackingData((prev) => {
        if (!prev || prev.order.id !== payload.orderId) return prev;
        const isFinished = payload.status === 'DELIVERED' || payload.status === 'CANCELLED';
        setSecondsAgo(0);
        return {
          ...prev,
          order: { ...prev.order, status: payload.status },
          driver: prev.driver
            ? {
                ...prev.driver,
                // Stop exposing live coordinates once trip finishes
                currentLocation: isFinished ? undefined : prev.driver.currentLocation,
              }
            : null,
          roadRoute: isFinished ? [] : prev.roadRoute,
        };
      });
    };

    socket.on('order:eta_update', handleEtaUpdate);
    socket.on('order:status_changed', handleStatusChanged);

    return () => {
      socket.off('order:eta_update', handleEtaUpdate);
      socket.off('order:status_changed', handleStatusChanged);
    };
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchTracking(searchQuery);
  };

  // Human-friendly student status labels
  const orderStatus = trackingData?.order.status.toUpperCase() || '';
  const isCompleted = orderStatus === 'DELIVERED';
  const isCancelled = orderStatus === 'CANCELLED';
  const isAtPickup = orderStatus === 'ARRIVED_PICKUP';
  const isInTransit = orderStatus === 'IN_TRANSIT' || orderStatus === 'PICKED_UP';
  const isEnRoute = orderStatus === 'DRIVER_EN_ROUTE_PICKUP' || orderStatus === 'EN_ROUTE_PICKUP';
  const isAssigned = orderStatus === 'ASSIGNED';
  const isPending = orderStatus === 'CREATED';

  let statusTitle = 'Waiting for driver';
  let statusBadgeClass = 'bg-white/10 text-slate-300';
  if (isCompleted) {
    statusTitle = 'Trip completed';
    statusBadgeClass = 'bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30';
  } else if (isCancelled) {
    statusTitle = 'Trip cancelled';
    statusBadgeClass = 'bg-[#ef4444]/15 text-[#ef4444] border border-[#ef4444]/30';
  } else if (isAtPickup) {
    statusTitle = 'Driver is at pickup';
    statusBadgeClass = 'bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30 animate-pulse';
  } else if (isInTransit) {
    statusTitle = 'Trip in progress';
    statusBadgeClass = 'bg-[#3b82f6]/15 text-[#3b82f6] border border-[#3b82f6]/30';
  } else if (isEnRoute) {
    statusTitle = 'Driver is on the way';
    statusBadgeClass = 'bg-[#3b82f6]/15 text-[#3b82f6] border border-[#3b82f6]/30';
  } else if (isAssigned) {
    statusTitle = 'Taxi Assigned';
    statusBadgeClass = 'bg-amber-500/15 text-amber-400 border border-amber-500/30';
  }

  // Check staleness of telemetry (> 35 seconds without ping)
  const isStale = secondsAgo > 35 && !isCompleted && !isCancelled && Boolean(trackingData?.driver?.currentLocation);

  // Driver entity for map if live tracking is active
  const driverForMap: Driver[] =
    trackingData?.driver && trackingData.driver.currentLocation && !isCompleted && !isCancelled
      ? [
          {
            id: 'tracked-taxi',
            companyId: '',
            name: trackingData.driver.name,
            phone: '', // Redacted
            vehicleId: '',
            vehicleModel: trackingData.driver.vehicleModel,
            plateNumber: trackingData.driver.plateNumber,
            networkCode: '',
            isLeadDriver: false,
            status: isAtPickup ? 'ARRIVED_PICKUP' : isInTransit ? 'EN_ROUTE_DELIVERY' : 'EN_ROUTE_PICKUP',
            currentLocation: {
              ...trackingData.driver.currentLocation,
              timestamp: Date.now() - secondsAgo * 1000,
            },
            totalTrips: 0,
            rating: trackingData.driver.rating || 5.0,
          },
        ]
      : [];

  return (
    <div className="w-full max-w-xl mx-auto flex flex-col items-center px-4 py-4 pb-20">
      {/* Quick Lookup Bar & Dorm Shuttles */}
      <div className="w-full mb-5">
        <form onSubmit={handleSearchSubmit} className="w-full relative flex items-center mb-2.5">
          <input
            id="input-student-tracking-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Paste tracking token or code (e.g. TRK-8821)"
            className="w-full h-11 bg-[#13131a] border border-white/[0.08] focus:border-[#3b82f6] rounded-xl pl-4 pr-24 text-xs text-white placeholder-[#4a5568] font-mono outline-none transition-colors"
          />
          <button
            type="submit"
            id="btn-student-track-submit"
            disabled={loading}
            className="absolute right-1.5 h-8 px-3.5 bg-[#3b82f6] hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Search className="w-3.5 h-3.5" />
            <span>{loading ? 'Finding...' : 'Track'}</span>
          </button>
        </form>

        {/* Jbeil Student Dorm Quick Corridor Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] text-[#94a3b8]">
          <span className="shrink-0 text-[#4a5568] text-[10px] uppercase font-semibold">Active:</span>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('TRK-8821');
              fetchTracking('TRK-8821');
            }}
            className={`shrink-0 px-2 py-1 rounded-md border font-mono transition-colors cursor-pointer ${
              searchQuery === 'TRK-8821'
                ? 'bg-[#3b82f6]/15 text-[#3b82f6] border-[#3b82f6]/30'
                : 'bg-[#13131a] text-[#94a3b8] border-white/[0.06] hover:text-white'
            }`}
          >
            TRK-8821 (Campus Crest)
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('TRK-4419');
              fetchTracking('TRK-4419');
            }}
            className={`shrink-0 px-2 py-1 rounded-md border font-mono transition-colors cursor-pointer ${
              searchQuery === 'TRK-4419'
                ? 'bg-[#3b82f6]/15 text-[#3b82f6] border-[#3b82f6]/30'
                : 'bg-[#13131a] text-[#94a3b8] border-white/[0.06] hover:text-white'
            }`}
          >
            TRK-4419 (Green House)
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('TRK-1920');
              fetchTracking('TRK-1920');
            }}
            className={`shrink-0 px-2 py-1 rounded-md border font-mono transition-colors cursor-pointer ${
              searchQuery === 'TRK-1920'
                ? 'bg-[#3b82f6]/15 text-[#3b82f6] border-[#3b82f6]/30'
                : 'bg-[#13131a] text-[#94a3b8] border-white/[0.06] hover:text-white'
            }`}
          >
            TRK-1920 (Mastita)
          </button>
        </div>
      </div>

      {error && (
        <div className="w-full mb-4 p-3 rounded-xl bg-[#ef4444]/10 border border-[#ef4444]/20 text-[#ef4444] text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Student-Facing Read-Only Card */}
      {trackingData && (
        <div className="w-full flex flex-col bg-[#13131a] border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl">
          {/* Header: Brand + Header State */}
          <div className="p-5 border-b border-white/[0.06] flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold text-[#3b82f6] tracking-wider uppercase">
                ONTime
              </div>
              <h1 className="text-lg font-bold text-white tracking-tight mt-0.5">
                Your Taxi
              </h1>
            </div>

            <div className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusBadgeClass}`}>
              {statusTitle}
            </div>
          </div>

          {/* Key Metrics: Driver & ETA */}
          <div className="p-5 grid grid-cols-2 gap-4 bg-[#0a0a0f]/60 border-b border-white/[0.06]">
            {/* Driver & Vehicle */}
            <div>
              <div className="text-[11px] text-[#4a5568] uppercase font-medium">Taxi & Driver</div>
              <div className="text-sm font-semibold text-white mt-0.5 truncate">
                {trackingData.driver ? trackingData.driver.name : 'Dispatching...'}
              </div>
              {trackingData.driver && (
                <div className="text-[11px] text-[#94a3b8] mt-0.5 font-mono">
                  {trackingData.driver.vehicleModel} • {trackingData.driver.plateNumber}
                </div>
              )}
            </div>

            {/* Big ETA */}
            <div className="text-right">
              <div className="text-[11px] text-[#4a5568] uppercase font-medium">ETA</div>
              <div className="text-2xl font-bold text-white mt-0.5 tabular-nums">
                {isCompleted ? (
                  <span className="text-[#22c55e] text-lg font-medium">Arrived</span>
                ) : isCancelled ? (
                  <span className="text-[#ef4444] text-lg font-medium">Cancelled</span>
                ) : isAtPickup ? (
                  <span className="text-[#22c55e] text-lg font-medium">At Pickup</span>
                ) : trackingData.liveEtaMinutes ? (
                  `~ ${trackingData.liveEtaMinutes} min`
                ) : (
                  'Calculating'
                )}
              </div>
              {!isCompleted && !isCancelled && trackingData.distanceKm && (
                <div className="text-[11px] text-[#94a3b8] mt-0.5 tabular-nums">
                  {trackingData.distanceKm.toFixed(1)} km away
                </div>
              )}
            </div>
          </div>

          {/* LIVE MAP SECTION */}
          <div className="w-full h-[280px] sm:h-[340px] relative bg-[#0a0a0f]">
            {isCompleted || isCancelled ? (
              <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-[#94a3b8]">
                {isCompleted ? (
                  <>
                    <CheckCircle2 className="w-10 h-10 text-[#22c55e] mb-2" />
                    <div className="text-sm font-semibold text-white">Trip Completed</div>
                    <div className="text-xs text-[#94a3b8] mt-1 max-w-xs">
                      Taxi reached destination. Live GPS tracking has ended.
                    </div>
                  </>
                ) : (
                  <>
                    <XCircle className="w-10 h-10 text-[#ef4444] mb-2" />
                    <div className="text-sm font-semibold text-white">Trip Cancelled</div>
                    <div className="text-xs text-[#94a3b8] mt-1 max-w-xs">
                      This trip was cancelled by dispatch.
                    </div>
                  </>
                )}
              </div>
            ) : (
              <MapComponent
                drivers={driverForMap}
                selectedDriverId={driverForMap[0]?.id}
                orders={[trackingData.order]}
                activeOrder={trackingData.order}
                routePath={trackingData.roadRoute}
                followDriver={Boolean(driverForMap.length > 0)}
                height="100%"
                className="w-full h-full"
              />
            )}
          </div>

          {/* Map Legend & Locations Summary */}
          <div className="p-4 sm:p-5 flex flex-col gap-3 text-xs border-t border-white/[0.06]">
            {/* Visual Legend */}
            {!isCompleted && !isCancelled && (
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.04] text-[11px] text-[#94a3b8]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#3b82f6] inline-block" />
                  <span>Taxi location: ●</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#22c55e] inline-block" />
                  <span>Pickup location: 📍</span>
                </div>
              </div>
            )}

            {/* Pickup & Destination */}
            <div className="flex flex-col gap-2 pt-1">
              <div className="flex items-start gap-2">
                <span className="text-[#22c55e] font-bold text-xs mt-0.5">●</span>
                <div>
                  <div className="text-[10px] text-[#4a5568] uppercase font-medium">Pickup</div>
                  <div className="text-slate-200">{trackingData.order.pickupAddress}</div>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <span className="text-[#ef4444] font-bold text-xs mt-0.5">📍</span>
                <div>
                  <div className="text-[10px] text-[#4a5568] uppercase font-medium">Destination</div>
                  <div className="text-slate-200">{trackingData.order.dropoffAddress}</div>
                </div>
              </div>
            </div>

            {/* GPS Freshness Indicator */}
            <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5">
                <Clock className={`w-3.5 h-3.5 ${isStale ? 'text-amber-400' : 'text-[#94a3b8]'}`} />
                {isStale ? (
                  <span className="text-amber-400 font-medium">
                    Driver location hasn't updated recently
                  </span>
                ) : isCompleted || isCancelled ? (
                  <span className="text-[#4a5568]">Tracking finished</span>
                ) : (
                  <span className="text-[#94a3b8]">
                    Last updated: {secondsAgo < 2 ? 'just now' : `${secondsAgo} seconds ago`}
                  </span>
                )}
              </div>

              {trackingData.trafficCondition && !isCompleted && !isCancelled && (
                <span className="text-[#4a5568]">
                  Traffic: {trackingData.trafficCondition}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
