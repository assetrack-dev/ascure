"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { login } from "@/lib/api";
import { normalizeAuthUser, persistSession, readStoredSession } from "@/lib/auth";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@ascure.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const session = readStoredSession();

    if (session?.token) {
      router.replace("/dashboard");
    }
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const payload = await login(email.trim(), password);

      if (!payload.access_token) {
        throw new Error("Login succeeded but no access token was returned.");
      }

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
      <section className="flex items-center justify-center border-b border-[var(--line)] bg-[#111827] px-6 py-10 text-white lg:border-b-0 lg:border-r">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#0f766e] text-lg font-bold">
              A
            </div>
            <div>
              <p className="text-2xl font-bold tracking-wide">ASCURE</p>
              <p className="text-sm text-slate-300">Asset Inspection Platform</p>
            </div>
          </div>
          <h1 className="mt-12 text-4xl font-bold tracking-tight">Admin operations console</h1>
          <div className="mt-8 grid gap-3 text-sm text-slate-200">
            <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
              <ShieldCheck size={18} className="text-emerald-300" />
              Role foundation: ADMIN, VIEWER, CLIENT
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
              <LockKeyhole size={18} className="text-amber-300" />
              Connected to the local NestJS API
            </div>
          </div>
        </div>
      </section>

      <section className="flex items-center justify-center px-6 py-10">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-md rounded-lg border border-[var(--line)] bg-white p-6 shadow-sm"
        >
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-[#0f766e]">
              Secure sign in
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-[var(--foreground)]">
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
                className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-slate-900 outline-none transition focus:border-[#0f766e]"
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
                className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-slate-900 outline-none transition focus:border-[#0f766e]"
              />
            </label>
          </div>

          {error ? (
            <div className="mt-5 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#0f766e] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#115e59] disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSubmitting ? "Signing in" : "Sign in"}
            <ArrowRight size={18} />
          </button>
        </form>
      </section>
    </main>
  );
}
