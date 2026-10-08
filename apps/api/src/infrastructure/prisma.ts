import { PrismaClient } from '@prisma/client';

/** Single shared Prisma client. All queries go through Prisma's parameterized API. */
export const prisma = new PrismaClient();
