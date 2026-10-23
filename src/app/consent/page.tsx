import { redirect } from "next/navigation";

import { getResearchConsent } from "@/lib/research-consents";
import { requireAuthenticatedUser } from "@/lib/route-guards";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server-client.ts";

import { ConsentForm } from "./consent-form.tsx";

export default async function ConsentPage() {
  const user = await requireAuthenticatedUser();

  const db = createSupabaseServiceRoleClient();
  const consent = await getResearchConsent(db, user.id);
  if (consent?.consented) {
    redirect("/journey/record");
  }

  return (
    <main className="consent-page">
      <h1>研究参加への同意</h1>
      <p className="notice">
        Music Walk Mapのパイロット調査にご協力いただく前に、以下の内容をご確認のうえ同意してください。
      </p>

      <section>
        <h2>調査の目的</h2>
        <p>
          本調査は、移動中の位置情報の変化と、Last.fmに記録される音楽視聴履歴の関係を明らかにすることを目的とした卒業研究の一環です。
        </p>
      </section>

      <section>
        <h2>収集するデータ</h2>
        <ul>
          <li>記録中に取得する位置情報（緯度・経度、測位時刻、精度など）</li>
          <li>Last.fmに記録された確定済みの再生履歴（曲名、アーティスト名、再生開始時刻など）</li>
          <li>上記を時刻で結合した、移動と音楽聴取の記録（Journey）</li>
        </ul>
      </section>

      <section>
        <h2>データの取り扱い</h2>
        <ul>
          <li>収集したデータは本研究の分析目的以外には使用しません。</li>
          <li>個人を特定できる形で結果を公開することはありません。</li>
          <li>記録の開始・終了はご自身の操作で制御でき、参加はいつでも中断できます。</li>
          <li>同意の撤回・データ削除を希望する場合は研究担当者までご連絡ください。</li>
        </ul>
      </section>

      <section>
        <h2>任意参加について</h2>
        <p>
          本調査への参加は任意です。同意しない場合でもいかなる不利益も生じません。同意いただいた場合のみ、記録機能をご利用いただけます。
        </p>
      </section>

      <ConsentForm />
    </main>
  );
}
