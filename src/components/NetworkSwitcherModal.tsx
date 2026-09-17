import React, { useState } from 'react';
import { X, Check } from 'lucide-react';
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
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-[#13131a] border border-white/[0.08] rounded-xl w-full max-w-[480px] p-5 shadow-2xl flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
          <div>
            <h2 className="text-sm font-bold text-white">Fleet Network</h2>
            <p className="text-xs text-[#94a3b8] mt-0.5">Switch network or join with an invite code</p>
          </div>
          <button
            id="btn-close-network-modal"
            onClick={onClose}
            className="text-[#94a3b8] hover:text-white p-1 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex bg-[#0a0a0f] p-1 rounded-lg border border-white/[0.06]">
          <button
            onClick={() => setTab('switch')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
              tab === 'switch' ? 'bg-[#1e1e28] text-white shadow-xs' : 'text-[#94a3b8] hover:text-white'
            }`}
          >
            Networks ({availableNetworks.length})
          </button>
          <button
            onClick={() => setTab('join')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
              tab === 'join' ? 'bg-[#1e1e28] text-white shadow-xs' : 'text-[#94a3b8] hover:text-white'
            }`}
          >
            Join Fleet
          </button>
          <button
            onClick={() => setTab('create')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
              tab === 'create' ? 'bg-[#1e1e28] text-white shadow-xs' : 'text-[#94a3b8] hover:text-white'
            }`}
          >
            New Company
          </button>
        </div>

        {/* Tab 1: Switch Network */}
        {tab === 'switch' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
              {availableNetworks.map((net) => {
                const isSelected = net.code === currentNetwork.code;
                return (
                  <div
                    key={net.code}
                    onClick={() => onSelectNetwork(net.code)}
                    className={`p-3 rounded-lg border cursor-pointer transition-all flex items-center justify-between ${
                      isSelected
                        ? 'bg-[#1e1e28] border-[#3b82f6]'
                        : 'bg-[#0a0a0f] border-white/[0.06] hover:border-white/[0.15]'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white">{net.name}</span>
                        {isSelected && <span className="text-[10px] text-[#3b82f6]">Active</span>}
                      </div>
                      <div className="text-[11px] text-[#4a5568]">
                        Owner: {net.ownerName} • Code: <span className="font-mono text-white">{net.code}</span>
                      </div>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-[#3b82f6]" />}
                  </div>
                );
              })}
            </div>

            {/* Switch driver profile within network */}
            <div className="pt-3 border-t border-white/[0.06]">
              <label className="block text-[11px] text-[#94a3b8] mb-1.5">
                Active Driver Profile:
              </label>
              <select
                value={currentDriver.id}
                onChange={(e) => onSelectDriver(e.target.value)}
                className="w-full bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg px-3 py-2 text-xs text-white outline-none cursor-pointer"
              >
                {drivers.map((drv) => (
                  <option key={drv.id} value={drv.id} className="bg-[#13131a] text-white">
                    {drv.name} ({drv.vehicleModel}) {drv.isLeadDriver ? '• Lead' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Tab 2: Join Existing Fleet */}
        {tab === 'join' && (
          <form onSubmit={handleJoinSubmit} className="flex flex-col gap-3">
            <div>
              <label className="block text-[11px] text-[#94a3b8] mb-1">Company Join Code</label>
              <input
                type="text"
                placeholder="e.g. JBEIL-CAMPUS"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                required
                className="w-full bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg px-3 py-2 text-xs text-white font-mono uppercase outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-[#94a3b8] mb-1">Your Name</label>
                <input
                  type="text"
                  placeholder="e.g. Nader Chami"
                  value={joinDriverName}
                  onChange={(e) => setJoinDriverName(e.target.value)}
                  required
                  className="w-full bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg px-3 py-2 text-xs text-white outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#94a3b8] mb-1">Phone</label>
                <input
                  type="text"
                  placeholder="+961 71 234 567"
                  value={joinPhone}
                  onChange={(e) => setJoinPhone(e.target.value)}
                  className="w-full bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg px-3 py-2 text-xs text-white outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-[#94a3b8] mb-1">Vehicle</label>
                <input
                  type="text"
                  placeholder="e.g. Dacia Duster"
                  value={joinVehicle}
                  onChange={(e) => setJoinVehicle(e.target.value)}
                  className="w-full bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg px-3 py-2 text-xs text-white outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#94a3b8] mb-1">Plate Number</label>
                <input
                  type="text"
                  placeholder="B-99881"
                  value={joinPlate}
                  onChange={(e) => setJoinPlate(e.target.value)}
                  required
                  className="w-full bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg px-3 py-2 text-xs text-white outline-none"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="join-lead-check"
                checked={joinAsLead}
                onChange={(e) => setJoinAsLead(e.target.checked)}
                className="accent-[#3b82f6]"
              />
              <label htmlFor="join-lead-check" className="text-xs text-[#94a3b8]">
                Join as Lead Driver / Dispatcher
              </label>
            </div>

            <div className="pt-2 border-t border-white/[0.06]">
              <button
                type="submit"
                className="w-full py-2 bg-[#3b82f6] hover:bg-blue-600 text-white text-xs font-medium rounded-lg transition-colors"
              >
                Join Fleet
              </button>
            </div>
          </form>
        )}

        {/* Tab 3: Create Company */}
        {tab === 'create' && (
          <form onSubmit={handleCreateSubmit} className="flex flex-col gap-3">
            <div>
              <label className="block text-[11px] text-[#94a3b8] mb-1">Company / Fleet Name</label>
              <input
                type="text"
                placeholder="e.g. Byblos Student Shuttle"
                value={newCompanyName}
                onChange={(e) => setNewCompanyName(e.target.value)}
                required
                className="w-full bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg px-3 py-2 text-xs text-white outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#94a3b8] mb-1">Manager / Owner Name</label>
              <input
                type="text"
                placeholder="e.g. Fadi Kassir"
                value={newOwnerName}
                onChange={(e) => setNewOwnerName(e.target.value)}
                required
                className="w-full bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg px-3 py-2 text-xs text-white outline-none"
              />
            </div>

            <div className="pt-2 border-t border-white/[0.06]">
              <button
                type="submit"
                className="w-full py-2 bg-[#3b82f6] hover:bg-blue-600 text-white text-xs font-medium rounded-lg transition-colors"
              >
                Create Company & Generate Code
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
