import { DefectDetailClient } from "@/components/defect-detail-client";

export default async function DefectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <DefectDetailClient defectId={id} />;
}
