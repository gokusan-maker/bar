import "server-only";
import { repository } from "./container";
import type { AuditLog } from "./domain/types";

/** 操作履歴を残す。記録に失敗しても本来の操作は止めない */
export async function recordAudit(entry: Omit<AuditLog, "id" | "createdAt">): Promise<void> {
  try {
    await repository().addAudit(entry);
  } catch (error) {
    console.error("audit log failed", error);
  }
}
