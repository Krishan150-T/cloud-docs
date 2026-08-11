import { Module } from '@nestjs/common';
import { S3Module } from '../s3/s3.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentEntity } from '../database/entities/document.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentEntity]), S3Module],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
