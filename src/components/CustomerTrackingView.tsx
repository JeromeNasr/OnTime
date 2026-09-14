import React, { useState } from 'react';
import {
  Search,
  Clock,
  Navigation,
  Phone,
  Shield,
  Gauge,
  CheckCircle2,
  Package,
  MapPin,
  AlertTriangle,
} from 'lucide-react';
import { Driver, Order } from '../types';
import { MapComponent } from './MapComponent';

interface CustomerTrackingViewProps {
  orders: Order[];
  drivers: Driver[];
  initialTrackingCode?: string;
  onSelectOrder?: (order: Order) => void;
}

export const CustomerTrackingView: React.FC<CustomerTrackingViewProps> = ({
  orders,
  drivers,
  initialTrackingCode,
}) => {
  const [searchQuery, setSearchQuery] = useState(initialTrackingCode || '');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(() => {
    if (initialTrackingCode) {
      return (
        orders.find(
          (o) =>
            o.trackingCode.toLowerCase() === initialTrackingCode.toLowerCase() ||
            o.id.toLowerCase() === initialTrackingCode.toLowerCase()
        ) || orders[0] || null
      );
    }
    return orders[0] || null;
  });

  // Find assigned driver for currently selected order
  const assignedDriver = selectedOrder?.assignedDriverId
    ? drivers.find((d) => d.id === selectedOrder.assignedDriverId)
    : null;

  // Calculate live ETA and distance
  let distanceKm = 4.8;
  let etaMinutes = 12;
  const currentSpeed = assignedDriver ? Math.round(assignedDriver.currentLocation.speed) : 0;

  if (selectedOrder && assignedDriver) {
    distanceKm = haversineDistanceKm(
      assignedDriver.currentLocation.lat,
      assignedDriver.currentLocation.lng,
      selectedOrder.dropoffCoords.lat,
      selectedOrder.dropoffCoords.lng
    );

    // Speedometer-based ETA calculation
    const effectiveSpeed = currentSpeed > 10 ? currentSpeed : 32; // fallback if stopped at red light
    const trafficMultiplier = 1.2; // North Lebanon urban / coastal traffic factor
    const hours = distanceKm / effectiveSpeed;
    etaMinutes = Math.max(2, Math.round(hours * 60 * trafficMultiplier));
  }

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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim().toLowerCase();
    const found = orders.find(
      (o) =>
        o.trackingCode.toLowerCase() === query ||
        o.id.toLowerCase() === query ||
        o.customerPhone.includes(query)
    );
    if (found) {
      setSelectedOrder(found);
    }
  };

  return (
    <div className="w-full flex flex-col gap-4 pb-12">
      {/* Tracking Search Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Enter Delivery PIN (e.g. TRK-9812 or ORD-TRIP-101)"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-emerald-500"
            />
          </div>
          <button
            id="btn-customer-track-search"
            type="submit"
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-1.5 transition-all"
          >
            Track Delivery
          </button>
        </form>

        {/* Quick Demo Track Buttons */}
        <div className="flex items-center gap-2 mt-3 overflow-x-auto text-[11px] text-slate-400 pb-1">
          <span className="shrink-0 text-[10px] uppercase font-semibold text-slate-500">
            Quick Orders:
          </span>
          {orders.slice(0, 3).map((o) => (
            <button
              key={o.id}
              onClick={() => {
                setSelectedOrder(o);
                setSearchQuery(o.trackingCode);
              }}
              className={`px-2.5 py-1 rounded-lg border shrink-0 transition-all font-mono ${
                selectedOrder?.id === o.id
                  ? 'bg-emerald-950/60 border-emerald-600/60 text-emerald-300 font-bold'
                  : 'bg-slate-950 border-slate-850 hover:border-slate-700 text-slate-300'
              }`}
            >
              {o.trackingCode} ({o.customerName.split(' ')[0]})
            </button>
          ))}
        </div>
      </div>

      {selectedOrder ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Main Live OpenStreetMap Container */}
          <div className="lg:col-span-2 flex flex-col gap-3">
            <div className="h-[420px] rounded-2xl overflow-hidden border border-slate-800 shadow-2xl relative">
              <MapComponent
                drivers={assignedDriver ? [assignedDriver] : drivers}
                selectedDriverId={assignedDriver?.id}
                orders={[selectedOrder]}
                activeOrder={selectedOrder}
                height="100%"
                followDriver={true}
              />

              {/* Floating Live Telemetry Badge over Map */}
              {assignedDriver && (
                <div className="absolute bottom-4 left-4 z-[400] bg-slate-950/90 backdrop-blur-md p-3 rounded-xl border border-slate-800 shadow-xl flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                      <Gauge className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">
                        Driver Speed
                      </div>
                      <div className="text-sm font-mono font-bold text-emerald-400">
                        {currentSpeed} <span className="text-[10px] font-normal text-slate-400">km/h</span>
                      </div>
                    </div>
                  </div>

                  <div className="border-l border-slate-800 pl-3">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">
                      Distance to You
                    </div>
                    <div className="text-sm font-mono font-bold text-slate-100">
                      {distanceKm.toFixed(1)} <span className="text-[10px] font-normal text-slate-400">km</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ETA and Traffic Analysis Banner */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
                  <Clock className="w-6 h-6 animate-spin-slow" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Estimated Time of Arrival
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black font-mono text-emerald-400">
                      ~{etaMinutes} Minutes
                    </span>
                    <span className="text-xs text-slate-400">
                      ({distanceKm.toFixed(1)} km away)
                    </span>
                  </div>
                </div>
              </div>

              {/* Traffic & Speed Calculation Breakdown */}
              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-850 text-xs text-slate-400 flex items-center gap-3">
                <div>
                  <span className="text-[10px] block text-slate-500 uppercase">Traffic Model:</span>
                  <span className="text-slate-200 font-semibold">North Coast Flow (Normal)</span>
                </div>
                <div className="border-l border-slate-800 pl-3">
                  <span className="text-[10px] block text-slate-500 uppercase">Speed Sensor:</span>
                  <span className="text-emerald-400 font-semibold font-mono">{currentSpeed} km/h GPS</span>
                </div>
              </div>
            </div>
          </div>

          {/* Delivery & Driver Details Card */}
          <div className="flex flex-col gap-4">
            {/* Driver Profile Card */}
            {assignedDriver ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Your Assigned Driver
                  </span>
                  <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    EN ROUTE
                  </span>
                </div>

                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow-lg">
                    {assignedDriver.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-slate-100">{assignedDriver.name}</h3>
                    <p className="text-xs text-slate-400">
                      {assignedDriver.vehicleModel} •{' '}
                      <span className="font-mono text-slate-300 font-bold">
                        {assignedDriver.plateNumber}
                      </span>
                    </p>
                    <div className="text-[11px] text-amber-400 font-semibold mt-0.5">
                      ★ {assignedDriver.rating} Rating • {assignedDriver.totalTrips} Trips
                    </div>
                  </div>
                </div>

                <a
                  href={`tel:${assignedDriver.phone}`}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow flex items-center justify-center gap-2 transition-colors"
                >
                  <Phone className="w-3.5 h-3.5" /> Call Driver ({assignedDriver.phone})
                </a>
              </div>
            ) : (
              <div className="bg-slate-900 border border-dashed border-slate-800 rounded-2xl p-5 text-center text-slate-400">
                <AlertTriangle className="w-6 h-6 text-amber-400 mx-auto mb-2" />
                <p className="text-xs font-semibold text-slate-200">Awaiting Driver Assignment</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  The lead driver is currently assigning a vehicle from the North Lebanon fleet.
                </p>
              </div>
            )}

            {/* Delivery Progress Steps */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                Order Tracking Status
              </h4>

              <div className="space-y-3">
                <div className="flex items-center gap-3 text-xs">
                  <div className="w-6 h-6 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center font-bold shrink-0">
                    ✓
                  </div>
                  <div>
                    <div className="font-semibold text-slate-200">Order Confirmed</div>
                    <div className="text-[10px] text-slate-500">Order #{selectedOrder.id}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center font-bold shrink-0 ${
                      selectedOrder.status !== 'pending'
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    {selectedOrder.status !== 'pending' ? '✓' : '2'}
                  </div>
                  <div>
                    <div
                      className={`font-semibold ${
                        selectedOrder.status !== 'pending' ? 'text-slate-200' : 'text-slate-500'
                      }`}
                    >
                      Driver Assigned & Picked Up
                    </div>
                    <div className="text-[10px] text-slate-500 truncate max-w-[200px]">
                      {selectedOrder.pickupAddress}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center font-bold shrink-0 ${
                      selectedOrder.status === 'in_transit' || selectedOrder.status === 'delivered'
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    {selectedOrder.status === 'delivered' ? '✓' : '3'}
                  </div>
                  <div>
                    <div
                      className={`font-semibold ${
                        selectedOrder.status === 'in_transit' || selectedOrder.status === 'delivered'
                          ? 'text-slate-200'
                          : 'text-slate-500'
                      }`}
                    >
                      In Transit (Live Speedometer GPS)
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Destination: {selectedOrder.dropoffAddress}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center font-bold shrink-0 ${
                      selectedOrder.status === 'delivered'
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    4
                  </div>
                  <div>
                    <div
                      className={`font-semibold ${
                        selectedOrder.status === 'delivered' ? 'text-slate-200' : 'text-slate-500'
                      }`}
                    >
                      Delivered
                    </div>
                    <div className="text-[10px] text-slate-500">Recipient signature confirmation</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Destination & Package Specs */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Delivery Details
              </div>
              <div className="flex items-start gap-2">
                <MapPin className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                <span className="text-slate-300 font-medium">{selectedOrder.dropoffAddress}</span>
              </div>
              <div className="p-2 bg-slate-950 rounded-xl text-slate-400 border border-slate-850">
                Package: <strong className="text-slate-200">{selectedOrder.packageInfo}</strong>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-2xl text-slate-400">
          <Search className="w-8 h-8 mx-auto text-slate-600 mb-2" />
          <p className="text-sm font-semibold">Enter a tracking PIN above to view live car location</p>
        </div>
      )}
    </div>
  );
};
