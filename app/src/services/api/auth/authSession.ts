import {
  getSecureItem,
  getSessionItem,
  isWeb,
  removeSecureItem,
  removeSessionItem,
  setSecureItem,
  setSessionItem,
} from '@/services/storage';
import { authRuntime } from './authRuntime';

export const ACCESS_TOKEN_KEY = 'access_token';
export const REFRESH_TOKEN_KEY = 'refresh_token';
export const WEB_SESSION_FLAG = 'web_has_session';
// Kept across sign-out on purpose: it marks this phone as one that has signed in before, so
// strangers guessing at the account cannot spend its login budget (backend device_cookie.py).
export const DEVICE_TOKEN_KEY = 'device_token';

export async function loadStoredAccessToken() {
  if (isWeb()) return;
  return getSecureItem(ACCESS_TOKEN_KEY);
}

export async function persistStoredAccessToken(nextToken: string) {
  if (isWeb()) return;
  await setSecureItem(ACCESS_TOKEN_KEY, nextToken);
}

export async function loadStoredRefreshToken() {
  if (isWeb()) return;
  return getSecureItem(REFRESH_TOKEN_KEY);
}

export async function persistStoredRefreshToken(nextToken: string) {
  if (isWeb()) return;
  await setSecureItem(REFRESH_TOKEN_KEY, nextToken);
}

export async function loadStoredDeviceToken() {
  if (isWeb()) return;
  return getSecureItem(DEVICE_TOKEN_KEY);
}

export async function persistStoredDeviceToken(nextToken: string) {
  if (isWeb()) return;
  await setSecureItem(DEVICE_TOKEN_KEY, nextToken);
}

export async function clearStoredAccessToken() {
  if (isWeb()) return;
  await removeSecureItem(ACCESS_TOKEN_KEY);
}

export async function clearStoredRefreshToken() {
  if (isWeb()) return;
  await removeSecureItem(REFRESH_TOKEN_KEY);
}

export function setWebSessionFlag(value: boolean) {
  if (!isWeb()) return;
  if (value) {
    setSessionItem(WEB_SESSION_FLAG, '1');
  } else {
    removeSessionItem(WEB_SESSION_FLAG);
  }
}

export function hasWebSessionFlag() {
  if (!isWeb()) return false;
  return Boolean(getSessionItem(WEB_SESSION_FLAG));
}

/** Record that a live browser session exists (password login, MFA challenge, OAuth). */
export function markWebSessionActive(): void {
  if (!isWeb()) return;
  authRuntime.explicitlyLoggedOut = false;
  setWebSessionFlag(true);
}
