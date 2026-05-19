import { EnterpriseDetailClient } from "@/components/enterprise-detail-client";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <EnterpriseDetailClient kind="projects" id={id} />;
}
