import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * One connection to SQLite, never a pool.
 *
 * Prisma opens several connections by default (num_cpus * 2 + 1), and each one
 * takes its own POSIX advisory lock on the database file. That is fine on a
 * local disk. It is not fine everywhere this is deployed: Azure App Service
 * gives a container its persistent storage as an SMB share, and SMB implements
 * fcntl byte-range locking unreliably enough that concurrent writers are the
 * documented way to corrupt a SQLite file on a network filesystem.
 *
 * Holding the pool to one connection means there is only ever one writer, so
 * the contention that causes the corruption never arises. The cost is that
 * database access serialises, which is free here — every request in this app
 * spends its time in a model call or in Tectonic, not waiting on SQLite.
 *
 * The journal mode is left alone deliberately. Prisma's default is `delete`
 * (verified, not assumed), and it must stay that way: WAL keeps its index in
 * shared memory and cannot be used on a network filesystem at all.
 *
 * Applied only to file: URLs, so pointing DATABASE_URL at Postgres later gets
 * a normal pool rather than a silently crippled one.
 */
function singleConnectionUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("file:")) return undefined;
  if (url.includes("connection_limit=")) return undefined;
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=1`;
}

function createClient(): PrismaClient {
  const url = singleConnectionUrl();
  return url
    ? new PrismaClient({ datasources: { db: { url } } })
    : new PrismaClient();
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
