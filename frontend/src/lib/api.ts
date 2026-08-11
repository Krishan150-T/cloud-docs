import type {
  AuthResponse,
  DocumentRecord,
  DocumentStats,
} from '../types';

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  '/api';

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const fallback = 'Request failed';
    try {
      const payload = (await response.json()) as { message?: string | string[] };
      const message = Array.isArray(payload.message)
        ? payload.message.join(', ')
        : payload.message;
      throw new Error(message || fallback);
    } catch {
      throw new Error(fallback);
    }
  }

  return (await response.json()) as T;
}

export function register(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function login(input: {
  email: string;
  password: string;
}): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listDocuments(token: string): Promise<DocumentRecord[]> {
  return request<DocumentRecord[]>('/documents', {}, token);
}

export function getStats(token: string): Promise<DocumentStats> {
  return request<DocumentStats>('/documents/stats', {}, token);
}

export function uploadDocument(input: {
  token: string;
  file: File;
  title?: string;
}): Promise<DocumentRecord> {
  const formData = new FormData();
  formData.append('file', input.file);
  if (input.title?.trim()) {
    formData.append('title', input.title.trim());
  }

  return request<DocumentRecord>(
    '/documents/upload',
    {
      method: 'POST',
      body: formData,
    },
    input.token,
  );
}

export function deleteDocument(token: string, id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/documents/${id}`, { method: 'DELETE' }, token);
}

export async function downloadDocument(token: string, document: DocumentRecord): Promise<void> {
  const response = await fetch(`${API_BASE}/documents/${document.id}/download`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Could not download file');
  }

  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = href;
  anchor.download = document.originalName;
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
