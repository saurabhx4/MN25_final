import { ROLE_PERMISSIONS } from '../src/middleware/auth';

describe('MN25 ML authorization contract', () => {
  test('researchers may read ML state but cannot train or promote', () => {
    expect(ROLE_PERMISSIONS.RESEARCHER).toContain('ml.read');
    expect(ROLE_PERMISSIONS.RESEARCHER).not.toContain('ml.train');
    expect(ROLE_PERMISSIONS.RESEARCHER).not.toContain('ml.promote');
  });
  test('only admin receives ML training and promotion permissions', () => {
    expect(ROLE_PERMISSIONS.ADMIN).toEqual(expect.arrayContaining(['ml.read','ml.train','ml.promote']));
    expect(ROLE_PERMISSIONS.MANAGER).not.toContain('ml.train');
  });
});
