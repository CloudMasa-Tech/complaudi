import type { NextFunction, Request, Response } from 'express';
import { CAPABILITY_LABEL, can, type Actor, type Capability } from '../lib/access';
import { ForbiddenError, TrialExpiredError, UnauthorizedError } from '../lib/errors';
import { verifyAccessToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';

/**
 * Verifies the token, then takes the role from the *database* rather than the
 * token's claim.
 *
 * A role can change while a token is still valid. Trusting the claim cuts both
 * ways: someone promoted to super admin was locked out until their token
 * expired, because the promotion had cleared the per-company grants their old
 * claim still depended on — and someone demoted kept their old powers for the
 * rest of the token's life. One indexed lookup per request is a small price for
 * neither of those being possible.
 *
 * It also means deactivating an account takes effect on the next request rather
 * than in fifteen minutes.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    next(new UnauthorizedError('Missing bearer token'));
    return;
  }

  let userId: string;
  let issuedAt: number;
  try {
    const payload = verifyAccessToken(header.slice(7).trim());
    userId = payload.sub;
    issuedAt = payload.iat;
  } catch (err) {
    next(err);
    return;
  }

  void prisma.user
    .findUnique({
      where: { id: userId },
      select: {
        id: true, organizationId: true, email: true, name: true,
        role: true, isActive: true, passwordChangedAt: true,
        organization: { select: { trialEndsAt: true } },
      },
    })
    .then((user) => {
      if (!user) throw new UnauthorizedError('This account no longer exists');
      if (!user.isActive) throw new UnauthorizedError('This account has been deactivated');
      // `iat` is whole seconds, so allow a second of slack rather than refuse a
      // token minted in the same instant as the change.
      if (issuedAt * 1000 < user.passwordChangedAt.getTime() - 1000) {
        throw new UnauthorizedError('The password for this account has changed. Sign in again.');
      }

      // An expired trial keeps its data and its login — it simply cannot reach
      // the application. These two routes stay open so the front end can render
      // the expiry rather than a bare error, and so people can still sign out.
      const trialEndsAt = user.organization.trialEndsAt;
      const alwaysOpen = req.path === '/me' || req.path === '/logout' || req.path === '/change-password';
      if (trialEndsAt && trialEndsAt.getTime() < Date.now() && !alwaysOpen) {
        throw new TrialExpiredError(trialEndsAt);
      }

      req.auth = {
        userId: user.id,
        organizationId: user.organizationId,
        email: user.email,
        name: user.name,
        role: user.role,
      };
      next();
    })
    .catch(next);
}

/**
 * Gate on what a role may *do*, not on where it sits in a hierarchy.
 *
 * A ranking invites "greater than MEMBER" checks that quietly grant a new role
 * more than intended the moment it is inserted in the order. A capability list
 * has to be edited deliberately for that to happen.
 */
export function requireCapability(capability: Capability) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new UnauthorizedError());
      return;
    }
    if (!can(req.auth.role, capability)) {
      next(new ForbiddenError(`Your role cannot ${CAPABILITY_LABEL[capability]}.`));
      return;
    }
    next();
  };
}

export function auth(req: Request): NonNullable<Request['auth']> {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

/** The same thing, narrowed to what the access layer needs. */
export const actor = (req: Request): Actor => auth(req);
