"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { login } from "@/lib/api";
import {
  normalizeAuthUser,
  persistLastLoginEmail,
  persistSession,
  readLastLoginEmail,
  readStoredSession,
} from "@/lib/auth";

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
      router.replace("/dashboard");
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
      persistSession({
        token: payload.access_token,
        user: normalizeAuthUser(payload.user),
      });

      router.replace("/dashboard");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-[var(--background)] lg:grid-cols-[minmax(360px,0.85fr)_1.15fr]">
      <section className="flex items-center justify-center border-b border-slate-800 bg-slate-950 px-6 py-10 text-white lg:border-b-0 lg:border-r">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--brand)] shadow-sm">
              <svg width="27" height="27" viewBox="0 0 64 64" fill="none" aria-hidden="true">
                <rect x="15.5" y="13" width="33" height="38" rx="8.5" stroke="#ECFEFF" strokeWidth="3.3" />
                <circle cx="32" cy="21" r="2.7" stroke="#ECFEFF" strokeWidth="2.2" />
                <path d="M26 46 L32 31 L38 46" stroke="#ECFEFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M28.3 40 H35.7" stroke="#ECFEFF" strokeWidth="3.4" strokeLinecap="round" />
                <circle cx="32" cy="30.7" r="3" fill="#FFFFFF" />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>ASCURE</p>
              <p className="text-sm text-slate-300">Asset Inspection Platform</p>
            </div>
          </div>
          <h1 className="mt-12 text-4xl font-bold">Admin operations console</h1>
          <div className="mt-8 grid gap-3 text-sm text-slate-200">
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <ShieldCheck size={18} className="text-green-300" />
              Role foundation: ADMIN, TECHNICIAN, VIEWER, CLIENT
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <LockKeyhole size={18} className="text-amber-300" />
              Connected to the local NestJS API
            </div>
          </div>
        </div>
      </section>

      <section className="flex items-center justify-center px-6 py-10">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-md rounded-xl border border-[var(--line)] bg-white p-6 shadow-[var(--shadow-card)]"
        >
          <div>
            <p className="text-sm font-semibold uppercase text-[var(--brand)]">
              Secure sign in
            </p>
            <h2 className="mt-3 text-3xl font-bold text-[var(--foreground)]">
              Welcome back
            </h2>
          </div>

          <div className="mt-8 space-y-5">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100"
              />
            </label>
          </div>

          {error ? (
            <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSubmitting ? "Signing in" : "Sign in"}
            <ArrowRight size={18} />
          </button>
        </form>
      </section>
    </main>
  );
}
