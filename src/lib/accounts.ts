import type { PlatformId } from "./config";
import { decrypt, encrypt } from "./crypto";
import { platforms } from "./platforms";
import type { ConnectedAccount } from "./platforms/types";
import { readDb, updateDb, type Account } from "./store";

export async function saveAccount(userId: string, platform: PlatformId, connected: ConnectedAccount) {
  await updateDb((db) => {
    const user = (db.users[userId] ??= { id: userId, createdAt: Date.now(), accounts: {} });
    user.accounts[platform] = {
      platform,
      accountId: connected.accountId,
      name: connected.name,
      avatarUrl: connected.avatarUrl,
      accessToken: encrypt(connected.accessToken),
      refreshToken: connected.refreshToken ? encrypt(connected.refreshToken) : undefined,
      expiresAt: connected.expiresAt,
      connectedAt: Date.now(),
    };
  });
}

export async function removeAccount(userId: string, platform: PlatformId) {
  await updateDb((db) => {
    delete db.users[userId]?.accounts[platform];
  });
}

/** Account info that is safe to send to the browser. */
export type PublicAccount = Pick<Account, "platform" | "name" | "avatarUrl" | "connectedAt"> & { expired: boolean };

export async function listAccounts(userId: string | null): Promise<Partial<Record<PlatformId, PublicAccount>>> {
  if (!userId) return {};
  const user = (await readDb()).users[userId];
  const out: Partial<Record<PlatformId, PublicAccount>> = {};
  for (const account of Object.values(user?.accounts ?? {})) {
    if (!account) continue;
    out[account.platform] = {
      platform: account.platform,
      name: account.name,
      avatarUrl: account.avatarUrl,
      connectedAt: account.connectedAt,
      expired: account.expiresAt < Date.now() && !account.refreshToken,
    };
  }
  return out;
}

/** Returns the account with a usable access token, refreshing it first when it is close to expiring. */
export async function accountWithToken(userId: string, platform: PlatformId) {
  const account = (await readDb()).users[userId]?.accounts[platform];
  if (!account) throw new Error(`${platforms[platform].label} is not connected.`);

  const handler = platforms[platform];
  let accessToken: string;
  let refreshToken: string | undefined;
  try {
    accessToken = decrypt(account.accessToken);
    refreshToken = account.refreshToken ? decrypt(account.refreshToken) : undefined;
  } catch {
    // Happens when APP_SECRET changed after the account was connected.
    throw new Error(`${handler.label} login could not be read, please reconnect.`);
  }

  if (account.expiresAt - Date.now() < handler.refreshWindowMs) {
    const fresh = await handler.refresh(account, refreshToken, accessToken).catch((error: Error) => {
      if (account.expiresAt > Date.now()) return null; // still valid, try with the old token
      throw new Error(`${handler.label} login expired, please reconnect. (${error.message})`);
    });
    if (fresh) {
      accessToken = fresh.accessToken;
      await updateDb((db) => {
        const stored = db.users[userId]?.accounts[platform];
        if (!stored) return;
        stored.accessToken = encrypt(fresh.accessToken);
        if (fresh.refreshToken) stored.refreshToken = encrypt(fresh.refreshToken);
        stored.expiresAt = fresh.expiresAt;
      });
    } else if (account.expiresAt <= Date.now()) {
      throw new Error(`${handler.label} login expired, please reconnect.`);
    }
  }
  return { account, accessToken };
}
