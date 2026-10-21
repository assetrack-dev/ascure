import { Module } from '@nestjs/common';
import { SheetSyncController } from './sheet-sync.controller';
import { SheetSyncService } from './sheet-sync.service';

/** Nightly verified-repair dates into TNB's Google Sheets (docs/PLAN-google-sheet-repair-sync.md). */
@Module({
  controllers: [SheetSyncController],
  providers: [SheetSyncService],
})
export class SheetSyncModule {}
