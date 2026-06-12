"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { readStoredSession } from "@/lib/auth";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const session = readStoredSession();

    if (!session?.token) {
      router.replace("/login");
      return;
    }

    // Forced first-login / post-reset password change gates every protected
    // page (except the change-password page itself, to avoid a redirect loop).
    if (session.user?.mustChangePassword && pathname !== "/change-password") {
      router.replace("/change-password");
      return;
    }

    setIsReady(true);
  }, [router, pathname]);

  if (!isReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
        <div className="w-full max-w-sm rounded-xl border border-[var(--line)] bg-white p-6 shadow-[var(--shadow-card)]">
          <div className="h-3 w-28 animate-pulse rounded-md bg-slate-200" />
          <div className="mt-5 h-8 w-48 animate-pulse rounded-md bg-slate-200" />
          <div className="mt-4 h-3 w-full animate-pulse rounded-md bg-slate-200" />
        </div>
      </main>
    );
  }

  return children;
}
