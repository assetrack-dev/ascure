import { EnterpriseDetailClient } from "@/components/enterprise-detail-client";

export default async function WorkPackageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <EnterpriseDetailClient kind="work-packages" id={id} />;
}
