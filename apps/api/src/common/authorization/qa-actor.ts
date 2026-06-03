import { OrganizationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../interfaces/request-user.interface';

export const QA_VALIDATION_CAPABILITY_CODE = 'QA_VALIDATION';

type QaActorUserShape = {
  organization: {
    type: OrganizationType;
    isActive: boolean;
  } | null;
  capabilityAssignments: Array<{ id: string }>;
};

export function hasQaActorShape(user: QaActorUserShape) {
  return (
    user.organization?.type === OrganizationType.ASCURE &&
    user.organization.isActive === true &&
    user.capabilityAssignments.length > 0
  );
}

export async function isQaActor(
  prisma: PrismaService,
  user: RequestUser,
): Promise<boolean> {
  const record = await prisma.user.findFirst({
    where: {
      id: user.id,
      tenantId: user.tenantId,
      isActive: true,
    },
    select: {
      organization: {
        select: {
          type: true,
          isActive: true,
        },
      },
      capabilityAssignments: {
        where: {
          isActive: true,
          capability: {
            code: QA_VALIDATION_CAPABILITY_CODE,
            isActive: true,
          },
        },
        select: {
          id: true,
        },
      },
    },
  });

  if (!record) {
    return false;
  }

  return hasQaActorShape(record);
}
