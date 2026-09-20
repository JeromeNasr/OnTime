import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import {
  User,
  Company,
  Vehicle,
  Driver,
  Trip,
  TripLog,
  TripPoint,
  Invite,
  TripStatus,
  TripStatusHistoryItem,
  UserRole,
} from '../types';

export const VALID_TRIP_TRANSITIONS: Record<string, string[]> = {
  CREATED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['DRIVER_ACCEPTED', 'EN_ROUTE_PICKUP', 'CANCELLED', 'CREATED'],
  DRIVER_ACCEPTED: ['EN_ROUTE_PICKUP', 'CANCELLED'],
  EN_ROUTE_PICKUP: ['AT_PICKUP', 'CANCELLED'],
  AT_PICKUP: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['AT_DESTINATION', 'COMPLETED', 'CANCELLED'],
  AT_DESTINATION: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function toCanonicalTripStatus(status: string): TripStatus {
  const s = (status || '').toUpperCase().trim();
  if (s === 'DRIVER_EN_ROUTE_PICKUP') return 'EN_ROUTE_PICKUP';
  if (s === 'ARRIVED_PICKUP') return 'AT_PICKUP';
  if (s === 'PICKED_UP') return 'IN_TRANSIT';
  if (s === 'ARRIVED_DESTINATION') return 'AT_DESTINATION';
  if (s === 'DELIVERED') return 'COMPLETED';
  return s as TripStatus;
}

export function getGpsFreshness(timestamp: number): 'FRESH' | 'STALE' | 'OFFLINE' {
  const ageSec = (Date.now() - timestamp) / 1000;
  if (ageSec < 25) return 'FRESH';
  if (ageSec <= 120) return 'STALE';
  return 'OFFLINE';
}

export interface AuditLog {
  id: string;
  companyId: string;
  userId?: string;
  action: string;
  details: string;
  timestamp: number;
  ipAddress?: string;
}

export interface Device {
  id: string;
  driverId: string;
  platform: 'android' | 'ios' | 'web';
  osVersion?: string;
  appVersion?: string;
  batteryLevel?: number;
  lastHeartbeat: number;
}

interface DatabaseSchema {
  users: Record<string, User & { passwordHash: string }>;
  companies: Record<string, Company & { leadDriverId?: string }>;
  vehicles: Record<string, Vehicle>;
  devices: Record<string, Device>;
  drivers: Record<string, Driver>;
  trips: Record<string, Trip>;
  tripLogs: Record<string, TripLog>;
  tripPoints: Record<string, TripPoint[]>;
  invites: Record<string, Invite>;
  auditLogs: AuditLog[];
}

// In-memory cache synced with PostgreSQL
const activeTripsMap: Record<string, Trip> = {};
const tripLogsMap: Record<string, TripLog> = {};

const dbState: DatabaseSchema = {
  users: {},
  companies: {},
  vehicles: {},
  devices: {},
  drivers: {},
  trips: activeTripsMap,
  tripLogs: tripLogsMap,
  tripPoints: {},
  invites: {},
  auditLogs: [],
};

// PostgreSQL Connection Pool
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
});

export { pool };

// Async helper to fire-and-forget or await safe SQL
async function executeSql(query: string, params: any[] = []): Promise<any> {
  try {
    return await pool.query(query, params);
  } catch (err) {
    console.error('Database write error:', err, 'Query was:', query.slice(0, 100));
    return null;
  }
}

/**
 * Prune old location pings older than 48 hours to enforce retention policy
 */
export async function pruneOldPings(): Promise<void> {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  await executeSql('DELETE FROM location_pings WHERE timestamp < $1;', [cutoff]);
}

/**
 * Initializes schema, seeds PostgreSQL if empty, and hydrates in-memory cache
 */
export async function initDatabase(): Promise<void> {
  try {
    // Run safe table migration checks to ensure all canonical columns exist
    await executeSql(`
      ALTER TABLE trips ADD COLUMN IF NOT EXISTS scheduled_at BIGINT;
      ALTER TABLE trips ADD COLUMN IF NOT EXISTS started_at BIGINT;
      ALTER TABLE trips ADD COLUMN IF NOT EXISTS completed_at BIGINT;
      ALTER TABLE trips ADD COLUMN IF NOT EXISTS vehicle_id VARCHAR(64);
      ALTER TABLE trips ADD COLUMN IF NOT EXISTS route_geometry JSONB;
      ALTER TABLE trips ADD COLUMN IF NOT EXISTS token_revoked BOOLEAN DEFAULT FALSE;
      ALTER TABLE drivers ADD COLUMN IF NOT EXISTS current_trip_id VARCHAR(64);
    `);

    const res = await pool.query('SELECT count(*) FROM companies;');
    const count = parseInt(res.rows[0].count, 10);

    if (count === 0) {
      console.log('PostgreSQL database is empty. Seeding initial Jbeil/LAU dorm shuttle fleet...');
      await seedInitialDataToPostgres();
    }

    // Hydrate memory cache from PostgreSQL
    await hydrateFromPostgres();

    // Start 1-hour periodic ping pruning
    setInterval(pruneOldPings, 60 * 60 * 1000);
  } catch (err) {
    console.error('Error during initDatabase:', err);
    // Fallback seed in memory so application runs regardless of network glitches
    seedInitialDataInMemory();
  }
}

async function seedInitialDataToPostgres(): Promise<void> {
  const company1: Company = {
    id: 'comp-byblos-01',
    code: 'JBEIL-01',
    name: 'Byblos Student Fleet & Shuttle',
    ownerName: 'Charbel Abi Nader',
    ownerEmail: 'charbel@byblosfleet.lb',
    phone: '+961 09 540 120',
    createdAt: Date.now() - 86400000 * 7,
    settings: {
      adaptiveGpsMovingSec: 3,
      adaptiveGpsStoppedSec: 25,
      speedLimitKmH: 80,
      enablePublicDriverPhone: false,
    },
  };

  const company2: Company = {
    id: 'comp-lau-dorm',
    code: 'LAU-BLAT',
    name: 'Blat Campus Express Shuttles',
    ownerName: 'Elie Karam',
    ownerEmail: 'elie@blatexpress.lb',
    phone: '+961 70 882 144',
    createdAt: Date.now() - 86400000 * 4,
    settings: {
      adaptiveGpsMovingSec: 3,
      adaptiveGpsStoppedSec: 25,
      speedLimitKmH: 80,
      enablePublicDriverPhone: false,
    },
  };

  await executeSql(
    `INSERT INTO companies (id, code, name, owner_name, owner_email, phone, settings, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING;`,
    [company1.id, company1.code, company1.name, company1.ownerName, company1.ownerEmail, company1.phone, JSON.stringify(company1.settings), company1.createdAt]
  );

  await executeSql(
    `INSERT INTO companies (id, code, name, owner_name, owner_email, phone, settings, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING;`,
    [company2.id, company2.code, company2.name, company2.ownerName, company2.ownerEmail, company2.phone, JSON.stringify(company2.settings), company2.createdAt]
  );

  const defaultPasswordHash = bcrypt.hashSync('ontime123', 8);

  const userOwner = {
    id: 'usr-owner-1',
    company_id: company1.id,
    email: 'admin@byblosfleet.lb',
    name: 'Charbel Abi Nader',
    phone: '+961 70 882 144',
    role: 'OWNER',
    password_hash: defaultPasswordHash,
    created_at: Date.now() - 86400000 * 7,
  };

  const userLead = {
    id: 'usr-lead-1',
    company_id: company1.id,
    email: 'driver1@byblosfleet.lb',
    name: 'Tarek Haddad (Lead)',
    phone: '+961 70 123 456',
    role: 'LEAD_DRIVER',
    password_hash: defaultPasswordHash,
    created_at: Date.now() - 86400000 * 7,
  };

  await executeSql(
    `INSERT INTO users (id, company_id, email, name, phone, role, password_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING;`,
    [userOwner.id, userOwner.company_id, userOwner.email, userOwner.name, userOwner.phone, userOwner.role, userOwner.password_hash, userOwner.created_at]
  );

  await executeSql(
    `INSERT INTO users (id, company_id, email, name, phone, role, password_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING;`,
    [userLead.id, userLead.company_id, userLead.email, userLead.name, userLead.phone, userLead.role, userLead.password_hash, userLead.created_at]
  );

  // Vehicles
  const vehicles = [
    { id: 'veh-hilux-1', company_id: company1.id, plate_number: 'J-48291', make_model: 'Toyota Hilux Shuttle', type: 'van', year: 2022, capacity: 4, status: 'active', assigned_driver_id: 'drv-lead-1', created_at: Date.now() },
    { id: 'veh-elantra-2', company_id: company1.id, plate_number: 'J-78932', make_model: 'Hyundai Elantra', type: 'sedan', year: 2021, capacity: 4, status: 'active', assigned_driver_id: 'drv-2', created_at: Date.now() },
    { id: 'veh-kangoo-3', company_id: company1.id, plate_number: 'J-31209', make_model: 'Renault Kangoo Mini-Shuttle', type: 'van', year: 2023, capacity: 6, status: 'active', assigned_driver_id: 'drv-3', created_at: Date.now() },
    { id: 'veh-cerato-4', company_id: company1.id, plate_number: 'J-99214', make_model: 'Kia Cerato', type: 'sedan', year: 2020, capacity: 4, status: 'active', assigned_driver_id: 'drv-4', created_at: Date.now() },
    { id: 'veh-shuttle-5', company_id: company2.id, plate_number: 'J-12845', make_model: 'Nissan NV200 Dorm Shuttle', type: 'van', year: 2023, capacity: 7, status: 'active', assigned_driver_id: 'drv-batroun-1', created_at: Date.now() },
  ];

  for (const v of vehicles) {
    await executeSql(
      `INSERT INTO vehicles (id, company_id, plate_number, make_model, type, year, capacity, status, assigned_driver_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING;`,
      [v.id, v.company_id, v.plate_number, v.make_model, v.type, v.year, v.capacity, v.status, v.assigned_driver_id, v.created_at]
    );
  }

  // Drivers
  const drivers = [
    {
      id: 'drv-lead-1',
      user_id: userLead.id,
      company_id: company1.id,
      vehicle_id: 'veh-hilux-1',
      name: 'Tarek Haddad (Lead Driver)',
      phone: '+961 70 123 456',
      vehicle_model: 'Toyota Hilux Shuttle',
      plate_number: 'J-48291',
      is_lead_driver: true,
      status: 'EN_ROUTE_PICKUP',
      current_location: {
        lat: 34.1228,
        lng: 35.6648,
        speed: 38,
        heading: 260,
        accuracy: 4,
        timestamp: Date.now(),
        batteryLevel: 92,
        networkStatus: '4g',
      },
      current_trip_id: 'ORD-TRIP-101',
      total_trips: 142,
      rating: 4.9,
      last_heartbeat: Date.now(),
      created_at: Date.now() - 86400000 * 7,
    },
    {
      id: 'drv-2',
      user_id: null,
      company_id: company1.id,
      vehicle_id: 'veh-elantra-2',
      name: 'Ahmad Masri',
      phone: '+961 71 889 012',
      vehicle_model: 'Hyundai Elantra',
      plate_number: 'J-78932',
      is_lead_driver: false,
      status: 'IN_TRANSIT',
      current_location: {
        lat: 34.1205,
        lng: 35.6608,
        speed: 32,
        heading: 40,
        accuracy: 5,
        timestamp: Date.now(),
        batteryLevel: 68,
        networkStatus: '4g',
      },
      current_trip_id: 'ORD-TRIP-102',
      total_trips: 98,
      rating: 4.8,
      last_heartbeat: Date.now(),
      created_at: Date.now() - 86400000 * 5,
    },
    {
      id: 'drv-3',
      user_id: null,
      company_id: company1.id,
      vehicle_id: 'veh-kangoo-3',
      name: 'Charbel Sarkis',
      phone: '+961 03 456 789',
      vehicle_model: 'Renault Kangoo Mini-Shuttle',
      plate_number: 'J-31209',
      is_lead_driver: false,
      status: 'AVAILABLE',
      current_location: {
        lat: 34.1265,
        lng: 35.652,
        speed: 0,
        heading: 90,
        accuracy: 5,
        timestamp: Date.now(),
        batteryLevel: 95,
        networkStatus: 'wifi',
      },
      current_trip_id: null,
      total_trips: 64,
      rating: 4.7,
      last_heartbeat: Date.now(),
      created_at: Date.now() - 86400000 * 3,
    },
    {
      id: 'drv-4',
      user_id: null,
      company_id: company1.id,
      vehicle_id: 'veh-cerato-4',
      name: 'Wissam Chehade',
      phone: '+961 76 543 210',
      vehicle_model: 'Kia Cerato',
      plate_number: 'J-99214',
      is_lead_driver: false,
      status: 'AVAILABLE',
      current_location: {
        lat: 34.1165,
        lng: 35.6558,
        speed: 0,
        heading: 180,
        accuracy: 4,
        timestamp: Date.now(),
        batteryLevel: 80,
        networkStatus: '4g',
      },
      current_trip_id: null,
      total_trips: 115,
      rating: 4.95,
      last_heartbeat: Date.now(),
      created_at: Date.now() - 86400000 * 6,
    },
  ];

  for (const d of drivers) {
    await executeSql(
      `INSERT INTO drivers (id, user_id, company_id, vehicle_id, name, phone, vehicle_model, plate_number, is_lead_driver, status, current_location, current_trip_id, total_trips, rating, last_heartbeat, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (id) DO NOTHING;`,
      [d.id, d.user_id, d.company_id, d.vehicle_id, d.name, d.phone, d.vehicle_model, d.plate_number, d.is_lead_driver, d.status, JSON.stringify(d.current_location), d.current_trip_id, d.total_trips, d.rating, d.last_heartbeat, d.created_at]
    );
  }

  // Trips
  const trips = [
    {
      id: 'ORD-TRIP-101',
      company_id: company1.id,
      driver_id: 'drv-lead-1',
      vehicle_id: 'veh-hilux-1',
      tracking_code: 'TRK-8821',
      tracking_token: 'tok_live_8821_jbeil_dorms',
      token_expires_at: Date.now() + 86400000 * 2,
      student_name: 'Lina Khoury (Room 304)',
      student_phone: '+961 70 445 566',
      pickup_address: 'Campus Crest Student Residences, Blat',
      pickup_lat: 34.1215,
      pickup_lng: 35.663,
      destination_address: 'LAU Byblos - Upper Gate (Science Complex)',
      destination_lat: 34.1238,
      destination_lng: 35.6698,
      status: 'EN_ROUTE_PICKUP',
      estimated_minutes: 5,
      road_distance_km: 1.2,
      created_at: Date.now() - 1800000,
      updated_at: Date.now() - 300000,
      notes: 'Morning Campus Commute',
    },
    {
      id: 'ORD-TRIP-102',
      company_id: company1.id,
      driver_id: 'drv-2',
      vehicle_id: 'veh-elantra-2',
      tracking_code: 'TRK-4419',
      tracking_token: 'tok_live_4419_lau_byblos',
      token_expires_at: Date.now() + 86400000 * 2,
      student_name: 'Marc Eid (Green House)',
      student_phone: '+961 71 332 211',
      pickup_address: 'Green House Student Dorms, Blat Road',
      pickup_lat: 34.1202,
      pickup_lng: 35.6605,
      destination_address: 'LAU Byblos - Lower Gate (Engineering Hall)',
      destination_lat: 34.1248,
      destination_lng: 35.6662,
      status: 'IN_TRANSIT',
      estimated_minutes: 6,
      road_distance_km: 1.8,
      created_at: Date.now() - 2400000,
      updated_at: Date.now() - 600000,
      notes: 'Engineering Lab Ride',
    },
    {
      id: 'ORD-TRIP-103',
      company_id: company1.id,
      driver_id: null,
      vehicle_id: null,
      tracking_code: 'TRK-1920',
      tracking_token: 'tok_live_1920_mastita_lau',
      token_expires_at: Date.now() + 86400000 * 2,
      student_name: 'Nour Salem (Mastita Housing)',
      student_phone: '+961 03 881 299',
      pickup_address: 'Mastita - Student Village & Housing',
      pickup_lat: 34.1165,
      pickup_lng: 35.6558,
      destination_address: 'Jbeil Voie 13 / Highway Hub',
      destination_lat: 34.1265,
      destination_lng: 35.652,
      status: 'CREATED',
      estimated_minutes: 8,
      road_distance_km: 2.2,
      created_at: Date.now() - 900000,
      updated_at: Date.now() - 900000,
      notes: 'Dorm to Highway Shuttle',
    },
  ];

  for (const t of trips) {
    await executeSql(
      `INSERT INTO trips (id, company_id, driver_id, vehicle_id, tracking_code, tracking_token, token_expires_at, student_name, student_phone, pickup_address, pickup_lat, pickup_lng, destination_address, destination_lat, destination_lng, status, estimated_minutes, road_distance_km, created_at, updated_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
       ON CONFLICT (id) DO NOTHING;`,
      [t.id, t.company_id, t.driver_id, t.vehicle_id, t.tracking_code, t.tracking_token, t.token_expires_at, t.student_name, t.student_phone, t.pickup_address, t.pickup_lat, t.pickup_lng, t.destination_address, t.destination_lat, t.destination_lng, t.status, t.estimated_minutes, t.road_distance_km, t.created_at, t.updated_at, t.notes]
    );

    // Initial student tracking session
    await executeSql(
      `INSERT INTO student_tracking_sessions (id, trip_id, token, created_at, expires_at, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       ON CONFLICT (id) DO NOTHING;`,
      [`sess-${t.id}`, t.id, t.tracking_token, t.created_at, t.token_expires_at]
    );
  }

  // Initial Invite
  const inviteCode = 'JBEIL-882';
  const inviteToken = crypto.randomBytes(16).toString('hex');
  await executeSql(
    `INSERT INTO invites (id, company_id, code, token, role, created_at, expires_at, max_uses, used_count)
     VALUES ($1, $2, $3, $4, 'DRIVER', $5, $6, 50, 0)
     ON CONFLICT (id) DO NOTHING;`,
    ['inv-init-1', company1.id, inviteCode, inviteToken, Date.now(), Date.now() + 86400000 * 30]
  );
}

async function hydrateFromPostgres(): Promise<void> {
  const [compRes, usrRes, vehRes, drvRes, tripRes, tripLogRes, invRes, auditRes] = await Promise.all([
    pool.query('SELECT * FROM companies;'),
    pool.query('SELECT * FROM users;'),
    pool.query('SELECT * FROM vehicles;'),
    pool.query('SELECT * FROM drivers;'),
    pool.query('SELECT * FROM trips;'),
    pool.query('SELECT * FROM trip_logs ORDER BY end_time DESC LIMIT 200;').catch(() => ({ rows: [] })),
    pool.query('SELECT * FROM invites;'),
    pool.query('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 200;'),
  ]);

  compRes.rows.forEach((r) => {
    dbState.companies[r.id] = {
      id: r.id,
      code: r.code,
      name: r.name,
      ownerName: r.owner_name,
      ownerEmail: r.owner_email,
      phone: r.phone,
      createdAt: Number(r.created_at),
      settings: typeof r.settings === 'string' ? JSON.parse(r.settings) : r.settings,
    };
  });

  usrRes.rows.forEach((r) => {
    dbState.users[r.id] = {
      id: r.id,
      companyId: r.company_id,
      email: r.email,
      name: r.name,
      phone: r.phone,
      role: r.role,
      passwordHash: r.password_hash,
      createdAt: Number(r.created_at),
    };
  });

  vehRes.rows.forEach((r) => {
    dbState.vehicles[r.id] = {
      id: r.id,
      companyId: r.company_id,
      plateNumber: r.plate_number,
      makeModel: r.make_model,
      type: r.type,
      year: r.year,
      capacityKg: r.capacity * 100,
      status: r.status,
      assignedDriverId: r.assigned_driver_id,
    };
  });

  drvRes.rows.forEach((r) => {
    const loc = typeof r.current_location === 'string' ? JSON.parse(r.current_location) : r.current_location;
    const comp = dbState.companies[r.company_id];
    dbState.drivers[r.id] = {
      id: r.id,
      userId: r.user_id,
      companyId: r.company_id,
      vehicleId: r.vehicle_id,
      name: r.name,
      phone: r.phone,
      vehicleModel: r.vehicle_model,
      plateNumber: r.plate_number,
      networkCode: comp ? comp.code : 'FLEET',
      isLeadDriver: r.is_lead_driver,
      status: r.status,
      currentLocation: loc,
      currentTripId: r.current_trip_id || undefined,
      totalTrips: r.total_trips,
      rating: r.rating || 5.0,
      lastHeartbeat: Number(r.last_heartbeat),
    };
  });

  tripRes.rows.forEach((r) => {
    const comp = dbState.companies[r.company_id];
    const tripObj: Trip = {
      id: r.id,
      companyId: r.company_id,
      networkCode: comp ? comp.code : 'FLEET',
      trackingCode: r.tracking_code,
      trackingToken: r.tracking_token,
      trackingTokenExpiresAt: r.token_expires_at ? Number(r.token_expires_at) : undefined,
      tokenExpiresAt: r.token_expires_at ? Number(r.token_expires_at) : undefined,
      tokenRevoked: !!r.token_revoked,
      studentName: r.student_name,
      studentPhone: r.student_phone,
      pickupAddress: r.pickup_address,
      pickupCoords: { lat: r.pickup_lat, lng: r.pickup_lng },
      dropoffAddress: r.destination_address,
      dropoffCoords: { lat: r.destination_lat, lng: r.destination_lng },
      driverId: r.driver_id || undefined,
      assignedDriverId: r.driver_id || undefined,
      vehicleId: r.vehicle_id || undefined,
      status: r.status,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      scheduledAt: r.scheduled_at ? Number(r.scheduled_at) : undefined,
      startedAt: r.started_at ? Number(r.started_at) : undefined,
      completedAt: r.completed_at ? Number(r.completed_at) : undefined,
      estimatedMinutes: r.estimated_minutes,
      roadDistanceKm: r.road_distance_km,
      routeGeometry: typeof r.route_geometry === 'string' ? JSON.parse(r.route_geometry) : r.route_geometry,
      notes: r.notes,
    };
    dbState.trips[r.id] = tripObj;
  });

  tripLogRes.rows.forEach((r: any) => {
    dbState.tripLogs[r.id] = {
      id: r.id,
      tripId: r.trip_id || undefined,
      driverId: r.driver_id,
      driverName: r.driver_name,
      companyId: r.company_id,
      vehicleId: r.vehicle_id,
      startTime: Number(r.start_time),
      endTime: Number(r.end_time),
      startAddress: r.start_address,
      endAddress: r.end_address,
      distanceKm: Number(r.distance_km),
      durationMinutes: Number(r.duration_minutes),
      avgSpeedKmH: Number(r.avg_speed_kmh),
      maxSpeedKmH: Number(r.max_speed_kmh),
      path: typeof r.path === 'string' ? JSON.parse(r.path) : r.path || [],
      status: r.status || 'COMPLETED',
    };
  });

  invRes.rows.forEach((r) => {
    dbState.invites[r.id] = {
      id: r.id,
      companyId: r.company_id,
      code: r.code,
      token: r.token,
      role: r.role,
      createdAt: Number(r.created_at),
      expiresAt: Number(r.expires_at),
      maxUses: r.max_uses,
      usedCount: r.used_count,
      revoked: r.revoked,
    };
  });

  dbState.auditLogs = auditRes.rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    userId: r.user_id,
    action: r.action,
    details: r.details,
    ipAddress: r.ip_address,
    timestamp: Number(r.timestamp),
  }));

  console.log(
    `Hydrated from PostgreSQL: ${Object.keys(dbState.companies).length} companies, ${
      Object.keys(dbState.drivers).length
    } drivers, ${Object.keys(dbState.trips).length} canonical trips, ${Object.keys(dbState.tripLogs).length} trip logs.`
  );
}

function seedInitialDataInMemory(): void {
  // Safe in-memory fallback if Postgres temporarily unavailable
  const defaultPasswordHash = bcrypt.hashSync('ontime123', 8);
  const company1: Company = {
    id: 'comp-byblos-01',
    code: 'JBEIL-01',
    name: 'Byblos Student Fleet & Shuttle',
    ownerName: 'Charbel Abi Nader',
    ownerEmail: 'charbel@byblosfleet.lb',
    phone: '+961 09 540 120',
    createdAt: Date.now() - 86400000 * 7,
    settings: {
      adaptiveGpsMovingSec: 3,
      adaptiveGpsStoppedSec: 25,
      speedLimitKmH: 80,
      enablePublicDriverPhone: false,
    },
  };
  dbState.companies[company1.id] = company1;
  const userOwner = {
    id: 'usr-owner-1',
    email: 'admin@byblosfleet.lb',
    name: 'Charbel Abi Nader',
    phone: '+961 70 882 144',
    role: 'OWNER' as UserRole,
    companyId: company1.id,
    createdAt: Date.now() - 86400000 * 7,
    passwordHash: defaultPasswordHash,
  };
  dbState.users[userOwner.id] = userOwner;
}

export const db = {
  // Companies
  getCompany(id: string): Company | null {
    return dbState.companies[id] || null;
  },

  getCompanyByCode(code: string): Company | null {
    const clean = code.trim().toUpperCase();
    return Object.values(dbState.companies).find((c) => c.code.toUpperCase() === clean) || null;
  },

  listCompanies(): Company[] {
    return Object.values(dbState.companies);
  },

  async createCompany(companyData: {
    code: string;
    name: string;
    ownerName: string;
    ownerEmail: string;
    phone?: string;
  }): Promise<Company> {
    const id = `comp-${crypto.randomUUID().slice(0, 8)}`;
    const company: Company = {
      id,
      code: companyData.code.trim().toUpperCase(),
      name: companyData.name.trim(),
      ownerName: companyData.ownerName.trim(),
      ownerEmail: companyData.ownerEmail.trim().toLowerCase(),
      phone: companyData.phone,
      createdAt: Date.now(),
      settings: {
        adaptiveGpsMovingSec: 3,
        adaptiveGpsStoppedSec: 25,
        speedLimitKmH: 80,
        enablePublicDriverPhone: false,
      },
    };

    dbState.companies[id] = company;

    await executeSql(
      `INSERT INTO companies (id, code, name, owner_name, owner_email, phone, settings, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
      [company.id, company.code, company.name, company.ownerName, company.ownerEmail, company.phone, JSON.stringify(company.settings), company.createdAt]
    );

    return company;
  },

  // Users
  getUserByEmail(email: string): (User & { passwordHash: string }) | null {
    const clean = email.trim().toLowerCase();
    return Object.values(dbState.users).find((u) => u.email.toLowerCase() === clean) || null;
  },

  getUser(id: string): User | null {
    return dbState.users[id] || null;
  },

  async createUser(userData: {
    email: string;
    name: string;
    phone: string;
    role: UserRole;
    companyId: string;
    passwordHash: string;
  }): Promise<User> {
    const id = `usr-${crypto.randomUUID().slice(0, 8)}`;
    const user: User & { passwordHash: string } = {
      id,
      email: userData.email.trim().toLowerCase(),
      name: userData.name.trim(),
      phone: userData.phone.trim(),
      role: userData.role,
      companyId: userData.companyId,
      createdAt: Date.now(),
      passwordHash: userData.passwordHash,
    };

    dbState.users[id] = user;

    await executeSql(
      `INSERT INTO users (id, company_id, email, name, phone, role, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
      [user.id, user.companyId, user.email, user.name, user.phone, user.role, user.passwordHash, user.createdAt]
    );

    // Also link company_member
    await executeSql(
      `INSERT INTO company_members (id, company_id, user_id, role, joined_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (company_id, user_id) DO NOTHING;`,
      [`mem-${id}`, user.companyId, user.id, user.role, user.createdAt]
    );

    return user;
  },

  listUsers(companyId: string): User[] {
    return Object.values(dbState.users).filter((u) => u.companyId === companyId);
  },

  // Vehicles
  listVehicles(companyId: string): Vehicle[] {
    return Object.values(dbState.vehicles).filter((v) => v.companyId === companyId);
  },

  getVehicle(id: string): Vehicle | null {
    return dbState.vehicles[id] || null;
  },

  async createVehicle(vehicleData: {
    companyId: string;
    plateNumber: string;
    makeModel: string;
    type: 'sedan' | 'pickup' | 'van' | 'motorcycle';
    year?: number;
    capacityKg?: number;
  }): Promise<Vehicle> {
    const id = `veh-${crypto.randomUUID().slice(0, 8)}`;
    const vehicle: Vehicle = {
      id,
      companyId: vehicleData.companyId,
      plateNumber: vehicleData.plateNumber.trim(),
      makeModel: vehicleData.makeModel.trim(),
      type: vehicleData.type,
      year: vehicleData.year,
      capacityKg: vehicleData.capacityKg,
      status: 'active',
    };

    dbState.vehicles[id] = vehicle;

    await executeSql(
      `INSERT INTO vehicles (id, company_id, plate_number, make_model, type, year, capacity, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
      [vehicle.id, vehicle.companyId, vehicle.plateNumber, vehicle.makeModel, vehicle.type, vehicle.year || null, vehicle.capacityKg ? Math.round(vehicle.capacityKg / 100) : 4, vehicle.status, Date.now()]
    );

    return vehicle;
  },

  // Drivers
  getDriver(id: string): Driver | null {
    return dbState.drivers[id] || null;
  },

  getDriverByUserId(userId: string): Driver | null {
    return Object.values(dbState.drivers).find((d) => d.userId === userId) || null;
  },

  listDrivers(companyId?: string): Driver[] {
    let drivers = Object.values(dbState.drivers);
    if (companyId) {
      drivers = drivers.filter((d) => d.companyId === companyId);
    }
    return drivers;
  },

  async createDriver(driverData: {
    name: string;
    phone: string;
    vehicleModel: string;
    plateNumber: string;
    companyId: string;
    vehicleId?: string;
    userId?: string;
    isLeadDriver?: boolean;
    initialLat?: number;
    initialLng?: number;
  }): Promise<Driver> {
    const id = `drv-${crypto.randomUUID().slice(0, 8)}`;
    const comp = dbState.companies[driverData.companyId];

    const driver: Driver = {
      id,
      userId: driverData.userId,
      companyId: driverData.companyId,
      vehicleId: driverData.vehicleId,
      name: driverData.name.trim(),
      phone: driverData.phone.trim(),
      vehicleModel: driverData.vehicleModel.trim(),
      plateNumber: driverData.plateNumber.trim(),
      networkCode: comp ? comp.code : 'FLEET',
      isLeadDriver: driverData.isLeadDriver || false,
      status: 'AVAILABLE',
      currentLocation: {
        lat: driverData.initialLat || 34.1238,
        lng: driverData.initialLng || 35.651,
        speed: 0,
        heading: 0,
        accuracy: 5,
        timestamp: Date.now(),
        batteryLevel: 90,
        networkStatus: '4g',
      },
      totalTrips: 0,
      rating: 5.0,
      lastHeartbeat: Date.now(),
    };

    dbState.drivers[id] = driver;

    await executeSql(
      `INSERT INTO drivers (id, user_id, company_id, vehicle_id, name, phone, vehicle_model, plate_number, is_lead_driver, status, current_location, total_trips, rating, last_heartbeat, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15);`,
      [driver.id, driver.userId || null, driver.companyId, driver.vehicleId || null, driver.name, driver.phone, driver.vehicleModel, driver.plateNumber, driver.isLeadDriver, driver.status, JSON.stringify(driver.currentLocation), driver.totalTrips, driver.rating, driver.lastHeartbeat, Date.now()]
    );

    return driver;
  },

  async updateDriverLocation(
    id: string,
    location: {
      lat: number;
      lng: number;
      speed: number;
      heading: number;
      accuracy: number;
      timestamp?: number;
      batteryLevel?: number;
      isCharging?: boolean;
      networkStatus?: 'wifi' | '4g' | '3g' | 'offline';
      isSimulated?: boolean;
    }
  ): Promise<Driver | null> {
    const driver = dbState.drivers[id];
    if (!driver) return null;

    const timestamp = location.timestamp || Date.now();
    driver.currentLocation = {
      lat: location.lat,
      lng: location.lng,
      speed: Math.max(0, location.speed),
      heading: location.heading,
      accuracy: location.accuracy,
      timestamp,
      batteryLevel: location.batteryLevel,
      isCharging: location.isCharging,
      networkStatus: location.networkStatus,
      isSimulated: location.isSimulated,
    };
    driver.lastHeartbeat = timestamp;

    // Update in Postgres
    await executeSql(
      `UPDATE drivers
       SET current_location = $1, last_heartbeat = $2
       WHERE id = $3;`,
      [JSON.stringify(driver.currentLocation), driver.lastHeartbeat, driver.id]
    );

    // Record ping for audit/retention tracking
    const pingId = `png-${crypto.randomUUID().slice(0, 8)}`;
    await executeSql(
      `INSERT INTO location_pings (id, driver_id, trip_id, lat, lng, speed, heading, accuracy, battery_level, network_status, is_simulated, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);`,
      [pingId, driver.id, driver.currentTripId || null, location.lat, location.lng, location.speed, location.heading, location.accuracy, location.batteryLevel || null, location.networkStatus || null, location.isSimulated || false, timestamp]
    );

    return driver;
  },

  async updateDriverStatus(id: string, status: Driver['status']): Promise<Driver | null> {
    const driver = dbState.drivers[id];
    if (!driver) return null;
    driver.status = status;

    await executeSql(`UPDATE drivers SET status = $1 WHERE id = $2;`, [status, id]);
    return driver;
  },

  // ==================== CANONICAL TRIPS ====================

  getTrip(id: string): Trip | null {
    return dbState.trips[id] || null;
  },

  getTripByToken(token: string): Trip | null {
    const clean = (token || '').trim();
    return Object.values(dbState.trips).find((t) => t.trackingToken === clean && !t.tokenRevoked) || null;
  },

  getTripByTracking(tokenOrCode: string): Trip | null {
    const clean = (tokenOrCode || '').trim();
    const cleanUpper = clean.toUpperCase();
    return (
      Object.values(dbState.trips).find(
        (t) =>
          (t.trackingToken === clean && !t.tokenRevoked) ||
          t.trackingCode.toUpperCase() === cleanUpper ||
          t.id === clean
      ) || null
    );
  },

  listAllTrips(companyId?: string): Trip[] {
    let trips = Object.values(dbState.trips);
    if (companyId) {
      trips = trips.filter((t) => t.companyId === companyId);
    }
    return trips.sort((a, b) => b.createdAt - a.createdAt);
  },

  listTrips(companyId?: string): Trip[] {
    let trips = Object.values(dbState.trips);
    if (companyId) {
      trips = trips.filter((t) => t.companyId === companyId);
    }
    return trips.sort((a, b) => b.createdAt - a.createdAt);
  },

  listActiveTrips(companyId?: string): Trip[] {
    return this.listTrips(companyId);
  },

  async createTrip(tripData: {
    companyId: string;
    studentName?: string;
    studentPhone?: string;
    pickupAddress: string;
    pickupCoords: { lat: number; lng: number };
    dropoffAddress: string;
    dropoffCoords: { lat: number; lng: number };
    notes?: string;
    priority?: 'normal' | 'high' | 'urgent';
    assignedDriverId?: string;
    estimatedMinutes?: number;
    roadDistanceKm?: number;
    routeGeometry?: [number, number][];
  }): Promise<Trip> {
    const id = `trip-${crypto.randomUUID().slice(0, 12)}`;
    const comp = dbState.companies[tripData.companyId];
    const trackingCode = `TRK-${crypto.randomInt(1000, 9999)}`;
    const trackingToken = crypto.randomBytes(24).toString('hex');
    const sName = (tripData.studentName || 'Student').trim();
    const sPhone = (tripData.studentPhone || '').trim();
    const now = Date.now();
    const tokenExpiresAt = now + 86400000 * 2; // 48 hour token lifetime

    const initialStatus: TripStatus = tripData.assignedDriverId ? 'ASSIGNED' : 'CREATED';

    const trip: Trip = {
      id,
      companyId: tripData.companyId,
      networkCode: comp ? comp.code : 'FLEET',
      trackingCode,
      trackingToken,
      trackingTokenExpiresAt: tokenExpiresAt,
      tokenExpiresAt,
      tokenRevoked: false,
      studentName: sName,
      studentPhone: sPhone,
      pickupAddress: tripData.pickupAddress,
      pickupCoords: tripData.pickupCoords,
      dropoffAddress: tripData.dropoffAddress,
      dropoffCoords: tripData.dropoffCoords,
      notes: (tripData.notes || 'Campus Dorm Shuttle').trim(),
      priority: tripData.priority || 'normal',
      assignedDriverId: tripData.assignedDriverId,
      driverId: tripData.assignedDriverId,
      status: initialStatus,
      createdAt: now,
      updatedAt: now,
      estimatedMinutes: tripData.estimatedMinutes || 8,
      roadDistanceKm: tripData.roadDistanceKm || 2.0,
      routeGeometry: tripData.routeGeometry || [],
      statusHistory: [
        {
          status: initialStatus,
          timestamp: now,
          note: tripData.assignedDriverId ? 'Created with driver assignment' : 'Trip created in dispatch queue',
        },
      ],
    };

    dbState.trips[id] = trip;

    if (tripData.assignedDriverId && dbState.drivers[tripData.assignedDriverId]) {
      const driver = dbState.drivers[tripData.assignedDriverId];
      driver.status = 'ASSIGNED';
      driver.currentTripId = id;
      await executeSql(`UPDATE drivers SET status = 'ASSIGNED', current_trip_id = $1 WHERE id = $2;`, [id, driver.id]);
    }

    // Persist trip to Postgres
    await executeSql(
      `INSERT INTO trips (id, company_id, driver_id, tracking_code, tracking_token, token_expires_at, student_name, student_phone, pickup_address, pickup_lat, pickup_lng, destination_address, destination_lat, destination_lng, status, estimated_minutes, road_distance_km, created_at, updated_at, notes, route_geometry)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21);`,
      [trip.id, trip.companyId, trip.assignedDriverId || null, trip.trackingCode, trip.trackingToken, tokenExpiresAt, trip.studentName, trip.studentPhone, trip.pickupAddress, trip.pickupCoords.lat, trip.pickupCoords.lng, trip.dropoffAddress, trip.dropoffCoords.lat, trip.dropoffCoords.lng, trip.status, trip.estimatedMinutes, trip.roadDistanceKm, trip.createdAt, trip.updatedAt, trip.notes, JSON.stringify(trip.routeGeometry)]
    );

    // Persist tracking session
    await executeSql(
      `INSERT INTO student_tracking_sessions (id, trip_id, token, created_at, expires_at, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE);`,
      [`sess-${id}`, id, trackingToken, now, tokenExpiresAt]
    );

    return trip;
  },

  async assignTrip(tripId: string, driverId?: string, authorizedCompanyId?: string): Promise<Trip | { error: string } | null> {
    const trip = dbState.trips[tripId];
    if (!trip) return null;

    if (authorizedCompanyId && trip.companyId !== authorizedCompanyId) {
      return { error: 'Company authorization mismatch: Cannot assign trip belonging to another company.' };
    }

    const now = Date.now();
    if (driverId) {
      const driver = dbState.drivers[driverId];
      if (!driver) return { error: `Driver with ID ${driverId} not found.` };
      if (driver.companyId !== trip.companyId) {
        return { error: 'Cannot assign driver from another company to this trip.' };
      }

      // If previously assigned to another driver, release that driver
      if (trip.assignedDriverId && trip.assignedDriverId !== driverId && dbState.drivers[trip.assignedDriverId]) {
        const prev = dbState.drivers[trip.assignedDriverId];
        prev.status = 'AVAILABLE';
        delete prev.currentTripId;
        await executeSql(`UPDATE drivers SET status = 'AVAILABLE', current_trip_id = NULL WHERE id = $1;`, [prev.id]);
      }

      trip.assignedDriverId = driverId;
      trip.driverId = driverId;
      trip.status = 'ASSIGNED';
      trip.updatedAt = now;
      trip.statusHistory = trip.statusHistory || [];
      trip.statusHistory.push({
        status: 'ASSIGNED',
        timestamp: now,
        note: `Assigned to ${driver.name}`,
      });
      driver.status = 'ASSIGNED';
      driver.currentTripId = trip.id;

      await executeSql(`UPDATE trips SET driver_id = $1, status = 'ASSIGNED', updated_at = $2 WHERE id = $3;`, [driverId, now, tripId]);
      await executeSql(`UPDATE drivers SET status = 'ASSIGNED', current_trip_id = $1 WHERE id = $2;`, [tripId, driverId]);
    } else {
      if (trip.assignedDriverId && dbState.drivers[trip.assignedDriverId]) {
        dbState.drivers[trip.assignedDriverId].status = 'AVAILABLE';
        delete dbState.drivers[trip.assignedDriverId].currentTripId;
        await executeSql(`UPDATE drivers SET status = 'AVAILABLE', current_trip_id = NULL WHERE id = $1;`, [trip.assignedDriverId]);
      }
      trip.assignedDriverId = undefined;
      trip.driverId = undefined;
      trip.status = 'CREATED';
      trip.updatedAt = now;
      trip.statusHistory = trip.statusHistory || [];
      trip.statusHistory.push({
        status: 'CREATED',
        timestamp: now,
        note: 'Trip unassigned back to dispatch pool',
      });

      await executeSql(`UPDATE trips SET driver_id = NULL, status = 'CREATED', updated_at = $1 WHERE id = $2;`, [now, tripId]);
    }

    return trip;
  },

  async updateTripStatus(tripId: string, status: TripStatus, note?: string): Promise<Trip | { error: string } | null> {
    const trip = dbState.trips[tripId];
    if (!trip) return null;

    const currentCanonical = toCanonicalTripStatus(trip.status);
    const targetCanonical = toCanonicalTripStatus(status);

    // Validate state transition
    if (currentCanonical !== targetCanonical) {
      const allowedTargets = VALID_TRIP_TRANSITIONS[currentCanonical] || [];
      if (!allowedTargets.includes(targetCanonical)) {
        return {
          error: `Invalid trip transition from ${currentCanonical} to ${targetCanonical}. Allowed transitions: ${allowedTargets.length ? allowedTargets.join(', ') : 'None (terminal state)'}`,
        };
      }
    }

    const now = Date.now();
    trip.status = targetCanonical;
    trip.updatedAt = now;
    if (targetCanonical === 'EN_ROUTE_PICKUP' && !trip.startedAt) {
      trip.startedAt = now;
      await executeSql(`UPDATE trips SET started_at = $1 WHERE id = $2;`, [now, tripId]);
    }
    if (targetCanonical === 'COMPLETED' && !trip.completedAt) {
      trip.completedAt = now;
      await executeSql(`UPDATE trips SET completed_at = $1 WHERE id = $2;`, [now, tripId]);
    }

    trip.statusHistory = trip.statusHistory || [];
    trip.statusHistory.push({
      status: targetCanonical,
      timestamp: now,
      note,
    });

    if (trip.assignedDriverId && dbState.drivers[trip.assignedDriverId]) {
      const driver = dbState.drivers[trip.assignedDriverId];
      if (targetCanonical === 'COMPLETED' || targetCanonical === 'CANCELLED') {
        driver.status = 'AVAILABLE';
        delete driver.currentTripId;
        if (targetCanonical === 'COMPLETED') {
          driver.totalTrips += 1;
        }
        await executeSql(`UPDATE drivers SET status = 'AVAILABLE', current_trip_id = NULL, total_trips = total_trips + ${targetCanonical === 'COMPLETED' ? 1 : 0} WHERE id = $1;`, [driver.id]);
      } else if (targetCanonical === 'EN_ROUTE_PICKUP') {
        driver.status = 'EN_ROUTE_PICKUP';
        await executeSql(`UPDATE drivers SET status = 'EN_ROUTE_PICKUP' WHERE id = $1;`, [driver.id]);
      } else if (targetCanonical === 'AT_PICKUP') {
        driver.status = 'AT_PICKUP';
        await executeSql(`UPDATE drivers SET status = 'AT_PICKUP' WHERE id = $1;`, [driver.id]);
      } else if (targetCanonical === 'IN_TRANSIT') {
        driver.status = 'IN_TRANSIT';
        await executeSql(`UPDATE drivers SET status = 'IN_TRANSIT' WHERE id = $1;`, [driver.id]);
      } else if (targetCanonical === 'AT_DESTINATION') {
        driver.status = 'AT_DESTINATION';
        await executeSql(`UPDATE drivers SET status = 'AT_DESTINATION' WHERE id = $1;`, [driver.id]);
      }
    }

    await executeSql(`UPDATE trips SET status = $1, updated_at = $2 WHERE id = $3;`, [targetCanonical, now, tripId]);

    // Record status history entry in Postgres
    const histId = `tsh-${crypto.randomUUID().slice(0, 8)}`;
    await executeSql(
      `INSERT INTO trip_status_history (id, trip_id, status, timestamp, note)
       VALUES ($1, $2, $3, $4, $5);`,
      [histId, tripId, targetCanonical, now, note || null]
    );

    return trip;
  },

  // ==================== TRIP LOGS & HISTORY ====================

  listTripLogs(companyId?: string, driverId?: string): TripLog[] {
    let list = Object.values(dbState.tripLogs);
    if (companyId) list = list.filter((t) => t.companyId === companyId || t.networkCode === companyId);
    if (driverId) list = list.filter((t) => t.driverId === driverId);
    return list.sort((a, b) => b.startTime - a.startTime);
  },

  async saveTripLog(tripLog: TripLog): Promise<TripLog> {
    dbState.tripLogs[tripLog.id] = tripLog;
    await executeSql(
      `INSERT INTO trip_logs (id, company_id, driver_id, driver_name, vehicle_id, trip_id, start_time, end_time, start_address, end_address, distance_km, duration_minutes, avg_speed_kmh, max_speed_kmh, path, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (id) DO UPDATE SET end_time = EXCLUDED.end_time, distance_km = EXCLUDED.distance_km, duration_minutes = EXCLUDED.duration_minutes, path = EXCLUDED.path;`,
      [tripLog.id, tripLog.companyId || null, tripLog.driverId || null, tripLog.driverName, tripLog.vehicleId || null, tripLog.tripId || null, tripLog.startTime, tripLog.endTime, tripLog.startAddress, tripLog.endAddress, tripLog.distanceKm, tripLog.durationMinutes, tripLog.avgSpeedKmH, tripLog.maxSpeedKmH, JSON.stringify(tripLog.path), tripLog.status || 'COMPLETED']
    );
    return tripLog;
  },

  // Invites
  async createInvite(companyId: string, role: UserRole = 'DRIVER', maxUses = 25): Promise<Invite> {
    const id = `inv-${crypto.randomUUID().slice(0, 8)}`;
    const comp = dbState.companies[companyId];
    const prefix = comp ? comp.code : 'JOIN';
    const code = `${prefix}-${crypto.randomInt(100, 999)}`;
    const token = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    const expiresAt = now + 86400000 * 30; // 30 days

    const invite: Invite = {
      id,
      companyId,
      code,
      token,
      role,
      createdAt: now,
      expiresAt,
      maxUses,
      usedCount: 0,
      revoked: false,
    };

    dbState.invites[id] = invite;

    await executeSql(
      `INSERT INTO invites (id, company_id, code, token, role, created_at, expires_at, max_uses, used_count, revoked)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, FALSE);`,
      [invite.id, invite.companyId, invite.code, invite.token, invite.role, invite.createdAt, invite.expiresAt, invite.maxUses]
    );

    return invite;
  },

  getInviteByCode(codeOrToken: string): Invite | null {
    const clean = codeOrToken.trim().toUpperCase();
    return (
      Object.values(dbState.invites).find(
        (i) => i.code.toUpperCase() === clean || i.token.toUpperCase() === clean
      ) || null
    );
  },

  // Audit Logs
  async createAuditLog(entry: Omit<AuditLog, 'id' | 'timestamp'>): Promise<AuditLog> {
    const log: AuditLog = {
      id: `audit-${crypto.randomUUID().slice(0, 8)}`,
      timestamp: Date.now(),
      ...entry,
    };
    dbState.auditLogs.unshift(log);
    if (dbState.auditLogs.length > 500) dbState.auditLogs.pop();

    await executeSql(
      `INSERT INTO audit_logs (id, company_id, user_id, action, details, ip_address, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7);`,
      [log.id, log.companyId, log.userId || null, log.action, log.details, log.ipAddress || null, log.timestamp]
    );

    return log;
  },
};

// Initialize on boot
initDatabase().catch((err) => {
  console.error('Fatal initialization error:', err);
});
