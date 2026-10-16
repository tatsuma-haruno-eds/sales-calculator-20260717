"use client";

import { FormEvent, useState } from "react";

type LoginResponse = {
  error?: { message?: string };
};

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await response.json() as LoginResponse;
      if (!response.ok) {
        setError(result.error?.message ?? "ログインできませんでした。もう一度お試しください。");
        return;
      }
      window.location.replace("/");
    } catch {
      setError("ログインできませんでした。ネットワーク接続を確認して、もう一度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand"><span className="brand-mark">住</span><span>住まいの資金計画<span className="brand-sub">HOUSING LOAN GUIDE</span></span></div>
        <span className="eyebrow">SECURE ACCESS</span>
        <h1 id="login-title">パスワードを入力</h1>
        <p>アプリを利用するには、担当者用パスワードでログインしてください。</p>
        <form onSubmit={handleSubmit}>
          <label className="login-label" htmlFor="app-password">パスワード</label>
          <input
            autoComplete="current-password"
            autoFocus
            id="app-password"
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            disabled={submitting}
          />
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="button button-primary login-submit" type="submit" disabled={submitting || !password}>
            {submitting ? "確認しています…" : "ログイン"}
          </button>
        </form>
        <small className="login-note">ログイン状態はブラウザーを閉じるまで保持されます。</small>
      </section>
    </main>
  );
}
