import { requireStaff } from "@/lib/auth";
import Link from "next/link";
import { repository } from "@/lib/container";
import { formatJa } from "@/lib/domain/time";
import { CHANNEL_LABEL } from "../ui";

export default async function InboxPage() {
  await requireStaff();
  const conversations = await repository().listRecentConversations(50);
  return (
    <>
      <h1>メッセージ</h1>
      <p className="muted">SNSで届いたメッセージと自動返信の履歴です。予約以外の問い合わせにはここから返信できます。</p>
      <section className="card">
        {conversations.length === 0 ? (
          <p className="muted">まだメッセージはありません</p>
        ) : (
          <ul className="list">
            {conversations.map(({ customer, last }) => (
              <li key={customer.id}>
                <div className="row spread">
                  <Link href={`/admin/customers/${customer.id}`}>
                    {customer.displayName ?? customer.name ?? "名前未設定"}
                  </Link>
                  <span className="muted">
                    {CHANNEL_LABEL[customer.channel]} ・ {formatJa(new Date(last.createdAt))}
                  </span>
                </div>
                <div className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {last.direction === "out" ? "店: " : ""}
                  {last.text}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
