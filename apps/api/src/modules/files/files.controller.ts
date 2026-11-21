import { Controller, Get, Inject, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { notFound } from '../../common/errors/domain-errors';
import { FILE_LINK_TTL_SECONDS, FileLinksService } from '../../common/storage/file-links.service';
import { FILE_STORAGE, type FileStorage } from '../../common/storage/file-storage';
import { Public } from '../auth/auth.decorators';

/** Serves stored files to holders of a signed link (FileLinksService). */
@ApiExcludeController()
@Controller('files')
export class FilesController {
  constructor(
    private readonly links: FileLinksService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  // Public by design: the signed, expiring token is the authorization.
  @Get(':token')
  @Public()
  async get(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const key = this.links.verify(token);
    const file = key ? await this.storage.get(key) : null;
    if (!file) {
      throw notFound('File');
    }
    res.setHeader('Cache-Control', `private, max-age=${FILE_LINK_TTL_SECONDS}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(file.body, { type: file.contentType, disposition: 'inline' });
  }
}
