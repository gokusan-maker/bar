import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { appBaseUrl, directory, shopRepository } from "@/lib/container";
import { DEFAULT_SHOP_ID } from "@/lib/domain/types";
import { clientIp, isLockedOut, recordFailure } from "@/lib/login-guard";
import { isOperator, loginOperator, operatorEnabled } from "@/lib/operator";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "運営", robots: { index: false } };

async function operatorLoginAction(formData: FormData) {
  "use server";
  const ip = await clientIp();
  if (await isLockedOut(ip)) redirect("/operator?error=locked");
  if (await loginOperator(String(formData.get("password") ?? ""))) redirect("/operator");
  await recordFailure(ip);
  redirect("/operator?error=1");
}

/** 店舗の利用を止める・再開する（止めると、その店舗のログイン・予約受付・Webhookが使えなくなる） */
async function toggleShopAction(formData: FormData) {
  "use server";
  if (!(await isOperator())) redirect("/operator");
  const id = String(formData.get("id"));
  if (id === DEFAULT_SHOP_ID && formData.get("active") !== "1") redirect("/operator?error=default");
  await directory().updateShop(id, { active: formData.get("active") === "1" });
  revalidatePath("/operator");
  redirect("/operator");
}

/** 運営の画面：登録されたお店の一覧 */
export default async function OperatorPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!operatorEnabled()) notFound();
  const { error } = await searchParams;
  if (!(await isOperator())) {
    return (
      <main className="container" style={{ maxWidth: 420, paddingTop: 48 }}>
        <h1>運営</h1>
        {error && <p className="notice error">{error === "locked" ? "しばらくログインできません" : "パスワードが違います"}</p>}
        <form action={operatorLoginAction} className="card">
          <label>
            運営パスワード
            <input type="password" name="password" required autoComplete="current-password" />
          </label>
          <button type="submit" className="primary">
            ログイン
          </button>
        </form>
      </main>
    );
  }
  const shops = await directory().listShops();
  const rows = await Promise.all(
    shops.map(async (shop) => {
      const repo = shopRepository(shop.id);
      const [owners, staff, customers] = await Promise.all([repo.listOwners(), repo.listStaff(), repo.listCustomers({ limit: 10000 })]);
      return { shop, owners: owners.map((o) => o.name).join("、"), staff: staff.filter((s) => s.active && !s.pending).length, customers: customers.length };
    }),
  );
  return (
    <main className="container" style={{ paddingTop: 24 }}>
      <h1>運営：お店の一覧（{shops.length}店）</h1>
      {error === "default" && <p className="notice error">店舗1は止められません</p>}
      <p className="muted">新しいお店の登録：<code>{appBaseUrl()}/signup</code>（SIGNUP_CODE を決めると、登録コードを知っている人だけが登録できます）</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>店名</th>
              <th>URL名</th>
              <th>オーナー</th>
              <th>スタッフ</th>
              <th>お客様</th>
              <th>登録日</th>
              <th>状態</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ shop, owners, staff, customers }) => (
              <tr key={shop.id}>
                <td>{shop.name}</td>
                <td>{shop.slug}</td>
                <td>{owners || "（店舗1の旧オーナー）"}</td>
                <td>{staff}人</td>
                <td>{customers}人</td>
                <td>{shop.createdAt.slice(0, 10)}</td>
                <td>
                  <form action={toggleShopAction}>
                    <input type="hidden" name="id" value={shop.id} />
                    <input type="hidden" name="active" value={shop.active ? "0" : "1"} />
                    {shop.active ? "利用中 " : "停止中 "}
                    <button type="submit">{shop.active ? "止める" : "再開"}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
