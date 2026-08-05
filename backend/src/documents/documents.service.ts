import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'node:fs';
import { Repository } from 'typeorm';
import { UPLOADS_DIR } from './documents.constants';
import { DocumentEntity } from '../database/entities/document.entity';

@Injectable()
export class DocumentsService implements OnModuleInit {
  constructor(
    @InjectRepository(DocumentEntity)
    private readonly documentsRepository: Repository<DocumentEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
  }

  static uploadsDir(): string {
    return UPLOADS_DIR;
  }

  async createDocument(input: {
    ownerId: string;
    originalName: string;
    storedName: string;
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
    title?: string;
  }): Promise<DocumentEntity> {
    const document = this.documentsRepository.create({
      ownerId: input.ownerId,
      title: input.title?.trim() || input.originalName,
      originalName: input.originalName,
      storedName: input.storedName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storagePath: input.storagePath,
    });

    return this.documentsRepository.save(document);
  }

  listByOwner(ownerId: string): Promise<DocumentEntity[]> {
    return this.documentsRepository.find({
      where: { ownerId },
      order: { uploadedAt: 'DESC' },
    });
  }

  async getById(ownerId: string, id: string): Promise<DocumentEntity> {
    const document = await this.documentsRepository.findOne({ where: { id } });
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    if (document.ownerId !== ownerId) {
      throw new ForbiddenException('You do not have access to this document');
    }
    return document;
  }

  async updateTitle(
    ownerId: string,
    id: string,
    title: string,
  ): Promise<DocumentEntity> {
    const document = await this.documentsRepository.findOne({ where: { id } });
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    if (document.ownerId !== ownerId) {
      throw new ForbiddenException('You do not have access to this document');
    }

    document.title = title.trim() || document.originalName;
    return this.documentsRepository.save(document);
  }

  async delete(ownerId: string, id: string): Promise<{ deleted: boolean }> {
    const document = await this.documentsRepository.findOne({ where: { id } });
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    if (document.ownerId !== ownerId) {
      throw new ForbiddenException('You do not have access to this document');
    }

    try {
      await fs.unlink(document.storagePath);
    } catch {
      // Missing files are ignored to keep metadata cleanup resilient.
    }

    await this.documentsRepository.delete({ id: document.id });
    return { deleted: true };
  }

  async getStats(ownerId: string): Promise<{
    totalDocuments: number;
    totalSizeBytes: number;
    recentUploads: DocumentEntity[];
  }> {
    const documents = await this.documentsRepository.find({
      where: { ownerId },
      order: { uploadedAt: 'DESC' },
    });
    const totalSizeBytes = documents.reduce(
      (sum, document) => sum + document.sizeBytes,
      0,
    );

    return {
      totalDocuments: documents.length,
      totalSizeBytes,
      recentUploads: documents.slice(0, 5),
    };
  }
}
