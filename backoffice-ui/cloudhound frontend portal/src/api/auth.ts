/**
 * Authentication helpers for CloudHound portal.
 * Backend: Django REST Framework + simplejwt
 * Login endpoint: POST /api/v1/auth/login/
 * Refresh endpoint: POST /api/v1/auth/token/refresh/
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

const STORAGE_KEYS = {
  ACCESS: 'ch_access_token',
  REFRESH: 'ch_refresh_token',
  USER: 'ch_user',
} as const;

// ──────────────────────────────────────────────────────────────
// Token storage
// ──────────────────────────────────────────────────────────────

export function getAccessToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.ACCESS);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.REFRESH);
}

export function isAuthenticated(): boolean {
  return !!getAccessToken();
}

function persistTokens(access: string, refresh: string): void {
  localStorage.setItem(STORAGE_KEYS.ACCESS, access);
  localStorage.setItem(STORAGE_KEYS.REFRESH, refresh);
}

export function clearTokens(): void {
  localStorage.removeItem(STORAGE_KEYS.ACCESS);
  localStorage.removeItem(STORAGE_KEYS.REFRESH);
  localStorage.removeItem(STORAGE_KEYS.USER);
}

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
}

export interface LoginResult {
  user: AuthUser;
  access_token: string;
  refresh_token: string;
}

// ──────────────────────────────────────────────────────────────
// API calls
// ──────────────────────────────────────────────────────────────

export async function login(email: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${API_BASE_URL}/auth/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const contentType = res.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await res.json() : null;

  if (!res.ok) {
    const msg = body?.message || body?.detail || res.statusText;
    throw new Error(msg);
  }

  const { access_token, refresh_token, data: user } = body as {
    access_token: string;
    refresh_token: string;
    data: AuthUser;
  };

  persistTokens(access_token, refresh_token);
  localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));

  return { user, access_token, refresh_token };
}

/** Returns a new access token, or throws if the refresh token is invalid/expired. */
export async function refreshAccessToken(): Promise<string> {
  const refresh = getRefreshToken();
  if (!refresh) throw new Error('No refresh token');

  const res = await fetch(`${API_BASE_URL}/auth/token/refresh/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh }),
  });

  if (!res.ok) {
    clearTokens();
    throw new Error('Session expired. Please log in again.');
  }

  const { access } = (await res.json()) as { access: string };
  localStorage.setItem(STORAGE_KEYS.ACCESS, access);
  return access;
}

export function logout(): void {
  clearTokens();
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.USER);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}
