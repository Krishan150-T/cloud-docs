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
import { memoryStorage } from 'multer';
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
      storage: memoryStorage(),
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

    return this.documentsService.uploadDocument({
      ownerId: req.user.userId,
      file,
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
    const { document, stream } = await this.documentsService.getDownloadStream(
      req.user.userId,
      id,
    );

    return new StreamableFile(stream, {
      type: document.mimeType,
      disposition: `attachment; filename="${document.originalName}"`,
    });
  }
}
