import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Host-aware split for the single admin-web Next app, so one deployment can play
 * two roles:
 *   - admin.ascure.com.my        → the operator CONSOLE; its home is /login, not
 *                                   the public marketing landing.
 *   - www / apex ascure.com.my   → the public MARKETING landing only; any deeper
 *                                   app path (incl. the Sign-in buttons' /login)
 *                                   is sent to the console domain.
 *
 * Non-ascure hosts (localhost, IDE previews, etc.) are left completely untouched
 * so local dev behaves exactly as before (root still shows the landing locally).
 */
const ADMIN_HOST = "admin.ascure.com.my";

export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase().split(":")[0];

  // Only govern the production ascure.com.my hosts.
  if (!host.endsWith("ascure.com.my")) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;

  if (host === ADMIN_HOST) {
    // The admin subdomain is the console — root goes straight to the login.
    if (pathname === "/") {
      return NextResponse.redirect(`https://${ADMIN_HOST}/login`);
    }
    return NextResponse.next();
  }

  // Marketing hosts (www + apex): only the landing lives here. Everything else
  // (a bookmarked /dashboard, the /login the Sign-in buttons point at, …) goes to
  // the console domain so the app has one canonical home.
  if (pathname === "/") {
    return NextResponse.next();
  }
  return NextResponse.redirect(`https://${ADMIN_HOST}${pathname}${search}`);
}

export const config = {
  // Page navigations only — skip Next internals and any file-with-extension
  // (favicon/icons/images/fonts) so static assets load on every host.
  matcher: ["/((?!_next/|.*\\.[\\w]+$).*)"],
};
