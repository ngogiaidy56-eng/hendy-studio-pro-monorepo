const API = import.meta.env.VITE_API_BASE_URL || '/api/v1';
export function getToken() { return sessionStorage.getItem('hendy_admin_token'); }
export function setToken(token: string | null) { token ? sessionStorage.setItem('hendy_admin_token', token) : sessionStorage.removeItem('hendy_admin_token'); }
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = getToken(); if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (!res.ok) { const message = await res.json().catch(() => ({})); throw new Error(message.error || `Request failed (${res.status})`); }
  return res.status === 204 ? undefined as T : res.json();
}
