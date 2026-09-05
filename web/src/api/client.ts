const ACCESS_KEY = 'ct.access';
const REFRESH_KEY = 'ct.refresh';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

export const tokens = {
  access: () => localStorage.getItem(ACCESS_KEY),
  refresh: () => localStorage.getItem(REFRESH_KEY),
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

/** Notifies the auth context when the session is beyond saving. */
let onSessionLost: () => void = () => {};
export const setSessionLostHandler = (fn: () => void) => { onSessionLost = fn; };


function isTokenExpired(token: string): boolean {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      window
        .atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(jsonPayload);
    // 10 seconds of slack
    return payload.exp * 1000 < Date.now() + 10000;
  } catch {
    return true;
  }
}

let refreshing: Promise<boolean> | null = null;

/**
 * Access tokens live 15 minutes, so a 401 mid-session is routine. Refresh once
 * and replay the request; concurrent 401s share the same refresh promise so a
 * page with six panels does not fire six rotations and invalidate its own token.
 */
async function refreshSession(): Promise<boolean> {
  const token = tokens.refresh();
  if (!token || isTokenExpired(token)) return false;

  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: token }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      tokens.set(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();

  return refreshing;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** multipart bodies are passed through untouched */
  form?: FormData;
  signal?: AbortSignal;
}

async function send(path: string, opts: RequestOptions, isRetry = false): Promise<Response> {
  const headers: Record<string, string> = {};
  let access = tokens.access();
  if (access && !isRetry) {
    if (isTokenExpired(access)) {
      if (tokens.refresh() && (await refreshSession())) {
        access = tokens.access();
      } else {
        tokens.clear();
        onSessionLost();
        // Return a fake 401 to avoid the browser logging a real failed HTTP request
        return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Session expired' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
  }

  if (access) headers.authorization = `Bearer ${access}`;

  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form; // let the browser set the multipart boundary
  } else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(`/api/v1${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body,
    signal: opts.signal,
    redirect: 'follow',
  });

  if (res.status === 401 && !isRetry && tokens.refresh()) {
    if (await refreshSession()) return send(path, opts, true);
    tokens.clear();
    onSessionLost();
  }

  return res;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await send(path, opts);

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'ERROR', err.message ?? res.statusText, err.details);
  }

  return data as T;
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
export const upload = <T>(path: string, form: FormData) => api<T>(path, { method: 'POST', form });

/** Downloads stream through the API, so the auth header has to travel with them. */
export async function download(id: string, fileName: string): Promise<void> {
  const res = await send(`/documents/${id}/download`, {});
  if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD_FAILED', 'Could not download the file');

  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}
