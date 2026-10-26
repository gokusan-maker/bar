import type { Metadata } from "next";
import Link from "next/link";
import { currentRole } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Ad } from "@/app/ad";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "バー予約・集客アプリ",
  description: "LINE・Instagramの予約を自動で受け付け、空き状況の配信、QRコードでの注文、売上とスタッフのバック計算まで。お店ごとに使えるバー・スナック向けの管理アプリ。",
};

const FEATURES: { title: string; text: string }[] = [
  { title: "LINE・Instagramの予約を自動受付", text: "「土曜の9時から2名」のようなメッセージを読み取り、空きを確認して自動で返信。満席なら近い時間を提案します。Googleカレンダーにも自動で反映。" },
  { title: "空き状況を自動で配信", text: "今夜の空き状況をLINEの友だちに自動配信。「21時〜で予約」ボタンを押すだけで予約が完了します。Instagramへの投稿も。" },
  { title: "QRコードでお酒の注文", text: "席のQRコードからお客様がスマホで注文。スタッフの画面に届き、会計でそのまま売上に入ります。" },
  { title: "売上とバックを自動計算", text: "伝票の写真を付けて売上を入力。スタッフごとのバック率で月のバックを計算し、CSV・PDFで出力。" },
  { title: "お客様リスト", text: "来店回数・利用金額・誕生日・タグで管理。誕生日には自動でお祝いのLINE。ご無沙汰のお客様もすぐ分かります。" },
  { title: "オーナーとスタッフで分けて使える", text: "オーナーは料金・バック・設定をすべて管理。スタッフはLINEでログインして、集客・売上の入力・お客様の登録ができます。" },
];

/** 製品の紹介ページ（ログイン中なら管理画面へ） */
export default async function Home() {
  if (await currentRole()) redirect("/admin");
  const price = process.env.PRICE_TEXT?.trim();
  return (
    <main className="container landing" style={{ maxWidth: 880, paddingTop: 32, paddingBottom: 48 }}>
      <section className="hero">
        <p className="muted" style={{ margin: 0 }}>バー・スナック・ラウンジのための　無料で使えます</p>
        <h1>予約も集客も、LINEで自動に。</h1>
        <p>
          SNSからの予約受付、空き状況の配信、QRコードでの注文、売上とスタッフのバック計算まで。スマホひとつでお店の毎日が回ります。
        </p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link className="button primary" href="/signup">
            お店を登録する
          </Link>
          <Link className="button" href="/owner/login">
            オーナーのログイン
          </Link>
          <Link className="button" href="/login">
            スタッフのログイン
          </Link>
        </div>
        {price ? <p className="muted">料金：{price}</p> : <p className="muted">登録・利用は無料です（画面に広告が表示されます）</p>}
      </section>

      <section className="features">
        {FEATURES.map((f) => (
          <div key={f.title} className="card">
            <h2>{f.title}</h2>
            <p className="muted" style={{ marginBottom: 0 }}>
              {f.text}
            </p>
          </div>
        ))}
      </section>

      <Ad place="landing" />

      <section className="card" style={{ textAlign: "center" }}>
        <h2 style={{ marginTop: 0 }}>はじめかた</h2>
        <ol style={{ textAlign: "left", display: "inline-block", margin: 0 }}>
          <li>「お店を登録する」から店名とログインIDを登録（無料）</li>
          <li>設定画面でお店の席数・営業時間と、LINE公式アカウントをつなぐ</li>
          <li>スタッフに登録用リンクを送る（LINEでかんたん登録）</li>
        </ol>
      </section>

      <footer className="site-footer">
        <Link href="/terms">利用規約</Link>
        <Link href="/privacy">プライバシーポリシー</Link>
      </footer>
    </main>
  );
}
