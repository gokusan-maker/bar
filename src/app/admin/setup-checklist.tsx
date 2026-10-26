import Link from "next/link";
import type { SetupStep } from "@/lib/onboarding";
import { dismissSetupAction } from "./actions";

/** 最初の設定のチェックリスト（すべて済むか、閉じるまで出す） */
export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  return (
    <section className="card setup">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>
          はじめの設定（{done}/{steps.length}）
        </h2>
        <form action={dismissSetupAction}>
          <button type="submit" className="small-button">
            閉じる
          </button>
        </form>
      </div>
      <progress max={steps.length} value={done} style={{ width: "100%" }} />
      <ol>
        {steps.map((s) => (
          <li key={s.key} className={s.done ? "done" : ""}>
            {s.done ? "✓ " : ""}
            {s.done ? s.label : <Link href={s.href}>{s.label}</Link>}
          </li>
        ))}
      </ol>
    </section>
  );
}
