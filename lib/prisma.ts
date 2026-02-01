import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Reuse across hot reloads (dev)
const pool =
  global.__pgPool ??
  new Pool({
    connectionString,
  });

global.__pgPool = pool;

const adapter = new PrismaPg(pool);

export const prisma =
  global.__prisma ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}