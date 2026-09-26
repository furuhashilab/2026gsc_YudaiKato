"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser-client.ts";

type Mode = "sign-in" | "sign-up";

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    supabase.auth.getUser().then(({ data }) => setUser(data.user));

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setLoading(true);
      setError(null);
      setMessage(null);

      const supabase = createSupabaseBrowserClient();
      try {
        if (mode === "sign-in") {
          const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
          if (signInError) throw signInError;
        } else {
          const { error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
          });
          if (signUpError) throw signUpError;
          setMessage("確認メールを送信しました。メール内のリンクからログインを完了してください。");
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "予期しないエラーが発生しました。");
      } finally {
        setLoading(false);
      }
    },
    [mode, email, password],
  );

  const handleSignOut = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
  }, []);

  return (
    <main className="auth-page">
      <h1>Supabase認証</h1>

      {user ? (
        <section className="status-grid" aria-label="ログイン状態">
          <div><strong>ログイン中のメールアドレス</strong><span>{user.email}</span></div>
          <div><strong>ユーザーID</strong><span>{user.id}</span></div>
          <div className="actions"><button type="button" onClick={() => void handleSignOut()}>サインアウト</button></div>
        </section>
      ) : (
        <>
          <div className="actions">
            <button type="button" onClick={() => setMode("sign-in")} disabled={mode === "sign-in"}>サインイン</button>
            <button type="button" onClick={() => setMode("sign-up")} disabled={mode === "sign-up"}>サインアップ</button>
          </div>

          <form onSubmit={(event) => void handleSubmit(event)}>
            <label>
              メールアドレス
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              パスワード
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                required
              />
            </label>
            <button type="submit" disabled={loading}>
              {mode === "sign-in" ? "サインイン" : "サインアップ"}
            </button>
          </form>
        </>
      )}

      {error && <p className="error" role="alert"><strong>エラー:</strong> {error}</p>}
      {message && <p className="summary">{message}</p>}
    </main>
  );
}
