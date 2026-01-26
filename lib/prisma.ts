import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "node:path";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

// Make SQLite URL absolute to avoid "relative path resolves from node_modules/.prisma/..." issues
// (common in Prisma 7 setups).
const envUrl = process.env.DATABASE_URL; // e.g. file:./dev.db
const absUrl =
  envUrl?.startsWith("file:")
    ? "file:" + path.resolve(process.cwd(), envUrl.replace("file:", ""))
    : "file:" + path.resolve(process.cwd(), "dev.db");

const adapter = new PrismaBetterSqlite3({ url: absUrl });

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

globalForPrisma.prisma = prisma;