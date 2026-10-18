"use client";

import React, { useState } from "react";

export default function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        window.location.assign("/crm");
        return;
      }
      setError(body?.message ?? `Sign-in failed (HTTP ${res.status}).`);
    } catch {
      setError("Network error while signing in. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h1 className="text-xl font-bold text-slate-900">PCT Project Desk</h1>
        <p className="mt-1 text-sm text-slate-500">Private CRM — sign in to continue.</p>

        <label htmlFor="login-password" className="mt-5 block text-sm font-medium text-slate-700">
          Password
        </label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          autoFocus
          required
        />

        {error ? (
          <p role="alert" className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending || !password}
          className="mt-5 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>

        <p className="mt-4 text-xs text-slate-400">
          Single-owner access. Sessions expire after 8 hours.
        </p>
      </form>
    </main>
  );
}
