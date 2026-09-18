import {
  Driver,
  Trip,
  Order,
  TripLog,
  Company,
  Vehicle,
  UserRole,
  DriverLocation,
  PublicTrackingResponse,
} from '../types';
import {
  storeOfflineGpsPoint,
  getQueuedOfflineGpsPoints,
  removeSyncedOfflineGpsPoints,
  QueuedGpsPoint,
} from './offlineStorage';

let _authToken: string | null = null;

export function getStoredToken(): string | null {
  return _authToken || localStorage.getItem('ontime_token');
}

export function setStoredToken(token: string): void {
  _authToken = token;
  try {
    localStorage.setItem('ontime_token', token);
  } catch {
    // localStorage might be blocked in restricted iframe
  }
}

export function clearStoredToken(): void {
  _authToken = null;
  try {
    localStorage.removeItem('ontime_token');
  } catch {
    // Ignore
  }
}

// Headers helper with bearer auth
function getHeaders(): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  const token = getStoredToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// ==================== PERSISTENT OFFLINE GPS QUEUE (IndexedDB) ====================

export function queueOfflineGpsPoint(point: DriverLocation & { driverId: string }): void {
  storeOfflineGpsPoint(point).catch((err) => {
    console.warn('Failed to persist offline GPS telemetry:', err);
  });
}

export async function flushOfflineGpsQueue(): Promise<number> {
  try {
    const queuedPoints: QueuedGpsPoint[] = await getQueuedOfflineGpsPoints();
    if (!queuedPoints || queuedPoints.length === 0) return 0;

    // Deduplicate points within 1 second of each other for the same driver
    const deduped: QueuedGpsPoint[] = [];
    for (const pt of queuedPoints) {
      const isDuplicate = deduped.some(
        (existing) =>
          existing.driverId === pt.driverId &&
          Math.abs(existing.timestamp - pt.timestamp) < 1000
      );
      if (!isDuplicate) {
        deduped.push(pt);
      }
    }

    const primaryDriverId = deduped[0]?.driverId;
    if (!primaryDriverId) return 0;

    const pointsToUpload = deduped.filter((p) => p.driverId === primaryDriverId);

    const response = await fetch('/api/telemetry/batch', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        driverId: primaryDriverId,
        points: pointsToUpload.map((p) => ({
          lat: p.lat,
          lng: p.lng,
          speed: p.speed,
          heading: p.heading,
          accuracy: p.accuracy,
          timestamp: p.timestamp,
          batteryLevel: p.batteryLevel,
          networkStatus: p.networkStatus,
          isSimulated: p.isSimulated,
        })),
      }),
    });

    if (response.ok) {
      const uploadedIds = pointsToUpload
        .map((p) => p.localId)
        .filter((id): id is number => typeof id === 'number');
      await removeSyncedOfflineGpsPoints(uploadedIds);
      return pointsToUpload.length;
    }
  } catch (err) {
    console.warn('Offline GPS sync retry will occur upon reconnection:', err);
  }
  return 0;
}

// ==================== API CLIENT ====================

export const api = {
  // ==================== AUTH ====================
  async loginDemo(role: UserRole = 'OWNER', companyCode = 'JBEIL-CAMPUS') {
    const res = await fetch('/api/auth/demo-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, companyCode }),
    });
    if (!res.ok) throw new Error('Demo login failed');
    const data = await res.json();
    setStoredToken(data.token);
    return data;
  },

  async login(email: string, pass: string) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || 'Login failed');
    }
    const data = await res.json();
    setStoredToken(data.token);
    return data;
  },

  async register(params: {
    email: string;
    pass: string;
    name: string;
    phone?: string;
    companyName?: string;
    joinCode?: string;
    role?: UserRole;
  }) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: params.email,
        password: params.pass,
        name: params.name,
        phone: params.phone,
        companyName: params.companyName,
        joinCode: params.joinCode,
        role: params.role,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || 'Registration failed');
    }
    const data = await res.json();
    setStoredToken(data.token);
    return data;
  },

  // ==================== COMPANIES ====================
  async fetchCompanies(): Promise<Company[]> {
    const res = await fetch('/api/companies', { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch fleet companies');
    return res.json();
  },

  async createCompany(name: string, ownerName: string, ownerEmail?: string): Promise<Company> {
    const res = await fetch('/api/companies', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, ownerName, ownerEmail }),
    });
    if (!res.ok) throw new Error('Failed to create company');
    return res.json();
  },

  async createCompanyInvite(companyId: string) {
    const res = await fetch(`/api/companies/${encodeURIComponent(companyId)}/invites`, {
      method: 'GET',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to generate fleet invite code');
    return res.json();
  },

  // ==================== DRIVERS ====================
  async fetchDrivers(companyId?: string): Promise<Driver[]> {
    const url = companyId ? `/api/drivers?companyId=${encodeURIComponent(companyId)}` : '/api/drivers';
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch drivers');
    return res.json();
  },

  async joinDriver(data: {
    name: string;
    phone: string;
    vehicleModel: string;
    plateNumber: string;
    networkCode: string;
    isLeadDriver?: boolean;
  }): Promise<Driver> {
    const res = await fetch('/api/drivers/join', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to register driver in fleet');
    }
    return res.json();
  },

  // ==================== VEHICLES ====================
  async fetchVehicles(companyId?: string): Promise<Vehicle[]> {
    const url = companyId ? `/api/vehicles?companyId=${encodeURIComponent(companyId)}` : '/api/vehicles';
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch vehicles');
    return res.json();
  },

  // ==================== TRIPS (CANONICAL) ====================
  async fetchTrips(companyId?: string, driverId?: string): Promise<Trip[]> {
    let url = '/api/trips';
    const params = new URLSearchParams();
    if (companyId) params.append('companyId', companyId);
    if (driverId) params.append('driverId', driverId);
    if (params.toString()) url += `?${params.toString()}`;

    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch trips');
    return res.json();
  },

  async createTrip(tripData: Partial<Trip>): Promise<Trip> {
    const res = await fetch('/api/trips', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(tripData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Failed to dispatch trip');
    }
    return res.json();
  },

  async assignTrip(tripId: string, driverId?: string): Promise<Trip> {
    const res = await fetch(`/api/trips/${encodeURIComponent(tripId)}/assign`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ driverId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Failed to assign driver to trip');
    }
    return res.json();
  },

  async updateTripStatus(tripId: string, status: string, note?: string): Promise<Trip> {
    const res = await fetch(`/api/trips/${encodeURIComponent(tripId)}/status`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ status, note }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Failed to update trip status');
    }
    return res.json();
  },

  async startDriverTrip(driverId: string) {
    const res = await fetch(`/api/drivers/${encodeURIComponent(driverId)}/trip/start`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return res.json();
  },

  async stopDriverTrip(driverId: string) {
    const res = await fetch(`/api/drivers/${encodeURIComponent(driverId)}/trip/stop`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return res.json();
  },

  async fetchTripHistory(companyId?: string, driverId?: string): Promise<TripLog[]> {
    let url = '/api/trips';
    const params = new URLSearchParams();
    if (companyId) params.append('companyId', companyId);
    if (driverId) params.append('driverId', driverId);
    if (params.toString()) url += `?${params.toString()}`;

    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch trip logs');
    return res.json();
  },

  // Backward compatibility order aliases
  fetchOrders(companyId?: string): Promise<Order[]> {
    return this.fetchTrips(companyId);
  },
  createOrder(orderData: Partial<Order>): Promise<Order> {
    return this.createTrip(orderData);
  },
  assignOrder(orderId: string, driverId?: string): Promise<Order> {
    return this.assignTrip(orderId, driverId);
  },
  updateOrderStatus(orderId: string, status: string, note?: string): Promise<Order> {
    return this.updateTripStatus(orderId, status, note);
  },
  startTrip(driverId: string) {
    return this.startDriverTrip(driverId);
  },
  stopTrip(driverId: string) {
    return this.stopDriverTrip(driverId);
  },

  // ==================== TRACKING ====================
  async trackTrip(tokenOrCode: string): Promise<PublicTrackingResponse> {
    const res = await fetch(`/api/trips/track/${encodeURIComponent(tokenOrCode)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Tracking information not found or link has expired');
    }
    return res.json();
  },

  trackOrder(tokenOrCode: string): Promise<PublicTrackingResponse> {
    return this.trackTrip(tokenOrCode);
  },

  // ==================== TELEMETRY & GPS ====================
  async postTelemetry(payload: {
    driverId: string;
    lat: number;
    lng: number;
    speed: number;
    heading: number;
    accuracy: number;
    batteryLevel?: number;
    networkStatus?: 'wifi' | '4g' | '3g' | 'offline';
    isSimulated?: boolean;
  }) {
    try {
      const res = await fetch('/api/telemetry', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        queueOfflineGpsPoint({
          ...payload,
          timestamp: Date.now(),
        });
      }
      return res.ok;
    } catch {
      queueOfflineGpsPoint({
        ...payload,
        timestamp: Date.now(),
      });
      return false;
    }
  },

  updateLocation(payload: {
    driverId: string;
    lat: number;
    lng: number;
    speed: number;
    heading: number;
    accuracy: number;
    batteryLevel?: number;
    networkStatus?: 'wifi' | '4g' | '3g' | 'offline';
    isSimulated?: boolean;
  }) {
    return this.postTelemetry(payload);
  },

  joinFleet(data: {
    name: string;
    phone: string;
    vehicleModel: string;
    plateNumber: string;
    networkCode: string;
    isLeadDriver?: boolean;
  }) {
    return this.joinDriver(data);
  },

  // ==================== ANALYTICS ====================
  async fetchAnalytics(companyId?: string) {
    const url = companyId ? `/api/analytics?companyId=${encodeURIComponent(companyId)}` : '/api/analytics';
    const res = await fetch(url, { headers: getHeaders() });
    return res.json();
  },
};
