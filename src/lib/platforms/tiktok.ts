import { open } from "node:fs/promises";
import { tiktokCaption } from "../caption";
import { credentials, redirectUri } from "../config";
import { ApiError, fetchJson, form, sleep } from "../http";
import type { Platform } from "./types";

const API = "https://open.tiktokapis.com/v2";
const SCOPES = ["user.info.basic", "video.publish"];

// TikTok upload rules: chunks of 5–64 MB, a file under 64 MB goes in one chunk,
// and the last chunk takes the remainder (it may be up to 128 MB).
const SINGLE_CHUNK_LIMIT = 64 * 1024 * 1024;
const CHUNK_SIZE = 32 * 1024 * 1024;

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  open_id?: string;
  error?: string;
  error_description?: string;
};

type Envelope<T> = { data: T; error: { code: string; message: string } };

async function token(params: Record<string, string>) {
  const { id, secret } = credentials("tiktok");
  const t = await fetchJson<TokenResponse>(
    `${API}/oauth/token/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ client_key: id, client_secret: secret, ...params }),
    },
    "TikTok token request",
  );
  if (!t.access_token) {
    throw new ApiError(`TikTok token request failed: ${t.error_description || t.error || "no access token"}`);
  }
  return t as Required<Pick<TokenResponse, "access_token" | "expires_in" | "open_id">> & TokenResponse;
}

async function api<T>(path: string, accessToken: string, body?: unknown): Promise<T> {
  const res = await fetchJson<Envelope<T>>(
    `${API}${path}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    "TikTok",
  );
  if (res.error && res.error.code !== "ok") {
    throw new ApiError(`TikTok: ${res.error.message || res.error.code}`);
  }
  return res.data;
}

export const tiktok: Platform = {
  id: "tiktok",
  label: "TikTok",
  refreshWindowMs: 10 * 60 * 1000,

  authorizeUrl(state) {
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.search = new URLSearchParams({
      client_key: credentials("tiktok").id,
      scope: SCOPES.join(","),
      response_type: "code",
      redirect_uri: redirectUri("tiktok"),
      state,
    }).toString();
    return url.toString();
  },

  async connect(code) {
    const t = await token({ code, grant_type: "authorization_code", redirect_uri: redirectUri("tiktok") });
    const res = await fetchJson<Envelope<{ user: { open_id: string; display_name: string; avatar_url?: string } }>>(
      `${API}/user/info/?fields=open_id,display_name,avatar_url`,
      { headers: { Authorization: `Bearer ${t.access_token}` } },
      "TikTok profile lookup",
    );
    return {
      accountId: res.data.user.open_id || t.open_id,
      name: res.data.user.display_name || "TikTok account",
      avatarUrl: res.data.user.avatar_url,
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: Date.now() + t.expires_in * 1000,
    };
  },

  async refresh(_account, refreshToken) {
    if (!refreshToken) return null;
    const t = await token({ grant_type: "refresh_token", refresh_token: refreshToken });
    return {
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? refreshToken,
      expiresAt: Date.now() + t.expires_in * 1000,
    };
  },

  async publish({ accessToken, media, post }) {
    // TikTok requires checking the creator's current posting options before every post.
    const creator = await api<{
      privacy_level_options: string[];
      max_video_post_duration_sec?: number;
      comment_disabled?: boolean;
      duet_disabled?: boolean;
      stitch_disabled?: boolean;
    }>("/post/publish/creator_info/query/", accessToken);

    const wanted = post.privacy === "public" ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY";
    const privacy = creator.privacy_level_options.includes(wanted) ? wanted : "SELF_ONLY";
    if (!creator.privacy_level_options.includes(privacy)) {
      throw new ApiError("TikTok did not offer a privacy option this app can use for this account.");
    }

    const singleChunk = media.size <= SINGLE_CHUNK_LIMIT;
    const chunkSize = singleChunk ? media.size : CHUNK_SIZE;
    const chunkCount = singleChunk ? 1 : Math.floor(media.size / CHUNK_SIZE);

    const init = await api<{ publish_id: string; upload_url: string }>("/post/publish/video/init/", accessToken, {
      post_info: {
        title: tiktokCaption(post),
        privacy_level: privacy,
        disable_comment: Boolean(creator.comment_disabled),
        disable_duet: Boolean(creator.duet_disabled),
        disable_stitch: Boolean(creator.stitch_disabled),
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: media.size,
        chunk_size: chunkSize,
        total_chunk_count: chunkCount,
      },
    });

    const file = await open(media.filePath, "r");
    try {
      for (let i = 0; i < chunkCount; i++) {
        const start = i * chunkSize;
        const end = i === chunkCount - 1 ? media.size - 1 : start + chunkSize - 1;
        const buffer = Buffer.alloc(end - start + 1);
        await file.read(buffer, 0, buffer.length, start);
        const res = await fetch(init.upload_url, {
          method: "PUT",
          headers: {
            "Content-Type": media.contentType,
            "Content-Length": String(buffer.length),
            "Content-Range": `bytes ${start}-${end}/${media.size}`,
          },
          body: buffer,
        });
        if (!res.ok) {
          throw new ApiError(`TikTok chunk ${i + 1}/${chunkCount} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
        }
      }
    } finally {
      await file.close();
    }

    // TikTok processes the video after upload. Wait for it so the result is accurate.
    for (let attempt = 0; attempt < 60; attempt++) {
      await sleep(5000);
      const status = await api<{ status: string; fail_reason?: string }>(
        "/post/publish/status/fetch/",
        accessToken,
        { publish_id: init.publish_id },
      );
      if (status.status === "FAILED") throw new ApiError(`TikTok rejected the video: ${status.fail_reason || "unknown reason"}`);
      if (status.status === "PUBLISH_COMPLETE") {
        return {
          message:
            privacy === "SELF_ONLY" && post.privacy === "public"
              ? "Posted as private (Only me). TikTok only allows public posts after the app passes its audit."
              : undefined,
        };
      }
    }
    return { message: "Uploaded. TikTok is still processing it, check your profile in a few minutes." };
  },
};
