import { SharedPoleClient } from "@/components/shared-pole-client";

/**
 * Public "shared pole" page — no login, no shell. The token in the URL is the
 * credential; the client resolves it against the API's public share endpoint.
 */
export default async function SharedPolePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return <SharedPoleClient token={token} />;
}
