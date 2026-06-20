/**
 * Verifies the profile DB round-trip the /api/users/profile route relies on:
 * the display_name/avatar columns exist, updateProfile persists, and toProfile
 * serializes correctly. Creates a throwaway user and deletes it afterwards.
 * Run: npx tsx scripts/profile-check.ts
 */
import "dotenv/config";
import { createClient } from "@libsql/client";
import {
  createUser,
  getUserById,
  updateProfile,
  toProfile,
} from "../src/lib/users";

const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error("TURSO_DATABASE_URL missing");
const raw = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

async function main() {
  let pass = 0;
  let fail = 0;
  const check = (n: string, ok: boolean) => {
    console.log(`${ok ? "✓" : "✗"} ${n}`);
    ok ? pass++ : fail++;
  };

  const id = `profcheck-${Date.now()}`;
  const username = `profcheck_${Date.now()}`;
  try {
    await createUser({
      id,
      username,
      publicKey: "PK",
      pwdHash: "H",
      createdAt: Date.now(),
    });

    let u = await getUserById(id);
    check("new user has null display_name", u?.display_name == null);
    check("new user has null avatar", u?.avatar == null);

    const avatar = "data:image/webp;base64,UklGRiIAAABXRUJQ";
    await updateProfile(id, { displayName: "Alice Liddell", avatar });
    u = await getUserById(id);
    check("display_name persisted", u?.display_name === "Alice Liddell");
    check("avatar persisted", u?.avatar === avatar);

    const prof = toProfile(u!);
    check("toProfile maps displayName", prof.displayName === "Alice Liddell");
    check("toProfile maps avatar", prof.avatar === avatar);
    check("toProfile omits key material", !("pwd_hash" in prof));

    // Clearing back to null works.
    await updateProfile(id, { displayName: null, avatar: null });
    u = await getUserById(id);
    check("can clear display_name", u?.display_name == null);
    check("can clear avatar", u?.avatar == null);
  } finally {
    await raw.execute({ sql: "DELETE FROM users WHERE id = ?", args: [id] });
    raw.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
