import React, { useState } from 'react';
import { Copy, Check, Plus, UserPlus } from 'lucide-react';
import { Driver, Order, Network, TripLog } from '../types';
import { StatusChip } from './StatusChip';

interface CompanyDashboardViewProps {
  network: Network;
  drivers: Driver[];
  orders: Order[];
  tripLogs: TripLog[];
  onAddDriver: (driverData: Partial<Driver>) => void;
  onSetLeadDriver: (driverId: string) => void;
}

export const CompanyDashboardView: React.FC<CompanyDashboardViewProps> = ({
  network,
  drivers,
  orders,
  onAddDriver,
  onSetLeadDriver,
}) => {
  const [showAddDriverModal, setShowAddDriverModal] = useState(false);
  const [newDriverName, setNewDriverName] = useState('');
  const [newDriverPhone, setNewDriverPhone] = useState('');
  const [newDriverVehicle, setNewDriverVehicle] = useState('');
  const [newDriverPlate, setNewDriverPlate] = useState('');
  const [isLeadDriverCheck, setIsLeadDriverCheck] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Real calculated performance metrics
  const totalDrivers = drivers.length;
  const activeNow = drivers.filter(
    (d) =>
      d.status === 'AVAILABLE' ||
      d.status === 'available' ||
      d.status === 'ASSIGNED' ||
      d.status === 'EN_ROUTE_PICKUP' ||
      d.status === 'AT_PICKUP' ||
      d.status === 'IN_TRANSIT' ||
      d.status === 'busy' ||
      d.status === 'EN_ROUTE_DELIVERY' ||
      (d.currentLocation && d.currentLocation.speed > 0)
  ).length;

  const activeTrips = orders.filter(
    (o) => o.status !== 'DELIVERED' && o.status !== 'CANCELLED' && o.status !== 'COMPLETED'
  );
  const activeTripsCount = activeTrips.length;

  // Real ETA calculation across active trips
  const activeWithEta = activeTrips.filter(
    (o) => (o.estimatedMinutes && o.estimatedMinutes > 0) || (o.liveEtaMinutes && o.liveEtaMinutes > 0)
  );
  const avgEtaMinutes =
    activeWithEta.length > 0
      ? Math.round(
          activeWithEta.reduce(
            (acc, o) => acc + (o.liveEtaMinutes || o.estimatedMinutes || 0),
            0
          ) / activeWithEta.length
        )
      : null;

  // Format relative time helper
  const getTimeAgo = (timestamp?: number) => {
    if (!timestamp) return 'Just now';
    const diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    return `${diffHr}h ago`;
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(network.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleAddDriverSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDriverName.trim() || !newDriverPlate.trim()) return;

    onAddDriver({
      name: newDriverName.trim(),
      phone: newDriverPhone.trim() || '+961 70 000 000',
      vehicleModel: newDriverVehicle.trim() || 'Fleet Van',
      plateNumber: newDriverPlate.trim(),
      isLeadDriver: isLeadDriverCheck,
      networkCode: network.code,
    });

    setNewDriverName('');
    setNewDriverPhone('');
    setNewDriverVehicle('');
    setNewDriverPlate('');
    setIsLeadDriverCheck(false);
    setShowAddDriverModal(false);
  };

  return (
    <div className="w-full flex flex-col gap-6 pb-12">
      {/* Network Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#13131a] border border-white/[0.06] rounded-xl p-5">
        <div>
          <div className="text-xs text-[#94a3b8]">Fleet Network</div>
          <h1 className="text-lg font-bold text-white mt-0.5">{network.name}</h1>
          <p className="text-xs text-[#4a5568] mt-0.5">
            Owner: {network.ownerName}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Join Code Display */}
          <div className="flex items-center gap-2 bg-[#0a0a0f] border border-white/[0.06] px-3 py-1.5 rounded-lg">
            <span className="text-[11px] text-[#4a5568]">Join Code:</span>
            <span className="font-mono text-xs font-bold text-white tracking-wider">
              {network.code}
            </span>
            <button
              id="btn-copy-network-code"
              onClick={handleCopyCode}
              title="Copy code"
              className="text-[#94a3b8] hover:text-white transition-colors"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5 text-[#22c55e]" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          <button
            id="btn-open-add-driver-modal"
            onClick={() => setShowAddDriverModal(true)}
            className="px-3 py-1.5 bg-[#3b82f6] hover:bg-blue-600 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Driver</span>
          </button>
        </div>
      </div>

      {/* Summary Stat Row at Top (4 Cards with 100% Real Calculated Metrics) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[#13131a] border border-white/[0.06] rounded-xl p-4">
          <div className="text-xs text-[#94a3b8]">Total Drivers</div>
          <div className="text-2xl font-bold text-white mt-1 tabular-nums">{totalDrivers}</div>
        </div>

        <div className="bg-[#13131a] border border-white/[0.06] rounded-xl p-4">
          <div className="text-xs text-[#94a3b8]">Active Drivers</div>
          <div className="text-2xl font-bold text-white mt-1 tabular-nums">{activeNow}</div>
        </div>

        <div className="bg-[#13131a] border border-white/[0.06] rounded-xl p-4">
          <div className="text-xs text-[#94a3b8]">Active Dorm Trips</div>
          <div className="text-2xl font-bold text-white mt-1 tabular-nums">{activeTripsCount}</div>
        </div>

        <div className="bg-[#13131a] border border-white/[0.06] rounded-xl p-4">
          <div className="text-xs text-[#94a3b8]">Avg Road ETA</div>
          <div className="text-2xl font-bold text-white mt-1 tabular-nums">
            {avgEtaMinutes !== null ? `${avgEtaMinutes} min` : '—'}
          </div>
        </div>
      </div>

      {/* Two Columns: Left = Driver List, Right = Recent Trips List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left Column: Driver List */}
        <div className="bg-[#13131a] border border-white/[0.06] rounded-xl p-4 sm:p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white">Fleet Drivers</h2>
            <span className="text-xs text-[#4a5568] tabular-nums font-mono">
              {drivers.length} registered
            </span>
          </div>

          <div className="flex flex-col gap-2 max-h-[460px] overflow-y-auto pr-1">
            {drivers.map((driver) => {
              const isAvailable =
                driver.status === 'AVAILABLE' || driver.status === 'available';
              const isBusy =
                driver.status === 'busy' ||
                driver.status === 'EN_ROUTE_DELIVERY' ||
                driver.status === 'EN_ROUTE_PICKUP' ||
                driver.status === 'IN_TRANSIT';

              return (
                <div
                  key={driver.id}
                  className="bg-[#0a0a0f] border border-white/[0.06] rounded-lg p-3 flex items-center justify-between gap-3 hover:border-white/[0.12] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Avatar Initial Circle */}
                    <div className="w-8 h-8 rounded-full bg-[#1e1e28] border border-white/[0.08] flex items-center justify-center text-xs font-bold text-white shrink-0">
                      {driver.name.charAt(0)}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-white truncate">
                          {driver.name}
                        </span>
                        {/* Status Dot */}
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            isAvailable
                              ? 'bg-[#22c55e]'
                              : isBusy
                              ? 'bg-[#f59e0b]'
                              : 'bg-[#ef4444]'
                          }`}
                          title={driver.status}
                        />
                        {driver.isLeadDriver && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-white/10 text-white font-medium">
                            Lead
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#94a3b8] truncate mt-0.5">
                        {driver.vehicleModel} •{' '}
                        <span className="font-mono text-[#4a5568]">
                          {driver.plateNumber}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-[11px] text-[#4a5568]">
                      {getTimeAgo(driver.currentLocation.timestamp)}
                    </div>
                    {!driver.isLeadDriver && (
                      <button
                        onClick={() => onSetLeadDriver(driver.id)}
                        className="text-[10px] text-[#3b82f6] hover:underline mt-0.5 cursor-pointer"
                      >
                        Make Lead
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Recent Dorm Trips List */}
        <div className="bg-[#13131a] border border-white/[0.06] rounded-xl p-4 sm:p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white">Dorm Shuttle Trips</h2>
            <span className="text-xs text-[#4a5568] tabular-nums font-mono">
              {orders.length} total
            </span>
          </div>

          <div className="flex flex-col gap-2 max-h-[460px] overflow-y-auto pr-1">
            {orders.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#4a5568]">
                No shuttle trips created yet.
              </div>
            ) : (
              orders.map((order) => {
                const assigned = drivers.find((d) => d.id === order.assignedDriverId);
                const trackingLink = `${window.location.origin}/?track=${order.trackingCode || order.id}`;

                return (
                  <div
                    key={order.id}
                    className="bg-[#0a0a0f] border border-white/[0.06] rounded-lg p-3 flex items-center justify-between gap-3 hover:border-white/[0.12] transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-[#94a3b8]">
                          {order.trackingCode || order.id.slice(-6)}
                        </span>
                        <span className="text-xs font-medium text-white truncate">
                          {order.studentName || order.customerName}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#4a5568] truncate mt-0.5">
                        {order.pickupAddress} → {order.dropoffAddress}
                      </div>
                      <div className="text-[10px] text-[#94a3b8] mt-0.5">
                        Taxi: {assigned ? `${assigned.name} (${assigned.vehicleModel})` : 'Unassigned'}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <StatusChip status={order.status} />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(trackingLink);
                        }}
                        title="Copy student tracking link"
                        className="text-[10px] text-[#3b82f6] hover:text-blue-400 flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copy Link</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Add Driver Modal */}
      {showAddDriverModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#13131a] border border-white/[0.08] rounded-xl w-full max-w-[440px] p-5 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-[#3b82f6]" /> Add Fleet Driver
              </h3>
              <button
                onClick={() => setShowAddDriverModal(false)}
                className="text-[#94a3b8] hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddDriverSubmit} className="flex flex-col gap-3">
              <div>
                <label className="block text-[11px] text-[#94a3b8] mb-1">Full Name</label>
                <input
                  type="text"
                  placeholder="e.g. Walid Mansour"
                  value={newDriverName}
                  onChange={(e) => setNewDriverName(e.target.value)}
                  required
                  className="w-full bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg px-3 py-2 text-xs text-white outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] text-[#94a3b8] mb-1">Phone Number</label>
                <input
                  type="text"
                  placeholder="+961 70 888 999"
                  value={newDriverPhone}
                  onChange={(e) => setNewDriverPhone(e.target.value)}
                  className="w-full bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg px-3 py-2 text-xs text-white outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-[#94a3b8] mb-1">Vehicle Model</label>
                  <input
                    type="text"
                    placeholder="e.g. Renault Kangoo"
                    value={newDriverVehicle}
                    onChange={(e) => setNewDriverVehicle(e.target.value)}
                    className="w-full bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg px-3 py-2 text-xs text-white outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#94a3b8] mb-1">Plate Number</label>
                  <input
                    type="text"
                    placeholder="T-12345"
                    value={newDriverPlate}
                    onChange={(e) => setNewDriverPlate(e.target.value)}
                    required
                    className="w-full bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg px-3 py-2 text-xs text-white outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="lead-check"
                  checked={isLeadDriverCheck}
                  onChange={(e) => setIsLeadDriverCheck(e.target.checked)}
                  className="accent-[#3b82f6] rounded"
                />
                <label htmlFor="lead-check" className="text-xs text-[#94a3b8]">
                  Grant Lead Driver dispatch authority
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setShowAddDriverModal(false)}
                  className="px-3 py-1.5 text-xs text-[#94a3b8] hover:text-white rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#3b82f6] hover:bg-blue-600 text-white text-xs font-medium rounded-lg"
                >
                  Add Driver
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
