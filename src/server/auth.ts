import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { UserRole } from '../types';

// Use environment JWT_SECRET; if missing in development, generate a cryptographically secure runtime fallback
let runtimeSecret = process.env.JWT_SECRET;
if (!runtimeSecret || runtimeSecret === 'CHANGE_ME' || runtimeSecret.includes('ontime-secret-jwt-key')) {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable must be set in production.');
  }
  runtimeSecret = runtimeSecret && runtimeSecret !== 'CHANGE_ME' ? runtimeSecret : crypto.randomBytes(32).toString('hex');
}
const JWT_SECRET: string = runtimeSecret;

export interface AuthUserPayload {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  companyId: string;
  phone?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
    }
  }
}

export function generateToken(user: AuthUserPayload): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): AuthUserPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthUserPayload;
  } catch (_err) {
    return null;
  }
}

/**
 * Strict authentication middleware: Rejects requests without valid token
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication token required.',
      },
    });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Session token has expired or is invalid.',
      },
    });
  }

  req.user = decoded;
  next();
}

/**
 * Strict authentication in production; permits non-production demo fallback if DEMO_MODE enabled
 */
export function requireAuthOrDemo(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
      return next();
    }
    return res.status(401).json({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Session token has expired or is invalid.',
      },
    });
  }

  // In production (when DEMO_MODE !== 'true'), authentication is strictly mandatory:
  const isDemo = process.env.DEMO_MODE === 'true' || (process.env.NODE_ENV !== 'production' && process.env.DEMO_MODE !== 'false');
  if (!isDemo) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication token required.',
      },
    });
  }

  // Non-production demo fallback: demo owner
  req.user = {
    id: 'usr-demo-owner',
    email: 'owner@byblosfleet.lb',
    name: 'Demo Dispatcher (Charbel)',
    role: 'OWNER',
    companyId: 'comp-byblos-01',
  };
  next();
}

/**
 * Role-Based Access Control (RBAC) middleware
 */
export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required.' },
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: `Access denied. Requires one of roles: ${allowedRoles.join(', ')}`,
        },
      });
    }

    next();
  };
}

/**
 * Multi-tenant Company Isolation Guard:
 * Ensures the authenticated user can only access resources belonging to their own company.
 */
export function requireCompanyAccess(targetCompanyIdGetter: (req: Request) => string | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required.' },
      });
    }

    const targetCompanyId = targetCompanyIdGetter(req);
    if (targetCompanyId && req.user.companyId !== targetCompanyId) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN_COMPANY_ACCESS',
          message: 'Access denied: You cannot access or modify another company resources.',
        },
      });
    }

    next();
  };
}
