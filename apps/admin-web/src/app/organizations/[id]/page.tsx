import { EnterpriseDetailClient } from "@/components/enterprise-detail-client";

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <EnterpriseDetailClient kind="organizations" id={id} />;
}
