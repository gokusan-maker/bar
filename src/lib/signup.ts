import "server-only";
import { DEFAULT_SETTINGS, type Shop, type Staff } from "./domain/types";
import { isValidSlug, randomSlug, type ShopDirectory } from "./directory";
import { hashPassword } from "./password";
import type { Repository } from "./repo/types";
import { loginIdProblem, loginIdTaken, normalizeLoginId, passwordProblem } from "./staff-accounts";

export interface SignupInput {
  shopName: string;
  slug: string;
  ownerName: string;
  loginId: string;
  password: string;
}

export type SignupResult = { ok: true; shop: Shop; owner: Staff } | { ok: false; error: string };

/** オーナーの登録：店舗を作り、その店舗のオーナーを作る */
export async function signupShop(
  dir: ShopDirectory,
  repoFor: (shopId: string) => Repository,
  input: SignupInput,
  reservedLoginIds: string[] = [],
): Promise<SignupResult> {
  const shopName = input.shopName.trim().slice(0, 40);
  const ownerName = input.ownerName.trim().slice(0, 30);
  if (!shopName) return { ok: false, error: "店名を入力してください" };
  if (!ownerName) return { ok: false, error: "お名前を入力してください" };
  const slug = input.slug.trim().toLowerCase() || randomSlug();
  if (!isValidSlug(slug)) return { ok: false, error: "URL名は2〜31文字の半角英小文字・数字・ハイフンにしてください" };
  if (await dir.getShopBySlug(slug)) return { ok: false, error: "このURL名はすでに使われています" };
  const loginId = normalizeLoginId(input.loginId);
  const idProblem = loginIdProblem(loginId);
  if (idProblem) return { ok: false, error: idProblem };
  if (await loginIdTaken(dir, loginId, undefined, reservedLoginIds)) return { ok: false, error: "このログインIDはすでに使われています" };
  const pwProblem = passwordProblem(input.password);
  if (pwProblem) return { ok: false, error: pwProblem };

  const shop = await dir.createShop({ name: shopName, slug });
  const repo = repoFor(shop.id);
  await repo.saveSettings({ ...DEFAULT_SETTINGS, shopName });
  const owner = await repo.createStaff({
    name: ownerName,
    role: "owner",
    backRates: { rate: 0, perVisit: 0 },
    active: true,
    loginId,
    passwordHash: hashPassword(input.password),
  });
  return { ok: true, shop, owner };
}
