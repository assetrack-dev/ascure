"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { login } from "@/lib/api";
import { ThemeToggle } from "./theme-toggle";
import {
  normalizeAuthUser,
  persistLastLoginEmail,
  persistSession,
  readLastLoginEmail,
  readStoredSession,
} from "@/lib/auth";

/**
 * Where a signed-in user lands. A CLIENT viewer (TNB) owns the network but not
 * the operation, so they go to their progress view — /dashboard is the
 * contractor console and isn't theirs to read.
 */
function landingPath(user: { mustChangePassword?: boolean; isClientViewer?: boolean } | null): string {
  if (user?.mustChangePassword) {
    return "/change-password";
  }
  return user?.isClientViewer ? "/progress" : "/dashboard";
}

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const session = readStoredSession();
    setEmail(readLastLoginEmail());

    if (session?.token) {
      router.replace(landingPath(session.user));
    }
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const trimmedEmail = email.trim();
      const payload = await login(trimmedEmail, password);

      if (!payload.access_token) {
        throw new Error("Login succeeded but no access token was returned.");
      }

      persistLastLoginEmail(trimmedEmail);
      const normalizedUser = normalizeAuthUser(payload.user);
      persistSession({
        token: payload.access_token,
        user: normalizedUser,
      });

      router.replace(landingPath(normalizedUser));
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // The sign-in page wears the brand "cover" look (the same one as the pitch
  // deck): a fixed dark-to-azure field, map grid, glow and a feeder route with
  // pole nodes. It is deliberately theme-independent — the colours below are
  // literal, not theme tokens — so light and dark users see the same page.
  const inputClass =
    "mt-2 w-full rounded-lg border border-[#FFFFFF]/15 bg-[#FFFFFF]/[0.06] px-3.5 py-3 text-[#FFFFFF] placeholder:text-[#FFFFFF]/35 outline-none transition focus:border-[#60A5FA] focus:bg-[#FFFFFF]/[0.09] focus:ring-4 focus:ring-[#2563EB]/30 [&:-webkit-autofill]:shadow-[inset_0_0_0_1000px_#18223d] [&:-webkit-autofill]:[-webkit-text-fill-color:#ffffff]";

  return (
    <main
      className="relative min-h-screen overflow-hidden text-[#FFFFFF]"
      style={{ background: "linear-gradient(135deg, #0B0E12 0%, #0F1B3D 55%, #1D4ED8 100%)" }}
    >
      {/* Map grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />
      {/* Glow behind the sign-in card */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 top-1/2 h-[900px] w-[900px] -translate-y-1/2 rounded-full"
        style={{ background: "radial-gradient(circle, rgba(96,165,250,0.40) 0%, rgba(37,99,235,0) 62%)" }}
      />
      {/* Faint brand mark */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/mark-white.svg"
        alt=""
        aria-hidden
        className="pointer-events-none absolute -right-24 top-1/2 hidden h-[760px] w-auto -translate-y-1/2 opacity-[0.05] lg:block"
      />
      {/* Feeder route with pole nodes */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 w-full"
        viewBox="0 0 1440 160"
        preserveAspectRatio="xMidYMax slice"
      >
        <path
          d="M0 118 L180 96 L360 116 L540 90 L720 112 L900 86 L1080 108 L1260 80 L1440 100"
          fill="none"
          stroke="#60A5FA"
          strokeOpacity="0.45"
          strokeWidth="2.5"
          strokeDasharray="10 9"
        />
        {[
          [180, 96, "#0B0E12", "#60A5FA"],
          [360, 116, "#0B0E12", "#60A5FA"],
          [540, 90, "#0d1630", "#60A5FA"],
          [720, 112, "#101a38", "#60A5FA"],
          [900, 86, "#13235a", "#93C5FD"],
          [1080, 108, "#1a2f7a", "#93C5FD"],
          [1260, 80, "#1f3fa0", "#BFDBFE"],
        ].map(([cx, cy, fill, stroke]) => (
          <circle key={`${cx}`} cx={cx} cy={cy} r="7" fill={fill as string} stroke={stroke as string} strokeWidth="2.5" />
        ))}
      </svg>

      <div className="absolute right-4 top-4 z-20">
        <ThemeToggle variant="icon" />
      </div>

      <div className="relative z-10 mx-auto grid min-h-screen w-full max-w-7xl content-center items-center gap-8 px-6 pb-40 pt-16 sm:gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16 lg:px-12 lg:pb-32">
        <section>
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/mark-white.svg" alt="ASCURE" className="h-10 w-auto sm:h-12" />
            <span className="text-xl font-bold tracking-[0.3em] sm:text-2xl" style={{ fontFamily: "var(--font-display)" }}>
              ASCURE
            </span>
          </div>

          <p className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-[#60A5FA] sm:mt-12 sm:text-sm">
            Operations console · TNB and contractors
          </p>
          <h1
            className="mt-4 text-4xl font-bold leading-[1.04] sm:mt-5 sm:text-6xl xl:text-7xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Every pole. Every defect. Proven.
          </h1>
          {/* On a phone the tagline and pills give way so the form is above the fold. */}
          <p className="mt-6 hidden max-w-xl text-lg leading-relaxed text-[#AEB8C4] sm:block sm:text-xl">
            From the first pole surveyed to the last repair closed, on one live record.
          </p>
          <div className="mt-8 hidden flex-wrap gap-3 sm:flex">
            {["Survey", "Verify", "Resolve"].map((word) => (
              <span
                key={word}
                className="rounded-full border border-[#93C5FD]/50 bg-[#2563EB]/55 px-5 py-1.5 text-sm font-semibold text-[#FFFFFF]"
              >
                {word}
              </span>
            ))}
          </div>
        </section>

        <section className="flex justify-center lg:justify-end">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-md rounded-2xl border border-[#FFFFFF]/15 bg-[#FFFFFF]/[0.07] p-7 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-8"
          >
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#60A5FA]">Secure sign in</p>
            <h2 className="mt-3 text-3xl font-bold text-[#FFFFFF]" style={{ fontFamily: "var(--font-display)" }}>
              Welcome back
            </h2>
            <p className="mt-2 text-sm text-[#AEB8C4]">Sign in with your work email.</p>

            <div className="mt-8 space-y-5">
              <label className="block">
                <span className="text-sm font-medium text-[#DBEAFE]">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="name@company.com"
                  required
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-[#DBEAFE]">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  className={inputClass}
                />
              </label>
            </div>

            {error ? (
              <div className="mt-5 rounded-lg border border-[#F87171]/40 bg-[#EF4444]/15 px-4 py-3 text-sm text-[#FEE2E2]">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#2563EB] px-4 py-3 text-sm font-semibold text-[#FFFFFF] shadow-[0_10px_30px_rgba(37,99,235,0.45)] transition hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:bg-[#FFFFFF]/20 disabled:shadow-none"
            >
              {isSubmitting ? "Signing in" : "Sign in"}
              <ArrowRight size={18} />
            </button>

            <p className="mt-6 flex items-center gap-2 text-xs text-[#AEB8C4]">
              <ShieldCheck size={15} className="text-[#60A5FA]" />
              You see only the work your role and area allow.
            </p>
          </form>
        </section>
      </div>
    </main>
  );
}
