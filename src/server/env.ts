import { config } from 'dotenv';

/**
 * Environment loading — must be the FIRST import of every server entrypoint
 * (`server.ts`, `src/server/init-db.ts`).
 *
 * `src/server/db.ts` reads `process.env.DATABASE_URL` and `src/server/auth.ts`
 * reads `process.env.JWT_SECRET` at module-import time, so the environment has
 * to be populated before those modules are evaluated.
 *
 * `config()` never overwrites variables that are already present in the
 * process environment, so real deployment/CI values always win over `.env`.
 * `quiet: true` suppresses the dotenv banner so server logs stay clean.
 */
config({ quiet: true });
