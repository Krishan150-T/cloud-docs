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
