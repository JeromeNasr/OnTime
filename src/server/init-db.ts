import './env';
import { db, initDatabase, getDatabaseMode, isDatabaseInitialized } from './db';

/**
 * Standalone database bootstrap.
 *
 *   npm run db:init
 *
 * Loads the environment, connects to PostgreSQL, applies schema/migrations,
 * seeds an empty database and verifies the hydrated state. Exits non-zero when
 * the bootstrap did not reach PostgreSQL mode, so it is safe to use in CI or
 * before deploying:
 *
 *   load environment -> connect -> schema/migrations -> seed -> hydrate -> report
 */
async function main(): Promise<void> {
  if (!(process.env.DATABASE_URL || '').trim()) {
    console.error('[db:init] DATABASE_URL is not set. Configure it (see .env.example) and re-run.');
    process.exit(1);
  }

  await initDatabase();

  if (getDatabaseMode() !== 'postgresql' || !isDatabaseInitialized()) {
    console.error(
      `[db:init] Bootstrap did not reach PostgreSQL mode (mode=${getDatabaseMode()}). ` +
        'Check that DATABASE_URL points at a reachable, writable database.'
    );
    process.exit(1);
  }

  const health = await db.checkHealth();
  if (!health.healthy) {
    console.error(`[db:init] Database health check failed: ${health.error || 'unknown error'}`);
    process.exit(1);
  }

  console.log(
    '[db:init] OK — ' +
      `${db.listCompanies().length} companies, ` +
      `${db.listDrivers().length} drivers, ` +
      `${db.listTrips().length} trips, ` +
      `${db.listTripLogs().length} trip logs, ` +
      `${db.listVehicles(db.listCompanies()[0]?.id || '').length} vehicles in the first company`
  );

  // The pool/prune timer would otherwise keep the process alive.
  process.exit(0);
}

main().catch((err) => {
  console.error('[db:init] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
