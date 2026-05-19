import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  ListBranchesQueryDto,
  ListMainheadsQueryDto,
  ListOrganizationsQueryDto,
  ListProjectsQueryDto,
  ListWorkPackagesQueryDto,
} from './dto/list-enterprise-query.dto';
import { EnterpriseService } from './enterprise.service';

class EnterpriseIdParamDto {
  @IsUUID()
  id!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('enterprise')
export class EnterpriseController {
  constructor(private readonly enterpriseService: EnterpriseService) {}

  @Get('organizations')
  listOrganizations(@Query() query: ListOrganizationsQueryDto) {
    return this.enterpriseService.listOrganizations(query);
  }

  @Get('organizations/:id')
  getOrganization(@Param() params: EnterpriseIdParamDto) {
    return this.enterpriseService.getOrganization(params.id);
  }

  @Get('branches')
  listBranches(@Query() query: ListBranchesQueryDto) {
    return this.enterpriseService.listBranches(query);
  }

  @Get('branches/:id')
  getBranch(@Param() params: EnterpriseIdParamDto) {
    return this.enterpriseService.getBranch(params.id);
  }

  @Get('mainheads')
  listMainheads(@Query() query: ListMainheadsQueryDto) {
    return this.enterpriseService.listMainheads(query);
  }

  @Get('mainheads/:id')
  getMainhead(@Param() params: EnterpriseIdParamDto) {
    return this.enterpriseService.getMainhead(params.id);
  }

  @Get('projects')
  listProjects(@Query() query: ListProjectsQueryDto) {
    return this.enterpriseService.listProjects(query);
  }

  @Get('projects/:id')
  getProject(@Param() params: EnterpriseIdParamDto) {
    return this.enterpriseService.getProject(params.id);
  }

  @Get('work-packages')
  listWorkPackages(@Query() query: ListWorkPackagesQueryDto) {
    return this.enterpriseService.listWorkPackages(query);
  }

  @Get('work-packages/:id')
  getWorkPackage(@Param() params: EnterpriseIdParamDto) {
    return this.enterpriseService.getWorkPackage(params.id);
  }
}
