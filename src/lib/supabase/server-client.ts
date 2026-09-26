import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`環境変数 ${name} を設定してください。`);
  return value;
}

/**
 * Route Handler内でリクエストのCookieからSupabase Authセッションを読み書きするクライアント。
 * DBアクセスには使わず、認証中のユーザーを確認する目的にのみ使用する。
 */
export async function createSupabaseRouteHandlerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Route Handlerからの呼び出しではCookie書き込みが許可されない場合がある。
            // トークン更新はmiddlewareが担うため、ここでの失敗は無視してよい。
          }
        },
      },
    },
  );
}

/**
 * service role keyを使うサーバー専用クライアント。RLSをバイパスするため、
 * 呼び出し側で必ずuser_idによる所有者確認を行うこと。
 */
export function createSupabaseServiceRoleClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/**
 * リクエストのCookieから認証済みユーザーを取得する。未認証の場合はnullを返す。
 */
export async function getAuthenticatedUser(): Promise<User | null> {
  const client = await createSupabaseRouteHandlerClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}
