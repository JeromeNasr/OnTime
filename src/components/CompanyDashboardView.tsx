import React, { useState } from 'react';
import {
  Users,
  Car,
  Activity,
  Award,
  Plus,
  Share2,
  Copy,
  Check,
  Shield,
  Clock,
  Gauge,
  MapPin,
  TrendingUp,
} from 'lucide-react';
import { Driver, Order, Network, TripLog } from '../types';
import { MapComponent } from './MapComponent';

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
  tripLogs,
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
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);

  // Performance calculations
  const totalDrivers = drivers.length;
  const activeEnRoute = drivers.filter((d) => d.status === 'busy' || d.currentLocation.speed > 5).length;
  const idleDrivers = drivers.filter((d) => d.status === 'available').length;
  const totalDeliveries = orders.filter((o) => o.status === 'delivered').length;

  const avgFleetSpeed = totalDrivers > 0
    ? Math.round(drivers.reduce((acc, d) => acc + d.currentLocation.speed, 0) / totalDrivers)
    : 0;

  const totalDistanceKm = tripLogs.reduce((acc, t) => acc + t.distanceKm, 0);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(network.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleAddDriverSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDriverName || !newDriverPlate) return;

    onAddDriver({
      name: newDriverName,
      phone: newDriverPhone || '+961 70 000 000',
      vehicleModel: newDriverVehicle || 'Fleet Van',
      plateNumber: newDriverPlate,
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
    <div className="w-full flex flex-col gap-5 pb-12">
      {/* Network Header & Join Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
              Fleet Network Control Center
            </span>
            <span className="bg-slate-800 text-slate-300 text-[10px] font-mono px-2 py-0.5 rounded">
              North Lebanon
            </span>
          </div>
          <h1 className="text-xl font-black text-slate-100">{network.name}</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Managed by <strong className="text-slate-200">{network.ownerName}</strong> • {totalDrivers} connected vehicles
          </p>
        </div>

        {/* Join Code Card & Add Driver Action */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="bg-slate-950 border border-slate-800 px-3.5 py-2 rounded-xl flex items-center gap-2.5">
            <div>
              <span className="text-[9px] uppercase font-bold text-slate-500 block">
                Network Join Code
              </span>
              <span className="text-sm font-black font-mono tracking-wider text-amber-400">
                {network.code}
              </span>
            </div>
            <button
              id="btn-copy-network-code"
              onClick={handleCopyCode}
              title="Copy join code for drivers"
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              {copiedCode ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          <button
            id="btn-open-add-driver-modal"
            onClick={() => setShowAddDriverModal(true)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-600/20 flex items-center gap-1.5 transition-all"
          >
            <Plus className="w-4 h-4" /> Add Driver
          </button>
        </div>
      </div>

      {/* KPI Performance Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold uppercase">Total Fleet</span>
            <Users className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-black font-mono text-slate-100">{totalDrivers}</div>
          <div className="text-[10px] text-slate-500 mt-1">Vehicles registered</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold uppercase">Active En Route</span>
            <Activity className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black font-mono text-emerald-400">{activeEnRoute}</div>
          <div className="text-[10px] text-slate-500 mt-1">{idleDrivers} available / idle</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold uppercase">Fleet Speed</span>
            <Gauge className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black font-mono text-amber-400">
            {avgFleetSpeed} <span className="text-xs font-normal text-slate-500">km/h</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1">Real-time GPS average</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold uppercase">Completed</span>
            <Award className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-black font-mono text-purple-400">{totalDeliveries}</div>
          <div className="text-[10px] text-slate-500 mt-1">Orders delivered</div>
        </div>

        <div className="col-span-2 lg:col-span-1 bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold uppercase">Trip Mileage</span>
            <TrendingUp className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-black font-mono text-cyan-400">
            {totalDistanceKm.toFixed(1)} <span className="text-xs font-normal text-slate-500">km</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1">North Lebanon logged</div>
        </div>
      </div>

      {/* Real-time OpenStreetMap Fleet Radar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Live Fleet Radar (North Lebanon OpenStreetMap)
            </h3>
          </div>
          <span className="text-[11px] text-slate-400">
            Click any car to inspect telemetry and active order
          </span>
        </div>

        <div className="h-[440px] rounded-xl overflow-hidden border border-slate-800 relative">
          <MapComponent
            drivers={drivers}
            selectedDriverId={selectedDriver?.id}
            onSelectDriver={(d) => setSelectedDriver(d)}
            orders={orders}
            height="100%"
          />
        </div>
      </div>

      {/* Driver Performance Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Driver Roster & Telemetry Performance
          </h3>
          <span className="text-[11px] text-slate-500 font-mono">
            {drivers.length} Drivers Active
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase font-bold">
              <tr>
                <th className="p-3">Driver</th>
                <th className="p-3">Vehicle & Plate</th>
                <th className="p-3">Status</th>
                <th className="p-3">Speedometer</th>
                <th className="p-3">Trips & Rating</th>
                <th className="p-3 text-right">Lead Driver</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {drivers.map((driver) => (
                <tr
                  key={driver.id}
                  onClick={() => setSelectedDriver(driver)}
                  className={`hover:bg-slate-850/50 cursor-pointer transition-colors ${
                    selectedDriver?.id === driver.id ? 'bg-slate-800/50' : ''
                  }`}
                >
                  <td className="p-3">
                    <div className="font-bold text-slate-100 flex items-center gap-1.5">
                      {driver.name}
                      {driver.isLeadDriver && (
                        <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[9px] font-bold px-1 rounded">
                          LEAD
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">{driver.phone}</div>
                  </td>

                  <td className="p-3">
                    <div>{driver.vehicleModel}</div>
                    <div className="font-mono text-[11px] text-slate-400">{driver.plateNumber}</div>
                  </td>

                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        driver.status === 'busy'
                          ? 'bg-amber-500/20 text-amber-300'
                          : driver.status === 'available'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      ● {driver.status.toUpperCase()}
                    </span>
                  </td>

                  <td className="p-3 font-mono font-bold">
                    <span
                      className={
                        driver.currentLocation.speed > 5
                          ? 'text-emerald-400'
                          : 'text-slate-500'
                      }
                    >
                      {Math.round(driver.currentLocation.speed)} km/h
                    </span>
                  </td>

                  <td className="p-3">
                    <div>{driver.totalTrips} Completed</div>
                    <div className="text-amber-400 font-bold text-[11px]">★ {driver.rating}</div>
                  </td>

                  <td className="p-3 text-right">
                    {driver.isLeadDriver ? (
                      <span className="text-amber-400 font-bold text-[11px] flex items-center justify-end gap-1">
                        <Shield className="w-3.5 h-3.5" /> Dispatcher
                      </span>
                    ) : (
                      <button
                        id={`btn-set-lead-${driver.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSetLeadDriver(driver.id);
                        }}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold rounded-lg transition-colors"
                      >
                        Make Lead
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Driver Modal */}
      {showAddDriverModal && (
        <div className="fixed inset-0 z-[1000] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Car className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-slate-100">Add Driver to Fleet</h3>
              </div>
              <button
                id="btn-close-add-driver-modal"
                onClick={() => setShowAddDriverModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddDriverSubmit} className="space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Driver Full Name
                </label>
                <input
                  type="text"
                  required
                  value={newDriverName}
                  onChange={(e) => setNewDriverName(e.target.value)}
                  placeholder="e.g. Fadi Nabbout"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Phone Number
                </label>
                <input
                  type="text"
                  required
                  value={newDriverPhone}
                  onChange={(e) => setNewDriverPhone(e.target.value)}
                  placeholder="+961 70 888 999"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Vehicle Model
                  </label>
                  <input
                    type="text"
                    value={newDriverVehicle}
                    onChange={(e) => setNewDriverVehicle(e.target.value)}
                    placeholder="e.g. Toyota Yaris"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Plate Number
                  </label>
                  <input
                    type="text"
                    required
                    value={newDriverPlate}
                    onChange={(e) => setNewDriverPlate(e.target.value)}
                    placeholder="e.g. T-92140"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="chk-lead-driver"
                  checked={isLeadDriverCheck}
                  onChange={(e) => setIsLeadDriverCheck(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-800 text-emerald-500"
                />
                <label htmlFor="chk-lead-driver" className="text-xs text-slate-300 cursor-pointer">
                  Designate as Main Lead Driver (Order Dispatcher phone)
                </label>
              </div>

              <div className="pt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddDriverModal(false)}
                  className="w-1/2 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-1/2 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-600/20"
                >
                  Confirm &amp; Register
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
