export interface DriverLocation {
  lat: number;
  lng: number;
  speed: number; // km/h
  heading: number; // degrees
  accuracy: number; // meters
  timestamp: number;
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  vehicleModel: string;
  plateNumber: string;
  networkCode: string;
  isLeadDriver: boolean;
  status: 'available' | 'busy' | 'offline';
  currentLocation: DriverLocation;
  currentOrderId?: string;
  totalTrips: number;
  rating: number;
  activeTrip?: {
    id: string;
    startTime: number;
    startLocation: { lat: number; lng: number };
    breadcrumbs: DriverLocation[];
    distanceKm: number;
    maxSpeedKmH: number;
  };
}

export interface Order {
  id: string;
  networkCode: string;
  customerName: string;
  customerPhone: string;
  pickupAddress: string;
  pickupCoords: { lat: number; lng: number };
  dropoffAddress: string;
  dropoffCoords: { lat: number; lng: number };
  packageInfo: string;
  assignedDriverId?: string;
  status: 'pending' | 'assigned' | 'picked_up' | 'in_transit' | 'delivered' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  estimatedMinutes?: number;
  trackingCode: string;
}

export interface TripLog {
  id: string;
  driverId: string;
  driverName: string;
  networkCode: string;
  startTime: number;
  endTime: number;
  startAddress: string;
  endAddress: string;
  distanceKm: number;
  durationMinutes: number;
  avgSpeedKmH: number;
  maxSpeedKmH: number;
  orderId?: string;
  path: [number, number][];
}

export interface Network {
  code: string;
  name: string;
  ownerName: string;
  createdAt: number;
  leadDriverId?: string;
}

export interface NorthLebanonLocation {
  name: string;
  area: string;
  lat: number;
  lng: number;
  type: 'city' | 'port' | 'commercial' | 'hospital' | 'industrial' | 'highway';
}
