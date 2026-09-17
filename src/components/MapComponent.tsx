import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { Driver, Order } from '../types';
import { JBEIL_BOUNDS } from '../data/jbeilData';

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
  showNorthHubs = false,
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
      center: JBEIL_BOUNDS.center,
      zoom: JBEIL_BOUNDS.defaultZoom,
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

    if (showNorthHubs) {
      const hubs = [
        { name: 'LAU Byblos Campus', lat: 34.1238, lng: 35.6698 },
        { name: 'Blat Campus Crest Dorms', lat: 34.1215, lng: 35.6630 },
        { name: 'Mastita Student Village', lat: 34.1165, lng: 35.6558 },
        { name: 'Jbeil Voie 13 / Highway', lat: 34.1265, lng: 35.6520 },
        { name: 'Jbeil Old Souk & Port', lat: 34.1215, lng: 35.6455 },
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
          .addTo(map);
      });
    }

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [showNorthHubs]);

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
        weight: 4,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);

      // Auto fit bounds to route on initial load if requested
      try {
        const bounds = L.latLngBounds(routePath.map((p) => [p[0], p[1]]));
        if (bounds.isValid() && !followDriver) {
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
        }
      } catch (e) {
        // ignore bounds fit error
      }
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
        color: '#3b82f6',
        weight: 3,
        opacity: 0.8,
        dashArray: '4, 4',
      }).addTo(map);
    }

    // 2. Render Drivers
    drivers.forEach((driver) => {
      const isSelected = driver.id === selectedDriverId;
      const speedDisplay = Math.round(driver.currentLocation.speed);

      // Small clean arrow/direction indicator in blue (#3b82f6)
      const markerHtml = `
        <div class="relative flex flex-col items-center cursor-pointer select-none">
          <div class="w-7 h-7 rounded-full bg-[#3b82f6] border ${
            isSelected ? 'border-white ring-2 ring-[#3b82f6]' : 'border-white/90'
          } shadow flex items-center justify-center transition-transform" style="transform: rotate(${driver.currentLocation.heading || 0}deg);">
            <svg class="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
            </svg>
          </div>
          <div class="mt-1 px-1.5 py-0.5 bg-[#13131a] text-white text-[10px] font-medium rounded border border-white/[0.08] shadow whitespace-nowrap">
            ${driver.name.split(' ')[0]} ${speedDisplay > 0 ? `• ${speedDisplay} km/h` : ''}
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        html: markerHtml,
        className: 'custom-driver-marker',
        iconSize: [60, 50],
        iconAnchor: [30, 20],
      });

      const marker = L.marker([driver.currentLocation.lat, driver.currentLocation.lng], {
        icon: customIcon,
      }).addTo(layer);

      marker.on('click', () => {
        if (onSelectDriver) onSelectDriver(driver);
      });

      marker.bindPopup(`
        <div class="text-[#94a3b8] text-xs">
          <div class="flex items-center gap-1.5 font-bold text-white text-sm">
            <span>${driver.name}</span>
            ${driver.isLeadDriver ? '<span class="text-[10px] bg-white/10 text-white px-1 rounded">Lead</span>' : ''}
          </div>
          <div class="mt-1 text-slate-400">${driver.vehicleModel} • <span class="font-mono text-white">${driver.plateNumber}</span></div>
          <div class="mt-1 font-medium text-slate-300">Speed: ${Math.round(driver.currentLocation.speed)} km/h • Status: ${driver.status}</div>
          <div class="mt-0.5 text-slate-500">Phone: ${driver.phone}</div>
        </div>
      `);
    });

    // 3. Render Orders (Pickup & Dropoff)
    orders.forEach((order) => {
      // Pickup Pin: small clean green dot
      const pickupHtml = `
        <div class="flex flex-col items-center select-none">
          <div class="w-3.5 h-3.5 rounded-full bg-[#22c55e] border-2 border-white shadow"></div>
          <span class="mt-0.5 px-1 py-0.2 bg-[#13131a] text-[9px] text-[#22c55e] font-medium rounded border border-white/[0.08] whitespace-nowrap">Pickup</span>
        </div>
      `;
      const pickupIcon = L.divIcon({
        html: pickupHtml,
        className: 'custom-pickup-pin',
        iconSize: [40, 30],
        iconAnchor: [20, 7],
      });
      L.marker([order.pickupCoords.lat, order.pickupCoords.lng], { icon: pickupIcon })
        .addTo(layer)
        .bindPopup(`
          <div class="text-[#94a3b8] text-xs">
            <div class="text-[10px] font-semibold text-[#22c55e] uppercase">Pickup</div>
            <div class="text-sm font-medium text-white mt-0.5">${order.pickupAddress}</div>
            <div class="text-slate-400 mt-1">Customer: ${order.customerName} (${order.customerPhone})</div>
          </div>
        `);

      // Dropoff Pin: small clean red dot
      const dropoffHtml = `
        <div class="flex flex-col items-center select-none">
          <div class="w-3.5 h-3.5 rounded-full bg-[#ef4444] border-2 border-white shadow"></div>
          <span class="mt-0.5 px-1 py-0.2 bg-[#13131a] text-[9px] text-[#ef4444] font-medium rounded border border-white/[0.08] whitespace-nowrap">Dropoff</span>
        </div>
      `;
      const dropoffIcon = L.divIcon({
        html: dropoffHtml,
        className: 'custom-dropoff-pin',
        iconSize: [40, 30],
        iconAnchor: [20, 7],
      });
      L.marker([order.dropoffCoords.lat, order.dropoffCoords.lng], { icon: dropoffIcon })
        .addTo(layer)
        .bindPopup(`
          <div class="text-[#94a3b8] text-xs">
            <div class="text-[10px] font-semibold text-[#ef4444] uppercase">Destination</div>
            <div class="text-sm font-medium text-white mt-0.5">${order.dropoffAddress}</div>
            <div class="text-slate-400 mt-1">Package: ${order.packageInfo}</div>
          </div>
        `);
    });

    // 4. Render User Phone position marker if watching real GPS
    if (userPosition) {
      const userHtml = `
        <div class="flex items-center justify-center">
          <div class="w-3.5 h-3.5 rounded-full bg-[#3b82f6] border-2 border-white shadow"></div>
        </div>
      `;
      const userIcon = L.divIcon({
        html: userHtml,
        className: 'custom-gps-user',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
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
      <div id="jbeil-fleet-map-view" ref={mapContainerRef} className="w-full h-full z-0" />
      
      {/* Subtle indicator */}
      <div className="absolute top-3 left-3 z-[400] pointer-events-none">
        <div className="bg-[#13131a]/85 backdrop-blur-xs px-2.5 py-1 rounded-md text-[11px] text-[#94a3b8] border border-white/[0.06] flex items-center gap-1.5 shadow-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]"></span>
          <span>Jbeil (Byblos) Grid</span>
        </div>
      </div>
    </div>
  );
};
