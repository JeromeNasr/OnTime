import React, { useState } from 'react';
import { Copy, Check, ChevronDown, Users, Shield, Radio, KeyRound } from 'lucide-react';
import { Driver, Trip, Network } from '../types';
import { JBEIL_HUBS } from '../data/jbeilData';
import { StatusChip } from './StatusChip';

interface LeadDriverDispatchViewProps {
  currentDriver: Driver;
  drivers: Driver[];
  trips: Trip[];
  network?: Network;
  onCreateTrip: (tripData: Partial<Trip>) => void;
  onAssignTrip: (tripId: string, driverId: string) => void;
  onSelectDriverForMap: (driver: Driver) => void;
}

export const LeadDriverDispatchView: React.FC<LeadDriverDispatchViewProps> = ({
  currentDriver,
  drivers,
  trips,
  network,
  onCreateTrip,
  onAssignTrip,
  onSelectDriverForMap,
}) => {
  const [studentName, setStudentName] = useState('');
  const [studentPhone, setStudentPhone] = useState('');
  const [pickupHubIndex, setPickupHubIndex] = useState(0);
  const [dropoffHubIndex, setDropoffHubIndex] = useState(2);
  const [notes, setNotes] = useState('');
  const [targetDriverId, setTargetDriverId] = useState<string>('');
  const [copiedTripId, setCopiedTripId] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const activeTrips = trips.filter((t) => {
    const s = t.status.toUpperCase();
    return s !== 'COMPLETED' && s !== 'CANCELLED';
  });

  const handleCopyCode = () => {
    if (!network?.code) return;
    navigator.clipboard.writeText(network.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCreateTrip = (e: React.FormEvent) => {
    e.preventDefault();
    const pickup = JBEIL_HUBS[pickupHubIndex] || JBEIL_HUBS[0];
    const dropoff = JBEIL_HUBS[dropoffHubIndex] || JBEIL_HUBS[1];

    onCreateTrip({
      studentName: studentName.trim() || 'Student / Passenger',
      studentPhone: studentPhone.trim() || '+961 70 000 000',
      pickupAddress: `${pickup.name}, ${pickup.area}`,
      pickupCoords: { lat: pickup.lat, lng: pickup.lng },
      dropoffAddress: `${dropoff.name}, ${dropoff.area}`,
      dropoffCoords: { lat: dropoff.lat, lng: dropoff.lng },
      notes: notes.trim() || 'Campus Shuttle Ride',
      priority: 'normal',
      assignedDriverId: targetDriverId || undefined,
    });

    setStudentName('');
    setStudentPhone('');
    setNotes('');
    setTargetDriverId('');
  };

  const copyTrackingLink = (trip: Trip) => {
    const token = trip.trackingToken || trip.trackingCode || trip.id;
    const url = `${window.location.origin}/?track=${encodeURIComponent(token)}`;
    navigator.clipboard.writeText(url);
    setCopiedTripId(trip.id);
    setTimeout(() => setCopiedTripId(null), 2000);
  };

  return (
    <div className="w-full flex flex-col gap-6 pb-12">
      {/* Lead Driver Network Header & Join Code Management */}
      <div className="bg-[#13131a] border border-white/[0.06] rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[10px] font-semibold">
              <Shield className="w-3 h-3" />
              Lead Driver Authority
            </span>
            <span className="text-xs text-[#64748b]">Active: {currentDriver?.name}</span>
          </div>
          <h2 className="text-base font-bold text-white mt-1">
            {network ? network.name : 'Network Fleet Management'}
          </h2>
          <p className="text-xs text-[#64748b] mt-0.5">
            {drivers.length} drivers registered • Dispatch rides & oversee network roster
          </p>
        </div>

        {network && (
          <div className="flex items-center gap-2 self-start sm:self-auto bg-[#0a0a0f] border border-white/[0.06] px-3 py-1.5 rounded-lg">
            <KeyRound className="w-3.5 h-3.5 text-[#64748b]" />
            <span className="text-[11px] text-[#64748b]">Join Code:</span>
            <span className="font-mono text-xs font-bold text-white tracking-wider">
              {network.code}
            </span>
            <button
              id="btn-lead-copy-network-code"
              type="button"
              onClick={handleCopyCode}
              title="Copy network code for new drivers"
              className="text-[#94a3b8] hover:text-white transition-colors cursor-pointer"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </div>

      {/* Network Driver Roster Strip */}
      <div className="bg-[#13131a] border border-white/[0.06] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Fleet Drivers Roster</h3>
          </div>
          <span className="text-xs text-[#64748b] font-mono">{drivers.length} drivers</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-[160px] overflow-y-auto pr-1">
          {drivers.map((drv) => {
            const isAvail = drv.status === 'AVAILABLE' || drv.status === 'available';
            const isBroadcasting = drv.locationSharingEnabled !== false;

            return (
              <button
                key={drv.id}
                type="button"
                onClick={() => onSelectDriverForMap(drv)}
                className="bg-[#0a0a0f] border border-white/[0.06] hover:border-white/[0.12] rounded-lg p-2.5 text-left transition-colors flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-white truncate">{drv.name}</span>
                    {drv.isLeadDriver && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-white/10 text-white font-medium">
                        Lead
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-[#64748b] truncate mt-0.5">
                    {drv.vehicleModel} • {drv.plateNumber}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isAvail ? 'bg-emerald-400' : 'bg-amber-400'
                    }`}
                    title={drv.status}
                  />
                  <span className="text-[9px] text-[#475569] font-mono">
                    {isBroadcasting ? (
                      <span className="text-emerald-500/80">Live</span>
                    ) : (
                      <span className="text-rose-500/80">Hidden</span>
                    )}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* "New Shuttle Trip" Compact Form at top */}
      <div className="bg-[#13131a] border border-white/[0.06] rounded-xl p-4 sm:p-5">
        <h2 className="text-sm font-bold text-white mb-3">Dispatch Dorm Shuttle Trip</h2>

        <form onSubmit={handleCreateTrip} className="flex flex-col gap-3">
          {/* Row 1: Student Name & Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="input-student-name" className="block text-[11px] text-[#94a3b8] mb-1">
                Student Name
              </label>
              <input
                id="input-student-name"
                type="text"
                placeholder="e.g. Maya Haddad"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                required
                className="w-full bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg px-3 py-2 text-xs text-white placeholder-[#4a5568] outline-none transition-colors"
              />
            </div>

            <div>
              <label htmlFor="input-student-phone" className="block text-[11px] text-[#94a3b8] mb-1">
                Student Mobile (Private)
              </label>
              <input
                id="input-student-phone"
                type="text"
                placeholder="+961 71 889 231"
                value={studentPhone}
                onChange={(e) => setStudentPhone(e.target.value)}
                className="w-full bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg px-3 py-2 text-xs text-white placeholder-[#4a5568] outline-none transition-colors"
              />
            </div>
          </div>

          {/* Row 2: Pickup Hub & Dropoff Hub */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="select-pickup-hub" className="block text-[11px] text-[#94a3b8] mb-1">
                Pickup Dorm / Location
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
                Destination Campus Gate / Hub
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

          {/* Row 3: Trip Notes & Optional Initial Assignee + Submit */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end pt-1">
            <div className="sm:col-span-6">
              <label htmlFor="input-trip-notes" className="block text-[11px] text-[#94a3b8] mb-1">
                Trip Notes / Gate Details
              </label>
              <input
                id="input-trip-notes"
                type="text"
                placeholder="e.g. Dorm Building B front lobby"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg px-3 py-2 text-xs text-white placeholder-[#4a5568] outline-none transition-colors"
              />
            </div>

            <div className="sm:col-span-4">
              <label htmlFor="select-assign-driver" className="block text-[11px] text-[#94a3b8] mb-1">
                Assign Taxi (Optional)
              </label>
              <div className="relative">
                <select
                  id="select-assign-driver"
                  value={targetDriverId}
                  onChange={(e) => setTargetDriverId(e.target.value)}
                  className="w-full appearance-none bg-[#0a0a0f] border border-white/[0.06] focus:border-[#3b82f6] rounded-lg pl-3 pr-8 py-2 text-xs text-white outline-none cursor-pointer transition-colors"
                >
                  <option value="" className="bg-[#13131a] text-[#94a3b8]">
                    Unassigned (Fleet Pool)
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
                id="btn-dispatch-create-trip"
                className="w-full py-2 bg-[#3b82f6] hover:bg-blue-600 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Dispatch
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Below Form: Active Shuttle Trips List */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white">Active Shuttle Trips</h3>
            <span className="text-xs font-mono text-[#94a3b8] tabular-nums">
              ({activeTrips.length})
            </span>
          </div>
        </div>

        {activeTrips.length === 0 ? (
          <div className="bg-[#13131a] border border-dashed border-white/[0.06] rounded-xl p-8 text-center text-xs text-[#94a3b8]">
            No active trips in dispatch queue. Dispatch a new student shuttle trip above.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {activeTrips.map((trip) => {
              const assignedDriver = drivers.find((d) => d.id === trip.assignedDriverId);
              const isUnassigned = !trip.assignedDriverId;

              return (
                <div
                  key={trip.id}
                  id={`trip-card-${trip.id}`}
                  className="bg-[#13131a] border border-white/[0.06] rounded-xl p-4 flex flex-col gap-2.5 hover:border-white/[0.12] transition-colors"
                >
                  {/* Top line: Tracking Code monospace top-left & Status chip right-aligned */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-[#94a3b8]">
                        {trip.trackingCode || trip.id.slice(-6)}
                      </span>
                      <button
                        onClick={() => copyTrackingLink(trip)}
                        title="Copy student tracking link"
                        className="text-[#4a5568] hover:text-[#3b82f6] transition-colors cursor-pointer"
                      >
                        {copiedTripId === trip.id ? (
                          <Check className="w-3 h-3 text-[#22c55e]" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>

                    <StatusChip status={trip.status} />
                  </div>

                  {/* Student name bold */}
                  <div className="font-bold text-white text-sm">
                    {trip.studentName}
                  </div>

                  {/* Pickup → Dropoff as a one-line with an arrow */}
                  <div className="text-xs text-[#94a3b8] truncate">
                    <span>{trip.pickupAddress}</span>
                    <span className="mx-2 text-[#4a5568]">→</span>
                    <span className="text-slate-300">{trip.dropoffAddress}</span>
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
                          id={`select-driver-trip-${trip.id}`}
                          onChange={(e) => {
                            if (e.target.value) {
                              onAssignTrip(trip.id, e.target.value);
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
                        {trip.notes}
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
