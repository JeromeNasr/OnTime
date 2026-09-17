import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import {
  User,
  Company,
  Vehicle,
  Driver,
  Trip,
  Order,
  TripLog,
  TripPoint,
  Invite,
  OrderStatus,
  OrderStatusHistoryItem,
  UserRole,
} from '../types';

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
  orders: Record<string, Order>;
  trips: Record<string, TripLog>;
  tripPoints: Record<string, TripPoint[]>;
  invites: Record<string, Invite>;
  auditLogs: AuditLog[];
}

// In-memory cache synced with PostgreSQL
const dbState: DatabaseSchema = {
  users: {},
  companies: {},
  vehicles: {},
  devices: {},
  drivers: {},
  orders: {},
  trips: {},
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
  const [compRes, usrRes, vehRes, drvRes, tripRes, invRes, auditRes] = await Promise.all([
    pool.query('SELECT * FROM companies;'),
    pool.query('SELECT * FROM users;'),
    pool.query('SELECT * FROM vehicles;'),
    pool.query('SELECT * FROM drivers;'),
    pool.query('SELECT * FROM trips;'),
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
      currentOrderId: r.current_trip_id,
      totalTrips: r.total_trips,
      rating: r.rating || 5.0,
      lastHeartbeat: Number(r.last_heartbeat),
    };
  });

  tripRes.rows.forEach((r) => {
    const comp = dbState.companies[r.company_id];
    dbState.orders[r.id] = {
      id: r.id,
      companyId: r.company_id,
      networkCode: comp ? comp.code : 'FLEET',
      trackingCode: r.tracking_code,
      trackingToken: r.tracking_token,
      studentName: r.student_name,
      studentPhone: r.student_phone,
      customerName: r.student_name,
      customerPhone: r.student_phone || '',
      pickupAddress: r.pickup_address,
      pickupCoords: { lat: r.pickup_lat, lng: r.pickup_lng },
      dropoffAddress: r.destination_address,
      dropoffCoords: { lat: r.destination_lat, lng: r.destination_lng },
      packageInfo: r.notes || 'Student Ride',
      assignedDriverId: r.driver_id,
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
    } drivers, ${Object.keys(dbState.orders).length} trips.`
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

  createCompany(companyData: {
    code: string;
    name: string;
    ownerName: string;
    ownerEmail: string;
    phone?: string;
  }): Company {
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

    executeSql(
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

  createUser(userData: {
    email: string;
    name: string;
    phone: string;
    role: UserRole;
    companyId: string;
    passwordHash: string;
  }): User {
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

    executeSql(
      `INSERT INTO users (id, company_id, email, name, phone, role, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
      [user.id, user.companyId, user.email, user.name, user.phone, user.role, user.passwordHash, user.createdAt]
    );

    // Also link company_member
    executeSql(
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

  createVehicle(vehicleData: {
    companyId: string;
    plateNumber: string;
    makeModel: string;
    type: 'sedan' | 'pickup' | 'van' | 'motorcycle';
    year?: number;
    capacityKg?: number;
  }): Vehicle {
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

    executeSql(
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

  createDriver(driverData: {
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
  }): Driver {
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

    executeSql(
      `INSERT INTO drivers (id, user_id, company_id, vehicle_id, name, phone, vehicle_model, plate_number, is_lead_driver, status, current_location, total_trips, rating, last_heartbeat, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15);`,
      [driver.id, driver.userId || null, driver.companyId, driver.vehicleId || null, driver.name, driver.phone, driver.vehicleModel, driver.plateNumber, driver.isLeadDriver, driver.status, JSON.stringify(driver.currentLocation), driver.totalTrips, driver.rating, driver.lastHeartbeat, Date.now()]
    );

    return driver;
  },

  updateDriverLocation(
    id: string,
    location: {
      lat: number;
      lng: number;
      speed: number;
      heading: number;
      accuracy: number;
      batteryLevel?: number;
      isCharging?: boolean;
      networkStatus?: 'wifi' | '4g' | '3g' | 'offline';
      isSimulated?: boolean;
    }
  ): Driver | null {
    const driver = dbState.drivers[id];
    if (!driver) return null;

    const timestamp = Date.now();
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
    executeSql(
      `UPDATE drivers
       SET current_location = $1, last_heartbeat = $2
       WHERE id = $3;`,
      [JSON.stringify(driver.currentLocation), driver.lastHeartbeat, driver.id]
    );

    // Record ping for audit/retention tracking
    const pingId = `png-${crypto.randomUUID().slice(0, 8)}`;
    executeSql(
      `INSERT INTO location_pings (id, driver_id, trip_id, lat, lng, speed, heading, accuracy, battery_level, network_status, is_simulated, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);`,
      [pingId, driver.id, driver.currentOrderId || null, location.lat, location.lng, location.speed, location.heading, location.accuracy, location.batteryLevel || null, location.networkStatus || null, location.isSimulated || false, timestamp]
    );

    return driver;
  },

  updateDriverStatus(id: string, status: Driver['status']): Driver | null {
    const driver = dbState.drivers[id];
    if (!driver) return null;
    driver.status = status;

    executeSql(`UPDATE drivers SET status = $1 WHERE id = $2;`, [status, id]);
    return driver;
  },

  // Trips & Orders
  getOrder(id: string): Order | null {
    return dbState.orders[id] || null;
  },

  getOrderByTracking(tokenOrCode: string): Order | null {
    const clean = tokenOrCode.trim();
    const cleanUpper = clean.toUpperCase();
    return (
      Object.values(dbState.orders).find(
        (o) =>
          o.trackingToken === clean ||
          o.trackingCode.toUpperCase() === cleanUpper ||
          o.id === clean
      ) || null
    );
  },

  listOrders(companyId?: string): Order[] {
    let orders = Object.values(dbState.orders);
    if (companyId) {
      orders = orders.filter((o) => o.companyId === companyId);
    }
    return orders.sort((a, b) => b.createdAt - a.createdAt);
  },

  createOrder(orderData: {
    companyId: string;
    studentName?: string;
    studentPhone?: string;
    customerName?: string;
    customerPhone?: string;
    pickupAddress: string;
    pickupCoords: { lat: number; lng: number };
    dropoffAddress: string;
    dropoffCoords: { lat: number; lng: number };
    packageInfo?: string;
    priority?: 'normal' | 'high' | 'urgent';
    assignedDriverId?: string;
    estimatedMinutes?: number;
    roadDistanceKm?: number;
    routeGeometry?: [number, number][];
  }): Order {
    const id = `ORD-TRIP-${Math.floor(100 + Math.random() * 899)}`;
    const comp = dbState.companies[orderData.companyId];
    const trackingCode = `TRK-${Math.floor(1000 + Math.random() * 9000)}`;
    const trackingToken = crypto.randomBytes(24).toString('hex');
    const sName = orderData.studentName || orderData.customerName || 'Student';
    const sPhone = orderData.studentPhone || orderData.customerPhone || '';
    const now = Date.now();
    const tokenExpiresAt = now + 86400000 * 2; // 48 hour token lifetime

    const initialStatus: OrderStatus = orderData.assignedDriverId ? 'ASSIGNED' : 'CREATED';

    const order: Order = {
      id,
      companyId: orderData.companyId,
      networkCode: comp ? comp.code : 'FLEET',
      trackingCode,
      trackingToken,
      studentName: sName,
      studentPhone: sPhone,
      customerName: sName,
      customerPhone: sPhone,
      pickupAddress: orderData.pickupAddress,
      pickupCoords: orderData.pickupCoords,
      dropoffAddress: orderData.dropoffAddress,
      dropoffCoords: orderData.dropoffCoords,
      packageInfo: orderData.packageInfo || 'Student Ride',
      priority: orderData.priority || 'normal',
      assignedDriverId: orderData.assignedDriverId,
      status: initialStatus,
      createdAt: now,
      updatedAt: now,
      estimatedMinutes: orderData.estimatedMinutes || 8,
      roadDistanceKm: orderData.roadDistanceKm || 2.0,
      routeGeometry: orderData.routeGeometry || [],
      statusHistory: [
        {
          status: initialStatus,
          timestamp: now,
          note: orderData.assignedDriverId ? 'Created with driver assignment' : 'Trip created in dispatch queue',
        },
      ],
    };

    dbState.orders[id] = order;

    if (orderData.assignedDriverId && dbState.drivers[orderData.assignedDriverId]) {
      const driver = dbState.drivers[orderData.assignedDriverId];
      driver.status = 'ASSIGNED';
      driver.currentOrderId = id;
    }

    // Persist trip to Postgres
    executeSql(
      `INSERT INTO trips (id, company_id, driver_id, tracking_code, tracking_token, token_expires_at, student_name, student_phone, pickup_address, pickup_lat, pickup_lng, destination_address, destination_lat, destination_lng, status, estimated_minutes, road_distance_km, created_at, updated_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20);`,
      [order.id, order.companyId, order.assignedDriverId || null, order.trackingCode, order.trackingToken, tokenExpiresAt, order.studentName, order.studentPhone, order.pickupAddress, order.pickupCoords.lat, order.pickupCoords.lng, order.dropoffAddress, order.dropoffCoords.lat, order.dropoffCoords.lng, order.status, order.estimatedMinutes, order.roadDistanceKm, order.createdAt, order.updatedAt, order.packageInfo]
    );

    // Persist tracking session
    executeSql(
      `INSERT INTO student_tracking_sessions (id, trip_id, token, created_at, expires_at, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE);`,
      [`sess-${id}`, id, trackingToken, now, tokenExpiresAt]
    );

    return order;
  },

  assignOrder(orderId: string, driverId?: string): Order | null {
    const order = dbState.orders[orderId];
    if (!order) return null;

    const now = Date.now();
    if (driverId) {
      const driver = dbState.drivers[driverId];
      if (!driver) return null;
      order.assignedDriverId = driverId;
      order.status = 'ASSIGNED';
      order.updatedAt = now;
      order.statusHistory = order.statusHistory || [];
      order.statusHistory.push({
        status: 'ASSIGNED',
        timestamp: now,
        note: `Assigned to ${driver.name}`,
      });
      driver.status = 'ASSIGNED';
      driver.currentOrderId = order.id;

      executeSql(`UPDATE trips SET driver_id = $1, status = 'ASSIGNED', updated_at = $2 WHERE id = $3;`, [driverId, now, orderId]);
      executeSql(`UPDATE drivers SET status = 'ASSIGNED', current_trip_id = $1 WHERE id = $2;`, [orderId, driverId]);
    } else {
      if (order.assignedDriverId && dbState.drivers[order.assignedDriverId]) {
        dbState.drivers[order.assignedDriverId].status = 'AVAILABLE';
        delete dbState.drivers[order.assignedDriverId].currentOrderId;
        executeSql(`UPDATE drivers SET status = 'AVAILABLE', current_trip_id = NULL WHERE id = $1;`, [order.assignedDriverId]);
      }
      order.assignedDriverId = undefined;
      order.status = 'CREATED';
      order.updatedAt = now;
      order.statusHistory = order.statusHistory || [];
      order.statusHistory.push({
        status: 'CREATED',
        timestamp: now,
        note: 'Order unassigned to dispatch pool',
      });

      executeSql(`UPDATE trips SET driver_id = NULL, status = 'CREATED', updated_at = $1 WHERE id = $2;`, [now, orderId]);
    }

    return order;
  },

  updateOrderStatus(orderId: string, status: OrderStatus, note?: string): Order | null {
    const order = dbState.orders[orderId];
    if (!order) return null;

    const now = Date.now();
    order.status = status;
    order.updatedAt = now;
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({
      status,
      timestamp: now,
      note,
    });

    if (order.assignedDriverId && dbState.drivers[order.assignedDriverId]) {
      const driver = dbState.drivers[order.assignedDriverId];
      if (status === 'COMPLETED' || status === 'DELIVERED') {
        driver.status = 'AVAILABLE';
        delete driver.currentOrderId;
        driver.totalTrips += 1;
        executeSql(`UPDATE drivers SET status = 'AVAILABLE', current_trip_id = NULL, total_trips = total_trips + 1 WHERE id = $1;`, [driver.id]);
      } else if (status === 'EN_ROUTE_PICKUP' || status === 'DRIVER_EN_ROUTE_PICKUP') {
        driver.status = 'EN_ROUTE_PICKUP';
        executeSql(`UPDATE drivers SET status = 'EN_ROUTE_PICKUP' WHERE id = $1;`, [driver.id]);
      } else if (status === 'AT_PICKUP' || status === 'ARRIVED_PICKUP') {
        driver.status = 'AT_PICKUP';
        executeSql(`UPDATE drivers SET status = 'AT_PICKUP' WHERE id = $1;`, [driver.id]);
      } else if (status === 'IN_TRANSIT' || status === 'PICKED_UP') {
        driver.status = 'IN_TRANSIT';
        executeSql(`UPDATE drivers SET status = 'IN_TRANSIT' WHERE id = $1;`, [driver.id]);
      }
    }

    executeSql(`UPDATE trips SET status = $1, updated_at = $2 WHERE id = $3;`, [status, now, orderId]);

    // Record status history entry in Postgres
    const histId = `tsh-${crypto.randomUUID().slice(0, 8)}`;
    executeSql(
      `INSERT INTO trip_status_history (id, trip_id, status, timestamp, note)
       VALUES ($1, $2, $3, $4, $5);`,
      [histId, orderId, status, now, note || null]
    );

    return order;
  },

  // Trips / History
  listTrips(companyId?: string, driverId?: string): TripLog[] {
    let list = Object.values(dbState.trips);
    if (companyId) list = list.filter((t) => t.companyId === companyId || t.networkCode === companyId);
    if (driverId) list = list.filter((t) => t.driverId === driverId);
    return list.sort((a, b) => b.startTime - a.startTime);
  },

  saveTrip(trip: TripLog): TripLog {
    dbState.trips[trip.id] = trip;
    executeSql(
      `INSERT INTO trip_logs (id, company_id, driver_id, driver_name, vehicle_id, trip_id, start_time, end_time, start_address, end_address, distance_km, duration_minutes, avg_speed_kmh, max_speed_kmh, path, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (id) DO UPDATE SET end_time = EXCLUDED.end_time, distance_km = EXCLUDED.distance_km, duration_minutes = EXCLUDED.duration_minutes, path = EXCLUDED.path;`,
      [trip.id, trip.companyId || null, trip.driverId || null, trip.driverName, trip.vehicleId || null, trip.orderId || trip.tripId || null, trip.startTime, trip.endTime, trip.startAddress, trip.endAddress, trip.distanceKm, trip.durationMinutes, trip.avgSpeedKmH, trip.maxSpeedKmH, JSON.stringify(trip.path), trip.status || 'COMPLETED']
    );
    return trip;
  },

  // Invites
  createInvite(companyId: string, role: UserRole = 'DRIVER', maxUses = 25): Invite {
    const id = `inv-${crypto.randomUUID().slice(0, 8)}`;
    const comp = dbState.companies[companyId];
    const prefix = comp ? comp.code : 'JOIN';
    const code = `${prefix}-${Math.floor(100 + Math.random() * 899)}`;
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

    executeSql(
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
  createAuditLog(entry: Omit<AuditLog, 'id' | 'timestamp'>): void {
    const log: AuditLog = {
      id: `audit-${crypto.randomUUID().slice(0, 8)}`,
      timestamp: Date.now(),
      ...entry,
    };
    dbState.auditLogs.unshift(log);
    if (dbState.auditLogs.length > 500) dbState.auditLogs.pop();

    executeSql(
      `INSERT INTO audit_logs (id, company_id, user_id, action, details, ip_address, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7);`,
      [log.id, log.companyId, log.userId || null, log.action, log.details, log.ipAddress || null, log.timestamp]
    );
  },
};

// Initialize on boot
initDatabase().catch((err) => {
  console.error('Fatal initialization error:', err);
});
