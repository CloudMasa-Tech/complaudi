import type { UserRole } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        organizationId: string;
        email: string;
        name: string;
        role: UserRole;
      };
      /** Captured by the express.json() verify hook so webhook signatures can
       *  be recomputed over the exact bytes Razorpay signed. */
      rawBody?: Buffer;
    }
  }
}

export {};
