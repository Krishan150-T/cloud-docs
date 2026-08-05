export interface User {
  id: string;
  name: string;
  email: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export interface DocumentRecord {
  id: string;
  ownerId: string;
  title: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  uploadedAt: string;
}

export interface DocumentStats {
  totalDocuments: number;
  totalSizeBytes: number;
  recentUploads: DocumentRecord[];
}
