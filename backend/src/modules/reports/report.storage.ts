import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { env } from '../../config/env';

const root = path.resolve(env.reportStorageDir ?? path.join(process.cwd(), 'storage', 'reports'));

export async function putReportPdf(key: string, bytes: Buffer): Promise<string> {
  const target = path.join(root, key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  return key;
}

export async function getReportPdf(key: string): Promise<Buffer> {
  return fs.readFile(path.join(root, key));
}

export function reportDownloadToken(reportId: string, versionId: string, expiresAt: number): string {
  const payload = `${reportId}.${versionId}.${expiresAt}`;
  const sig = crypto.createHmac('sha256', env.jwtSecret).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

export function verifyReportDownloadToken(token: string, reportId: string): { versionId: string; expiresAt: number } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const [tokenReportId, versionId, expiresRaw, sig] = decoded.split('.');
    const expiresAt = Number(expiresRaw);
    if (!tokenReportId || !versionId || !Number.isFinite(expiresAt) || !sig) return null;
    if (tokenReportId !== reportId || expiresAt < Date.now()) return null;
    const payload = `${tokenReportId}.${versionId}.${expiresAt}`;
    const expected = crypto.createHmac('sha256', env.jwtSecret).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return { versionId, expiresAt };
  } catch {
    return null;
  }
}

export function checksum(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
