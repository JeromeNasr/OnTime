import type { Pool } from 'pg';

/**
 * PostgreSQL schema & migrations for OnTime.
 *
 * Every column below was derived from the SQL actually issued by
 * `src/server/db.ts` (INSERT/UPDATE/DELETE statements + the `SELECT *`
 * hydration mappings in `hydrateFromPostgres()`). Nothing here is speculative:
 * if a column is not written or read by the application, it is not in the
 * schema.
 *
 * Type conventions
 *  - epoch-millisecond timestamps are BIGINT (the app always wraps them with
 *    `Number(...)` when hydrating)
 *  - JSON payloads produced by `JSON.stringify(...)` are JSONB
 *  - numeric measurements (coordinates, speed, distance) are DOUBLE PRECISION
 *  - counters/flags that hydrate as plain numbers/booleans are INTEGER/BOOLEAN
 *
 * Tables (12): companies, users, company_members, vehicles, drivers, trips,
 * trip_status_history, student_tracking_sessions, trip_logs, location_pings,
 * invites, audit_logs.
 */

const INITIAL_SCHEMA_SQL = `
-- ============================================================================
-- companies  (a.k.a. "Network"/"Fleet" in the domain model)
-- INSERT: seedInitialDataToPostgres(), db.createCompany()
-- SELECT: hydrateFromPostgres()
-- ============================================================================
CREATE TABLE IF NOT EXISTS companies (
  id             VARCHAR(64)  PRIMARY KEY,
  code           VARCHAR(64)  NOT NULL,
  name           VARCHAR(255) NOT NULL,
  owner_name     VARCHAR(255) NOT NULL,
  owner_email    VARCHAR(255) NOT NULL,
  phone          VARCHAR(64),
  join_code      VARCHAR(32),
  is_public      BOOLEAN      NOT NULL DEFAULT TRUE,
  -- Soft pointer to drivers(id): companies are inserted before drivers exist,
  -- so a foreign key here would break the seed order. Enforced in application
  -- code instead (updateNetworkLead()).
  lead_driver_id VARCHAR(64),
  lead_phone     VARCHAR(32),
  settings       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at     BIGINT       NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_companies_code      ON companies (code);
CREATE INDEX IF NOT EXISTS idx_companies_join_code ON companies (join_code);

-- ============================================================================
-- users  (login accounts; role is one of OWNER/DISPATCHER/LEAD_DRIVER/DRIVER)
-- INSERT: seedInitialDataToPostgres(), db.createUser()
-- SELECT: hydrateFromPostgres()  -> (User & { passwordHash })
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(64)  PRIMARY KEY,
  company_id    VARCHAR(64)  NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email         VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  phone         VARCHAR(64),
  role          VARCHAR(32)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    BIGINT       NOT NULL
);
-- db.getUserByEmail() compares lower-cased emails; db.createUser() stores the
-- address already lower-cased, so a plain unique index matches its lookup.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email      ON users (email);
CREATE INDEX IF NOT EXISTS        idx_users_company_id ON users (company_id);

-- ============================================================================
-- company_members  (written by db.createUser(); membership/role history)
-- INSERT: db.createUser() with ON CONFLICT (company_id, user_id) DO NOTHING
-- ============================================================================
CREATE TABLE IF NOT EXISTS company_members (
  id         VARCHAR(64)  PRIMARY KEY,
  company_id VARCHAR(64)  NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id    VARCHAR(64)  NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role       VARCHAR(32)  NOT NULL,
  joined_at  BIGINT       NOT NULL,
  CONSTRAINT uq_company_members_company_user UNIQUE (company_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_company_members_user_id ON company_members (user_id);

-- ============================================================================
-- vehicles
-- INSERT: seedInitialDataToPostgres(), db.createVehicle()
-- SELECT: hydrateFromPostgres()
-- ============================================================================
CREATE TABLE IF NOT EXISTS vehicles (
  id          VARCHAR(64)  PRIMARY KEY,
  company_id  VARCHAR(64)  NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plate_number VARCHAR(32) NOT NULL,
  make_model  VARCHAR(128) NOT NULL,
  type        VARCHAR(32)  NOT NULL,
  year        INTEGER,
  capacity    INTEGER,
  status      VARCHAR(32)  NOT NULL DEFAULT 'active',
  -- Soft pointer to drivers(id): vehicles are seeded before drivers, so a
  -- foreign key here would violate seed order. Not written at runtime.
  assigned_driver_id VARCHAR(64),
  created_at  BIGINT       NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vehicles_company_id          ON vehicles (company_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_assigned_driver_id  ON vehicles (assigned_driver_id);

-- ============================================================================
-- drivers
-- INSERT: seedInitialDataToPostgres(), db.createDriver()
-- UPDATE: updateDriverLocation(), updateDriverStatus(), setDriverBroadcasting(),
--         updateDriverNetwork(), removeDriverFromNetwork(), assignTrip(),
--         updateTripStatus(), createTrip()
-- SELECT: hydrateFromPostgres()  -> current_location is JSONB
-- ============================================================================
CREATE TABLE IF NOT EXISTS drivers (
  id             VARCHAR(64)  PRIMARY KEY,
  user_id        VARCHAR(64)  REFERENCES users(id)     ON DELETE SET NULL,
  company_id     VARCHAR(64)  NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vehicle_id     VARCHAR(64)  REFERENCES vehicles(id)  ON DELETE SET NULL,
  name           VARCHAR(255) NOT NULL,
  phone          VARCHAR(64)  NOT NULL,
  vehicle_model  VARCHAR(128) NOT NULL,
  plate_number   VARCHAR(32),
  is_lead_driver BOOLEAN      NOT NULL DEFAULT FALSE,
  status         VARCHAR(32)  NOT NULL DEFAULT 'AVAILABLE',
  current_location JSONB,
  -- Soft pointer to trips(id): drivers are seeded before trips, so a foreign
  -- key here would violate seed order. server.ts repairs a dangling pointer at
  -- runtime (trip start/stop fallback lookup).
  current_trip_id VARCHAR(64),
  total_trips    INTEGER      NOT NULL DEFAULT 0,
  rating         DOUBLE PRECISION NOT NULL DEFAULT 5.0,
  last_heartbeat BIGINT       NOT NULL,
  location_sharing_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  speedometer_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     BIGINT       NOT NULL
);
-- One driver profile per user account (db.getDriverByUserId() assumes this).
CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_user_id    ON drivers (user_id);
CREATE INDEX IF NOT EXISTS        idx_drivers_company_id ON drivers (company_id);
CREATE INDEX IF NOT EXISTS        idx_drivers_vehicle_id ON drivers (vehicle_id);
CREATE INDEX IF NOT EXISTS        idx_drivers_current_trip_id ON drivers (current_trip_id);
CREATE INDEX IF NOT EXISTS        idx_drivers_status     ON drivers (status);

-- ============================================================================
-- trips  (canonical ride/order entity; status follows VALID_TRIP_TRANSITIONS)
-- INSERT: seedInitialDataToPostgres(), db.createTrip()
-- UPDATE: assignTrip(), updateTripStatus()
-- SELECT: hydrateFromPostgres()
-- ============================================================================
CREATE TABLE IF NOT EXISTS trips (
  id             VARCHAR(64)  PRIMARY KEY,
  company_id     VARCHAR(64)  NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id      VARCHAR(64)  REFERENCES drivers(id)  ON DELETE SET NULL,
  vehicle_id     VARCHAR(64)  REFERENCES vehicles(id) ON DELETE SET NULL,
  tracking_code  VARCHAR(32)  NOT NULL,
  tracking_token VARCHAR(128) NOT NULL,
  token_expires_at BIGINT,
  token_revoked  BOOLEAN      NOT NULL DEFAULT FALSE,
  student_name   VARCHAR(255) NOT NULL,
  student_phone  VARCHAR(64),
  pickup_address TEXT         NOT NULL,
  pickup_lat     DOUBLE PRECISION NOT NULL,
  pickup_lng     DOUBLE PRECISION NOT NULL,
  destination_address TEXT    NOT NULL,
  destination_lat DOUBLE PRECISION NOT NULL,
  destination_lng DOUBLE PRECISION NOT NULL,
  status         VARCHAR(32)  NOT NULL,
  estimated_minutes INTEGER,
  road_distance_km  DOUBLE PRECISION,
  created_at     BIGINT       NOT NULL,
  updated_at     BIGINT       NOT NULL,
  scheduled_at   BIGINT,
  started_at     BIGINT,
  completed_at   BIGINT,
  route_geometry JSONB,
  notes          TEXT
);
-- Public tracking resolves a trip by its random 48-byte token
-- (db.getTripByToken()); tracking codes are only 4 digits of entropy
-- (TRK-1000..TRK-9999), so they are indexed but deliberately NOT unique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trips_tracking_token ON trips (tracking_token);
CREATE INDEX IF NOT EXISTS        idx_trips_tracking_code  ON trips (tracking_code);
CREATE INDEX IF NOT EXISTS        idx_trips_company_id     ON trips (company_id);
CREATE INDEX IF NOT EXISTS        idx_trips_driver_id      ON trips (driver_id);
CREATE INDEX IF NOT EXISTS        idx_trips_status         ON trips (status);

-- ============================================================================
-- trip_status_history  (append-only audit of trip state transitions)
-- INSERT: db.updateTripStatus()
-- ============================================================================
CREATE TABLE IF NOT EXISTS trip_status_history (
  id        VARCHAR(64)  NOT NULL,
  trip_id   VARCHAR(64)  NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  status    VARCHAR(32)  NOT NULL,
  timestamp BIGINT       NOT NULL,
  note      TEXT
);
-- No primary key by design: ids are \`tsh-\${8 hex chars}\`, which collides
-- statistically at large volumes (birthday problem) and nothing references
-- this table. Ordering/pruning is done via the indexes below.
CREATE INDEX IF NOT EXISTS idx_trip_status_history_trip ON trip_status_history (trip_id, timestamp DESC);

-- ============================================================================
-- student_tracking_sessions  (one session per trip; mirrors the tracking token)
-- INSERT: seedInitialDataToPostgres(), db.createTrip()
-- ============================================================================
CREATE TABLE IF NOT EXISTS student_tracking_sessions (
  id         VARCHAR(64)  PRIMARY KEY,
  trip_id    VARCHAR(64)  NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  token      VARCHAR(128) NOT NULL,
  created_at BIGINT       NOT NULL,
  expires_at BIGINT       NOT NULL,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_student_tracking_sessions_trip  ON student_tracking_sessions (trip_id);
CREATE INDEX IF NOT EXISTS idx_student_tracking_sessions_token ON student_tracking_sessions (token);

-- ============================================================================
-- trip_logs  (completed trip history shown in "Trip Logs")
-- INSERT: db.saveTripLog() with ON CONFLICT (id) DO UPDATE
-- SELECT: hydrateFromPostgres() ORDER BY end_time DESC LIMIT 200
-- ============================================================================
CREATE TABLE IF NOT EXISTS trip_logs (
  id               VARCHAR(64)  PRIMARY KEY,
  trip_id          VARCHAR(64)  REFERENCES trips(id)    ON DELETE SET NULL,
  driver_id        VARCHAR(64)  REFERENCES drivers(id)  ON DELETE SET NULL,
  driver_name      VARCHAR(255) NOT NULL,
  company_id       VARCHAR(64)  REFERENCES companies(id) ON DELETE SET NULL,
  vehicle_id       VARCHAR(64)  REFERENCES vehicles(id)  ON DELETE SET NULL,
  start_time       BIGINT       NOT NULL,
  end_time         BIGINT       NOT NULL,
  start_address    TEXT,
  end_address      TEXT,
  distance_km      DOUBLE PRECISION NOT NULL DEFAULT 0,
  duration_minutes INTEGER          NOT NULL DEFAULT 0,
  avg_speed_kmh    DOUBLE PRECISION NOT NULL DEFAULT 0,
  max_speed_kmh    DOUBLE PRECISION NOT NULL DEFAULT 0,
  path             JSONB,
  status           VARCHAR(32)  NOT NULL DEFAULT 'COMPLETED'
);
CREATE INDEX IF NOT EXISTS idx_trip_logs_company_id ON trip_logs (company_id);
CREATE INDEX IF NOT EXISTS idx_trip_logs_driver_id  ON trip_logs (driver_id);
CREATE INDEX IF NOT EXISTS idx_trip_logs_trip_id    ON trip_logs (trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_logs_end_time   ON trip_logs (end_time DESC);

-- ============================================================================
-- location_pings  (append-only GPS telemetry history, pruned after 48h by
--                  pruneOldPings())
-- INSERT: db.updateDriverLocation()
-- DELETE: pruneOldPings()  WHERE timestamp < cutoff
-- ============================================================================
CREATE TABLE IF NOT EXISTS location_pings (
  id             VARCHAR(64)  NOT NULL,
  driver_id      VARCHAR(64)  NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  trip_id        VARCHAR(64)  REFERENCES trips(id) ON DELETE SET NULL,
  lat            DOUBLE PRECISION NOT NULL,
  lng            DOUBLE PRECISION NOT NULL,
  speed          DOUBLE PRECISION NOT NULL DEFAULT 0,
  heading        DOUBLE PRECISION,
  accuracy       DOUBLE PRECISION,
  battery_level  DOUBLE PRECISION,
  network_status VARCHAR(16),
  is_simulated   BOOLEAN      NOT NULL DEFAULT FALSE,
  timestamp      BIGINT       NOT NULL
);
-- No primary key by design: this is the highest-volume table and ids are
-- \`png-\${8 hex chars}\` (collision risk grows quadratically with volume).
-- Nothing references it; retention is enforced by the timestamp index.
CREATE INDEX IF NOT EXISTS idx_location_pings_timestamp         ON location_pings (timestamp);
CREATE INDEX IF NOT EXISTS idx_location_pings_driver_timestamp  ON location_pings (driver_id, timestamp DESC);

-- ============================================================================
-- invites  (fleet join invitations)
-- INSERT: seedInitialDataToPostgres(), db.createInvite() with ON CONFLICT (id)
-- SELECT: db.getInviteByCode()
-- ============================================================================
CREATE TABLE IF NOT EXISTS invites (
  id         VARCHAR(64)  PRIMARY KEY,
  company_id VARCHAR(64)  NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code       VARCHAR(64)  NOT NULL,
  token      VARCHAR(128) NOT NULL,
  role       VARCHAR(32)  NOT NULL DEFAULT 'DRIVER',
  created_at BIGINT       NOT NULL,
  expires_at BIGINT       NOT NULL,
  max_uses   INTEGER      NOT NULL DEFAULT 25,
  used_count INTEGER      NOT NULL DEFAULT 0,
  revoked    BOOLEAN      NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_invites_company_id ON invites (company_id);
CREATE INDEX IF NOT EXISTS idx_invites_code       ON invites (code);

-- ============================================================================
-- audit_logs  (written by db.createAuditLog(); hydration takes the newest 200)
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id         VARCHAR(64)  NOT NULL,
  company_id VARCHAR(64)  REFERENCES companies(id) ON DELETE CASCADE,
  user_id    VARCHAR(64)  REFERENCES users(id)     ON DELETE SET NULL,
  action     VARCHAR(128) NOT NULL,
  details    TEXT,
  ip_address VARCHAR(64),
  timestamp  BIGINT       NOT NULL
);
-- No primary key by design (ids are \`audit-\${8 hex chars}\`, unbounded table);
-- lookups always go through company/time indexes.
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_timestamp ON audit_logs (company_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp         ON audit_logs (timestamp DESC);
`;

/**
 * Column backfill for databases that were created before this schema existed.
 * Statements are idempotent (`IF NOT EXISTS` / conditional `UPDATE`s), so they
 * are safe on a brand-new database where 0001 already created the columns.
 */
const LEGACY_BACKFILL_SQL = `
ALTER TABLE trips ADD COLUMN IF NOT EXISTS scheduled_at BIGINT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS started_at BIGINT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS completed_at BIGINT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS vehicle_id VARCHAR(64);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS route_geometry JSONB;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS token_revoked BOOLEAN DEFAULT FALSE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS current_trip_id VARCHAR(64);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS location_sharing_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS speedometer_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS join_code VARCHAR(32);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT TRUE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS lead_driver_id VARCHAR(64);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS lead_phone VARCHAR(32);
UPDATE companies SET join_code = '482913' WHERE id = 'comp-byblos-01' AND (join_code IS NULL OR join_code = '');
UPDATE companies SET join_code = '739104' WHERE id = 'comp-lau-dorm' AND (join_code IS NULL OR join_code = '');
UPDATE companies SET lead_phone = '+961 70 123 456' WHERE id = 'comp-byblos-01' AND (lead_phone IS NULL OR lead_phone = '');
UPDATE companies SET lead_phone = '+961 70 882 144' WHERE id = 'comp-lau-dorm' AND (lead_phone IS NULL OR lead_phone = '');
`;

export interface Migration {
  id: string;
  description: string;
  sql: string;
}

/**
 * Ordered, tracked migrations. Add new entries at the end; each id is applied
 * at most once and recorded in `schema_migrations`.
 */
export const MIGRATIONS: Migration[] = [
  {
    id: '0001_initial_schema',
    description: 'Create all tables, constraints and indexes used by src/server/db.ts',
    sql: INITIAL_SCHEMA_SQL,
  },
  {
    id: '0002_legacy_column_backfill',
    description: 'Idempotent column backfill for pre-existing databases (was previously run on every boot)',
    sql: LEGACY_BACKFILL_SQL,
  },
];

/**
 * Applies pending migrations, each inside its own transaction, and records the
 * applied ids in `schema_migrations`. Safe to call repeatedly.
 *
 * Returns the ids that were applied during this call.
 */
export async function applyMigrations(pool: Pool): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         VARCHAR(128) PRIMARY KEY,
      applied_at BIGINT       NOT NULL
    );
  `);

  const applied: string[] = [];

  for (const migration of MIGRATIONS) {
    const existing = await pool.query('SELECT 1 FROM schema_migrations WHERE id = $1;', [migration.id]);
    if (existing.rowCount && existing.rowCount > 0) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2);', [
        migration.id,
        Date.now(),
      ]);
      await client.query('COMMIT');
      applied.push(migration.id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${migration.id} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  return applied;
}
