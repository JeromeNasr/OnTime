import React, { useState } from 'react';
import { Clock, MapPin, Gauge, Route, Calendar, ArrowUpRight, X } from 'lucide-react';
import { TripLog } from '../types';
import { MapComponent } from './MapComponent';

interface TripHistoryModalProps {
  tripLogs: TripLog[];
  onClose: () => void;
}

export const TripHistoryModal: React.FC<TripHistoryModalProps> = ({ tripLogs, onClose }) => {
  const [selectedTrip, setSelectedTrip] = useState<TripLog | null>(tripLogs[0] || null);

  return (
    <div className="fixed inset-0 z-[1000] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl h-[90vh] max-h-[780px] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Route className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">Trip History & GPS Logs</h2>
              <p className="text-xs text-slate-400">
                Review past routes, speedometer telemetry, and delivery durations in North Lebanon.
              </p>
            </div>
          </div>
          <button
            id="btn-close-trip-history"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Split View */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Trip List Sidebar */}
          <div className="w-full md:w-80 border-b md:border-b-0 md:border-r border-slate-800 p-3 overflow-y-auto space-y-2.5 max-h-56 md:max-h-full">
            {tripLogs.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No trips recorded yet. Use the Driver Phone cockpit to start logging your trip.
              </div>
            ) : (
              tripLogs.map((trip) => (
                <div
                  key={trip.id}
                  onClick={() => setSelectedTrip(trip)}
                  className={`p-3 rounded-2xl border transition-all cursor-pointer ${
                    selectedTrip?.id === trip.id
                      ? 'bg-blue-950/40 border-blue-500/50 shadow-lg'
                      : 'bg-slate-950 border-slate-850 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-bold text-slate-200">{trip.driverName}</span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {new Date(trip.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-400 space-y-1 mb-2">
                    <div className="truncate flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                      <span>{trip.startAddress}</span>
                    </div>
                    <div className="truncate flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                      <span>{trip.endAddress}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] pt-2 border-t border-slate-800/80 font-mono">
                    <span className="text-emerald-400 font-bold">{trip.distanceKm} km</span>
                    <span className="text-slate-400">{trip.durationMinutes} min</span>
                    <span className="text-amber-400">Avg {trip.avgSpeedKmH} km/h</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Trip Details & Route Visualizer */}
          <div className="flex-1 flex flex-col p-4 bg-slate-950 overflow-y-auto">
            {selectedTrip ? (
              <div className="flex-1 flex flex-col gap-3">
                {/* Stats Bar */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-xl">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Distance</div>
                    <div className="text-lg font-bold font-mono text-emerald-400">
                      {selectedTrip.distanceKm} <span className="text-xs text-slate-500">km</span>
                    </div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-xl">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Duration</div>
                    <div className="text-lg font-bold font-mono text-blue-400">
                      {selectedTrip.durationMinutes} <span className="text-xs text-slate-500">min</span>
                    </div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-xl">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Average Speed</div>
                    <div className="text-lg font-bold font-mono text-amber-400">
                      {selectedTrip.avgSpeedKmH} <span className="text-xs text-slate-500">km/h</span>
                    </div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-xl">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Top Speed</div>
                    <div className="text-lg font-bold font-mono text-rose-400">
                      {selectedTrip.maxSpeedKmH} <span className="text-xs text-slate-500">km/h</span>
                    </div>
                  </div>
                </div>

                {/* Leaflet Map Replaying Trip Path */}
                <div className="flex-1 min-h-[280px] rounded-2xl overflow-hidden border border-slate-800 relative shadow-inner">
                  <MapComponent
                    routePath={selectedTrip.path}
                    focusLocation={
                      selectedTrip.path.length > 0
                        ? { lat: selectedTrip.path[0][0], lng: selectedTrip.path[0][1] }
                        : null
                    }
                    height="100%"
                  />
                  <div className="absolute bottom-3 right-3 z-[400] bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700 text-[11px] font-medium text-slate-300">
                    Showing {selectedTrip.path.length} GPS Breadcrumbs
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-xs">
                Select a trip on the left to view route playback on OpenStreetMap.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
