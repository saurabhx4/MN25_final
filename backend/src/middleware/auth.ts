import { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';

export type AuthRole = 'RESEARCHER' | 'OPERATOR' | 'MANAGER' | 'ADMIN';
export type Permission =
  | 'exploration.read'
  | 'analysis.run'
  | 'reports.generate'
  | 'operational.read'
  | 'production.read'
  | 'risk.read'
  | 'actions.approve'
  | 'actions.schedule'
  | 'operational.analytics'
  | 'users.manage'
  | 'settings.manage'
  | 'organization.manage'
  | 'data.read'
  | 'data.upload'
  | 'audit.read'
  | 'ml.read'
  | 'ml.train'
  | 'ml.promote';

export const ROLE_PERMISSIONS: Record<AuthRole, readonly Permission[]> = {
  RESEARCHER: ['exploration.read', 'analysis.run', 'reports.generate', 'data.read', 'ml.read'],
  OPERATOR: ['operational.read', 'production.read', 'risk.read', 'data.read'],
  MANAGER: ['operational.read', 'production.read', 'risk.read', 'actions.approve', 'actions.schedule', 'operational.analytics', 'data.read'],
  ADMIN: [
    'exploration.read', 'analysis.run', 'reports.generate', 'operational.read', 'production.read', 'risk.read',
    'actions.approve', 'actions.schedule', 'operational.analytics', 'users.manage', 'settings.manage',
    'organization.manage', 'data.read', 'data.upload', 'audit.read', 'ml.read', 'ml.train', 'ml.promote',
  ],
};

export type AuthUser = {
  id: string;
  organizationId: string;
  role: AuthRole;
  environment: 'ORGANIZATION' | 'EMPLOYEE';
  permissions: readonly Permission[];
  mineIds: string[];
};

declare global {
  namespace Express {
    interface Request { user?: AuthUser; }
  }
}

const COOKIE = 'mn25_session';
const HASH = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export function sessionTokenHash(token: string) { return HASH(token); }
export function getSessionToken(req: Request): string | null {
  const raw = req.cookies?.[COOKIE] as string | undefined;
  if (raw) return raw;
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = getSessionToken(req);
    if (!token) return res.status(401).json({ error: 'unauthorized', message: 'Authentication required.' });
    const session = await prisma.authSession.findUnique({
      where: { tokenHash: HASH(token) },
      include: { user: { include: { mineMemberships: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.isActive) {
      return res.status(401).json({ error: 'unauthorized', message: 'Session is invalid or expired.' });
    }
    const role = session.user.role as AuthRole;
    req.user = {
      id: session.user.id,
      organizationId: session.user.organizationId,
      role,
      environment: session.user.environment,
      permissions: ROLE_PERMISSIONS[role],
      mineIds: session.user.mineMemberships.map(m => m.mineId),
    };
    await prisma.authSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
    next();
  } catch (err) { next(err); }
}

export function requireRole(...roles: AuthRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden', message: 'Insufficient role for this operation.' });
    next();
  };
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (!req.user.permissions.includes(permission)) return res.status(403).json({ error: 'forbidden', message: `Missing permission: ${permission}` });
    next();
  };
}

export function cookieName() { return COOKIE; }
