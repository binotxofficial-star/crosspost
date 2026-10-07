import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { youtubeMetadata } from "../caption";
import { credentials, redirectUri } from "../config";
import { ApiError, fetchJson, form } from "../http";
import type { Platform } from "./types";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

async function token(params: Record<string, string>): Promise<TokenResponse> {
  const { id, secret } = credentials("youtube");
  return fetchJson<TokenResponse>(
    "https://oauth2.googleapis.com/token",
    { method: "POST", body: form({ client_id: id, client_secret: secret, ...params }) },
    "Google token request",
  );
}

export const youtube: Platform = {
  id: "youtube",
  label: "YouTube",
  refreshWindowMs: 5 * 60 * 1000,

  authorizeUrl(state) {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: credentials("youtube").id,
      redirect_uri: redirectUri("youtube"),
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    }).toString();
    return url.toString();
  },

  async connect(code) {
    const t = await token({ code, grant_type: "authorization_code", redirect_uri: redirectUri("youtube") });
    const channels = await fetchJson<{
      items?: { id: string; snippet: { title: string; thumbnails?: { default?: { url: string } } } }[];
    }>(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      { headers: { Authorization: `Bearer ${t.access_token}` } },
      "YouTube channel lookup",
    );
    const channel = channels.items?.[0];
    if (!channel) throw new Error("This Google account has no YouTube channel. Create one on youtube.com first.");
    return {
      accountId: channel.id,
      name: channel.snippet.title,
      avatarUrl: channel.snippet.thumbnails?.default?.url,
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
    const meta = youtubeMetadata(post);
    const init = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(media.size),
          "X-Upload-Content-Type": media.contentType,
        },
        body: JSON.stringify({
          snippet: { title: meta.title, description: meta.description, tags: meta.tags, categoryId: "22" },
          status: { privacyStatus: post.privacy, selfDeclaredMadeForKids: false },
        }),
      },
    );
    const uploadUrl = init.headers.get("location");
    if (!init.ok || !uploadUrl) {
      throw new ApiError(`YouTube upload setup failed (${init.status}): ${(await init.text()).slice(0, 300)}`);
    }

    const video = await fetchJson<{ id: string; status?: { privacyStatus?: string } }>(
      uploadUrl,
      {
        method: "PUT",
        headers: { "Content-Type": media.contentType, "Content-Length": String(media.size) },
        body: Readable.toWeb(createReadStream(media.filePath)) as ReadableStream,
        // Node's fetch needs this to stream a request body.
        duplex: "half",
      } as RequestInit,
      "YouTube upload",
    );

    const locked = post.privacy === "public" && video.status?.privacyStatus === "private";
    return {
      url: `https://www.youtube.com/watch?v=${video.id}`,
      message: locked
        ? "Uploaded as private. Google keeps uploads from unverified API projects private until the project passes its audit."
        : undefined,
    };
  },
};
