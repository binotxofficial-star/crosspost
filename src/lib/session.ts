import { cookies } from "next/headers";
import { randomId, sign, unsign } from "./crypto";
import { updateDb } from "./store";

const COOKIE = "cp_uid";
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Each browser gets its own anonymous user id in a signed cookie. Connected accounts
 * and uploads belong to that id.
 */
export async function getUserId(): Promise<string | null> {
  const store = await cookies();
  return unsign(store.get(COOKIE)?.value);
}

export async function getOrCreateUserId(): Promise<string> {
  const existing = await getUserId();
  if (existing) return existing;

  const id = randomId();
  await updateDb((db) => {
    db.users[id] = { id, createdAt: Date.now(), accounts: {} };
  });
  const store = await cookies();
  store.set(COOKIE, sign(id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR,
  });
  return id;
}
