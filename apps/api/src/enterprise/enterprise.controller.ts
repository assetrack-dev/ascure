import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '../common/interfaces/request-user.interface';
import {
  ListBranchesQueryDto,
  ListCapabilitiesQueryDto,
  ListMainheadsQueryDto,
  ListOrganizationsQueryDto,
  ListOperationalRegionsQueryDto,
  ListProjectsQueryDto,
  ListWorkPackagesQueryDto,
} from './dto/list-enterprise-query.dto';
import {
  CreateBranchDto,
  CreateCapabilityDto,
  CreateMainheadDto,
  CreateOperationalRegionDto,
  CreateOrganizationDto,
  CreateProjectDto,
  CreateWorkPackageDto,
  UpdateBranchDto,
  UpdateCapabilityDto,
  UpdateEnterpriseActiveDto,
  UpdateMainheadDto,
  UpdateOperationalRegionDto,
  UpdateOrganizationDto,
  UpdateProjectDto,
  UpdateProjectLifecycleStatusDto,
  UpdateWorkPackageDto,
  UpdateWorkPackageLifecycleStatusDto,
} from './dto/manage-enterprise.dto';
import { EnterpriseService } from './enterprise.service';

class EnterpriseIdParamDto {
  @IsUUID()
  id!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('enterprise')
export class EnterpriseController {
  constructor(private readonly enterpriseService: EnterpriseService) {}

  @Get('options')
  getOptions(@CurrentUser() user: RequestUser) {
    return this.enterpriseService.getOptions(user);
  }

  @Post('organizations')
  createOrganization(@Body() dto: CreateOrganizationDto) {
    return this.enterpriseService.createOrganization(dto);
  }

  @Get('organizations')
  listOrganizations(@Query() query: ListOrganizationsQueryDto) {
    return this.enterpriseService.listOrganizations(query);
  }

  @Patch('organizations/:id')
  updateOrganization(
    @Param() params: EnterpriseIdParamDto,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.enterpriseService.updateOrganization(params.id, dto);
  }

  @Patch('organizations/:id/status')
  updateOrganizationActive(
    @Param() params: EnterpriseIdParamDto,
    @Body() dto: UpdateEnterpriseActiveDto,
  ) {
    return this.enterpriseService.updateOrganizationActive(params.id, dto);
  }

  @Get('organizations/:id')
  getOrganization(@Param() params: EnterpriseIdParamDto) {
    return this.enterpriseService.getOrganization(params.id);
  }

  @Get('branches')
  listBranches(@Query() query: ListBranchesQueryDto) {
    return this.enterpriseService.listBranches(query);
  }

  @Post('branches')
  createBranch(@Body() dto: CreateBranchDto) {
    return this.enterpriseService.createBranch(dto);
  }

  @Patch('branches/:id')
  updateBranch(
    @Param() params: EnterpriseIdParamDto,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.enterpriseService.updateBranch(params.id, dto);
  }

  @Patch('branches/:id/status')
  updateBranchActive(
    @Param() params: EnterpriseIdParamDto,
    @Body() dto: UpdateEnterpriseActiveDto,
  ) {
    return this.enterpriseService.updateBranchActive(params.id, dto);
  }

  @Get('branches/:id')
  getBranch(@Param() params: EnterpriseIdParamDto) {
    return this.enterpriseService.getBranch(params.id);
  }

  @Get('operational-regions')
  listOperationalRegions(
    @CurrentUser() user: RequestUser,
    @Query() query: ListOperationalRegionsQueryDto,
  ) {
    return this.enterpriseService.listOperationalRegions(user, query);
  }

  @Post('operational-regions')
  createOperationalRegion(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateOperationalRegionDto,
  ) {
    return this.enterpriseService.createOperationalRegion(user, dto);
  }

  @Patch('operational-regions/:id')
  updateOperationalRegion(
    @CurrentUser() user: RequestUser,
    @Param() params: EnterpriseIdParamDto,
    @Body() dto: UpdateOperationalRegionDto,
  ) {
    return this.enterpriseService.updateOperationalRegion(user, params.id, dto);
  }

  @Patch('operational-regions/:id/status')
  updateOperationalRegionActive(
    @CurrentUser() user: RequestUser,
    @Param() params: EnterpriseIdParamDto,
    @Body() dto: UpdateEnterpriseActiveDto,
  ) {
    return this.enterpriseService.updateOperationalRegionActive(
      user,
      params.id,
      dto,
    );
  }

  @Get('operational-regions/:id')
  getOperationalRegion(
    @CurrentUser() user: RequestUser,
    @Param() params: EnterpriseIdParamDto,
  ) {
    return this.enterpriseService.getOperationalRegion(user, params.id);
  }

  @Get('capabilities')
  listCapabilities(@Query() query: ListCapabilitiesQueryDto) {
    return this.enterpriseService.listCapabilities(query);
  }

  @Post('capabilities')
  createCapability(@Body() dto: CreateCapabilityDto) {
    return this.enterpriseService.createCapability(dto);
  }

  @Patch('capabilities/:id')
  updateCapability(
    @Param() params: EnterpriseIdParamDto,
    @Body() dto: UpdateCapabilityDto,
  ) {
    return this.enterpriseService.updateCapability(params.id, dto);
  }

  @Patch('capabilities/:id/status')
  updateCapabilityActive(
    @Param() params: EnterpriseIdParamDto,
    @Body() dto: UpdateEnterpriseActiveDto,
  ) {
    return this.enterpriseService.updateCapabilityActive(params.id, dto);
  }

  @Get('capabilities/:id')
  getCapability(@Param() params: EnterpriseIdParamDto) {
    return this.enterpriseService.getCapability(params.id);
  }

  @Post('mainheads')
  createMainhead(@CurrentUser() user: RequestUser, @Body() dto: CreateMainheadDto) {
    return this.enterpriseService.createMainhead(user, dto);
  }

  @Get('mainheads')
  listMainheads(@Query() query: ListMainheadsQueryDto) {
    return this.enterpriseService.listMainheads(query);
  }

  @Patch('mainheads/:id')
  updateMainhead(
    @CurrentUser() user: RequestUser,
    @Param() params: EnterpriseIdParamDto,
    @Body() dto: UpdateMainheadDto,
  ) {
    return this.enterpriseService.updateMainhead(user, params.id, dto);
  }

  @Patch('mainheads/:id/status')
  updateMainheadActive(
    @Param() params: EnterpriseIdParamDto,
    @Body() dto: UpdateEnterpriseActiveDto,
  ) {
    return this.enterpriseService.updateMainheadActive(params.id, dto);
  }

  @Get('mainheads/:id')
  getMainhead(@Param() params: EnterpriseIdParamDto) {
    return this.enterpriseService.getMainhead(params.id);
  }

  @Post('projects')
  createProject(@Body() dto: CreateProjectDto) {
    return this.enterpriseService.createProject(dto);
  }

  @Get('projects')
  listProjects(@Query() query: ListProjectsQueryDto) {
    return this.enterpriseService.listProjects(query);
  }

  @Patch('projects/:id')
  updateProject(
    @Param() params: EnterpriseIdParamDto,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.enterpriseService.updateProject(params.id, dto);
  }

  @Patch('projects/:id/status')
  updateProjectStatus(
    @Param() params: EnterpriseIdParamDto,
    @Body() dto: UpdateProjectLifecycleStatusDto,
  ) {
    return this.enterpriseService.updateProjectStatus(params.id, dto);
  }

  @Get('projects/:id')
  getProject(@Param() params: EnterpriseIdParamDto) {
    return this.enterpriseService.getProject(params.id);
  }

  @Post('work-packages')
  createWorkPackage(@Body() dto: CreateWorkPackageDto) {
    return this.enterpriseService.createWorkPackage(dto);
  }

  @Get('work-packages')
  listWorkPackages(@Query() query: ListWorkPackagesQueryDto) {
    return this.enterpriseService.listWorkPackages(query);
  }

  @Patch('work-packages/:id')
  updateWorkPackage(
    @Param() params: EnterpriseIdParamDto,
    @Body() dto: UpdateWorkPackageDto,
  ) {
    return this.enterpriseService.updateWorkPackage(params.id, dto);
  }

  @Patch('work-packages/:id/status')
  updateWorkPackageStatus(
    @Param() params: EnterpriseIdParamDto,
    @Body() dto: UpdateWorkPackageLifecycleStatusDto,
  ) {
    return this.enterpriseService.updateWorkPackageStatus(params.id, dto);
  }

  @Get('work-packages/:id')
  getWorkPackage(@Param() params: EnterpriseIdParamDto) {
    return this.enterpriseService.getWorkPackage(params.id);
  }
}
