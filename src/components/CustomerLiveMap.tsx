import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Layers,
  Search,
  Navigation,
  Phone,
  Gauge,
  Compass,
  Clock,
  X,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  LocateFixed,
  Car,
  Check,
  AlertCircle,
  ShieldCheck,
} from 'lucide-react';
import { PublicVehicle, Network } from '../types';
import { api } from '../services/api';
import { getSocket } from '../services/socket';
import { MapComponent } from './MapComponent';

interface CustomerLiveMapProps {
  initialNetworkCode?: string;
  onOpenDriverPhone?: () => void;
  onOpenFleetPortal?: () => void;
  onSelectNetwork?: (networkCode: string) => void;
}

export const CustomerLiveMap: React.FC<CustomerLiveMapProps> = ({
  initialNetworkCode,
  onOpenDriverPhone,
  onOpenFleetPortal,
  onSelectNetwork,
}) => {
  // Networks & Filtering
  const [networks, setNetworks] = useState<Network[]>([]);
  const [selectedNetworkIds, setSelectedNetworkIds] = useState<string[]>([]);
  const [vehicles, setVehicles] = useState<PublicVehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<PublicVehicle | null>(null);

  // Customer Location (Optional — strictly on-demand, no auto-prompt, no hardcoded dorms)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isLocatingUser, setIsLocatingUser] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Dynamic Public Road ETA
  const [etaResult, setEtaResult] = useState<{
    etaMinutes: number;
    roadDistanceKm: number;
    polyline: [number, number][];
    trafficLevel?: string;
    trafficAssessmentBasis?: string;
    source?: string;
  } | null>(null);
  const [loadingEta, setLoadingEta] = useState(false);

  // UI state
  const [showNetworkFilter, setShowNetworkFilter] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [bottomSheetExpanded, setBottomSheetExpanded] = useState(true);
  const [nowTimestamp, setNowTimestamp] = useState<number>(Date.now());

  // Ticking clock for real-time freshness display
  useEffect(() => {
    const clock = setInterval(() => {
      setNowTimestamp(Date.now());
    }, 1000);
    return () => clearInterval(clock);
  }, []);

  // Request Customer Location strictly upon explicit user interaction
  const requestUserLocation = useCallback((onSuccess?: (loc: { lat: number; lng: number }) => void) => {
    if (!('geolocation' in navigator)) {
      setLocationError('Geolocation is not supported by your browser.');
      return;
    }

    setIsLocatingUser(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setUserLocation(coords);
        setIsLocatingUser(false);
        setLocationError(null);
        if (onSuccess) onSuccess(coords);
      },
      (err) => {
        setIsLocatingUser(false);
        let msg = 'Location access was not granted.';
        if (err.code === 1) {
          msg = 'Location permission denied. Map remains fully accessible.';
        } else if (err.code === 2) {
          msg = 'Location position unavailable.';
        } else if (err.code === 3) {
          msg = 'Location request timed out.';
        }
        setLocationError(msg);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }, []);

  // Load public networks and active vehicles
  const loadNetworksAndFleet = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [fetchedNetworks, fetchedVehicles] = await Promise.all([
        api.fetchPublicNetworks().catch(() => []),
        api.fetchPublicVehicles(selectedNetworkIds.length > 0 ? selectedNetworkIds : undefined).catch(() => []),
      ]);

      if (Array.isArray(fetchedNetworks)) {
        setNetworks(fetchedNetworks);
      }
      if (Array.isArray(fetchedVehicles)) {
        setVehicles(fetchedVehicles);
      }
    } catch (err) {
      console.warn('Error loading public fleet data:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedNetworkIds]);

  useEffect(() => {
    loadNetworksAndFleet();
  }, [loadNetworksAndFleet]);

  // Connect to public_fleet Socket.IO room for real-time live GPS broadcast updates
  useEffect(() => {
    const socket = getSocket();

    const joinPublicFleet = () => {
      socket.emit('join:public_fleet');
    };

    if (socket.connected) {
      joinPublicFleet();
    }
    socket.on('connect', joinPublicFleet);

    // Live vehicle update event
    const handleVehicleUpdate = (updatedVeh: PublicVehicle) => {
      setVehicles((prev) => {
        const existingIdx = prev.findIndex((v) => v.id === updatedVeh.id || v.driverId === updatedVeh.driverId);
        if (existingIdx >= 0) {
          const next = [...prev];
          next[existingIdx] = updatedVeh;
          return next;
        } else {
          return [...prev, updatedVeh];
        }
      });

      // If selected vehicle updated, refresh telemetry in drawer
      setSelectedVehicle((prevSel) => {
        if (!prevSel) return null;
        if (prevSel.id === updatedVeh.id || prevSel.driverId === updatedVeh.driverId) {
          return updatedVeh;
        }
        return prevSel;
      });
    };

    // Vehicle removed event (driver toggled location sharing OFF or went offline)
    const handleVehicleRemoved = (data: { driverId: string }) => {
      setVehicles((prev) => prev.filter((v) => v.driverId !== data.driverId && v.id !== `veh-${data.driverId}`));
      setSelectedVehicle((prevSel) => {
        if (prevSel && (prevSel.driverId === data.driverId || prevSel.id === `veh-${data.driverId}`)) {
          return null;
        }
        return prevSel;
      });
      setEtaResult(null);
    };

    socket.on('vehicle:location:update', handleVehicleUpdate);
    socket.on('vehicle:removed', handleVehicleRemoved);

    return () => {
      socket.off('connect', joinPublicFleet);
      socket.off('vehicle:location:update', handleVehicleUpdate);
      socket.off('vehicle:removed', handleVehicleRemoved);
    };
  }, []);

  // Compute dynamic ETA when vehicle is selected and customer location is known
  const calculateVehicleEta = useCallback(
    async (vehicle: PublicVehicle, custLoc: { lat: number; lng: number } | null) => {
      if (!custLoc || !vehicle.location) {
        setEtaResult(null);
        return;
      }
      setLoadingEta(true);
      try {
        const result = await api.fetchPublicEta({
          vehicleLat: vehicle.location.lat,
          vehicleLng: vehicle.location.lng,
          vehicleSpeed: vehicle.location.speed,
          customerLat: custLoc.lat,
          customerLng: custLoc.lng,
          vehicleId: vehicle.id,
        });
        setEtaResult(result);
      } catch (err) {
        console.warn('Could not calculate public ETA:', err);
        setEtaResult(null);
      } finally {
        setLoadingEta(false);
      }
    },
    []
  );

  // Recalculate ETA when selected vehicle moves or customer location changes
  useEffect(() => {
    if (selectedVehicle && userLocation) {
      calculateVehicleEta(selectedVehicle, userLocation);
    } else {
      setEtaResult(null);
    }
  }, [selectedVehicle?.location.lat, selectedVehicle?.location.lng, userLocation, calculateVehicleEta]);

  // Handle vehicle marker selection
  const handleSelectVehicle = (vehicle: PublicVehicle) => {
    setSelectedVehicle(vehicle);
    setBottomSheetExpanded(true);
  };

  // Toggle network filter
  const toggleNetworkFilter = (networkId: string) => {
    setSelectedNetworkIds((prev) => {
      if (prev.includes(networkId)) {
        return prev.filter((id) => id !== networkId);
      } else {
        return [...prev, networkId];
      }
    });
  };

  // Filter vehicles based on search query and active network filter
  const filteredVehicles = vehicles.filter((v) => {
    if (
      selectedNetworkIds.length > 0 &&
      !selectedNetworkIds.includes(v.networkId) &&
      !selectedNetworkIds.includes(v.networkCode)
    ) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchDriver = (v.driverName || '').toLowerCase().includes(q);
      const matchNetwork = ((v.networkName || '') + ' ' + (v.networkCode || '')).toLowerCase().includes(q);
      const matchModel = (v.vehicleModel || '').toLowerCase().includes(q);
      const matchPlate = (v.plateNumber || '').toLowerCase().includes(q);
      return matchDriver || matchNetwork || matchModel || matchPlate;
    }
    return true;
  });

  // Calculate telemetry age
  const getSecondsAgo = (timestamp: number) => {
    return Math.max(0, Math.floor((nowTimestamp - timestamp) / 1000));
  };

  return (
    <div className="relative w-full h-[calc(100vh-52px)] overflow-hidden bg-[#090a0f] flex flex-col">
      {/* 1. Full-screen Real-Time Leaflet Map (Customer Mode: zero trips rendered, smooth interpolation) */}
      <div className="absolute inset-0 z-0">
        <MapComponent
          mode="customer"
          publicVehicles={filteredVehicles}
          selectedDriverId={selectedVehicle?.driverId || selectedVehicle?.id}
          onSelectPublicVehicle={handleSelectVehicle}
          userPosition={userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : null}
          routePath={etaResult?.polyline}
          height="100%"
          className="w-full h-full"
        />
      </div>

      {/* 2. Floating Top Header & Action Strip */}
      <div className="absolute top-3 left-3 right-3 sm:left-6 sm:right-6 z-20 pointer-events-none flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        {/* Search Bar */}
        <div className="pointer-events-auto flex items-center gap-2 bg-[#0d0f17]/90 backdrop-blur-md border border-white/10 rounded-xl px-3 py-2 shadow-xl flex-1 max-w-md">
          <Search className="w-4 h-4 text-[#94a3b8] shrink-0" />
          <input
            type="text"
            id="input-customer-fleet-search"
            placeholder="Search vehicle, driver, network, or plate..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent text-xs text-white placeholder-[#64748b] outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-[#94a3b8] hover:text-white p-0.5 rounded transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Action Controls: Network Filter, Find Location, Refresh */}
        <div className="pointer-events-auto flex items-center gap-2 self-end sm:self-auto">
          {/* Network Filter Dropdown Toggle */}
          <div className="relative">
            <button
              id="btn-customer-network-filter"
              onClick={() => setShowNetworkFilter(!showNetworkFilter)}
              className={`px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 backdrop-blur-md border transition-all shadow-md ${
                selectedNetworkIds.length > 0
                  ? 'bg-blue-600/90 border-blue-400 text-white'
                  : 'bg-[#0d0f17]/90 border-white/10 text-slate-200 hover:bg-[#1a1f2e]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{selectedNetworkIds.length === 0 ? 'All Networks' : `${selectedNetworkIds.length} Filtered`}</span>
              <ChevronDown className="w-3.5 h-3.5 ml-0.5" />
            </button>

            {/* Filter Dropdown Popover */}
            {showNetworkFilter && (
              <div className="absolute right-0 mt-2 w-72 bg-[#0d0f17]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-3 z-30 flex flex-col gap-2">
                <div className="flex items-center justify-between pb-2 border-b border-white/10 text-xs">
                  <span className="font-semibold text-white">Participating Networks</span>
                  {selectedNetworkIds.length > 0 && (
                    <button
                      onClick={() => setSelectedNetworkIds([])}
                      className="text-[11px] text-blue-400 hover:underline"
                    >
                      Show All
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-1 max-h-56 overflow-y-auto pr-1">
                  {networks.map((net) => {
                    const isChecked = selectedNetworkIds.includes(net.id) || selectedNetworkIds.includes(net.code);
                    return (
                      <button
                        key={net.id}
                        onClick={() => toggleNetworkFilter(net.id)}
                        className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between transition-colors ${
                          isChecked
                            ? 'bg-blue-600/20 text-blue-200 border border-blue-500/30'
                            : 'hover:bg-white/5 text-slate-300'
                        }`}
                      >
                        <div className="truncate pr-2">
                          <div className="font-medium text-white truncate flex items-center gap-1.5">
                            {isChecked && <Check className="w-3 h-3 text-blue-400 shrink-0" />}
                            <span>{net.name}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">{net.code}</div>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-300 font-mono">
                          {net.activeVehicleCount ?? 0} live
                        </span>
                      </button>
                    );
                  })}
                  {networks.length === 0 && (
                    <div className="py-4 text-center text-xs text-slate-500">No public networks registered</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* On-Demand Customer Location Button */}
          <button
            id="btn-customer-find-location"
            onClick={() => requestUserLocation()}
            disabled={isLocatingUser}
            className={`p-2 rounded-xl backdrop-blur-md border transition-colors shadow-md flex items-center gap-1.5 text-xs font-medium ${
              userLocation
                ? 'bg-emerald-600/80 border-emerald-400 text-white'
                : 'bg-[#0d0f17]/90 border-white/10 text-slate-300 hover:text-white hover:bg-[#1a1f2e]'
            }`}
            title={userLocation ? 'Location Active' : 'Find My Location'}
          >
            <LocateFixed className={`w-4 h-4 ${isLocatingUser ? 'animate-spin text-blue-400' : ''}`} />
            <span className="hidden sm:inline">{userLocation ? 'Located' : 'My Location'}</span>
          </button>

          {/* Refresh Fleet Button */}
          <button
            id="btn-customer-refresh-fleet"
            onClick={loadNetworksAndFleet}
            disabled={isRefreshing}
            className="p-2 rounded-xl bg-[#0d0f17]/90 backdrop-blur-md border border-white/10 text-slate-300 hover:text-white hover:bg-[#1a1f2e] transition-colors shadow-md"
            title="Refresh Fleet"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
          </button>

          {/* Driver Cockpit Quick Link (if provided) */}
          {onOpenDriverPhone && (
            <button
              onClick={onOpenDriverPhone}
              className="hidden md:flex px-3 py-2 rounded-xl bg-[#0d0f17]/90 backdrop-blur-md border border-white/10 text-xs font-medium text-slate-300 hover:text-white hover:bg-[#1a1f2e] transition-colors shadow-md items-center gap-1.5"
            >
              <Car className="w-3.5 h-3.5 text-emerald-400" />
              <span>Driver Cockpit</span>
            </button>
          )}
        </div>
      </div>

      {/* 3. Floating Live Count Badge */}
      <div className="absolute top-16 left-3 sm:left-6 z-10 pointer-events-none flex flex-col gap-1.5">
        <div className="bg-[#0d0f17]/85 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 text-xs text-slate-300 flex items-center gap-2 shadow-lg">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="font-semibold text-white">{filteredVehicles.length}</span>
          <span className="text-slate-400">vehicles online</span>
        </div>

        {locationError && (
          <div className="pointer-events-auto bg-[#1a0f0f]/90 backdrop-blur-md border border-rose-500/30 rounded-lg px-2.5 py-1 text-[11px] text-rose-300 flex items-center gap-1.5 shadow">
            <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
            <span>{locationError}</span>
            <button onClick={() => setLocationError(null)} className="ml-1 text-slate-400 hover:text-white">
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        )}
      </div>

      {/* 4. Bottom Drawer / Vehicle Carousel */}
      <div className="mt-auto z-20 pointer-events-none p-3 sm:p-6 flex flex-col items-center">
        {selectedVehicle ? (
          /* Detailed Vehicle Inspection Card */
          <div className="pointer-events-auto w-full max-w-lg bg-[#0d0f17]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300">
            {/* Header: Driver Name, Network, Vehicle, Status */}
            <div className="p-4 sm:p-5 border-b border-white/10 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white tracking-tight">{selectedVehicle.driverName}</h2>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      selectedVehicle.location.freshness === 'OFFLINE'
                        ? 'bg-slate-800 text-slate-400'
                        : selectedVehicle.location.freshness === 'STALE'
                        ? 'bg-amber-950/80 text-amber-400 border border-amber-500/20'
                        : 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/20'
                    }`}
                  >
                    {selectedVehicle.location.freshness === 'FRESH'
                      ? 'Live Online'
                      : selectedVehicle.location.freshness === 'STALE'
                      ? 'Signal Delay'
                      : 'Offline'}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                  <span>{selectedVehicle.networkName || selectedVehicle.networkCode}</span>
                  <span>•</span>
                  <span>{selectedVehicle.vehicleModel}</span>
                  <span className="font-mono text-slate-200">({selectedVehicle.plateNumber})</span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setBottomSheetExpanded(!bottomSheetExpanded)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
                >
                  {bottomSheetExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
                </button>
                <button
                  onClick={() => {
                    setSelectedVehicle(null);
                    setEtaResult(null);
                  }}
                  className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Expandable Body */}
            {bottomSheetExpanded && (
              <div className="p-4 sm:p-5 flex flex-col gap-4">
                {/* Dynamic Road ETA & Distance */}
                <div className="bg-gradient-to-r from-blue-950/40 via-sky-950/30 to-[#0d0f17] border border-blue-500/20 rounded-xl p-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400 shrink-0">
                      <Navigation className="w-5 h-5 animate-pulse" />
                    </div>
                    <div>
                      <div className="text-[11px] text-blue-300 font-medium uppercase tracking-wider">
                        Dynamic ETA to you
                      </div>
                      <div className="text-xl font-extrabold text-white font-mono flex items-baseline gap-1 mt-0.5">
                        {loadingEta ? (
                          <span className="text-xs text-slate-400 font-normal">Calculating live road route...</span>
                        ) : etaResult ? (
                          <>
                            <span>~{etaResult.etaMinutes}</span>
                            <span className="text-xs font-medium text-blue-300">min</span>
                          </>
                        ) : userLocation ? (
                          <span className="text-xs text-slate-400 font-normal">Direct route calculated</span>
                        ) : (
                          <span className="text-xs text-slate-400 font-normal">Location needed for ETA</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {etaResult ? (
                    <div className="text-right">
                      <div className="text-xs font-mono font-bold text-slate-200">
                        {etaResult.roadDistanceKm.toFixed(1)} km
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {etaResult.trafficLevel ? `${etaResult.trafficLevel} Traffic` : 'Road routing'}
                      </div>
                    </div>
                  ) : !userLocation ? (
                    <button
                      id="btn-eta-request-location"
                      onClick={() =>
                        requestUserLocation((loc) => {
                          if (selectedVehicle) calculateVehicleEta(selectedVehicle, loc);
                        })
                      }
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors shadow flex items-center gap-1.5"
                    >
                      <LocateFixed className="w-3.5 h-3.5" />
                      <span>ETA to me</span>
                    </button>
                  ) : null}
                </div>

                {/* Telemetry Metrics Row: Speed, Heading, Last Update */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  {/* Speedometer */}
                  <div className="bg-[#090a0f] p-2.5 rounded-xl border border-white/5 flex flex-col items-center justify-center">
                    <div className="flex items-center gap-1 text-[11px] text-slate-400 mb-0.5">
                      <Gauge className="w-3 h-3" />
                      <span>Speed</span>
                    </div>
                    <div className="font-mono font-bold text-white text-sm">
                      {selectedVehicle.speedometerEnabled !== false &&
                      selectedVehicle.location.speed !== null &&
                      selectedVehicle.location.speed !== undefined ? (
                        <>
                          <span className={selectedVehicle.location.speed > 0 ? 'text-emerald-400' : 'text-slate-300'}>
                            {Math.round(selectedVehicle.location.speed)}
                          </span>
                          <span className="text-[10px] text-slate-400 ml-1">km/h</span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-500 font-normal">Speed unavailable</span>
                      )}
                    </div>
                  </div>

                  {/* Heading Bearing */}
                  <div className="bg-[#090a0f] p-2.5 rounded-xl border border-white/5 flex flex-col items-center justify-center">
                    <div className="flex items-center gap-1 text-[11px] text-slate-400 mb-0.5">
                      <Compass className="w-3 h-3" />
                      <span>Heading</span>
                    </div>
                    <div className="font-mono font-bold text-white text-sm">
                      {selectedVehicle.location.heading !== null && selectedVehicle.location.heading !== undefined ? (
                        <span>{Math.round(selectedVehicle.location.heading)}°</span>
                      ) : (
                        <span className="text-xs text-slate-500 font-normal">Heading unavailable</span>
                      )}
                    </div>
                  </div>

                  {/* Freshness / Heartbeat */}
                  <div className="bg-[#090a0f] p-2.5 rounded-xl border border-white/5 flex flex-col items-center justify-center">
                    <div className="flex items-center gap-1 text-[11px] text-slate-400 mb-0.5">
                      <Clock className="w-3 h-3" />
                      <span>Updated</span>
                    </div>
                    <div className="font-mono font-bold text-white text-xs">
                      {getSecondsAgo(selectedVehicle.location.timestamp)}s ago
                    </div>
                  </div>
                </div>

                {/* Contact Information & Action Buttons (Phone Privacy Enforced) */}
                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  {/* Lead / Dispatch Phone Button (only shown if backend provided it) */}
                  {selectedVehicle.leadPhone ? (
                    <a
                      id="btn-call-lead-driver"
                      href={`tel:${selectedVehicle.leadPhone}`}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center justify-center gap-2 transition-colors shadow-md"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Call Dispatch ({selectedVehicle.leadPhone})</span>
                    </a>
                  ) : null}

                  {/* Driver Direct Phone (only shown if network explicitly enabled public contact) */}
                  {selectedVehicle.phone ? (
                    <a
                      id="btn-call-driver-direct"
                      href={`tel:${selectedVehicle.phone}`}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-medium text-xs flex items-center justify-center gap-2 transition-colors border border-white/10"
                    >
                      <Phone className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Driver Direct</span>
                    </a>
                  ) : null}

                  {!selectedVehicle.leadPhone && !selectedVehicle.phone && (
                    <div className="w-full py-2 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center text-xs text-slate-400 flex items-center justify-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                      <span>Direct phone calls are private on this network.</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Horizontal Scroller Carousel of Active Vehicles */
          <div className="pointer-events-auto w-full max-w-4xl overflow-x-auto pb-2 flex items-center gap-3 no-scrollbar">
            {filteredVehicles.map((vehicle) => {
              const speedVal = vehicle.location.speed;
              const isStale = vehicle.location.freshness === 'STALE';
              const isOffline = vehicle.location.freshness === 'OFFLINE';
              const isSpeedEnabled = vehicle.speedometerEnabled !== false;

              return (
                <div
                  key={vehicle.id || vehicle.driverId}
                  onClick={() => handleSelectVehicle(vehicle)}
                  className="cursor-pointer shrink-0 w-64 bg-[#0d0f17]/95 backdrop-blur-xl border border-white/10 hover:border-blue-500/50 rounded-2xl p-3.5 shadow-2xl transition-all hover:scale-[1.02]"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-white text-sm truncate pr-2">{vehicle.driverName}</span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isOffline ? 'bg-slate-500' : isStale ? 'bg-amber-400' : 'bg-emerald-400'
                      }`}
                    />
                  </div>

                  <div className="text-[11px] text-slate-400 truncate mb-2">
                    {vehicle.networkName || vehicle.networkCode} • {vehicle.vehicleModel}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-white/5 text-xs">
                    <span className="text-slate-400">
                      Speed:{' '}
                      <strong className="text-white font-mono">
                        {isSpeedEnabled && speedVal !== null && speedVal !== undefined
                          ? `${Math.round(speedVal)} km/h`
                          : 'Unavailable'}
                      </strong>
                    </span>
                    <span className="text-blue-400 font-medium text-[11px] hover:underline flex items-center gap-0.5">
                      Track <ChevronUp className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              );
            })}

            {filteredVehicles.length === 0 && (
              <div className="w-full bg-[#0d0f17]/95 backdrop-blur-xl border border-white/10 rounded-2xl p-4 text-center text-xs text-slate-400 shadow-xl">
                No active vehicles currently broadcasting in this area.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
