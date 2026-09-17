import { Driver, Order, TripLog, Company, UserRole, DriverLocation, PublicTrackingResponse } from '../types';

let _authToken: string | null = null;
let _offlineGpsQueue: (DriverLocation & { driverId: string })[] = [];

export function getStoredToken(): string | null {
  return _authToken;
}

export function setStoredToken(token: string): void {
  _authToken = token;
}

export function clearStoredToken(): void {
  _authToken = null;
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

// ==================== OFFLINE GPS QUEUE ====================

export function queueOfflineGpsPoint(point: DriverLocation & { driverId: string }): void {
  try {
    _offlineGpsQueue.push(point);
    // Keep max 200 points to prevent storage bloat
    if (_offlineGpsQueue.length > 200) _offlineGpsQueue.shift();
  } catch (err) {
    console.warn('Failed to queue offline GPS point:', err);
  }
}

export async function flushOfflineGpsQueue(): Promise<number> {
  try {
    if (_offlineGpsQueue.length === 0) return 0;
    const queue = [..._offlineGpsQueue];
    const driverId = queue[0].driverId;
    const response = await fetch('/api/telemetry/batch', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        driverId,
        points: queue,
      }),
    });

    if (response.ok) {
      _offlineGpsQueue = [];
      return queue.length;
    }
  } catch (err) {
    console.warn('Offline GPS sync retry will occur later:', err);
  }
  return 0;
}

// ==================== API METHODS ====================

export const api = {
  // Auth
  async loginDemo(role: UserRole = 'OWNER', companyCode = 'NORTH-77') {
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

  async register(params: { email: string; pass: string; name: string; phone?: string; companyName?: string; joinCode?: string; role?: UserRole }) {
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

  // Companies & Networks
  async fetchCompanies(): Promise<Company[]> {
    const res = await fetch('/api/companies', { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch companies');
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
    const res = await fetch(`/api/companies/${companyId}/invites`, {
      method: 'GET',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to generate invite');
    return res.json();
  },

  // Drivers
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
      throw new Error(err.error || 'Failed to join fleet');
    }
    return res.json();
  },

  // Telemetry & GPS
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
    } catch (err) {
      // Offline: queue in local storage for automatic retry
      queueOfflineGpsPoint({
        ...payload,
        timestamp: Date.now(),
      });
      return false;
    }
  },

  // Trips
  async startTrip(driverId: string) {
    const res = await fetch(`/api/drivers/${driverId}/trip/start`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return res.json();
  },

  async stopTrip(driverId: string) {
    const res = await fetch(`/api/drivers/${driverId}/trip/stop`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return res.json();
  },

  async fetchTrips(companyId?: string, driverId?: string): Promise<TripLog[]> {
    let url = '/api/trips';
    const params = new URLSearchParams();
    if (companyId) params.append('companyId', companyId);
    if (driverId) params.append('driverId', driverId);
    if (params.toString()) url += `?${params.toString()}`;

    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch trips');
    return res.json();
  },

  // Orders
  async fetchOrders(companyId?: string): Promise<Order[]> {
    const url = companyId ? `/api/orders?companyId=${encodeURIComponent(companyId)}` : '/api/orders';
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch orders');
    return res.json();
  },

  async createOrder(orderData: Partial<Order>): Promise<Order> {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(orderData),
    });
    if (!res.ok) throw new Error('Failed to create order');
    return res.json();
  },

  async assignOrder(orderId: string, driverId?: string): Promise<Order> {
    const res = await fetch(`/api/orders/${orderId}/assign`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ driverId }),
    });
    if (!res.ok) throw new Error('Failed to assign order');
    return res.json();
  },

  async updateOrderStatus(orderId: string, status: string, note?: string): Promise<Order> {
    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ status, note }),
    });
    if (!res.ok) throw new Error('Failed to update order status');
    return res.json();
  },

  // Customer Tracking
  async trackOrder(tokenOrCode: string): Promise<PublicTrackingResponse> {
    const res = await fetch(`/api/orders/track/${encodeURIComponent(tokenOrCode)}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || 'Tracking information not found');
    }
    return res.json();
  },

  // Analytics
  async fetchAnalytics(companyId?: string) {
    const url = companyId ? `/api/analytics?companyId=${encodeURIComponent(companyId)}` : '/api/analytics';
    const res = await fetch(url, { headers: getHeaders() });
    return res.json();
  },

  // Aliases for ergonomics
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
};

