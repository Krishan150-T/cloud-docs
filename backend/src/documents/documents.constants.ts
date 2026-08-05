import path from 'node:path';

export const STORAGE_DIR = path.join(process.cwd(), 'storage');
export const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads');
