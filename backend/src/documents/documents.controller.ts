import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { createReadStream } from 'node:fs';
import { extname, join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { DocumentsService } from './documents.service';
import { UpdateDocumentDto } from './dto/update-document.dto';

interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: DocumentsService.uploadsDir(),
        filename: (_, file, callback) => {
          const extension = extname(file.originalname);
          callback(null, `${uuidv4()}${extension}`);
        },
      }),
    }),
  )
  async upload(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
    @Body('title') title?: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    return this.documentsService.createDocument({
      ownerId: req.user.userId,
      originalName: file.originalname,
      storedName: file.filename,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      storagePath: join(DocumentsService.uploadsDir(), file.filename),
      title,
    });
  }

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.documentsService.listByOwner(req.user.userId);
  }

  @Get('stats')
  stats(@Req() req: AuthenticatedRequest) {
    return this.documentsService.getStats(req.user.userId);
  }

  @Get(':id')
  getById(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.documentsService.getById(req.user.userId, id);
  }

  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() updateDto: UpdateDocumentDto,
  ) {
    return this.documentsService.updateTitle(
      req.user.userId,
      id,
      updateDto.title ?? '',
    );
  }

  @Delete(':id')
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.documentsService.delete(req.user.userId, id);
  }

  @Get(':id/download')
  async download(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const document = await this.documentsService.getById(req.user.userId, id);
    const file = createReadStream(document.storagePath);

    return new StreamableFile(file, {
      type: document.mimeType,
      disposition: `attachment; filename="${document.originalName}"`,
    });
  }
}
