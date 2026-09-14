import React, { useState } from 'react';
import {
  PlusCircle,
  Send,
  UserCheck,
  Package,
  MapPin,
  Clock,
  Phone,
  Radio,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { Driver, Order } from '../types';
import { NORTH_LEBANON_HUBS } from '../data/northLebanonData';

interface LeadDriverDispatchViewProps {
  currentDriver: Driver;
  drivers: Driver[];
  orders: Order[];
  onCreateOrder: (orderData: Partial<Order>) => void;
  onAssignOrder: (orderId: string, driverId: string) => void;
  onSelectDriverForMap: (driver: Driver) => void;
}

export const LeadDriverDispatchView: React.FC<LeadDriverDispatchViewProps> = ({
  currentDriver,
  drivers,
  orders,
  onCreateOrder,
  onAssignOrder,
  onSelectDriverForMap,
}) => {
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [pickupHubIndex, setPickupHubIndex] = useState(0);
  const [dropoffHubIndex, setDropoffHubIndex] = useState(2);
  const [packageInfo, setPackageInfo] = useState('');
  const [targetDriverId, setTargetDriverId] = useState<string>('');

  const activeOrders = orders.filter((o) => o.status !== 'delivered' && o.status !== 'cancelled');
  const completedOrders = orders.filter((o) => o.status === 'delivered');

  const handleCreateOrder = (e: React.FormEvent) => {
    e.preventDefault();
    const pickup = NORTH_LEBANON_HUBS[pickupHubIndex];
    const dropoff = NORTH_LEBANON_HUBS[dropoffHubIndex];

    onCreateOrder({
      customerName: customerName || 'Valued Customer',
      customerPhone: customerPhone || '+961 70 000 000',
      pickupAddress: `${pickup.name}, ${pickup.area}`,
      pickupCoords: { lat: pickup.lat, lng: pickup.lng },
      dropoffAddress: `${dropoff.name}, ${dropoff.area}`,
      dropoffCoords: { lat: dropoff.lat, lng: dropoff.lng },
      packageInfo: packageInfo || 'General Delivery Package',
      assignedDriverId: targetDriverId || undefined,
    });

    // Reset form
    setCustomerName('');
    setCustomerPhone('');
    setPackageInfo('');
    setTargetDriverId('');
    setShowNewOrderModal(false);
  };

  return (
    <div className="w-full flex flex-col gap-5 pb-12">
      {/* Lead Driver Authority Banner */}
      <div className="bg-gradient-to-r from-amber-950/80 via-slate-900 to-slate-900 border border-amber-600/40 rounded-2xl p-4 shadow-xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                Main Lead Driver Dispatch Console
              </span>
              <span className="bg-amber-500 text-slate-950 text-[10px] font-black px-1.5 py-0.2 rounded">
                DISPATCHER
              </span>
            </div>
            <h2 className="text-base font-bold text-slate-100">
              {currentDriver.name} • Network [{currentDriver.networkCode}]
            </h2>
            <p className="text-xs text-slate-400">
              Assign dispatch orders to drivers in your North Lebanon fleet in real-time.
            </p>
          </div>
        </div>

        <button
          id="btn-open-create-order"
          onClick={() => setShowNewOrderModal(true)}
          className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-amber-500/20 flex items-center gap-2 transition-all shrink-0"
        >
          <PlusCircle className="w-4 h-4" /> Create & Assign Order
        </button>
      </div>

      {/* Fleet Live Radar Roster */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Fleet Drivers on Patrol ({drivers.length})
            </h3>
          </div>
          <span className="text-[11px] text-slate-500">
            Click driver to focus on OpenStreetMap
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {drivers.map((drv) => {
            const isSelf = drv.id === currentDriver.id;
            return (
              <div
                key={drv.id}
                onClick={() => onSelectDriverForMap(drv)}
                className={`p-3 rounded-xl border transition-all cursor-pointer ${
                  isSelf
                    ? 'bg-amber-950/20 border-amber-600/40 hover:border-amber-500'
                    : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-sm text-slate-200">
                      {drv.name} {drv.isLeadDriver ? '⭐' : ''}
                    </span>
                    {isSelf && (
                      <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1 rounded font-bold">
                        YOU
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      drv.status === 'busy'
                        ? 'bg-amber-500/20 text-amber-300'
                        : drv.status === 'available'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    ● {drv.status.toUpperCase()}
                  </span>
                </div>

                <div className="text-xs text-slate-400">
                  {drv.vehicleModel} • <span className="font-mono text-slate-300">{drv.plateNumber}</span>
                </div>

                <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1 text-slate-400">
                    <span className="text-[10px] text-slate-500">SPEED:</span>
                    <span className="font-mono font-bold text-emerald-400">
                      {Math.round(drv.currentLocation.speed)} km/h
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Trips: <span className="font-bold text-slate-200">{drv.totalTrips}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Orders Grid: Pending & In-Transit */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Active Orders & Assignments ({activeOrders.length})
            </h3>
          </div>
          <span className="text-[11px] text-slate-400">
            Completed today: <span className="text-emerald-400 font-bold">{completedOrders.length}</span>
          </span>
        </div>

        {activeOrders.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-slate-800 rounded-xl text-slate-500">
            <p className="text-sm font-medium">No pending or in-transit orders</p>
            <p className="text-xs text-slate-600 mt-1">
              Click &quot;Create &amp; Assign Order&quot; above to dispatch new deliveries across North Lebanon.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeOrders.map((order) => {
              const assignedDriver = drivers.find((d) => d.id === order.assignedDriverId);
              return (
                <div
                  key={order.id}
                  className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-amber-400">
                          {order.id}
                        </span>
                        <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded font-mono">
                          PIN: {order.trackingCode}
                        </span>
                      </div>
                      <span
                        className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                          order.status === 'in_transit'
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            : order.status === 'picked_up'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {order.status.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <div className="flex items-start gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span className="text-slate-300 font-medium truncate">{order.pickupAddress}</span>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                        <span className="text-slate-300 font-medium truncate">{order.dropoffAddress}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-2 pt-1">
                        <span>Customer: <strong className="text-slate-200">{order.customerName}</strong></span>
                        <span>•</span>
                        <span>{order.packageInfo}</span>
                      </div>
                    </div>
                  </div>

                  {/* Assign to driver dropdown */}
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-slate-400">
                      <UserCheck className="w-3.5 h-3.5 text-blue-400" />
                      <span>Assigned to:</span>
                    </div>

                    <select
                      id={`select-assign-${order.id}`}
                      value={order.assignedDriverId || ''}
                      onChange={(e) => onAssignOrder(order.id, e.target.value)}
                      className="bg-slate-900 border border-slate-700 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg outline-none max-w-[200px]"
                    >
                      <option value="">-- Unassigned --</option>
                      {drivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} {d.isLeadDriver ? '(Lead)' : ''} ({d.status})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New Order Modal */}
      {showNewOrderModal && (
        <div className="fixed inset-0 z-[1000] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-slate-100">
                  Dispatch New Delivery Order
                </h3>
              </div>
              <button
                id="btn-close-new-order-modal"
                onClick={() => setShowNewOrderModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateOrder} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Customer Name
                  </label>
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="e.g. Salim Karam"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Customer Phone
                  </label>
                  <input
                    type="text"
                    required
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="+961 70 123 456"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {/* North Lebanon Pickup Hub */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  North Lebanon Pickup Hub
                </label>
                <select
                  value={pickupHubIndex}
                  onChange={(e) => setPickupHubIndex(parseInt(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                >
                  {NORTH_LEBANON_HUBS.map((hub, idx) => (
                    <option key={hub.name} value={idx}>
                      {hub.name} ({hub.area})
                    </option>
                  ))}
                </select>
              </div>

              {/* North Lebanon Dropoff Hub */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  North Lebanon Drop-off Destination
                </label>
                <select
                  value={dropoffHubIndex}
                  onChange={(e) => setDropoffHubIndex(parseInt(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                >
                  {NORTH_LEBANON_HUBS.map((hub, idx) => (
                    <option key={hub.name} value={idx}>
                      {hub.name} ({hub.area})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Package Details
                </label>
                <input
                  type="text"
                  value={packageInfo}
                  onChange={(e) => setPackageInfo(e.target.value)}
                  placeholder="e.g. 2x boxes of electronics, Fragile"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Assign Immediately to Driver (Optional)
                </label>
                <select
                  value={targetDriverId}
                  onChange={(e) => setTargetDriverId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                >
                  <option value="">Leave Unassigned (Queue)</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.isLeadDriver ? '(Lead)' : ''} - {d.status.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewOrderModal(false)}
                  className="w-1/2 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-1/2 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black rounded-xl shadow-lg shadow-amber-500/20 flex items-center justify-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> Dispatch Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
