import { describe, expect, test as it } from '@jest/globals';
import { ACCOUNT_SECTIONS } from '@/features/profile/accountSections';

describe('ACCOUNT_SECTIONS', () => {
  it('defines the six account groups in spec order', () => {
    expect(ACCOUNT_SECTIONS.map((section) => section.key)).toEqual([
      'preferences',
      'integrations',
      'security',
      'data',
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
      'About',
      'Danger zone',
    ]);
    expect(ACCOUNT_SECTIONS.at(-1)?.key).toBe('danger');
  });
});
