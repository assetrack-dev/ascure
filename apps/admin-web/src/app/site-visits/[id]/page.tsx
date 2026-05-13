import { SiteVisitDetailClient } from "@/components/site-visit-detail-client";

export default async function SiteVisitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <SiteVisitDetailClient siteVisitId={id} />;
}
