import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';
import { recordAudit } from '../audit/audit.service';
import { requireAuth, cookieName, sessionTokenHash, ROLE_PERMISSIONS, type AuthRole } from '../../middleware/auth';

export const authRouter = Router();

const loginBody = z.object({ email: z.string().email().transform(v => v.trim().toLowerCase()), password: z.string().min(1) });
const registerBody = z.object({
  organizationName: z.string().trim().min(2).max(160),
  name: z.string().trim().min(2).max(120),
  email: z.string().email().transform(v => v.trim().toLowerCase()),
  password: z.string().min(10).max(200),
  environment: z.enum(['ORGANIZATION', 'EMPLOYEE']).default('ORGANIZATION'),
  role: z.enum(['RESEARCHER', 'OPERATOR', 'MANAGER', 'ADMIN']).optional(),
});

const SESSION_DAYS = 30;
const failedLogins = new Map<string, { count: number; resetAt: number }>();
function loginKey(email: string, ip: string | undefined) { return `${email}:${ip ?? 'unknown'}`; }
function blocked(key: string) { const v = failedLogins.get(key); if (!v) return false; if (v.resetAt <= Date.now()) { failedLogins.delete(key); return false; } return v.count >= 5; }
function recordFailed(key: string) { const now = Date.now(); const v = failedLogins.get(key); if (!v || v.resetAt <= now) failedLogins.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 }); else v.count += 1; }
function clearFailed(key: string) { failedLogins.delete(key); }
function newToken() { return crypto.randomBytes(48).toString('base64url'); }
function cookieOptions() {
  const secure = process.env.NODE_ENV === 'production';
  return { httpOnly: true, secure, sameSite: 'lax' as const, path: '/', maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 };
}
function publicUser(user: { id: string; name: string; email: string; role: AuthRole; organizationId: string; environment: 'ORGANIZATION'|'EMPLOYEE'; createdAt: Date; mineMemberships: { mineId: string }[] }) {
  return {
    id: user.id, name: user.name, email: user.email, role: user.role,
    organizationId: user.organizationId, mineIds: user.mineMemberships.map(m => m.mineId),
    environment: user.environment.toLowerCase(), permissions: ROLE_PERMISSIONS[user.role], createdAt: user.createdAt,
  };
}
async function createSession(user: { id: string; organizationId: string }) {
  const token = newToken();
  await prisma.authSession.create({ data: { userId: user.id, organizationId: user.organizationId, tokenHash: sessionTokenHash(token), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000) } });
  return token;
}

// POST /api/auth/register
// Public registration creates a new organization and its first admin unless a role is explicitly requested.
authRouter.post('/register', async (req, res, next) => {
  try {
    const body = registerBody.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw new AppError(409, 'email_taken', 'An account with this email already exists.');
    const passwordHash = await bcrypt.hash(body.password, 12);
    const isOrganization = body.environment === 'ORGANIZATION';
    const userRole: AuthRole = isOrganization ? 'ADMIN' : 'OPERATOR';
    const result = await prisma.$transaction(async tx => {
      const org = isOrganization
        ? await tx.organization.create({ data: { name: body.organizationName } })
        : await tx.organization.findUnique({ where: { id: body.organizationName } });
      if (!org) throw new AppError(404, 'organization_not_found', 'The supplied organization was not found.');
      const user = await tx.user.create({ data: { organizationId: org.id, email: body.email, name: body.name, passwordHash, role: userRole, environment: body.environment } });
      return user;
    });
    const token = await createSession(result);
    res.cookie(cookieName(), token, cookieOptions());
    await recordAudit({ organizationId: result.organizationId, userId: result.id, action: 'auth.register', resourceType: 'User', resourceId: result.id, metadata: { environment: result.environment, role: result.role } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.id }, include: { mineMemberships: true } });
    res.status(201).json({ user: publicUser(user) });
  } catch (err) { next(err); }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginBody.parse(req.body);
    const key = loginKey(email, req.ip);
    if (blocked(key)) throw new AppError(429, 'too_many_attempts', 'Too many failed login attempts. Try again later.');
    const user = await prisma.user.findUnique({ where: { email }, include: { mineMemberships: true } });
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
      recordFailed(key);
      await recordAudit({ organizationId: user?.organizationId ?? null, userId: user?.id ?? null, action: 'auth.failed_login', resourceType: 'User', resourceId: user?.id ?? null, metadata: { email, reason: !user ? 'unknown_account' : !user.isActive ? 'inactive_account' : 'invalid_password' } });
      throw new AppError(401, 'invalid_credentials', 'Email or password is incorrect.');
    }
    clearFailed(key);
    const token = await createSession(user);
    res.cookie(cookieName(), token, cookieOptions());
    await recordAudit({ organizationId: user.organizationId, userId: user.id, action: 'auth.login', resourceType: 'User', resourceId: user.id });
    res.json({ user: publicUser(user) });
  } catch (err) { next(err); }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies?.[cookieName()] as string | undefined;
    if (token) {
      const session = await prisma.authSession.findUnique({ where: { tokenHash: sessionTokenHash(token) } });
      if (session) {
        await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
        await recordAudit({ organizationId: session.organizationId, userId: session.userId, action: 'auth.logout', resourceType: 'AuthSession', resourceId: session.id });
      }
    }
    res.clearCookie(cookieName(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
    res.status(204).send();
  } catch (err) { next(err); }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const oldToken = req.cookies?.[cookieName()] as string | undefined;
    if (!oldToken) throw new AppError(401, 'unauthorized', 'Refresh session is missing.');
    const session = await prisma.authSession.findUnique({ where: { tokenHash: sessionTokenHash(oldToken) } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new AppError(401, 'unauthorized', 'Refresh session is invalid or expired.');
    const newSessionToken = await createSession({ id: session.userId, organizationId: session.organizationId });
    await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    res.cookie(cookieName(), newSessionToken, cookieOptions());
    const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId }, include: { mineMemberships: true } });
    res.json({ user: publicUser(user) });
  } catch (err) { next(err); }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, include: { mineMemberships: true } });
    if (!user || !user.isActive || user.organizationId !== req.user!.organizationId) throw new AppError(401, 'unauthorized', 'Authenticated user is no longer active.');
    res.json({ user: publicUser(user) });
  } catch (err) { next(err); }
});
