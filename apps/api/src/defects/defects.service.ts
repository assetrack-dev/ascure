import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DefectStatus } from '@prisma/client';
import { buildInspectionImagePath } from '../common/uploads.constants';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateDefectStatusDto } from './dto/update-defect-status.dto';

@Injectable()
export class DefectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: RequestUser) {
    await this.ensureDefectsForAccessibleItems(user);

    const defects = await this.prisma.defect.findMany({
      where: {
        inspectionItemResult: {
          isDefect: true,
          inspection: {
            tenantId: user.tenantId,
            ...this.inspectionAccessScope(user),
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        inspectionItemResult: {
          select: {
            id: true,
            inspectionId: true,
            label: true,
            remark: true,
            createdAt: true,
            inspection: {
              select: {
                id: true,
                assetId: true,
                inspectionCycle: true,
                submittedAt: true,
                asset: {
                  select: {
                    id: true,
                    assetCode: true,
                    assetType: {
                      select: {
                        code: true,
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    return defects
      .sort((left, right) => {
        const leftSubmittedAt =
          left.inspectionItemResult.inspection.submittedAt?.getTime() ?? 0;
        const rightSubmittedAt =
          right.inspectionItemResult.inspection.submittedAt?.getTime() ?? 0;

        if (leftSubmittedAt !== rightSubmittedAt) {
          return rightSubmittedAt - leftSubmittedAt;
        }

        return (
          right.inspectionItemResult.createdAt.getTime() -
          left.inspectionItemResult.createdAt.getTime()
        );
      })
      .map((defect) => this.serializeDefectListItem(defect));
  }

  async getDetail(user: RequestUser, defectId: string) {
    const defect = await this.findOrCreateAccessibleDefect(user, defectId);

    return this.serializeDefectDetail(defect);
  }

  async updateStatus(user: RequestUser, defectId: string, dto: UpdateDefectStatusDto) {
    const defect = await this.findOrCreateAccessibleDefect(user, defectId);
    const data: {
      status: DefectStatus;
      closedAt: Date | null;
      actionRemark?: string | null;
    } = {
      status: dto.status,
      closedAt: dto.status === DefectStatus.CLOSED ? new Date() : null,
    };

    if (dto.actionRemark !== undefined) {
      data.actionRemark = this.normalizeOptionalString(dto.actionRemark);
    }

    await this.prisma.defect.update({
      where: {
        id: defect.id,
      },
      data,
    });

    return this.getDetail(user, defect.id);
  }

  private async ensureDefectsForAccessibleItems(user: RequestUser) {
    const itemResults = await this.prisma.inspectionItemResult.findMany({
      where: {
        isDefect: true,
        inspection: {
          tenantId: user.tenantId,
          ...this.inspectionAccessScope(user),
        },
      },
      select: {
        id: true,
      },
    });

    if (itemResults.length === 0) {
      return;
    }

    const now = new Date();

    await this.prisma.defect.createMany({
      data: itemResults.map((item) => ({
        id: randomUUID(),
        inspectionItemResultId: item.id,
        status: DefectStatus.OPEN,
        createdAt: now,
        updatedAt: now,
      })),
      skipDuplicates: true,
    });
  }

  private async findOrCreateAccessibleDefect(user: RequestUser, defectId: string) {
    const existingDefect = await this.findAccessibleDefectById(user, defectId);

    if (existingDefect) {
      return existingDefect;
    }

    const itemResult = await this.prisma.inspectionItemResult.findFirst({
      where: {
        id: defectId,
        isDefect: true,
        inspection: {
          tenantId: user.tenantId,
          ...this.inspectionAccessScope(user),
        },
      },
      select: {
        id: true,
      },
    });

    if (!itemResult) {
      throw new NotFoundException('Defect not found.');
    }

    await this.prisma.defect.upsert({
      where: {
        inspectionItemResultId: itemResult.id,
      },
      create: {
        id: randomUUID(),
        inspectionItemResultId: itemResult.id,
        status: DefectStatus.OPEN,
      },
      update: {},
    });

    const defect = await this.findAccessibleDefectByItemResultId(user, itemResult.id);

    if (!defect) {
      throw new NotFoundException('Defect not found.');
    }

    return defect;
  }

  private findAccessibleDefectById(user: RequestUser, defectId: string) {
    return this.prisma.defect.findFirst({
      where: {
        id: defectId,
        inspectionItemResult: {
          isDefect: true,
          inspection: {
            tenantId: user.tenantId,
            ...this.inspectionAccessScope(user),
          },
        },
      },
      include: this.defectDetailInclude(),
    });
  }

  private findAccessibleDefectByItemResultId(user: RequestUser, inspectionItemResultId: string) {
    return this.prisma.defect.findFirst({
      where: {
        inspectionItemResultId,
        inspectionItemResult: {
          isDefect: true,
          inspection: {
            tenantId: user.tenantId,
            ...this.inspectionAccessScope(user),
          },
        },
      },
      include: this.defectDetailInclude(),
    });
  }

  private defectDetailInclude() {
    return {
      inspectionItemResult: {
        include: {
          inspection: {
            select: {
              id: true,
              assetId: true,
              inspectionCycle: true,
              submittedAt: true,
              createdAt: true,
              asset: {
                select: {
                  id: true,
                  assetCode: true,
                  assetType: {
                    select: {
                      code: true,
                      name: true,
                    },
                  },
                },
              },
              inspectionImages: {
                orderBy: {
                  createdAt: 'asc' as const,
                },
                select: {
                  id: true,
                  inspectionId: true,
                  url: true,
                  filename: true,
                  mimeType: true,
                  sizeBytes: true,
                  latitude: true,
                  longitude: true,
                  timestamp: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      },
    };
  }

  private serializeDefectListItem(defect: {
    id: string;
    status: DefectStatus;
    actionRemark: string | null;
    closedAt: Date | null;
    inspectionItemResult: {
      id: string;
      inspectionId: string;
      label: string;
      remark: string | null;
      createdAt: Date;
      inspection: {
        assetId: string;
        inspectionCycle: number;
        submittedAt: Date | null;
        asset: {
          assetCode: string;
          assetType: {
            code: string;
            name: string;
          };
        };
      };
    };
  }) {
    const item = defect.inspectionItemResult;
    const inspection = item.inspection;

    return {
      id: defect.id,
      inspectionItemResultId: item.id,
      inspectionId: item.inspectionId,
      assetId: inspection.assetId,
      assetCode: inspection.asset.assetCode,
      assetType: inspection.asset.assetType.name || inspection.asset.assetType.code,
      cycleNumber: inspection.inspectionCycle,
      label: item.label,
      result: 'FAIL' as const,
      remark: item.remark,
      status: defect.status,
      actionRemark: defect.actionRemark,
      closedAt: defect.closedAt?.toISOString() ?? null,
      submittedAt: inspection.submittedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
    };
  }

  private serializeDefectDetail(defect: Awaited<ReturnType<DefectsService['findAccessibleDefectById']>>) {
    if (!defect) {
      throw new NotFoundException('Defect not found.');
    }

    const item = defect.inspectionItemResult;
    const inspection = item.inspection;

    return {
      id: defect.id,
      inspectionItemResultId: item.id,
      status: defect.status,
      actionRemark: defect.actionRemark,
      closedAt: defect.closedAt?.toISOString() ?? null,
      label: item.label,
      checklistRemark: item.remark,
      inspectionId: inspection.id,
      assetId: inspection.assetId,
      assetCode: inspection.asset.assetCode,
      assetType: inspection.asset.assetType.name || inspection.asset.assetType.code,
      cycleNumber: inspection.inspectionCycle,
      submittedAt: inspection.submittedAt?.toISOString() ?? null,
      createdAt: defect.createdAt.toISOString(),
      updatedAt: defect.updatedAt.toISOString(),
      images: inspection.inspectionImages.map((image) => ({
        id: image.id,
        inspectionId: image.inspectionId,
        url: image.url,
        path: buildInspectionImagePath(image.inspectionId, image.filename),
        filename: image.filename,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        latitude: image.latitude,
        longitude: image.longitude,
        timestamp: image.timestamp?.toISOString() ?? null,
        createdAt: image.createdAt.toISOString(),
      })),
    };
  }

  private inspectionAccessScope(user: RequestUser) {
    if (user.role === 'ADMIN') {
      return {};
    }

    return {
      siteVisit: {
        team: {
          members: {
            some: {
              userId: user.id,
              isActive: true,
            },
          },
        },
      },
    };
  }

  private normalizeOptionalString(value?: string | null) {
    if (!value) {
      return null;
    }

    const trimmedValue = value.trim();

    return trimmedValue ? trimmedValue : null;
  }
}
