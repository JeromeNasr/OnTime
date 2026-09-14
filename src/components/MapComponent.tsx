import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { Driver, Order } from '../types';
import { NORTH_LEBANON_BOUNDS } from '../data/northLebanonData';

interface MapComponentProps {
  drivers?: Driver[];
  selectedDriverId?: string;
  onSelectDriver?: (driver: Driver) => void;
  orders?: Order[];
  activeOrder?: Order | null;
  focusLocation?: { lat: number; lng: number } | null;
  followDriver?: boolean;
  userPosition?: { lat: number; lng: number; heading?: number } | null;
  height?: string;
  className?: string;
  showNorthHubs?: boolean;
  routePath?: [number, number][];
}

export const MapComponent: React.FC<MapComponentProps> = ({
  drivers = [],
  selectedDriverId,
  onSelectDriver,
  orders = [],
  activeOrder,
  focusLocation,
  followDriver = false,
  userPosition,
  height = '100%',
  className = '',
  routePath,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.Polyline | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: NORTH_LEBANON_BOUNDS.center,
      zoom: NORTH_LEBANON_BOUNDS.defaultZoom,
      zoomControl: false,
      attributionControl: true,
    });

    // Clean OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    // Zoom control at bottom right for better mobile ergonomics
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const markersGroup = L.layerGroup().addTo(map);
    markersLayerRef.current = markersGroup;
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Markers & Polylines when data changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    // 1. Draw Route Polyline if provided (e.g. from breadcrumbs or pickup to dropoff)
    if (routeLayerRef.current) {
      routeLayerRef.current.remove();
      routeLayerRef.current = null;
    }

    if (routePath && routePath.length > 1) {
      routeLayerRef.current = L.polyline(routePath, {
        color: '#3b82f6',
        weight: 5,
        opacity: 0.85,
        lineCap: 'round',
        dashArray: '1, 8',
      }).addTo(map);
    } else if (activeOrder && activeOrder.pickupCoords && activeOrder.dropoffCoords) {
      // Direct route line between pickup and dropoff
      const waypoints: [number, number][] = [
        [activeOrder.pickupCoords.lat, activeOrder.pickupCoords.lng],
      ];
      if (activeOrder.assignedDriverId) {
        const assignedDriver = drivers.find((d) => d.id === activeOrder.assignedDriverId);
        if (assignedDriver) {
          waypoints.unshift([assignedDriver.currentLocation.lat, assignedDriver.currentLocation.lng]);
        }
      }
      waypoints.push([activeOrder.dropoffCoords.lat, activeOrder.dropoffCoords.lng]);

      routeLayerRef.current = L.polyline(waypoints, {
        color: '#10b981',
        weight: 4,
        opacity: 0.8,
        dashArray: '6, 6',
      }).addTo(map);
    }

    // 2. Render Drivers
    drivers.forEach((driver) => {
      const isSelected = driver.id === selectedDriverId;
      const isBusy = driver.status === 'busy';
      const speedDisplay = Math.round(driver.currentLocation.speed);

      // Create rich custom HTML marker
      const markerHtml = `
        <div class="relative flex flex-col items-center group cursor-pointer select-none">
          <!-- Speed bubble -->
          <div class="px-1.5 py-0.5 mb-1 text-[10px] font-bold rounded-full shadow-md text-white whitespace-nowrap transition-transform ${
            isSelected
              ? 'bg-amber-500 ring-2 ring-white scale-110'
              : isBusy
              ? 'bg-emerald-600'
              : 'bg-blue-600'
          }">
            ${speedDisplay > 0 ? `${speedDisplay} km/h` : 'Stopped'}
          </div>

          <!-- Car Icon with Bearing Rotation -->
          <div class="w-10 h-10 rounded-full flex items-center justify-center shadow-xl border-2 transition-all ${
            isSelected
              ? 'bg-amber-500 border-white ring-4 ring-amber-400/40 scale-110'
              : isBusy
              ? 'bg-emerald-500 border-emerald-900'
              : 'bg-blue-600 border-blue-900'
          }" style="transform: rotate(${driver.currentLocation.heading || 0}deg);">
            <svg class="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.85 7h10.29l1.04 3H5.81l1.04-3zM19 17H5v-4.66l.12-.34h13.77l.11.34V17z"/>
              <circle cx="7.5" cy="14.5" r="1.5"/>
              <circle cx="16.5" cy="14.5" r="1.5"/>
            </svg>
          </div>

          <!-- Driver Name Tag -->
          <div class="mt-1 px-2 py-0.5 bg-slate-900/90 backdrop-blur-sm text-slate-200 text-[10px] font-semibold rounded border border-slate-700 shadow max-w-[120px] truncate">
            ${driver.name.split(' ')[0]} ${driver.isLeadDriver ? '⭐' : ''}
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        html: markerHtml,
        className: 'custom-driver-marker',
        iconSize: [80, 75],
        iconAnchor: [40, 45],
      });

      const marker = L.marker([driver.currentLocation.lat, driver.currentLocation.lng], {
        icon: customIcon,
      }).addTo(layer);

      marker.on('click', () => {
        if (onSelectDriver) onSelectDriver(driver);
      });

      marker.bindPopup(`
        <div class="p-2 text-slate-900 font-sans">
          <div class="flex items-center gap-1.5 font-bold text-sm">
            <span>${driver.name}</span>
            ${driver.isLeadDriver ? '<span class="text-xs bg-amber-100 text-amber-800 px-1 rounded">Lead</span>' : ''}
          </div>
          <div class="text-xs text-slate-600 mt-1">${driver.vehicleModel} • <span class="font-mono">${driver.plateNumber}</span></div>
          <div class="text-xs text-slate-700 font-semibold mt-1">Speed: ${Math.round(driver.currentLocation.speed)} km/h • Status: ${driver.status.toUpperCase()}</div>
          <div class="text-[11px] text-slate-500 mt-0.5">Phone: ${driver.phone}</div>
        </div>
      `);
    });

    // 3. Render Orders (Pickup & Dropoff)
    orders.forEach((order) => {
      // Pickup Pin
      const pickupHtml = `
        <div class="flex flex-col items-center">
          <div class="w-7 h-7 bg-emerald-600 text-white rounded-full flex items-center justify-center text-xs font-black shadow-lg border-2 border-white ring-2 ring-emerald-400/50">
            P
          </div>
          <div class="px-1.5 py-0.5 bg-slate-900/80 text-[9px] text-emerald-300 font-bold rounded mt-0.5 shadow whitespace-nowrap">
            Pickup
          </div>
        </div>
      `;
      const pickupIcon = L.divIcon({
        html: pickupHtml,
        className: 'custom-pickup-pin',
        iconSize: [50, 45],
        iconAnchor: [25, 25],
      });
      L.marker([order.pickupCoords.lat, order.pickupCoords.lng], { icon: pickupIcon })
        .addTo(layer)
        .bindPopup(`
          <div class="p-2 text-slate-900">
            <div class="text-xs font-bold text-emerald-800">PICKUP LOCATION</div>
            <div class="text-sm font-semibold">${order.pickupAddress}</div>
            <div class="text-xs text-slate-600 mt-1">Customer: ${order.customerName} (${order.customerPhone})</div>
          </div>
        `);

      // Dropoff Pin
      const dropoffHtml = `
        <div class="flex flex-col items-center">
          <div class="w-7 h-7 bg-rose-600 text-white rounded-full flex items-center justify-center text-xs font-black shadow-lg border-2 border-white ring-2 ring-rose-400/50">
            D
          </div>
          <div class="px-1.5 py-0.5 bg-slate-900/80 text-[9px] text-rose-300 font-bold rounded mt-0.5 shadow whitespace-nowrap">
            Dropoff
          </div>
        </div>
      `;
      const dropoffIcon = L.divIcon({
        html: dropoffHtml,
        className: 'custom-dropoff-pin',
        iconSize: [50, 45],
        iconAnchor: [25, 25],
      });
      L.marker([order.dropoffCoords.lat, order.dropoffCoords.lng], { icon: dropoffIcon })
        .addTo(layer)
        .bindPopup(`
          <div class="p-2 text-slate-900">
            <div class="text-xs font-bold text-rose-800">DESTINATION (DROPOFF)</div>
            <div class="text-sm font-semibold">${order.dropoffAddress}</div>
            <div class="text-xs text-slate-600 mt-1">Package: ${order.packageInfo}</div>
          </div>
        `);
    });

    // 4. Render User Phone position marker if watching real GPS
    if (userPosition) {
      const userHtml = `
        <div class="relative flex items-center justify-center">
          <div class="absolute w-8 h-8 rounded-full bg-cyan-500/30 animate-ping"></div>
          <div class="w-6 h-6 rounded-full bg-cyan-500 border-2 border-white shadow-xl flex items-center justify-center text-[10px] text-slate-950 font-bold">
            GPS
          </div>
        </div>
      `;
      const userIcon = L.divIcon({
        html: userHtml,
        className: 'custom-gps-user',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      L.marker([userPosition.lat, userPosition.lng], { icon: userIcon }).addTo(layer);
    }

    // Auto-center or follow
    if (followDriver && selectedDriverId) {
      const selDriver = drivers.find((d) => d.id === selectedDriverId);
      if (selDriver) {
        map.panTo([selDriver.currentLocation.lat, selDriver.currentLocation.lng], {
          animate: true,
          duration: 0.8,
        });
      }
    } else if (focusLocation) {
      map.panTo([focusLocation.lat, focusLocation.lng], { animate: true });
    }
  }, [drivers, selectedDriverId, orders, activeOrder, focusLocation, followDriver, userPosition, routePath]);

  return (
    <div className={`relative w-full overflow-hidden ${className}`} style={{ height }}>
      <div id="north-lebanon-map-view" ref={mapContainerRef} className="w-full h-full z-0" />
      
      {/* North Lebanon Geographic Watermark / Badge */}
      <div className="absolute top-3 left-3 z-[400] pointer-events-none">
        <div className="bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700/80 shadow-lg flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-xs font-semibold text-slate-200">North Lebanon OpenStreetMap</span>
          <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">Tripoli • Batroun</span>
        </div>
      </div>
    </div>
  );
};
