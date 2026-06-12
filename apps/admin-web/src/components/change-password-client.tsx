"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LogOut } from "lucide-react";
import { ApiError, changePassword } from "@/lib/api";
import {
  clearStoredSession,
  normalizeAuthUser,
  persistSession,
  readStoredSession,
} from "@/lib/auth";

const inputClassName =
  "mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";

export function ChangePasswordClient() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const session = readStoredSession();

    if (!session?.token) {
      router.replace("/login");
      return;
    }

    setToken(session.token);
    setEmail(session.user?.email ?? "");
  }, [router]);

  function handleSignOut() {
    clearStoredSession();
    router.replace("/login");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!token) {
      return;
    }

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    if (newPassword === currentPassword) {
      setError("New password must be different from your current password.");
      return;
    }

    setIsSubmitting(true);

    try {
      const updated = await changePassword(token, currentPassword, newPassword);
      persistSession({ token, user: normalizeAuthUser(updated) });
      router.replace("/dashboard");
    } catch (changeError) {
      setError(
        changeError instanceof ApiError
          ? changeError.message
          : changeError instanceof Error
            ? changeError.message
            : "Unable to change password.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6 py-10">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl border border-[var(--line)] bg-white p-6 shadow-[var(--shadow-card)]"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--brand)] text-white shadow-sm">
            <KeyRound size={20} />
          </div>
          <div>
            <p className="text-sm font-semibold uppercase text-[var(--brand)]">
              Security
            </p>
            <h2 className="mt-1 text-2xl font-bold text-[var(--foreground)]">
              Set a new password
            </h2>
          </div>
        </div>

        <p className="mt-4 text-sm text-slate-600">
          {email ? <span className="font-semibold">{email}</span> : "Your account"}{" "}
          must set a new password before continuing.
        </p>

        <div className="mt-6 space-y-5">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Current (temporary) password
            </span>
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
              className={inputClassName}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">New password</span>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              className={inputClassName}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Confirm new password
            </span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              className={inputClassName}
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
          <KeyRound size={18} />
          {isSubmitting ? "Saving" : "Update password"}
        </button>

        <button
          type="button"
          onClick={handleSignOut}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </form>
    </main>
  );
}
