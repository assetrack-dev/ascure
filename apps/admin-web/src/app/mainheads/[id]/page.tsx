import { EnterpriseDetailClient } from "@/components/enterprise-detail-client";

export default async function MainheadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <EnterpriseDetailClient kind="mainheads" id={id} />;
}
