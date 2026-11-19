import { jest } from '@jest/globals';
import type { AdminUser } from '@/services/api/adminUsers';
import type { User } from '@/types/User';

/**
 * Creates a minimal fetch Response-like mock object.
 *
 * @param status  HTTP status code
 * @param body    Response body (will be JSON-serialized)
 * @param ok      Overrides the default ok flag (status 200-299 → true)
 */
export function mockResponse(status: number, body: unknown, ok?: boolean) {
  return {
    status,
    ok: ok ?? (status >= 200 && status < 300),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/**
 * Assigns a jest mock to `global.fetch` and returns it so tests can
 * configure resolved values with `.mockResolvedValueOnce()`.
 */
export function setupFetchMock() {
  const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
  global.fetch = fetchMock;
  return fetchMock;
}

/** Creates a minimal User object with optional overrides. */
export function mockUser(overrides: Partial<User> = {}): User {
  return {
    id: '1',
    username: 'testuser',
    email: 'test@example.com',
    isActive: true,
    isVerified: true,
    isSuperuser: false,
    mfaEnabled: false,
    hasUsablePassword: true,
    role: 'contributor',
    termsAcceptanceRequired: false,
    uploadQuota: { files: 1000, bytes: 1024 * 1024 * 1024, usedFiles: 0, usedBytes: 0 },
    imageLimits: { maxBytes: 10 * 1024 * 1024, maxPixels: 30_000_000 },
    oauth_accounts: [],
    preferences: {},
    ...overrides,
  };
}

/** A `UserRead` as the `/admin/users` routes return it (snake_case, server fields). */
export function mockAdminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: '7d9f3c4e-0a1b-4c2d-8e3f-5a6b7c8d9e0f',
    email: 'ada@example.org',
    username: 'ada',
    is_active: true,
    is_superuser: false,
    is_verified: true,
    mfa_enabled: true,
    has_usable_password: true,
    terms_acceptance_required: false,
    role: 'contributor',
    oauth_accounts: [],
    upload_quota_files: 1000,
    upload_quota_bytes: 1024 * 1024 * 1024,
    image_upload_max_bytes: 10 * 1024 * 1024,
    image_upload_max_pixels: 30_000_000,
    upload_file_count: 0,
    upload_total_bytes: 0,
    ...overrides,
  };
}
