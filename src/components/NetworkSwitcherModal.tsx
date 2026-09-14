import React, { useState } from 'react';
import { Shield, Plus, Key, Car, Users, Check, X, Building2 } from 'lucide-react';
import { Network, Driver } from '../types';

interface NetworkSwitcherModalProps {
  currentNetwork: Network;
  availableNetworks: Network[];
  drivers: Driver[];
  currentDriver: Driver;
  onSelectNetwork: (networkCode: string) => void;
  onCreateNetwork: (name: string, ownerName: string) => void;
  onJoinNetwork: (data: {
    networkCode: string;
    driverName: string;
    phone: string;
    vehicleModel: string;
    plateNumber: string;
    isLeadDriver: boolean;
  }) => void;
  onSelectDriver: (driverId: string) => void;
  onClose: () => void;
}

export const NetworkSwitcherModal: React.FC<NetworkSwitcherModalProps> = ({
  currentNetwork,
  availableNetworks,
  drivers,
  currentDriver,
  onSelectNetwork,
  onCreateNetwork,
  onJoinNetwork,
  onSelectDriver,
  onClose,
}) => {
  const [tab, setTab] = useState<'switch' | 'create' | 'join'>('switch');

  // Create form state
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newOwnerName, setNewOwnerName] = useState('');

  // Join form state
  const [joinCode, setJoinCode] = useState('');
  const [joinDriverName, setJoinDriverName] = useState('');
  const [joinPhone, setJoinPhone] = useState('');
  const [joinVehicle, setJoinVehicle] = useState('');
  const [joinPlate, setJoinPlate] = useState('');
  const [joinAsLead, setJoinAsLead] = useState(false);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyName.trim() || !newOwnerName.trim()) return;
    onCreateNetwork(newCompanyName.trim(), newOwnerName.trim());
    setNewCompanyName('');
    setNewOwnerName('');
    setTab('switch');
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim() || !joinDriverName.trim() || !joinPlate.trim()) return;

    onJoinNetwork({
      networkCode: joinCode.trim().toUpperCase(),
      driverName: joinDriverName.trim(),
      phone: joinPhone.trim() || '+961 70 000 000',
      vehicleModel: joinVehicle.trim() || 'Fleet Car',
      plateNumber: joinPlate.trim(),
      isLeadDriver: joinAsLead,
    });

    setJoinCode('');
    setJoinDriverName('');
    setJoinPhone('');
    setJoinVehicle('');
    setJoinPlate('');
    setJoinAsLead(false);
    setTab('switch');
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">Fleet Network Management</h2>
              <p className="text-xs text-slate-400">
                Create a company network or join your car with an invite code.
              </p>
            </div>
          </div>
          <button
            id="btn-close-network-modal"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Controls */}
        <div className="flex border-b border-slate-800 bg-slate-950/50 p-1.5 gap-1 text-xs font-semibold">
          <button
            id="tab-btn-switch-network"
            onClick={() => setTab('switch')}
            className={`flex-1 py-2 rounded-xl transition-all ${
              tab === 'switch'
                ? 'bg-slate-800 text-slate-100 shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Active Networks
          </button>
          <button
            id="tab-btn-join-network"
            onClick={() => setTab('join')}
            className={`flex-1 py-2 rounded-xl transition-all ${
              tab === 'join'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            + Join with Code
          </button>
          <button
            id="tab-btn-create-network"
            onClick={() => setTab('create')}
            className={`flex-1 py-2 rounded-xl transition-all ${
              tab === 'create'
                ? 'bg-amber-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Create Network
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-5 max-h-[480px] overflow-y-auto">
          {tab === 'switch' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2">
                  Connected Fleet Networks
                </label>
                <div className="space-y-2">
                  {availableNetworks.map((net) => (
                    <div
                      key={net.code}
                      onClick={() => onSelectNetwork(net.code)}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                        net.code === currentNetwork.code
                          ? 'bg-amber-950/30 border-amber-500/50 shadow'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div>
                        <div className="font-bold text-sm text-slate-100">{net.name}</div>
                        <div className="text-xs text-slate-400">
                          Owner: {net.ownerName} • Code:{' '}
                          <span className="font-mono text-amber-400 font-bold">{net.code}</span>
                        </div>
                      </div>
                      {net.code === currentNetwork.code && (
                        <span className="text-[10px] bg-amber-500 text-slate-950 font-black px-2 py-0.5 rounded-full">
                          ACTIVE
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Driver Phone Persona Switcher for testing */}
              <div className="pt-3 border-t border-slate-800">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2">
                  Switch Active Driver Phone on this Device
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {drivers.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => onSelectDriver(d.id)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        d.id === currentDriver.id
                          ? 'bg-emerald-950/40 border-emerald-500/60'
                          : 'bg-slate-950 border-slate-850 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs text-slate-200 flex items-center justify-between">
                        <span>{d.name.split(' ')[0]}</span>
                        {d.isLeadDriver && (
                          <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1 rounded">
                            LEAD
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {d.plateNumber} ({d.status})
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'join' && (
            <form onSubmit={handleJoinSubmit} className="space-y-3.5">
              <div className="p-3 bg-blue-950/40 border border-blue-800/60 rounded-xl text-xs text-blue-300">
                Enter your company&apos;s Network Join Code to connect this phone and car to their live map radar.
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Network Join Code
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. NORTH-77 or CEDAR-24"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-amber-400 font-mono font-bold tracking-wider uppercase outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Your Full Name (Driver)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Marwan Tannous"
                  value={joinDriverName}
                  onChange={(e) => setJoinDriverName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Phone Number
                </label>
                <input
                  type="text"
                  placeholder="+961 70 123 456"
                  value={joinPhone}
                  onChange={(e) => setJoinPhone(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Vehicle Model
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Honda Civic"
                    value={joinVehicle}
                    onChange={(e) => setJoinVehicle(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Plate Number
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. T-55123"
                    value={joinPlate}
                    onChange={(e) => setJoinPlate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="chk-join-as-lead"
                  checked={joinAsLead}
                  onChange={(e) => setJoinAsLead(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-800 text-blue-500"
                />
                <label htmlFor="chk-join-as-lead" className="text-xs text-slate-300 cursor-pointer">
                  Act as Main Lead Driver for this company
                </label>
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-600/20 mt-3"
              >
                Join Fleet &amp; Connect Car
              </button>
            </form>
          )}

          {tab === 'create' && (
            <form onSubmit={handleCreateSubmit} className="space-y-3.5">
              <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-xl text-xs text-amber-300">
                Launch your own courier, taxi, or delivery fleet network in North Lebanon. A unique invite code will be generated for drivers to connect.
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Fleet / Company Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Tripoli Express Delivery"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Company Owner / Manager Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ziad Al-Rifai"
                  value={newOwnerName}
                  onChange={(e) => setNewOwnerName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 mt-3"
              >
                Create Fleet Network &amp; Generate Code
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
