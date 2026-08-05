import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  deleteDocument,
  downloadDocument,
  getStats,
  listDocuments,
  uploadDocument,
} from '../lib/api';
import type { DocumentRecord, DocumentStats, User } from '../types';

interface DashboardPageProps {
  token: string;
  user: User;
  onLogout: () => void;
}

function bytesToMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function DashboardPage({ token, user, onLogout }: DashboardPageProps) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [stats, setStats] = useState<DocumentStats | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');

  const storageUsage = useMemo(() => {
    return stats ? bytesToMegabytes(stats.totalSizeBytes) : '0.00 MB';
  }, [stats]);

  async function loadData() {
    setIsLoading(true);
    setError('');
    try {
      const [docs, statsResponse] = await Promise.all([
        listDocuments(token),
        getStats(token),
      ]);
      setDocuments(docs);
      setStats(statsResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [token]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) {
      setError('Select a file first');
      return;
    }

    setIsUploading(true);
    setError('');

    try {
      await uploadDocument({ token, file: selectedFile, title });
      setSelectedFile(null);
      setTitle('');
      await loadData();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : 'Upload failed',
      );
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDelete(documentId: string) {
    setError('');
    try {
      await deleteDocument(token, documentId);
      await loadData();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : 'Delete failed',
      );
    }
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(160deg,#fff7ed_0%,#fef3c7_45%,#f8fafc_100%)] px-4 py-6 sm:px-10 sm:py-10">
      <section className="mx-auto w-full max-w-6xl space-y-6">
        <header className="rounded-2xl border border-orange-100 bg-white/90 p-6 shadow-[0_12px_45px_-25px_rgba(124,45,18,0.55)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-orange-600">CloudDocs Dashboard</p>
              <h1 className="mt-2 text-3xl font-semibold text-slate-900">Hi {user.name}, manage your documents</h1>
            </div>
            <button
              onClick={onLogout}
              className="rounded-xl border border-orange-200 px-4 py-2 text-sm font-medium text-orange-700 transition hover:bg-orange-50"
            >
              Logout
            </button>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <article className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs uppercase tracking-wide text-amber-700">Total Documents</p>
              <p className="mt-2 text-2xl font-semibold text-amber-900">{stats?.totalDocuments ?? 0}</p>
            </article>
            <article className="rounded-xl border border-orange-200 bg-orange-50 p-4">
              <p className="text-xs uppercase tracking-wide text-orange-700">Storage Usage</p>
              <p className="mt-2 text-2xl font-semibold text-orange-900">{storageUsage}</p>
            </article>
            <article className="rounded-xl border border-sky-200 bg-sky-50 p-4">
              <p className="text-xs uppercase tracking-wide text-sky-700">Recent Uploads</p>
              <p className="mt-2 text-2xl font-semibold text-sky-900">{stats?.recentUploads.length ?? 0}</p>
            </article>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <article className="rounded-2xl border border-orange-100 bg-white p-5">
            <h2 className="text-xl font-semibold text-slate-900">Upload Document</h2>
            <form className="mt-4 space-y-3" onSubmit={handleUpload}>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Title (optional)</span>
                <input
                  className="w-full rounded-xl border border-orange-200 px-3 py-2 text-sm outline-none ring-orange-200 focus:ring"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. Team Q3 Plan"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">File</span>
                <input
                  type="file"
                  className="w-full rounded-xl border border-orange-200 px-3 py-2 text-sm"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setSelectedFile(file);
                  }}
                  required
                />
              </label>
              <button
                type="submit"
                disabled={isUploading}
                className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
              >
                {isUploading ? 'Uploading...' : 'Upload'}
              </button>
            </form>
          </article>

          <article className="rounded-2xl border border-orange-100 bg-white p-5">
            <h2 className="text-xl font-semibold text-slate-900">Your Documents</h2>

            {isLoading ? (
              <p className="mt-4 text-sm text-slate-600">Loading documents...</p>
            ) : documents.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">No documents uploaded yet.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-2 py-2">Title</th>
                      <th className="px-2 py-2">Size</th>
                      <th className="px-2 py-2">Uploaded</th>
                      <th className="px-2 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((document) => (
                      <tr key={document.id} className="border-t border-slate-100">
                        <td className="px-2 py-3 font-medium text-slate-800">{document.title}</td>
                        <td className="px-2 py-3 text-slate-600">{bytesToMegabytes(document.sizeBytes)}</td>
                        <td className="px-2 py-3 text-slate-600">
                          {new Date(document.uploadedAt).toLocaleString()}
                        </td>
                        <td className="px-2 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => void downloadDocument(token, document)}
                              className="rounded-lg border border-sky-200 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50"
                            >
                              Download
                            </button>
                            <button
                              onClick={() => void handleDelete(document.id)}
                              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </section>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}
      </section>
    </main>
  );
}
