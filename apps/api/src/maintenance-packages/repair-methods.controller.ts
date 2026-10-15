import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { MaintenanceCategory, UserRole } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';

class CreateRepairMethodDto {
  @IsEnum(MaintenanceCategory)
  category!: MaintenanceCategory;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  label!: string;

  @IsOptional()
  @IsBoolean()
  requiresNote?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

class UpdateRepairMethodDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsBoolean()
  requiresNote?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

const SELECT = {
  id: true,
  category: true,
  code: true,
  label: true,
  requiresNote: true,
  sortOrder: true,
  isActive: true,
  _count: { select: { defects: true } },
} as const;

/**
 * ADMIN: the kinds of repair a crew picks from at "Mark done" (plan §20, P2 —
 * e.g. Rentis: KAEDAH LAZIM, KAEDAH A.B.C, ULAN/CREEPERS, TEBANG POKOK,
 * Lain-lain). Retire instead of delete — past repairs keep their type.
 * The crew-facing active list is GET /maintenance-work/repair-methods.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('repair-methods')
export class RepairMethodsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const rows = await this.prisma.repairMethod.findMany({
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
      select: SELECT,
    });
    return rows.map(({ _count, ...row }) => ({ ...row, usedCount: _count.defects }));
  }

  @Post()
  async create(@Body() dto: CreateRepairMethodDto) {
    const label = dto.label.replace(/\s+/g, ' ').trim();
    const slug = label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'METHOD';
    let code = `${dto.category}_${slug}`;
    for (let n = 2; await this.prisma.repairMethod.findUnique({ where: { code } }); n += 1) {
      code = `${dto.category}_${slug}_${n}`;
    }
    const last = await this.prisma.repairMethod.findFirst({
      where: { category: dto.category },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const row = await this.prisma.repairMethod.create({
      data: {
        category: dto.category,
        code,
        label,
        requiresNote: dto.requiresNote ?? false,
        sortOrder: dto.sortOrder ?? (last ? last.sortOrder + 10 : 10),
      },
      select: SELECT,
    });
    const { _count, ...rest } = row;
    return { ...rest, usedCount: _count.defects };
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRepairMethodDto) {
    const existing = await this.prisma.repairMethod.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      throw new NotFoundException('Repair type not found.');
    }
    const label = dto.label?.replace(/\s+/g, ' ').trim();
    if (dto.label !== undefined && !label) {
      throw new BadRequestException('A name is required.');
    }
    const row = await this.prisma.repairMethod.update({
      where: { id },
      data: {
        ...(label ? { label } : {}),
        ...(dto.requiresNote !== undefined ? { requiresNote: dto.requiresNote } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      select: SELECT,
    });
    const { _count, ...rest } = row;
    return { ...rest, usedCount: _count.defects };
  }
}
