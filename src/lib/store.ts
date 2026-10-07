import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir, type PlatformId } from "./config";

export type Account = {
  platform: PlatformId;
  /** The platform's id for this user/channel. */
  accountId: string;
  name: string;
  avatarUrl?: string;
  /** Encrypted with lib/crypto. */
  accessToken: string;
  /** Encrypted with lib/crypto. */
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt: number;
  connectedAt: number;
};

export type User = {
  id: string;
  createdAt: number;
  accounts: Partial<Record<PlatformId, Account>>;
};

export type Media = {
  id: string;
  userId: string;
  fileName: string;
  filePath: string;
  size: number;
  contentType: string;
  createdAt: number;
};

export type Privacy = "public" | "private";

export type PostInput = {
  title: string;
  description: string;
  hashtags: string[];
  tags: string[];
  privacy: Privacy;
  platforms: PlatformId[];
};

export type PlatformResult = {
  status: "queued" | "running" | "done" | "failed";
  message?: string;
  url?: string;
};

export type Job = {
  id: string;
  userId: string;
  mediaId: string;
  post: PostInput;
  createdAt: number;
  finishedAt?: number;
  results: Partial<Record<PlatformId, PlatformResult>>;
};

type Db = {
  users: Record<string, User>;
  media: Record<string, Media>;
  jobs: Record<string, Job>;
};

const emptyDb = (): Db => ({ users: {}, media: {}, jobs: {} });

function dbFile(): string {
  return path.join(dataDir(), "db.json");
}

export async function readDb(): Promise<Db> {
  try {
    return { ...emptyDb(), ...JSON.parse(await readFile(dbFile(), "utf8")) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyDb();
    throw error;
  }
}

// Route handlers can end up in separate bundles, so the write lock lives on globalThis
// to make sure every writer in this process queues behind the same promise.
const lockHolder = globalThis as typeof globalThis & { __crosspostDbLock?: Promise<unknown> };

/** Runs `fn` against the latest data and saves the result. Writes are serialized. */
export function updateDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const run = async () => {
    const db = await readDb();
    const result = await fn(db);
    await mkdir(dataDir(), { recursive: true });
    const tmp = `${dbFile()}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
    await rename(tmp, dbFile());
    return result;
  };
  const next = (lockHolder.__crosspostDbLock ?? Promise.resolve()).then(run, run);
  lockHolder.__crosspostDbLock = next.catch(() => undefined);
  return next;
}
