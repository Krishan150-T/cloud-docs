import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { DocumentEntity } from '../database/entities/document.entity';
import { S3Service } from '../s3/s3.service';

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(DocumentEntity)
    private readonly documentsRepository: Repository<DocumentEntity>,
    private readonly s3Service: S3Service,
  ) {}

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

  async uploadDocument(input: {
    ownerId: string;
    file: Express.Multer.File;
    title?: string;
  }): Promise<DocumentEntity> {
    const storedName = `${uuidv4()}${extname(input.file.originalname)}`;

    await this.s3Service.uploadFile(
      storedName,
      input.file.buffer,
      input.file.mimetype,
    );

    try {
      return await this.createDocument({
        ownerId: input.ownerId,
        originalName: input.file.originalname,
        storedName,
        mimeType: input.file.mimetype,
        sizeBytes: input.file.size,
        storagePath: storedName,
        title: input.title,
      });
    } catch (error) {
      await this.s3Service.deleteFile(storedName).catch(() => undefined);
      throw error;
    }
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

    await this.s3Service.deleteFile(document.storagePath);

    await this.documentsRepository.delete({ id: document.id });
    return { deleted: true };
  }

  async getDownloadStream(
    ownerId: string,
    id: string,
  ): Promise<{ document: DocumentEntity; stream: Readable }> {
    const document = await this.getById(ownerId, id);
    const stream = await this.s3Service.getFileStream(document.storagePath);

    return { document, stream };
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
