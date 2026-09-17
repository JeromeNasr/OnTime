import React, { useState } from 'react';
import { Copy, Check, ChevronDown } from 'lucide-react';
import { Driver, Order } from '../types';
import { JBEIL_HUBS } from '../data/jbeilData';
import { StatusChip } from './StatusChip';

interface LeadDriverDispatchViewProps {
  currentDriver: Driver;
  drivers: Driver[];
  orders: Order[];
  onCreateOrder: (orderData: Partial<Order>) => void;
  onAssignOrder: (orderId: string, driverId: string) => void;
  onSelectDriverForMap: (driver: Driver) => void;
}

export const LeadDriverDispatchView: React.FC<LeadDriverDispatchViewProps> = ({
  drivers,
  orders,
  onCreateOrder,
  onAssignOrder,
  onSelectDriverForMap,
}) => {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [pickupHubIndex, setPickupHubIndex] = useState(0);
  const [dropoffHubIndex, setDropoffHubIndex] = useState(2);
  const [packageInfo, setPackageInfo] = useState('');
  const [targetDriverId, setTargetDriverId] = useState<string>('');
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null);

  const activeOrders = orders.filter((o) => {
    const s = o.status.toUpperCase();
    return s !== 'DELIVERED' && s !== 'CANCELLED';
  });

  const handleCreateOrder = (e: React.FormEvent) => {
    e.preventDefault();
    const pickup = JBEIL_HUBS[pickupHubIndex] || JBEIL_HUBS[0];
    const dropoff = JBEIL_HUBS[dropoffHubIndex] || JBEIL_HUBS[1];

    onCreateOrder({
      customerName: customerName.trim() || 'Student / Passenger',
      customerPhone: customerPhone.trim() || '+961 70 000 000',
      pickupAddress: `${pickup.name}, ${pickup.area}`,
      pickupCoords: { lat: pickup.lat, lng: pickup.lng },
      dropoffAddress: `${dropoff.name}, ${dropoff.area}`,
      dropoffCoords: { lat: dropoff.lat, lng: dropoff.lng },
      packageInfo: packageInfo.trim() || 'Campus Shuttle Ride',
      priority: 'normal',
      assignedDriverId: targetDriverId || undefined,
    });

    setCustomerName('');
    setCustomerPhone('');
    setPackageInfo('');
    setTargetDriverId('');
  };

  const copyTrackingLink = (order: Order) => {
    const token = order.trackingToken || order.trackingCode;
    const url = `${window.location.origin}/?tab=customer&track=${encodeURIComponent(token)}`;
    navigator.clipboard.writeText(url);
    setCopiedOrderId(order.id);
    setTimeout(() => setCopiedOrderId(null), 2000);
  };

  return (
    <div className="w-full flex flex-col gap-6 pb-12">
      {/* "New Order" Compact Form at top */}
      <div className="bg-[#13131a] border border-white/[0.06] rounded-xl p-4 sm:p-5">
        <h2 className="text-sm font-bold text-white mb-3">New Order</h2>

        <form onSubmit={handleCreateOrder} className="flex flex-col gap-3">
          {/* Row 1: Customer Name & Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="input-customer-name" className="block text-[11px] text-[#94a3b8] mb-1">
                Customer Name
              </label>
              <input
                id="input-customer-name"
                type="text"
                placeholder="e.g. Samir Al-Khoury"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                required
                className="w-full bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg px-3 py-2 text-xs text-white placeholder-[#4a5568] outline-none transition-colors"
              />
            </div>

            <div>
              <label htmlFor="input-customer-phone" className="block text-[11px] text-[#94a3b8] mb-1">
                Customer Phone
              </label>
              <input
                id="input-customer-phone"
                type="text"
                placeholder="+961 70 123 456"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="w-full bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg px-3 py-2 text-xs text-white placeholder-[#4a5568] outline-none transition-colors"
              />
            </div>
          </div>

          {/* Row 2: Pickup Hub & Dropoff Hub */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="select-pickup-hub" className="block text-[11px] text-[#94a3b8] mb-1">
                Pickup Hub
              </label>
              <div className="relative">
                <select
                  id="select-pickup-hub"
                  value={pickupHubIndex}
                  onChange={(e) => setPickupHubIndex(parseInt(e.target.value, 10))}
                  className="w-full appearance-none bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg pl-3 pr-8 py-2 text-xs text-white outline-none cursor-pointer transition-colors"
                >
                  {JBEIL_HUBS.map((hub, idx) => (
                    <option key={hub.name} value={idx} className="bg-[#13131a] text-white">
                      {hub.name} ({hub.area})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-[#94a3b8] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            <div>
              <label htmlFor="select-dropoff-hub" className="block text-[11px] text-[#94a3b8] mb-1">
                Dropoff Hub
              </label>
              <div className="relative">
                <select
                  id="select-dropoff-hub"
                  value={dropoffHubIndex}
                  onChange={(e) => setDropoffHubIndex(parseInt(e.target.value, 10))}
                  className="w-full appearance-none bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg pl-3 pr-8 py-2 text-xs text-white outline-none cursor-pointer transition-colors"
                >
                  {JBEIL_HUBS.map((hub, idx) => (
                    <option key={hub.name} value={idx} className="bg-[#13131a] text-white">
                      {hub.name} ({hub.area})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-[#94a3b8] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Row 3: Package Info & Optional Initial Assignee + Submit */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end pt-1">
            <div className="sm:col-span-6">
              <label htmlFor="input-package-desc" className="block text-[11px] text-[#94a3b8] mb-1">
                Package Description
              </label>
              <input
                id="input-package-desc"
                type="text"
                placeholder="e.g. Medical Supplies (2kg)"
                value={packageInfo}
                onChange={(e) => setPackageInfo(e.target.value)}
                className="w-full bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg px-3 py-2 text-xs text-white placeholder-[#4a5568] outline-none transition-colors"
              />
            </div>

            <div className="sm:col-span-4">
              <label htmlFor="select-assign-driver" className="block text-[11px] text-[#94a3b8] mb-1">
                Assign Driver (Optional)
              </label>
              <div className="relative">
                <select
                  id="select-assign-driver"
                  value={targetDriverId}
                  onChange={(e) => setTargetDriverId(e.target.value)}
                  className="w-full appearance-none bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg pl-3 pr-8 py-2 text-xs text-white outline-none cursor-pointer transition-colors"
                >
                  <option value="" className="bg-[#13131a] text-[#94a3b8]">
                    Unassigned (Pool)
                  </option>
                  {drivers.map((drv) => (
                    <option key={drv.id} value={drv.id} className="bg-[#13131a] text-white">
                      {drv.name} ({drv.vehicleModel.split(' ')[0]})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-[#94a3b8] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            <div className="sm:col-span-2">
              <button
                type="submit"
                id="btn-dispatch-create-order"
                className="w-full py-2 bg-[#3b82f6] hover:bg-blue-600 text-white text-xs font-medium rounded-lg transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Below Form: Active Orders List */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white">Active Orders</h3>
            <span className="text-xs font-mono text-[#94a3b8] tabular-nums">
              ({activeOrders.length})
            </span>
          </div>
        </div>

        {activeOrders.length === 0 ? (
          <div className="bg-[#13131a] border border-dashed border-white/[0.06] rounded-xl p-8 text-center text-xs text-[#94a3b8]">
            No active orders in dispatch queue. Create a new order above to start delivery.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {activeOrders.map((order) => {
              const assignedDriver = drivers.find((d) => d.id === order.assignedDriverId);
              const isUnassigned = !order.assignedDriverId;

              return (
                <div
                  key={order.id}
                  id={`order-card-${order.id}`}
                  className="bg-[#13131a] border border-white/[0.06] rounded-xl p-4 flex flex-col gap-2.5 hover:border-white/[0.12] transition-colors"
                >
                  {/* Top line: Tracking Code monospace top-left & Status chip right-aligned */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-[#94a3b8]">
                        {order.trackingCode || order.id}
                      </span>
                      <button
                        onClick={() => copyTrackingLink(order)}
                        title="Copy tracking link"
                        className="text-[#4a5568] hover:text-white transition-colors"
                      >
                        {copiedOrderId === order.id ? (
                          <Check className="w-3 h-3 text-[#22c55e]" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>

                    <StatusChip status={order.status} />
                  </div>

                  {/* Customer name bold */}
                  <div className="font-bold text-white text-sm">
                    {order.customerName}
                  </div>

                  {/* Pickup → Dropoff as a one-line with an arrow */}
                  <div className="text-xs text-[#94a3b8] truncate">
                    <span>{order.pickupAddress}</span>
                    <span className="mx-2 text-[#4a5568]">→</span>
                    <span className="text-slate-300">{order.dropoffAddress}</span>
                  </div>

                  {/* Bottom info & Assign action */}
                  <div className="flex items-center justify-between pt-2 border-t border-white/[0.06] text-xs">
                    <div className="text-[#94a3b8]">
                      {assignedDriver ? (
                        <button
                          onClick={() => onSelectDriverForMap(assignedDriver)}
                          className="hover:text-white transition-colors flex items-center gap-1.5"
                        >
                          <span className="text-[#4a5568]">Driver:</span>
                          <span className="text-white font-medium">{assignedDriver.name}</span>
                        </button>
                      ) : (
                        <span className="text-[#f59e0b]">Unassigned</span>
                      )}
                    </div>

                    {isUnassigned ? (
                      <div className="flex items-center gap-2">
                        <select
                          id={`select-driver-order-${order.id}`}
                          onChange={(e) => {
                            if (e.target.value) {
                              onAssignOrder(order.id, e.target.value);
                            }
                          }}
                          defaultValue=""
                          className="bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] text-white text-xs px-2 py-1 rounded-lg outline-none cursor-pointer"
                        >
                          <option value="" disabled>
                            Assign to...
                          </option>
                          {drivers.map((d) => (
                            <option key={d.id} value={d.id} className="bg-[#13131a] text-white">
                              {d.name} ({d.status})
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="text-[11px] text-[#4a5568]">
                        {order.packageInfo}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
