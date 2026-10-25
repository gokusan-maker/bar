import Link from "next/link";
import { formatJa } from "@/lib/domain/time";
import type { AuditLog } from "@/lib/domain/types";

const ACTOR: Record<AuditLog["actor"], string> = {
  owner: "店主",
  staff: "スタッフ",
  guest: "お客様",
  system: "自動",
};

function targetHref(a: AuditLog): string | null {
  if (!a.targetId) return null;
  if (a.targetType === "reservation") return `/admin/reservations/${a.targetId}`;
  if (a.targetType === "sale") return `/admin/sales/${a.targetId}`;
  if (a.targetType === "staff") return "/admin/staff";
  if (a.targetType === "order") return "/admin/orders";
  return null;
}

export function HistoryList({ logs, links }: { logs: AuditLog[]; links: boolean }) {
  if (!logs.length) return <p className="muted">履歴はまだありません</p>;
  return (
    <ul className="list">
      {logs.map((a) => {
        const href = links ? targetHref(a) : null;
        return (
          <li key={a.id}>
            <div className="row">
              <span className="muted">{formatJa(new Date(a.createdAt))}</span>
              <span className="badge">{ACTOR[a.actor]}</span>
              {href ? <Link href={href}>{a.action}</Link> : <span>{a.action}</span>}
            </div>
            {a.detail && <div className="muted">{a.detail}</div>}
          </li>
        );
      })}
    </ul>
  );
}
