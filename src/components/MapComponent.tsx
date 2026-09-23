import React, { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import { Driver, Trip, PublicVehicle } from '../types';

interface MapComponentProps {
  drivers?: Driver[];
  publicVehicles?: PublicVehicle[];
  selectedDriverId?: string;
  onSelectDriver?: (driver: Driver) => void;
  onSelectPublicVehicle?: (vehicle: PublicVehicle) => void;
  trips?: Trip[];
  currentTrip?: Trip | null;
  focusLocation?: { lat: number; lng: number } | null;
  followDriver?: boolean;
  userPosition?: { lat: number; lng: number; heading?: number } | null;
  height?: string;
  className?: string;
  showNorthHubs?: boolean;
  routePath?: [number, number][];
  mode?: 'customer' | 'admin';
}

interface VehicleMarkerEntry {
  marker: L.Marker;
  currentLat: number;
  currentLng: number;
  heading: number | null;
  animFrame?: number;
  id: string;
}

export const MapComponent: React.FC<MapComponentProps> = ({
  drivers = [],
  publicVehicles = [],
  selectedDriverId,
  onSelectDriver,
  onSelectPublicVehicle,
  trips = [],
  currentTrip,
  focusLocation,
  followDriver = false,
  userPosition,
  height = '100%',
  className = '',
  showNorthHubs = false,
  routePath,
  mode,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  // Layers
  const vehiclesLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.Polyline | null>(null);
  const adminTripsLayerRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);

  // Incremental marker cache to prevent layer wiping & enable smooth interpolation
  const vehicleMarkersMapRef = useRef<Map<string, VehicleMarkerEntry>>(new Map());
  const initialFitBoundsDoneRef = useRef<boolean>(false);

  // Determine effective mode: if publicVehicles are provided or mode === 'customer', hide admin trips
  const isCustomerMode = mode === 'customer' || (publicVehicles.length > 0 && mode !== 'admin');

  // 1. Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Default regional center without campus labels
    const defaultCenter: [number, number] = [34.123, 35.655];
    const defaultZoom = 13;

    const map = L.map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: defaultZoom,
      zoomControl: false,
      attributionControl: true,
    });

    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
      }
    ).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Dedicated layer groups
    const vehiclesGroup = L.layerGroup().addTo(map);
    vehiclesLayerRef.current = vehiclesGroup;

    const tripsGroup = L.layerGroup().addTo(map);
    adminTripsLayerRef.current = tripsGroup;

    mapInstanceRef.current = map;

    const ro = new ResizeObserver(() => {
      map.invalidateSize();
    });
    ro.observe(mapContainerRef.current);

    if (showNorthHubs && !isCustomerMode) {
      const hubs = [
        { name: 'Terminal North', lat: 34.1265, lng: 35.652 },
        { name: 'Central District', lat: 34.1215, lng: 35.6455 },
      ];
      hubs.forEach((hub) => {
        L.circleMarker([hub.lat, hub.lng], {
          radius: 5,
          fillColor: '#3b82f6',
          color: '#ffffff',
          weight: 1.5,
          opacity: 1,
          fillOpacity: 0.8,
        })
          .bindTooltip(hub.name)
          .addTo(tripsGroup);
      });
    }

    return () => {
      ro.disconnect();
      // Cancel any ongoing marker animations
      vehicleMarkersMapRef.current.forEach((entry) => {
        if (entry.animFrame) cancelAnimationFrame(entry.animFrame);
      });
      vehicleMarkersMapRef.current.clear();

      map.remove();
      mapInstanceRef.current = null;
    };
  }, [showNorthHubs, isCustomerMode]);

  // 2. Incremental Vehicle Marker Updates with Smooth GPS Animation
  useEffect(() => {
    const map = mapInstanceRef.current;
    const group = vehiclesLayerRef.current;
    if (!map || !group) return;

    // Normalizing vehicle entities: either publicVehicles or internal drivers
    type UnifiedVehicle = {
      id: string;
      driverId: string;
      name: string;
      lat: number;
      lng: number;
      heading: number | null;
      speed: number | null;
      speedometerEnabled: boolean;
      freshness: 'FRESH' | 'STALE' | 'OFFLINE';
      networkName: string;
      vehicleModel: string;
      plateNumber: string;
      phone?: string;
      leadPhone?: string;
      rawPublic?: PublicVehicle;
      rawDriver?: Driver;
    };

    const unifiedList: UnifiedVehicle[] = [];

    if (publicVehicles.length > 0) {
      publicVehicles.forEach((pv) => {
        if (!pv.location || typeof pv.location.lat !== 'number' || typeof pv.location.lng !== 'number') return;
        const validHeading = (typeof pv.location.heading === 'number' && !isNaN(pv.location.heading))
          ? pv.location.heading
          : null;
        unifiedList.push({
          id: pv.id || `veh-${pv.driverId}`,
          driverId: pv.driverId,
          name: pv.driverName,
          lat: pv.location.lat,
          lng: pv.location.lng,
          heading: validHeading,
          speed: pv.location.speed ?? null,
          speedometerEnabled: pv.speedometerEnabled !== false,
          freshness: pv.location.freshness || 'FRESH',
          networkName: pv.networkName || pv.networkCode || 'Network',
          vehicleModel: pv.vehicleModel || 'Fleet Vehicle',
          plateNumber: pv.plateNumber || 'Public Vehicle',
          phone: pv.phone,
          leadPhone: pv.leadPhone,
          rawPublic: pv,
        });
      });
    } else if (drivers.length > 0) {
      drivers.forEach((drv) => {
        if (!drv.currentLocation || typeof drv.currentLocation.lat !== 'number' || typeof drv.currentLocation.lng !== 'number') return;
        const freshness: 'FRESH' | 'STALE' | 'OFFLINE' =
          drv.status === 'OFFLINE' ? 'OFFLINE' : drv.status === 'PAUSED' ? 'STALE' : 'FRESH';
        const validHeading = (drv.currentLocation && typeof drv.currentLocation.heading === 'number' && !isNaN(drv.currentLocation.heading))
          ? drv.currentLocation.heading
          : null;
        unifiedList.push({
          id: `drv-${drv.id}`,
          driverId: drv.id,
          name: drv.name,
          lat: drv.currentLocation.lat,
          lng: drv.currentLocation.lng,
          heading: validHeading,
          speed: drv.speedometerEnabled !== false ? (drv.currentLocation.speed ?? null) : null,
          speedometerEnabled: drv.speedometerEnabled !== false,
          freshness,
          networkName: drv.networkName || drv.networkCode || 'Network',
          vehicleModel: drv.vehicleModel || 'Fleet Car',
          plateNumber: drv.plateNumber || 'Fleet',
          phone: drv.phone,
          rawDriver: drv,
        });
      });
    }

    const currentIds = new Set(unifiedList.map((v) => v.id));
    const markersMap = vehicleMarkersMapRef.current;

    // Prune removed vehicles
    markersMap.forEach((entry, id) => {
      if (!currentIds.has(id)) {
        if (entry.animFrame) cancelAnimationFrame(entry.animFrame);
        entry.marker.remove();
        markersMap.delete(id);
      }
    });

    // Create or update markers
    unifiedList.forEach((v) => {
      const isSelected = v.id === selectedDriverId || v.driverId === selectedDriverId;
      const markerColor = v.freshness === 'OFFLINE' ? '#64748b' : v.freshness === 'STALE' ? '#f59e0b' : '#10b981';

      // Format speed indicator strictly: null vs 0 vs >0
      let speedBadgeText = '';
      if (v.speedometerEnabled && v.speed !== null && !isNaN(v.speed)) {
        if (v.speed === 0) {
          speedBadgeText = '0 km/h';
        } else {
          speedBadgeText = `${Math.round(v.speed)} km/h`;
        }
      }

      const buildIconHtml = (h: number | null) => {
        const hasValidHeading = h !== null && !isNaN(h);
        const rotationStyle = hasValidHeading ? `transform: rotate(${h}deg);` : '';
        const arrowSvg = `
          <svg class="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
          </svg>
        `;
        const neutralSvg = `
          <svg class="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C2.1 10.7 2 11 2 11.3V16c0 .6.4 1 1 1h2"/>
            <circle cx="7" cy="17" r="2"/>
            <path d="M9 17h6"/>
            <circle cx="17" cy="17" r="2"/>
          </svg>
        `;

        return `
          <div class="relative flex flex-col items-center cursor-pointer select-none group">
            <div class="w-8 h-8 rounded-full border-2 ${
              isSelected ? 'border-white ring-2 ring-emerald-400 scale-110 shadow-lg' : 'border-white/90 shadow'
            } flex items-center justify-center transition-transform" style="background-color: ${markerColor}; ${rotationStyle}">
              ${hasValidHeading ? arrowSvg : neutralSvg}
            </div>
            <div class="mt-1 px-1.5 py-0.5 bg-[#0f172a]/95 text-white text-[10px] font-semibold rounded-md border border-white/20 shadow-md whitespace-nowrap flex items-center gap-1">
              <span>${v.name.split(' ')[0]}</span>
              ${speedBadgeText ? `<span class="text-emerald-400 font-mono">${speedBadgeText}</span>` : ''}
            </div>
          </div>
        `;
      };

      const headingDisplay = (v.heading !== null && !isNaN(v.heading))
        ? `${Math.round(v.heading)}°`
        : 'Heading unavailable';

      const speedDisplay = (v.speedometerEnabled && v.speed !== null && !isNaN(v.speed))
        ? `${Math.round(v.speed)} km/h`
        : 'Speed unavailable';

      const buildPopupContent = () => `
        <div class="p-1 text-slate-300 text-xs min-w-[210px]">
          <div class="flex items-center justify-between gap-2 border-b border-slate-700/80 pb-1.5 mb-1.5">
            <span class="font-bold text-white text-sm">${v.name}</span>
            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${
              v.freshness === 'OFFLINE'
                ? 'bg-slate-700 text-slate-300'
                : v.freshness === 'STALE'
                ? 'bg-amber-900/60 text-amber-300'
                : 'bg-emerald-900/60 text-emerald-300'
            }">${v.freshness}</span>
          </div>
          <div class="text-[11px] text-slate-400 mb-1">
            <span class="text-slate-200 font-medium">${v.networkName}</span>
          </div>
          <div class="text-[11px] text-slate-300 mb-1">
            ${v.vehicleModel} • <span class="font-mono text-slate-100">${v.plateNumber}</span>
          </div>
          <div class="flex items-center justify-between text-[11px] text-slate-300 pt-1 border-t border-slate-700/60">
            <span>Speed: <strong class="text-emerald-400 font-mono">${speedDisplay}</strong></span>
            <span>Bearing: ${headingDisplay}</span>
          </div>
          ${
            v.leadPhone
              ? `
            <div class="mt-2 pt-1.5 border-t border-slate-700/60 flex items-center justify-between">
              <span class="text-[10px] text-slate-400">Fleet Lead:</span>
              <a href="tel:${v.leadPhone}" class="text-[11px] font-medium text-sky-400 hover:underline flex items-center gap-1">
                📞 ${v.leadPhone}
              </a>
            </div>
          `
              : ''
          }
          ${
            v.phone
              ? `
            <div class="mt-1 flex items-center justify-between">
              <span class="text-[10px] text-slate-400">Driver Phone:</span>
              <a href="tel:${v.phone}" class="text-[11px] font-medium text-emerald-400 hover:underline flex items-center gap-1">
                📞 ${v.phone}
              </a>
            </div>
          `
              : ''
          }
        </div>
      `;

      let entry = markersMap.get(v.id);

      if (!entry) {
        // Create new marker
        const icon = L.divIcon({
          html: buildIconHtml(v.heading),
          className: 'custom-vehicle-marker',
          iconSize: [80, 56],
          iconAnchor: [40, 20],
        });

        const marker = L.marker([v.lat, v.lng], { icon }).addTo(group);
        marker.bindPopup(buildPopupContent());

        marker.on('click', () => {
          if (v.rawPublic && onSelectPublicVehicle) {
            onSelectPublicVehicle(v.rawPublic);
          } else if (v.rawDriver && onSelectDriver) {
            onSelectDriver(v.rawDriver);
          }
        });

        entry = {
          id: v.id,
          marker,
          currentLat: v.lat,
          currentLng: v.lng,
          heading: v.heading,
        };
        markersMap.set(v.id, entry);
      } else {
        // Update existing marker
        // 1. Icon & Popup update
        const updatedIcon = L.divIcon({
          html: buildIconHtml(v.heading),
          className: 'custom-vehicle-marker',
          iconSize: [80, 56],
          iconAnchor: [40, 20],
        });
        entry.marker.setIcon(updatedIcon);
        entry.marker.setPopupContent(buildPopupContent());

        // 2. Smooth GPS Animation / Interpolation
        const startLat = entry.currentLat;
        const startLng = entry.currentLng;
        const targetLat = v.lat;
        const targetLng = v.lng;

        const distanceMoved = Math.hypot(targetLat - startLat, targetLng - startLng);
        if (distanceMoved > 0.000005) {
          if (entry.animFrame) cancelAnimationFrame(entry.animFrame);
          const startTime = performance.now();
          const duration = 750; // 750ms smooth transition

          const step = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / duration);
            // Cubic ease-out
            const ease = 1 - Math.pow(1 - progress, 3);
            const curLat = startLat + (targetLat - startLat) * ease;
            const curLng = startLng + (targetLng - startLng) * ease;

            entry!.currentLat = curLat;
            entry!.currentLng = curLng;
            entry!.marker.setLatLng([curLat, curLng]);

            if (progress < 1) {
              entry!.animFrame = requestAnimationFrame(step);
            } else {
              entry!.animFrame = undefined;
            }
          };

          entry.animFrame = requestAnimationFrame(step);
        } else {
          entry.currentLat = targetLat;
          entry.currentLng = targetLng;
          entry.marker.setLatLng([targetLat, targetLng]);
        }
      }
    });

    // Initial fit bounds: center on vehicles if map hasn't been centered yet
    if (!initialFitBoundsDoneRef.current && unifiedList.length > 0) {
      try {
        const bounds = L.latLngBounds(unifiedList.map((v) => [v.lat, v.lng]));
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
          initialFitBoundsDoneRef.current = true;
        }
      } catch {
        // ignore
      }
    }
  }, [publicVehicles, drivers, selectedDriverId, onSelectDriver, onSelectPublicVehicle]);

  // 3. User Position Marker (Single incremental update)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (!userPosition) {
      if (userMarkerRef.current) {
        userMarkerRef.current.remove();
        userMarkerRef.current = null;
      }
      return;
    }

    const userHtml = `
      <div class="relative flex items-center justify-center">
        <span class="absolute w-7 h-7 rounded-full bg-blue-500/30 animate-ping"></span>
        <div class="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-lg flex items-center justify-center">
          <div class="w-1.5 h-1.5 rounded-full bg-white"></div>
        </div>
      </div>
    `;

    const userIcon = L.divIcon({
      html: userHtml,
      className: 'custom-gps-user-marker',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    if (!userMarkerRef.current) {
      userMarkerRef.current = L.marker([userPosition.lat, userPosition.lng], {
        icon: userIcon,
        zIndexOffset: 1000,
      }).addTo(map);
      userMarkerRef.current.bindTooltip('Your Location', { direction: 'top', offset: [0, -10] });
    } else {
      userMarkerRef.current.setLatLng([userPosition.lat, userPosition.lng]);
    }
  }, [userPosition]);

  // 4. Road Polyline (Customer ETA route or Admin trip route)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (routeLayerRef.current) {
      routeLayerRef.current.remove();
      routeLayerRef.current = null;
    }

    if (routePath && routePath.length > 1) {
      routeLayerRef.current = L.polyline(routePath, {
        color: '#3b82f6',
        weight: 4,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);

      try {
        const bounds = routeLayerRef.current.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
        }
      } catch {
        // ignore
      }
    } else if (!isCustomerMode && currentTrip?.pickupCoords && currentTrip?.dropoffCoords) {
      const waypoints: [number, number][] = [
        [currentTrip.pickupCoords.lat, currentTrip.pickupCoords.lng],
      ];
      if (currentTrip.assignedDriverId) {
        const assigned = drivers.find((d) => d.id === currentTrip.assignedDriverId);
        if (assigned) {
          waypoints.unshift([assigned.currentLocation.lat, assigned.currentLocation.lng]);
        }
      }
      waypoints.push([currentTrip.dropoffCoords.lat, currentTrip.dropoffCoords.lng]);

      routeLayerRef.current = L.polyline(waypoints, {
        color: '#3b82f6',
        weight: 3,
        opacity: 0.8,
        dashArray: '5, 5',
      }).addTo(map);
    }
  }, [routePath, currentTrip, drivers, isCustomerMode]);

  // 5. Admin Mode Only: Render Dispatch Trips
  useEffect(() => {
    const group = adminTripsLayerRef.current;
    if (!group) return;

    group.clearLayers();

    // In customer mode, NEVER render dispatch trips or pickup/dropoff pins
    if (isCustomerMode) return;

    trips.forEach((trip) => {
      if (trip.pickupCoords) {
        const pickupIcon = L.divIcon({
          html: `
            <div class="flex flex-col items-center select-none">
              <div class="w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white shadow"></div>
              <span class="mt-0.5 px-1 py-0.2 bg-[#13131a] text-[9px] text-emerald-400 font-medium rounded border border-white/10 whitespace-nowrap">Pickup</span>
            </div>
          `,
          className: 'custom-pickup-pin',
          iconSize: [40, 30],
          iconAnchor: [20, 7],
        });
        L.marker([trip.pickupCoords.lat, trip.pickupCoords.lng], { icon: pickupIcon })
          .addTo(group)
          .bindPopup(`
            <div class="text-slate-300 text-xs">
              <div class="text-[10px] font-semibold text-emerald-400 uppercase">Pickup Location</div>
              <div class="text-sm font-medium text-white mt-0.5">${trip.pickupAddress}</div>
            </div>
          `);
      }

      if (trip.dropoffCoords) {
        const dropoffIcon = L.divIcon({
          html: `
            <div class="flex flex-col items-center select-none">
              <div class="w-3.5 h-3.5 rounded-full bg-rose-500 border-2 border-white shadow"></div>
              <span class="mt-0.5 px-1 py-0.2 bg-[#13131a] text-[9px] text-rose-400 font-medium rounded border border-white/10 whitespace-nowrap">Dropoff</span>
            </div>
          `,
          className: 'custom-dropoff-pin',
          iconSize: [40, 30],
          iconAnchor: [20, 7],
        });
        L.marker([trip.dropoffCoords.lat, trip.dropoffCoords.lng], { icon: dropoffIcon })
          .addTo(group)
          .bindPopup(`
            <div class="text-slate-300 text-xs">
              <div class="text-[10px] font-semibold text-rose-400 uppercase">Destination</div>
              <div class="text-sm font-medium text-white mt-0.5">${trip.dropoffAddress}</div>
            </div>
          `);
      }
    });
  }, [trips, isCustomerMode]);

  // 6. Camera Follow / Focus
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (focusLocation) {
      map.panTo([focusLocation.lat, focusLocation.lng], { animate: true });
    } else if (followDriver && selectedDriverId) {
      const entry = vehicleMarkersMapRef.current.get(selectedDriverId) ||
        vehicleMarkersMapRef.current.get(`veh-${selectedDriverId}`) ||
        vehicleMarkersMapRef.current.get(`drv-${selectedDriverId}`);
      if (entry) {
        map.panTo([entry.currentLat, entry.currentLng], { animate: true, duration: 0.8 });
      }
    }
  }, [focusLocation, followDriver, selectedDriverId]);

  return (
    <div className={`relative w-full overflow-hidden ${className}`} style={{ height }}>
      <div id="fleet-live-map-viewport" ref={mapContainerRef} className="w-full h-full z-0" />
    </div>
  );
};
