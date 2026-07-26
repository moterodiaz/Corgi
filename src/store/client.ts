import { PrismaClient } from '@prisma/client'

// Singleton pattern prevents multiple PrismaClient instances in hot-reload (dev/test).
// justified: globalThis cast is the standard Prisma singleton pattern for Node.js
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma
}
