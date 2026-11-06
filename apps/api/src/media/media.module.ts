import { Module } from '@nestjs/common';
import { MediaStorage } from './media-storage';

// Uploaded files (ADR 0023).
@Module({
  providers: [MediaStorage],
  exports: [MediaStorage],
})
export class MediaModule {}
