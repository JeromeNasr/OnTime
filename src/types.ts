export type UserRole = 'OWNER' | 'DISPATCHER' | 'LEAD_DRIVER' | 'DRIVER';

export type DriverStatus =
  | 'OFFLINE'
  | 'ONLINE'
  | 'AVAILABLE'
  | 'ASSIGNED'
  | 'EN_ROUTE_PICKUP'
  | 'AT_PICKUP'
  | 'IN_TRANSIT'
  | 'AT_DESTINATION'
  | 'PAUSED';

export type TripStatus =
  | 'CREATED'
  | 'ASSIGNED'
  | 'DRIVER_ACCEPTED'
  | 'EN_ROUTE_PICKUP'
  | 'AT_PICKUP'
  | 'IN_TRANSIT'
  | 'AT_DESTINATION'
  | 'COMPLETED'
  | 'CANCELLED';

// Compatibility alias for API and internal migrations
export type OrderStatus = TripStatus;

export interface User {
  id: string;
  email: string;
  name: string;
  phone: string;
  role: UserRole;
  companyId: string;
  createdAt: number;
}

export interface Company {
  id: string;
  code: string; // human-friendly short code e.g. JBEIL-01
  name: string;
  ownerName: string;
  ownerEmail: string;
  phone?: string;
  createdAt: number;
  settings: {
    adaptiveGpsMovingSec: number;
    adaptiveGpsStoppedSec: number;
    speedLimitKmH: number;
    enablePublicDriverPhone: boolean;
  };
}

// Backwards compatibility alias for Network
export interface Network extends Company {
  leadDriverId?: string;
}

export interface Vehicle {
  id: string;
  companyId: string;
  plateNumber: string;
  makeModel: string;
  type: 'sedan' | 'pickup' | 'van' | 'motorcycle';
  year?: number;
  capacityKg?: number;
  assignedDriverId?: string;
  status: 'active' | 'maintenance' | 'inactive';
}

export interface DriverLocation {
  lat: number;
  lng: number;
  speed: number; // km/h
  heading: number; // degrees 0-360
  accuracy: number; // meters
  timestamp: number;
  batteryLevel?: number; // percentage 0-100
  isCharging?: boolean;
  networkStatus?: 'wifi' | '4g' | '3g' | 'offline';
  isSimulated?: boolean;
}

export interface Driver {
  id: string;
  userId?: string;
  companyId?: string;
  name: string;
  phone: string;
  vehicleId?: string;
  vehicleModel: string; // denormalized for UI
  plateNumber: string; // denormalized for UI
  networkCode: string; // denormalized for UI
  isLeadDriver: boolean;
  status: DriverStatus;
  currentLocation: DriverLocation;
  currentOrderId?: string;
  currentTripId?: string;
  totalTrips: number;
  rating: number;
  lastHeartbeat?: number;
  activeTrip?: {
    id: string;
    startTime: number;
    startLocation: { lat: number; lng: number };
    breadcrumbs: DriverLocation[];
    distanceKm: number;
    maxSpeedKmH: number;
  };
}

export interface TripStatusHistoryItem {
  status: TripStatus;
  timestamp: number;
  note?: string;
  updatedBy?: string;
  location?: { lat: number; lng: number };
}

export type OrderStatusHistoryItem = TripStatusHistoryItem;

export interface Trip {
  id: string;
  companyId: string;
  networkCode?: string;
  driverId?: string;
  vehicleId?: string;
  trackingCode: string;
  trackingToken: string; // Cryptographic 256-bit unguessable credential
  trackingTokenExpiresAt?: number;
  studentName: string;
  studentPhone?: string;
  pickupAddress: string;
  pickupCoords: { lat: number; lng: number };
  dropoffAddress: string;
  dropoffCoords: { lat: number; lng: number };
  priority?: 'normal' | 'high' | 'urgent';
  assignedDriverId?: string;
  status: TripStatus;
  createdAt: number;
  updatedAt: number;
  scheduledAt?: number;
  startedAt?: number;
  completedAt?: number;
  estimatedMinutes?: number;
  roadDistanceKm?: number;
  routeGeometry?: [number, number][]; // actual road polyline from OSRM
  statusHistory?: TripStatusHistoryItem[];
  notes?: string;

  // Compatibility fields for legacy references
  customerName?: string;
  customerPhone?: string;
  packageInfo?: string;
  liveEtaMinutes?: number;
}

// Canonical model is Trip; Order is kept only as type alias
export type Order = Trip;

export type StudentTrackingState =
  | 'WAITING_FOR_DRIVER'
  | 'DRIVER_ON_THE_WAY'
  | 'ARRIVING_SOON'
  | 'AT_PICKUP'
  | 'TRIP_IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'LOCATION_UNAVAILABLE'
  | 'TRACKING_EXPIRED';

export interface TripPoint {
  id: string;
  tripId: string;
  lat: number;
  lng: number;
  speedKmH: number;
  heading: number;
  accuracy: number;
  timestamp: number;
  isFiltered?: boolean;
}

export interface TripLog {
  id: string;
  driverId: string;
  driverName: string;
  companyId?: string;
  networkCode?: string;
  vehicleId?: string;
  tripId?: string;
  orderId?: string;
  startTime: number;
  endTime: number;
  startAddress: string;
  endAddress: string;
  distanceKm: number;
  durationMinutes: number;
  avgSpeedKmH: number;
  maxSpeedKmH: number;
  idleMinutes?: number;
  movingMinutes?: number;
  path: [number, number][];
  status?: string;
}

export interface Invite {
  id: string;
  companyId: string;
  code: string;
  token: string;
  role: UserRole;
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  usedCount: number;
  revoked?: boolean;
}

/**
 * Public Student Tracking DTO (Privacy-hardened)
 * Exposes ONLY what the student needs to view their taxi.
 * NO database IDs, company IDs, driver phone, private driver info, or internal notes.
 */
export interface PublicTrackingResponse {
  status: TripStatus;
  trackingState: StudentTrackingState;
  trackingCode: string;
  companyName?: string;
  studentName?: string;
  pickup: {
    address: string;
    lat: number;
    lng: number;
  };
  destination: {
    address: string;
    lat: number;
    lng: number;
  };
  taxiLocation: {
    lat: number;
    lng: number;
    speed: number;
    heading: number;
    timestamp: number;
  } | null;
  etaMinutes: number | null;
  distanceKm: number | null;
  lastUpdated: number;
  lastUpdatedSecondsAgo: number;
  isStale: boolean;
  gpsFreshness: 'FRESH' | 'STALE' | 'OFFLINE';
  roadRoute: [number, number][];
  vehicle: {
    makeModel: string;
    plateNumber: string;
    type?: string;
  } | null;
  driver?: {
    name: string; // First name only
    vehicleModel?: string;
    plateNumber?: string;
  } | null;

  // Backwards compatibility shim for existing consumers during transition
  tripStatus?: TripStatus;
  order?: {
    id: string;
    trackingCode: string;
    customerName: string;
    pickupAddress: string;
    pickupCoords: { lat: number; lng: number };
    dropoffAddress: string;
    dropoffCoords: { lat: number; lng: number };
    status: TripStatus;
    packageInfo: string;
    updatedAt: number;
  };
  liveEtaMinutes?: number;
  trafficCondition?: string;
  trafficSource?: string;
}

export interface NorthLebanonLocation {
  name: string;
  area: string;
  lat: number;
  lng: number;
  type: 'city' | 'port' | 'commercial' | 'hospital' | 'industrial' | 'highway';
}
