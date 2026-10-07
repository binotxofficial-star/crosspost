import path from "node:path";

export type PlatformId = "tiktok" | "instagram" | "youtube";

export const PLATFORMS: PlatformId[] = ["tiktok", "instagram", "youtube"];

export function isPlatform(value: string): value is PlatformId {
  return (PLATFORMS as string[]).includes(value);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function appSecret(): string {
  const secret = required("APP_SECRET");
  if (secret.length < 32) throw new Error("APP_SECRET must be at least 32 characters");
  return secret;
}

/** Public URL of this site, without a trailing slash. Used for OAuth redirects and media links. */
export function baseUrl(): string {
  return required("PUBLIC_BASE_URL").replace(/\/+$/, "");
}

export function redirectUri(platform: PlatformId): string {
  return `${baseUrl()}/api/auth/${platform}/callback`;
}

export function dataDir(): string {
  // Runtime-only path: keep the bundler from tracing the whole project into the build.
  return path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || ".data");
}

export function maxUploadBytes(): number {
  const mb = Number(process.env.MAX_UPLOAD_MB || 1024);
  return Math.max(1, mb) * 1024 * 1024;
}

export function instagramGraphVersion(): string {
  return process.env.INSTAGRAM_GRAPH_VERSION || "v23.0";
}

/** Which platforms have their developer app credentials filled in. */
export function configuredPlatforms(): Record<PlatformId, boolean> {
  return {
    tiktok: Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),
    instagram: Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET),
    youtube: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  };
}

export function credentials(platform: PlatformId): { id: string; secret: string } {
  switch (platform) {
    case "tiktok":
      return { id: required("TIKTOK_CLIENT_KEY"), secret: required("TIKTOK_CLIENT_SECRET") };
    case "instagram":
      return { id: required("INSTAGRAM_APP_ID"), secret: required("INSTAGRAM_APP_SECRET") };
    case "youtube":
      return { id: required("GOOGLE_CLIENT_ID"), secret: required("GOOGLE_CLIENT_SECRET") };
  }
}
