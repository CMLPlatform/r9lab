import { describe, expect, test as it } from '@jest/globals';
import { ACCOUNT_SECTIONS } from '@/features/profile/accountSections';
import { mockUser } from '@/test-utils/api-mocks';

describe('ACCOUNT_SECTIONS', () => {
  it('defines the six account groups in spec order', () => {
    expect(ACCOUNT_SECTIONS.map((section) => section.key)).toEqual([
      'preferences',
      'integrations',
      'security',
      'data',
      'admin',
      'about',
      'danger',
    ]);
  });

  it('labels are sentence case and danger zone is last', () => {
    expect(ACCOUNT_SECTIONS.map((section) => section.label)).toEqual([
      'Preferences',
      'Integrations',
      'Security & sessions',
      'Your data',
      'Admin',
      'About',
      'Danger zone',
    ]);
    expect(ACCOUNT_SECTIONS.at(-1)?.key).toBe('danger');
  });

  it('shows the admin group to superusers only', () => {
    const admin = ACCOUNT_SECTIONS.find((section) => section.key === 'admin');
    expect(admin?.visible?.(mockUser({ isSuperuser: false }))).toBe(false);
    expect(admin?.visible?.(mockUser({ isSuperuser: true }))).toBe(true);
    // Every other group has no predicate, so it is always shown.
    expect(ACCOUNT_SECTIONS.filter((section) => section.visible)).toEqual([admin]);
  });
});
