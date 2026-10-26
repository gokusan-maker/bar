import type { Metadata } from "next";
import { siteInfo } from "@/lib/site";
import { LegalPage } from "../legal-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "プライバシーポリシー" };

export default function PrivacyPage() {
  const { appName, operatorName, contactEmail } = siteInfo();
  return (
    <LegalPage title="プライバシーポリシー" updated="2026年10月26日">
      <p>
        {operatorName}（以下「運営者」）は、{appName}（以下「本サービス」）における利用者の情報を、次のとおり取り扱います。
      </p>

      <h2>1. 取得する情報</h2>
      <ul>
        <li>お店のオーナー・スタッフの情報：お名前、ログインID、パスワード（暗号化して保存）、LINEログインで連携したLINEのユーザーID・表示名</li>
        <li>お店が登録する情報：店名、営業時間、席、メニュー、売上と証拠の写真、スタッフのバック率など</li>
        <li>
          お店のお客様の情報：お店がLINE・Instagram・予約フォーム・QRコード注文などを通じて受け取ったお名前、表示名、SNSのユーザーID、電話番号、誕生日、予約・注文・来店の履歴、メッセージの内容
        </li>
        <li>利用の記録：ログインの失敗の記録（IPアドレス）、操作の履歴、アクセスの記録</li>
      </ul>

      <h2>2. 利用の目的</h2>
      <ul>
        <li>予約の受付・返信・リマインド、空き状況の配信、注文の受付、売上とバックの計算など、本サービスの機能を提供するため</li>
        <li>不正なログイン・いたずらの防止、障害の調査のため</li>
        <li>本サービスの改善と、利用者へのお知らせのため</li>
      </ul>
      <p>
        お店のお客様の情報は、それぞれのお店が自分のお客様の管理のために登録・利用するものです。お店ごとに分けて保存し、ほかのお店からは見えません。運営者は、障害の対応など必要な場合を除き、お客様の情報を見ません。
      </p>

      <h2>3. 外部のサービス</h2>
      <p>本サービスは、次のサービスを利用しています。それぞれのサービスの規約・プライバシーポリシーもあわせてご確認ください。</p>
      <ul>
        <li>データの保存：Supabase</li>
        <li>アプリの公開：Cloudflare</li>
        <li>メッセージの送受信・ログイン：LINE（LINEヤフー株式会社）、Instagram（Meta Platforms, Inc.）</li>
        <li>予定の反映：Googleカレンダー（Google LLC）</li>
        <li>メッセージの読み取り（お店が設定した場合）：Anthropic</li>
      </ul>

      <h2>4. 広告について</h2>
      <p>
        本サービスは、第三者配信の広告サービス「Google AdSense」を利用することがあります。広告配信事業者は、利用者の興味に応じた広告を表示するために Cookie
        を使用することがあります。Cookie を無効にする方法や Google AdSense の詳細は、
        <a href="https://policies.google.com/technologies/ads?hl=ja" target="_blank" rel="noopener noreferrer">
          Google の広告に関するポリシー
        </a>
        をご覧ください。パーソナライズ広告は
        <a href="https://adssettings.google.com/" target="_blank" rel="noopener noreferrer">
          広告設定
        </a>
        で無効にできます。
      </p>

      <h2>5. 第三者への提供</h2>
      <p>法令に基づく場合を除き、本人の同意なく個人情報を第三者に提供しません（上記の外部のサービスへの保存・送信を除きます）。</p>

      <h2>6. 保存の期間と削除</h2>
      <p>
        お客様のメッセージや名前・連絡先は、お店が設定した保存期間（初期値24か月）を過ぎると自動で削除・匿名化します。売上の金額と証拠の写真は帳簿として残ります。お店の登録をやめたい場合は、運営者にご連絡ください。
      </p>

      <h2>7. お問い合わせ</h2>
      <p>
        個人情報の開示・訂正・削除などのご請求、そのほかのお問い合わせは
        {contactEmail ? (
          <>
            {" "}
            <a href={`mailto:${contactEmail}`}>{contactEmail}</a> までご連絡ください。
          </>
        ) : (
          "運営者までご連絡ください。"
        )}
        お店のお客様の情報については、まずそのお店にお問い合わせください。
      </p>
    </LegalPage>
  );
}
