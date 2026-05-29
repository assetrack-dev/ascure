import { OperationalSessionDetailClient } from "@/components/operational-session-detail-client";

export default async function OperationalSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <OperationalSessionDetailClient sessionId={id} />;
}
