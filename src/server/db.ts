import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { applyMigrations } from './schema';
import {
  User,
  Company,
  Network,
  Vehicle,
  Driver,
  DriverLocation,
  PublicVehicle,
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

// ==================== PERSISTENCE MODE ====================
//
// PostgreSQL is the authoritative persistent store for this application.
// initDatabase() establishes exactly one of two explicit modes:
//
//   'postgresql' — connected, schema/migrations applied, state hydrated.
//                  Reads are served from the hydrated cache and every write
//                  goes to PostgreSQL first: if the write fails, the operation
//                  fails and in-memory state is left untouched.
//   'memory'     — development-only fallback used when no database is
//                  reachable/configured. PostgreSQL is not touched at all, so
//                  reads and writes are consistent (both served from process
//                  memory) and nothing silently pretends to be persisted.
//
// There is deliberately NO "memory reads + PostgreSQL writes" state.
export type DatabaseMode = 'postgresql' | 'memory';

let databaseMode: DatabaseMode = 'memory';
let initializationFinished = false;
let initializationPromise: Promise<void> | null = null;
let pruneTimer: NodeJS.Timeout | null = null;

/** Current persistence mode. In production this is always 'postgresql'. */
export function getDatabaseMode(): DatabaseMode {
  return databaseMode;
}

/** True once initialization completed successfully (either mode). */
export function isDatabaseInitialized(): boolean {
  return initializationFinished;
}

/** True when DATABASE_URL was provided and a pool was created. */
export function isPostgresConfigured(): boolean {
  return pool !== null;
}

// PostgreSQL Connection Pool
//
// Only created when DATABASE_URL is configured. Without it the application can
// still start outside production, but only in the explicit 'memory' mode.
const databaseUrl = (process.env.DATABASE_URL || '').trim();

// SSL policy:
//  - `sslmode=...` in the URL is honored by node-postgres itself (not overridden)
//  - local hosts are treated as plain (non-TLS) PostgreSQL
//  - any other host keeps the historical permissive TLS setting used for
//    managed/cloud SQL instances.
const isLocalDatabase = /(^|\/\/|@)(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(databaseUrl);
const sslConfig: boolean | { rejectUnauthorized: boolean } | undefined = databaseUrl.includes('sslmode=')
  ? undefined
  : isLocalDatabase
    ? false
    : { rejectUnauthorized: false };

const pool: pg.Pool | null = databaseUrl
  ? new pg.Pool({
      connectionString: databaseUrl,
      ...(sslConfig !== undefined ? { ssl: sslConfig } : {}),
      max: 10,
      idleTimeoutMillis: 30000,
      // Fail fast instead of hanging startup indefinitely on an unreachable host.
      connectionTimeoutMillis: 10000,
    })
  : null;

if (pool) {
  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err);
  });
}

export { pool };

// Async helper to execute SQL statements.
//
//  - In 'postgresql' mode the statement must succeed: failures propagate so a
//    caller never mutates in-memory state for data that was not persisted.
//  - In 'memory' mode PostgreSQL is intentionally out of the request path, so
//    the statement is skipped and the in-memory store is the single, explicit
//    source of truth for this process.
async function executeSql(query: string, params: any[] = []): Promise<any> {
  if (databaseMode === 'memory' || !pool) {
    return null;
  }
  try {
    return await pool.query(query, params);
  } catch (err) {
    console.error('Database SQL write error:', err, 'Query was:', query.slice(0, 100));
    throw err;
  }
}

/**
 * Prune old location pings older than 48 hours to enforce retention policy
 */
export async function pruneOldPings(): Promise<void> {
  try {
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    await executeSql('DELETE FROM location_pings WHERE timestamp < $1;', [cutoff]);
  } catch (err) {
    console.warn('Prune old pings error:', err);
  }
}

/**
 * Initializes the database and hydrates the in-memory read cache.
 *
 * Startup contract (called by startServer() BEFORE httpServer.listen()):
 *
 *   load environment -> connect -> apply schema/migrations -> seed when empty
 *   -> hydrate -> report ready
 *
 * Failure policy:
 *  - Production (NODE_ENV=production && DEMO_MODE!=='true'): any failure is
 *    fatal. The promise rejects and the process exits; the server never listens
 *    with an unusable database.
 *  - Database configured but failing (reachable yet schema/seed/hydration
 *    error): fatal in every environment. This is a real database failure and
 *    must not be hidden behind a fallback that would make reads succeed while
 *    writes target a broken database.
 *  - Development/demo only: when no database is configured, or the configured
 *    database is unreachable, fall back to the explicit in-memory mode with a
 *    loud warning (see logMemoryFallback).
 *
 * The returned promise is memoized: concurrent/repeat calls await the same run.
 */
export function initDatabase(): Promise<void> {
  if (!initializationPromise) {
    initializationPromise = runInitialization();
  }
  return initializationPromise;
}

function logMemoryFallback(reason: string): void {
  console.warn(
    [
      '',
      '***********************************************************************',
      '* [db] POSTGRES FALLBACK — running in IN-MEMORY development mode',
      `*   reason: ${reason}`,
      '*   PostgreSQL is not used at all: reads AND writes are served from',
      '*   process memory and are LOST when the server restarts.',
      '*   Set DATABASE_URL (see .env.example) and restart to persist data.',
      '*   This fallback is disabled when NODE_ENV=production.',
      '***********************************************************************',
      '',
    ].join('\n')
  );
}

async function runInitialization(): Promise<void> {
  const strictProduction = process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true';

  // --- No database configured -------------------------------------------------
  if (!pool) {
    if (strictProduction) {
      throw new Error('DATABASE_URL is not configured. PostgreSQL is required in production.');
    }
    databaseMode = 'memory';
    seedInitialDataInMemory();
    initializationFinished = true;
    logMemoryFallback('DATABASE_URL is not set');
    return;
  }

  // --- Database configured: connect, migrate, seed, hydrate -------------------
  let reachable = false;
  try {
    await pool.query('SELECT 1;');
    reachable = true;

    // From here executeSql() writes through to PostgreSQL.
    databaseMode = 'postgresql';

    const appliedMigrations = await applyMigrations(pool);
    for (const id of appliedMigrations) {
      console.log(`[db] applied migration: ${id}`);
    }

    const res = await pool.query('SELECT count(*) FROM companies;');
    const count = parseInt(res.rows[0].count, 10);

    if (count === 0) {
      console.log('[db] PostgreSQL database is empty. Seeding initial Jbeil/LAU dorm shuttle fleet...');
      await seedInitialDataToPostgres();
    }

    // Hydrate the in-memory read cache from PostgreSQL
    await hydrateFromPostgres();

    // 1-hour periodic ping retention job (PostgreSQL mode only)
    if (!pruneTimer) {
      pruneTimer = setInterval(pruneOldPings, 60 * 60 * 1000);
      pruneTimer.unref?.();
    }

    initializationFinished = true;
    console.log(
      `[db] PostgreSQL ready (mode=postgresql): ` +
        `${Object.keys(dbState.companies).length} companies, ` +
        `${Object.keys(dbState.drivers).length} drivers, ` +
        `${Object.keys(dbState.trips).length} trips, ` +
        `${Object.keys(dbState.tripLogs).length} trip logs hydrated`
    );
    return;
  } catch (err) {
    const message = (err as Error)?.message || String(err);

    if (reachable) {
      // PostgreSQL answered, but initialization failed (schema/migration/seed/
      // hydration). This is a REAL database failure: surface it in every
      // environment instead of hiding it behind the in-memory fallback.
      // databaseMode stays 'postgresql' so nothing pretends the data was saved.
      initializationFinished = false;
      throw new Error(`PostgreSQL is reachable but initialization failed: ${message}`);
    }

    if (strictProduction) {
      initializationFinished = false;
      throw new Error(`PostgreSQL is unreachable: ${message}`);
    }

    // Development/demo only: the configured database could not be reached.
    databaseMode = 'memory';
    seedInitialDataInMemory();
    initializationFinished = true;
    logMemoryFallback(`cannot connect to PostgreSQL (${message})`);
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
      leadDriverId: r.lead_driver_id || undefined,
      leadPhone: r.lead_phone || r.phone,
      joinCode: r.join_code || r.code,
      isPublic: r.is_public !== false,
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
      networkName: comp ? comp.name : undefined,
      isLeadDriver: r.is_lead_driver,
      status: r.status,
      locationSharingEnabled: r.location_sharing_enabled !== false,
      speedometerEnabled: r.speedometer_enabled !== false,
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
  /**
   * Reports the real persistence state. `mode` distinguishes the authoritative
   * PostgreSQL mode from the explicit development-only in-memory fallback, so
   * a non-persistent process is never advertised as a healthy database.
   */
  async checkHealth(): Promise<{
    healthy: boolean;
    postgres: boolean;
    mode: DatabaseMode;
    initialized: boolean;
    error?: string;
  }> {
    if (!initializationFinished) {
      return {
        healthy: false,
        postgres: false,
        mode: databaseMode,
        initialized: false,
        error: 'Database initialization has not completed',
      };
    }

    if (databaseMode === 'memory') {
      // Development fallback: the process is serving traffic, but nothing is
      // persisted. Reported as healthy-with-warning (never in production).
      return {
        healthy: true,
        postgres: false,
        mode: 'memory',
        initialized: true,
        error: 'In-memory development mode: data is not persisted (DATABASE_URL missing or unreachable)',
      };
    }

    if (!pool) {
      return { healthy: false, postgres: false, mode: 'memory', initialized: false, error: 'DATABASE_URL is not configured' };
    }

    try {
      await pool.query('SELECT 1;');
      return { healthy: true, postgres: true, mode: 'postgresql', initialized: true };
    } catch (err) {
      return { healthy: false, postgres: false, mode: 'postgresql', initialized: true, error: (err as Error).message };
    }
  },

  // Companies & Networks
  getCompany(id: string): Network | null {
    return dbState.companies[id] || null;
  },

  getCompanyByCode(code: string): Network | null {
    const clean = code.trim().toUpperCase();
    return Object.values(dbState.companies).find((c) => c.code.toUpperCase() === clean) || null;
  },

  getNetworkByJoinCode(code: string): Network | null {
    const clean = (code || '').trim().toUpperCase();
    return (
      Object.values(dbState.companies).find(
        (c) =>
          (c.joinCode && c.joinCode.toUpperCase() === clean) ||
          c.code.toUpperCase() === clean ||
          c.id === clean
      ) || null
    );
  },

  listCompanies(): Network[] {
    return Object.values(dbState.companies);
  },

  listPublicNetworks(): Network[] {
    const now = Date.now();
    return Object.values(dbState.companies)
      .filter((c) => c.isPublic !== false)
      .map((c) => {
        const driversInNet = Object.values(dbState.drivers).filter((d) => d.companyId === c.id);
        const activeCount = driversInNet.filter((d) => {
          if (d.locationSharingEnabled === false) return false;
          const ageSec = (now - (d.currentLocation?.timestamp || 0)) / 1000;
          return ageSec < 300; // active in last 5 minutes
        }).length;

        const leadDriver = driversInNet.find((d) => d.isLeadDriver) || (c.leadDriverId ? dbState.drivers[c.leadDriverId] : undefined);
        return {
          ...c,
          leadDriverName: leadDriver ? leadDriver.name : c.ownerName,
          leadPhone: c.leadPhone || (leadDriver ? leadDriver.phone : c.phone),
          activeVehicleCount: activeCount,
        };
      });
  },

  async createCompany(companyData: {
    code: string;
    name: string;
    ownerName: string;
    ownerEmail: string;
    phone?: string;
    joinCode?: string;
    leadDriverId?: string;
    leadPhone?: string;
    isPublic?: boolean;
  }): Promise<Network> {
    const id = `comp-${crypto.randomUUID().slice(0, 8)}`;
    const joinCode = companyData.joinCode || String(crypto.randomInt(100000, 999999));
    const company: Network = {
      id,
      code: companyData.code.trim().toUpperCase(),
      name: companyData.name.trim(),
      ownerName: companyData.ownerName.trim(),
      ownerEmail: companyData.ownerEmail.trim().toLowerCase(),
      phone: companyData.phone,
      joinCode,
      leadDriverId: companyData.leadDriverId,
      leadPhone: companyData.leadPhone || companyData.phone,
      isPublic: companyData.isPublic !== false,
      createdAt: Date.now(),
      settings: {
        adaptiveGpsMovingSec: 3,
        adaptiveGpsStoppedSec: 25,
        speedLimitKmH: 80,
        enablePublicDriverPhone: false,
      },
    };

    await executeSql(
      `INSERT INTO companies (id, code, name, owner_name, owner_email, phone, join_code, is_public, lead_driver_id, lead_phone, settings, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);`,
      [
        company.id,
        company.code,
        company.name,
        company.ownerName,
        company.ownerEmail,
        company.phone,
        company.joinCode,
        company.isPublic,
        company.leadDriverId || null,
        company.leadPhone || null,
        JSON.stringify(company.settings),
        company.createdAt,
      ]
    );

    dbState.companies[id] = company;
    return company;
  },

  async updateNetworkLead(companyId: string, leadDriverId: string, leadPhone?: string): Promise<Network | null> {
    const comp = dbState.companies[companyId];
    if (!comp) return null;
    await executeSql(
      `UPDATE companies SET lead_driver_id = $1, lead_phone = COALESCE($2, lead_phone) WHERE id = $3;`,
      [leadDriverId, leadPhone || null, companyId]
    );
    comp.leadDriverId = leadDriverId;
    if (leadPhone) comp.leadPhone = leadPhone;
    return comp;
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

    dbState.users[id] = user;

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

    await executeSql(
      `INSERT INTO vehicles (id, company_id, plate_number, make_model, type, year, capacity, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
      [vehicle.id, vehicle.companyId, vehicle.plateNumber, vehicle.makeModel, vehicle.type, vehicle.year || null, vehicle.capacityKg ? Math.round(vehicle.capacityKg / 100) : 4, vehicle.status, Date.now()]
    );

    dbState.vehicles[id] = vehicle;

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

    await executeSql(
      `INSERT INTO drivers (id, user_id, company_id, vehicle_id, name, phone, vehicle_model, plate_number, is_lead_driver, status, current_location, total_trips, rating, last_heartbeat, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15);`,
      [driver.id, driver.userId || null, driver.companyId, driver.vehicleId || null, driver.name, driver.phone, driver.vehicleModel, driver.plateNumber, driver.isLeadDriver, driver.status, JSON.stringify(driver.currentLocation), driver.totalTrips, driver.rating, driver.lastHeartbeat, Date.now()]
    );

    dbState.drivers[id] = driver;

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
    const cleanSpeed = Math.max(0, location.speed);
    const updatedLocation: DriverLocation = {
      lat: location.lat,
      lng: location.lng,
      speed: cleanSpeed,
      heading: location.heading,
      accuracy: location.accuracy,
      timestamp,
      batteryLevel: location.batteryLevel,
      isCharging: location.isCharging,
      networkStatus: location.networkStatus,
      isSimulated: location.isSimulated,
    };

    // Update in Postgres FIRST
    await executeSql(
      `UPDATE drivers
       SET current_location = $1, last_heartbeat = $2
       WHERE id = $3;`,
      [JSON.stringify(updatedLocation), timestamp, driver.id]
    );

    // Record ping for audit/retention tracking
    const pingId = `png-${crypto.randomUUID().slice(0, 8)}`;
    await executeSql(
      `INSERT INTO location_pings (id, driver_id, trip_id, lat, lng, speed, heading, accuracy, battery_level, network_status, is_simulated, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);`,
      [pingId, driver.id, driver.currentTripId || null, location.lat, location.lng, cleanSpeed, location.heading, location.accuracy, location.batteryLevel || null, location.networkStatus || null, location.isSimulated || false, timestamp]
    );

    // Update in memory ONLY after Postgres write succeeds
    driver.currentLocation = updatedLocation;
    driver.lastHeartbeat = timestamp;

    return driver;
  },

  async updateDriverStatus(id: string, status: Driver['status']): Promise<Driver | null> {
    const driver = dbState.drivers[id];
    if (!driver) return null;

    await executeSql(`UPDATE drivers SET status = $1 WHERE id = $2;`, [status, id]);
    driver.status = status;
    return driver;
  },

  async setDriverBroadcasting(
    id: string,
    locationSharingEnabled: boolean,
    speedometerEnabled?: boolean
  ): Promise<Driver | null> {
    const driver = dbState.drivers[id];
    if (!driver) return null;

    const speedo = speedometerEnabled !== undefined ? speedometerEnabled : (driver.speedometerEnabled !== false);
    await executeSql(
      `UPDATE drivers SET location_sharing_enabled = $1, speedometer_enabled = $2 WHERE id = $3;`,
      [locationSharingEnabled, speedo, id]
    );
    driver.locationSharingEnabled = locationSharingEnabled;
    driver.speedometerEnabled = speedo;
    if (!locationSharingEnabled) {
      driver.status = 'OFFLINE';
    } else if (driver.status === 'OFFLINE') {
      driver.status = 'ONLINE';
    }
    return driver;
  },

  async updateDriverNetwork(driverId: string, companyId: string, isLead: boolean = false): Promise<Driver | null> {
    const driver = dbState.drivers[driverId];
    const comp = dbState.companies[companyId];
    if (!driver || !comp) return null;

    await executeSql(
      `UPDATE drivers SET company_id = $1, is_lead_driver = $2 WHERE id = $3;`,
      [comp.id, isLead, driver.id]
    );
    driver.companyId = comp.id;
    driver.networkCode = comp.code;
    driver.networkName = comp.name;
    driver.isLeadDriver = isLead;
    return driver;
  },

  async removeDriverFromNetwork(driverId: string): Promise<Driver | null> {
    const driver = dbState.drivers[driverId];
    if (!driver) return null;
    await executeSql(`UPDATE drivers SET status = 'OFFLINE', location_sharing_enabled = FALSE WHERE id = $1;`, [driverId]);
    driver.status = 'OFFLINE';
    driver.locationSharingEnabled = false;
    return driver;
  },

  listPublicVehicles(networkIds?: string[]): PublicVehicle[] {
    const now = Date.now();
    const vehicles: PublicVehicle[] = [];

    for (const driver of Object.values(dbState.drivers)) {
      const comp = driver.companyId ? dbState.companies[driver.companyId] : null;
      if (!comp || comp.isPublic === false) continue;

      // If specific networks are requested, filter by company id or code
      if (networkIds && networkIds.length > 0) {
        const matches = networkIds.some((id) => id === comp.id || id.toUpperCase() === comp.code.toUpperCase());
        if (!matches) continue;
      }

      // Check broadcasting flag: when location sharing is OFF, do NOT broadcast live coordinates to customers
      if (driver.locationSharingEnabled === false) {
        continue;
      }

      const loc = driver.currentLocation;
      if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') continue;

      const ageSec = (now - (loc.timestamp || 0)) / 1000;
      let freshness: 'FRESH' | 'STALE' | 'OFFLINE' = 'FRESH';
      if (ageSec > 120) {
        freshness = 'OFFLINE';
      } else if (ageSec > 25) {
        freshness = 'STALE';
      }

      // If driver hasn't sent telemetry in over 10 minutes, do not display ghost car on public map
      if (ageSec > 600) {
        continue;
      }

      const status: 'ONLINE' | 'LOCATION_OFF' | 'STALE' | 'OFFLINE' =
        freshness === 'OFFLINE' ? 'OFFLINE' : freshness === 'STALE' ? 'STALE' : 'ONLINE';

      const vehicle = driver.vehicleId ? dbState.vehicles[driver.vehicleId] : null;
      const vehicleModel = vehicle?.makeModel || driver.vehicleModel || 'Taxi Sedan';
      const plateNumber = vehicle?.plateNumber || driver.plateNumber || 'Public Taxi';

      const speed = (driver.speedometerEnabled !== false)
        ? (typeof loc.speed === 'number' && !isNaN(loc.speed) ? Math.round(loc.speed) : null)
        : null;

      const heading = (typeof loc.heading === 'number' && !isNaN(loc.heading)) ? loc.heading : null;
      const accuracy = (typeof loc.accuracy === 'number' && !isNaN(loc.accuracy)) ? loc.accuracy : null;

      vehicles.push({
        id: `veh-${driver.id}`,
        driverId: driver.id,
        driverName: driver.name,
        phone: comp.settings?.enablePublicDriverPhone === true ? driver.phone : undefined,
        networkId: comp.id,
        networkCode: comp.code,
        networkName: comp.name,
        leadDriverName: comp.ownerName,
        leadPhone: comp.settings?.enablePublicDriverPhone === true ? (comp.leadPhone || comp.phone) : undefined,
        vehicleModel,
        plateNumber,
        status,
        location: {
          lat: loc.lat,
          lng: loc.lng,
          speed,
          heading,
          accuracy,
          timestamp: loc.timestamp,
          isCalculatedSpeed: loc.isCalculatedSpeed,
          freshness,
        },
        locationSharingEnabled: true,
        speedometerEnabled: driver.speedometerEnabled !== false,
      });
    }

    return vehicles;
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

    // Persist trip to Postgres FIRST
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

    if (tripData.assignedDriverId && dbState.drivers[tripData.assignedDriverId]) {
      const driver = dbState.drivers[tripData.assignedDriverId];
      await executeSql(`UPDATE drivers SET status = 'ASSIGNED', current_trip_id = $1 WHERE id = $2;`, [id, driver.id]);
      driver.status = 'ASSIGNED';
      driver.currentTripId = id;
    }

    dbState.trips[id] = trip;

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
        await executeSql(`UPDATE drivers SET status = 'AVAILABLE', current_trip_id = NULL WHERE id = $1;`, [prev.id]);
        prev.status = 'AVAILABLE';
        delete prev.currentTripId;
      }

      await executeSql(`UPDATE trips SET driver_id = $1, status = 'ASSIGNED', updated_at = $2 WHERE id = $3;`, [driverId, now, tripId]);
      await executeSql(`UPDATE drivers SET status = 'ASSIGNED', current_trip_id = $1 WHERE id = $2;`, [tripId, driverId]);

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
    } else {
      if (trip.assignedDriverId && dbState.drivers[trip.assignedDriverId]) {
        await executeSql(`UPDATE drivers SET status = 'AVAILABLE', current_trip_id = NULL WHERE id = $1;`, [trip.assignedDriverId]);
        dbState.drivers[trip.assignedDriverId].status = 'AVAILABLE';
        delete dbState.drivers[trip.assignedDriverId].currentTripId;
      }
      await executeSql(`UPDATE trips SET driver_id = NULL, status = 'CREATED', updated_at = $1 WHERE id = $2;`, [now, tripId]);

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
    const isStarted = targetCanonical === 'EN_ROUTE_PICKUP' && !trip.startedAt;
    const isCompleted = targetCanonical === 'COMPLETED' && !trip.completedAt;

    // Database writes first
    if (isStarted) {
      await executeSql(`UPDATE trips SET started_at = $1 WHERE id = $2;`, [now, tripId]);
    }
    if (isCompleted) {
      await executeSql(`UPDATE trips SET completed_at = $1 WHERE id = $2;`, [now, tripId]);
    }

    if (trip.assignedDriverId && dbState.drivers[trip.assignedDriverId]) {
      const driver = dbState.drivers[trip.assignedDriverId];
      if (targetCanonical === 'COMPLETED' || targetCanonical === 'CANCELLED') {
        await executeSql(`UPDATE drivers SET status = 'AVAILABLE', current_trip_id = NULL, total_trips = total_trips + ${targetCanonical === 'COMPLETED' ? 1 : 0} WHERE id = $1;`, [driver.id]);
      } else if (targetCanonical === 'EN_ROUTE_PICKUP') {
        await executeSql(`UPDATE drivers SET status = 'EN_ROUTE_PICKUP' WHERE id = $1;`, [driver.id]);
      } else if (targetCanonical === 'AT_PICKUP') {
        await executeSql(`UPDATE drivers SET status = 'AT_PICKUP' WHERE id = $1;`, [driver.id]);
      } else if (targetCanonical === 'IN_TRANSIT') {
        await executeSql(`UPDATE drivers SET status = 'IN_TRANSIT' WHERE id = $1;`, [driver.id]);
      } else if (targetCanonical === 'AT_DESTINATION') {
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

    // Apply in-memory mutations only after successful PostgreSQL writes
    trip.status = targetCanonical;
    trip.updatedAt = now;
    if (isStarted) {
      trip.startedAt = now;
    }
    if (isCompleted) {
      trip.completedAt = now;
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
      } else if (targetCanonical === 'EN_ROUTE_PICKUP') {
        driver.status = 'EN_ROUTE_PICKUP';
      } else if (targetCanonical === 'AT_PICKUP') {
        driver.status = 'AT_PICKUP';
      } else if (targetCanonical === 'IN_TRANSIT') {
        driver.status = 'IN_TRANSIT';
      } else if (targetCanonical === 'AT_DESTINATION') {
        driver.status = 'AT_DESTINATION';
      }
    }

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
    await executeSql(
      `INSERT INTO trip_logs (id, company_id, driver_id, driver_name, vehicle_id, trip_id, start_time, end_time, start_address, end_address, distance_km, duration_minutes, avg_speed_kmh, max_speed_kmh, path, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (id) DO UPDATE SET end_time = EXCLUDED.end_time, distance_km = EXCLUDED.distance_km, duration_minutes = EXCLUDED.duration_minutes, path = EXCLUDED.path;`,
      [tripLog.id, tripLog.companyId || null, tripLog.driverId || null, tripLog.driverName, tripLog.vehicleId || null, tripLog.tripId || null, tripLog.startTime, tripLog.endTime, tripLog.startAddress, tripLog.endAddress, tripLog.distanceKm, tripLog.durationMinutes, tripLog.avgSpeedKmH, tripLog.maxSpeedKmH, JSON.stringify(tripLog.path), tripLog.status || 'COMPLETED']
    );
    dbState.tripLogs[tripLog.id] = tripLog;
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

    await executeSql(
      `INSERT INTO invites (id, company_id, code, token, role, created_at, expires_at, max_uses, used_count, revoked)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, FALSE);`,
      [invite.id, invite.companyId, invite.code, invite.token, invite.role, invite.createdAt, invite.expiresAt, invite.maxUses]
    );

    dbState.invites[id] = invite;

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

    await executeSql(
      `INSERT INTO audit_logs (id, company_id, user_id, action, details, ip_address, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7);`,
      [log.id, log.companyId, log.userId || null, log.action, log.details, log.ipAddress || null, log.timestamp]
    );

    dbState.auditLogs.unshift(log);
    if (dbState.auditLogs.length > 500) dbState.auditLogs.pop();

    return log;
  },
};

// NOTE: initialization is intentionally NOT triggered at module-import time.
// `server.ts` awaits `initDatabase()` inside `startServer()` before the HTTP
// server starts listening, and `npm run db:init` runs it as a standalone
// bootstrap. See initDatabase() for the failure policy.
