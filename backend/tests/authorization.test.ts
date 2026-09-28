import { ROLE_PERMISSIONS } from '../src/middleware/auth';

describe('MN25 explicit authorization matrix', () => {
  test('researcher permissions are limited to research/data reads', () => {
    expect(ROLE_PERMISSIONS.RESEARCHER).toEqual(expect.arrayContaining(['exploration.read', 'analysis.run', 'reports.generate']));
    expect(ROLE_PERMISSIONS.RESEARCHER).not.toContain('users.manage');
    expect(ROLE_PERMISSIONS.RESEARCHER).not.toContain('actions.approve');
  });

  test('operator receives operational read permissions without approval permissions', () => {
    expect(ROLE_PERMISSIONS.OPERATOR).toEqual(expect.arrayContaining(['operational.read', 'production.read', 'risk.read']));
    expect(ROLE_PERMISSIONS.OPERATOR).not.toContain('actions.approve');
  });

  test('manager can approve/schedule but cannot manage users', () => {
    expect(ROLE_PERMISSIONS.MANAGER).toEqual(expect.arrayContaining(['actions.approve', 'actions.schedule', 'operational.analytics']));
    expect(ROLE_PERMISSIONS.MANAGER).not.toContain('users.manage');
  });

  test('admin has organization administration permissions', () => {
    expect(ROLE_PERMISSIONS.ADMIN).toEqual(expect.arrayContaining(['users.manage', 'settings.manage', 'organization.manage', 'audit.read', 'data.upload']));
  });
});
