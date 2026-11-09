import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: process.env.VERCEL ? 1 : 10,
      allowExitOnIdle: true,
    })
  : undefined;
export const db = pool ? drizzle(pool, { schema }) : undefined;

export * from "./schema";
