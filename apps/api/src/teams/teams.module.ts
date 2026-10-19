import { Module } from '@nestjs/common';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { MyTeamService } from './my-team.service';

@Module({
  controllers: [TeamsController],
  providers: [TeamsService, MyTeamService],
})
export class TeamsModule {}
