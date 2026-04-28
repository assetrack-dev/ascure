import { Module } from '@nestjs/common';
import { DefectsController } from './defects.controller';
import { DefectsService } from './defects.service';

@Module({
  controllers: [DefectsController],
  providers: [DefectsService],
})
export class DefectsModule {}
