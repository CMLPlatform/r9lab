import { API_URL } from '@/config';
import { fetchWithAuth } from '@/services/api/auth/authRefresh';
import type { components } from '@/types/api.generated';
import { throwFromResponse } from './errors';

export type AdminUser = components['schemas']['UserRead'];
export type AdminUsersPage = components['schemas']['Page_UserRead_'];
export type ErasureContent = components['schemas']['ErasureContent'];
export type AdminUserRole = components['schemas']['UserRoleUpdate']['role'];

/** One structured filter at a time, each a single `/admin/users` query param. */
export type AdminUsersFilter = 'all' | 'suspended' | 'unverified' | 'superusers';

const FILTER_PARAMS: Record<AdminUsersFilter, [string, string] | null> = {
  all: null,
  suspended: ['is_active', 'false'],
  unverified: ['is_verified', 'false'],
  superusers: ['is_superuser', 'true'],
};

const ADMIN_USERS = `${API_URL}/admin/users`;
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

export type AdminUsersQuery = {
  search: string;
  filter: AdminUsersFilter;
  page: number;
  size: number;
};

export async function fetchAdminUsers({
  search,
  filter,
  page,
  size,
}: AdminUsersQuery): Promise<AdminUsersPage> {
  const url = new URL(ADMIN_USERS);
  if (search) url.searchParams.set('search', search);
  const param = FILTER_PARAMS[filter];
  if (param) url.searchParams.set(...param);
  url.searchParams.set('order_by', 'email');
  url.searchParams.set('page', String(page));
  url.searchParams.set('size', String(size));
  const resp = await fetchWithAuth(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!resp.ok) await throwFromResponse(resp, "Couldn't load the users. Try again.");
  return resp.json() as Promise<AdminUsersPage>;
}

export async function fetchAdminUser(id: string): Promise<AdminUser> {
  const resp = await fetchWithAuth(`${ADMIN_USERS}/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) await throwFromResponse(resp, "Couldn't load the user. Try again.");
  return resp.json() as Promise<AdminUser>;
}

export async function setAdminUserRole(id: string, role: AdminUserRole): Promise<AdminUser> {
  const resp = await fetchWithAuth(`${ADMIN_USERS}/${encodeURIComponent(id)}/role`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ role }),
  });
  if (!resp.ok) await throwFromResponse(resp, "Couldn't change the role. Try again.");
  return resp.json() as Promise<AdminUser>;
}

export async function setAdminUserActive(id: string, isActive: boolean): Promise<AdminUser> {
  const resp = await fetchWithAuth(`${ADMIN_USERS}/${encodeURIComponent(id)}/active`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ is_active: isActive }),
  });
  if (!resp.ok) await throwFromResponse(resp, "Couldn't change the account status. Try again.");
  return resp.json() as Promise<AdminUser>;
}

export async function resetAdminUserMfa(id: string): Promise<void> {
  const resp = await fetchWithAuth(`${ADMIN_USERS}/${encodeURIComponent(id)}/mfa/reset`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) await throwFromResponse(resp, "Couldn't reset two-step verification. Try again.");
}

export async function eraseAdminUser(id: string, content: ErasureContent): Promise<void> {
  const url = new URL(`${ADMIN_USERS}/${encodeURIComponent(id)}`);
  url.searchParams.set('content', content);
  const resp = await fetchWithAuth(url, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) await throwFromResponse(resp, "Couldn't delete the account. Try again.");
}
