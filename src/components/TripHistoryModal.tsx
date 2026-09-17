import React, { useState } from 'react';
import { X, ChevronRight } from 'lucide-react';
import { TripLog } from '../types';
import { MapComponent } from './MapComponent';

interface TripHistoryModalProps {
  tripLogs: TripLog[];
  onClose: () => void;
}

export const TripHistoryModal: React.FC<TripHistoryModalProps> = ({ tripLogs, onClose }) => {
  const [selectedTrip, setSelectedTrip] = useState<TripLog | null>(tripLogs[0] || null);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-[#13131a] border border-white/[0.08] rounded-xl w-full max-w-[480px] max-h-[85vh] p-5 shadow-2xl flex flex-col gap-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
          <div>
            <h2 className="text-sm font-bold text-white">Trip History</h2>
            <p className="text-xs text-[#94a3b8] mt-0.5">Recorded GPS breadcrumbs & durations</p>
          </div>
          <button
            id="btn-close-trip-history"
            onClick={onClose}
            className="text-[#94a3b8] hover:text-white p-1 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Selected Trip Details */}
        {selectedTrip && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-4 gap-2 text-center bg-[#0a0a0f] p-3 rounded-lg border border-white/[0.06]">
              <div>
                <div className="text-[10px] text-[#4a5568]">Distance</div>
                <div className="text-xs font-bold text-white font-mono tabular-nums mt-0.5">
                  {selectedTrip.distanceKm} km
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#4a5568]">Duration</div>
                <div className="text-xs font-bold text-white font-mono tabular-nums mt-0.5">
                  {selectedTrip.durationMinutes}m
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#4a5568]">Avg Speed</div>
                <div className="text-xs font-bold text-white font-mono tabular-nums mt-0.5">
                  {selectedTrip.avgSpeedKmH} km/h
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#4a5568]">Max Speed</div>
                <div className="text-xs font-bold text-white font-mono tabular-nums mt-0.5">
                  {selectedTrip.maxSpeedKmH} km/h
                </div>
              </div>
            </div>

            {/* Map Path */}
            <div className="h-44 w-full rounded-lg overflow-hidden border border-white/[0.06]">
              <MapComponent
                routePath={selectedTrip.path}
                focusLocation={
                  selectedTrip.path.length > 0
                    ? { lat: selectedTrip.path[0][0], lng: selectedTrip.path[0][1] }
                    : null
                }
                height="100%"
                className="w-full h-full"
              />
            </div>
          </div>
        )}

        {/* Trip List */}
        <div className="flex flex-col gap-2 pt-2 border-t border-white/[0.06] overflow-y-auto max-h-48 pr-1">
          <div className="text-[11px] text-[#94a3b8] font-medium">All Logged Trips</div>
          {tripLogs.length === 0 ? (
            <div className="p-4 text-center text-xs text-[#4a5568]">
              No logged trips found. Start a trip in the Driver cockpit to log paths.
            </div>
          ) : (
            tripLogs.map((trip) => {
              const isSelected = selectedTrip?.id === trip.id;
              return (
                <div
                  key={trip.id}
                  onClick={() => setSelectedTrip(trip)}
                  className={`p-2.5 rounded-lg border text-xs cursor-pointer flex items-center justify-between transition-colors ${
                    isSelected
                      ? 'bg-[#1e1e28] border-[#3b82f6]'
                      : 'bg-[#0a0a0f] border-white/[0.06] hover:border-white/[0.12]'
                  }`}
                >
                  <div>
                    <div className="font-medium text-white">{trip.driverName}</div>
                    <div className="text-[11px] text-[#4a5568] mt-0.5">
                      {trip.distanceKm} km • {trip.durationMinutes} min • Avg {trip.avgSpeedKmH} km/h
                    </div>
                  </div>
                  <ChevronRight className={`w-3.5 h-3.5 ${isSelected ? 'text-[#3b82f6]' : 'text-[#4a5568]'}`} />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
