import { instagramCaption } from "../caption";
import { credentials, instagramGraphVersion, redirectUri } from "../config";
import { ApiError, form, sleep } from "../http";
import type { Platform } from "./types";

const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];
const graph = () => `https://graph.instagram.com/${instagramGraphVersion()}`;

/**
 * Instagram ids are 17+ digits, larger than JavaScript numbers can hold exactly,
 * and some endpoints send them unquoted. Quote them before parsing.
 */
async function igFetch<T>(url: string, init: RequestInit, label: string): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text.replace(/("(?:user_id|id)"\s*:\s*)(\d{10,})/g, '$1"$2"'));
  } catch {
    body = { error_message: text.slice(0, 300) };
  }
  if (!res.ok || body.error || body.error_type) {
    const err = body.error as { message?: string; error_user_msg?: string } | undefined;
    const msg = err?.error_user_msg || err?.message || body.error_message || `HTTP ${res.status}`;
    throw new ApiError(`${label} failed: ${String(msg)}`, res.status);
  }
  return body as T;
}

export const instagram: Platform = {
  id: "instagram",
  label: "Instagram",
  // Long-lived tokens last 60 days. Refresh during the last week.
  refreshWindowMs: 7 * 24 * 60 * 60 * 1000,

  authorizeUrl(state) {
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: credentials("instagram").id,
      redirect_uri: redirectUri("instagram"),
      response_type: "code",
      scope: SCOPES.join(","),
      state,
    }).toString();
    return url.toString();
  },

  async connect(code) {
    const { id, secret } = credentials("instagram");
    const short = await igFetch<
      { access_token?: string; user_id?: string; data?: { access_token: string; user_id: string }[] }
    >(
      "https://api.instagram.com/oauth/access_token",
      {
        method: "POST",
        body: form({
          client_id: id,
          client_secret: secret,
          grant_type: "authorization_code",
          redirect_uri: redirectUri("instagram"),
          // Instagram appends "#_" to the code in the redirect.
          code: code.replace(/#_$/, ""),
        }),
      },
      "Instagram token request",
    );
    const shortToken = short.access_token ?? short.data?.[0]?.access_token;
    if (!shortToken) throw new ApiError("Instagram did not return an access token.");

    const long = await igFetch<{ access_token: string; expires_in: number }>(
      `https://graph.instagram.com/access_token?${new URLSearchParams({
        grant_type: "ig_exchange_token",
        client_secret: secret,
        access_token: shortToken,
      })}`,
      {},
      "Instagram long-lived token",
    );

    const me = await igFetch<{ user_id: string; username: string; profile_picture_url?: string; account_type?: string }>(
      `${graph()}/me?fields=user_id,username,profile_picture_url,account_type`,
      { headers: { Authorization: `Bearer ${long.access_token}` } },
      "Instagram profile lookup",
    );

    return {
      accountId: me.user_id,
      name: `@${me.username}`,
      avatarUrl: me.profile_picture_url,
      accessToken: long.access_token,
      expiresAt: Date.now() + long.expires_in * 1000,
    };
  },

  async refresh(_account, _refreshToken, accessToken) {
    const t = await igFetch<{ access_token: string; expires_in: number }>(
      `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({
        grant_type: "ig_refresh_token",
        access_token: accessToken,
      })}`,
      {},
      "Instagram token refresh",
    );
    return { accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
  },

  async publish({ account, accessToken, mediaUrl, post }) {
    if (!mediaUrl.startsWith("https://") || /\/\/(localhost|127\.|0\.0\.0\.0)/.test(mediaUrl)) {
      throw new ApiError(
        "Instagram downloads the video from your site, so PUBLIC_BASE_URL must be a public https:// address (not localhost).",
      );
    }
    const auth = { Authorization: `Bearer ${accessToken}` };

    const container = await igFetch<{ id: string }>(
      `${graph()}/${account.accountId}/media`,
      {
        method: "POST",
        headers: auth,
        body: form({
          media_type: "REELS",
          video_url: mediaUrl,
          caption: instagramCaption(post),
          share_to_feed: "true",
        }),
      },
      "Instagram upload",
    );

    // Instagram fetches and transcodes the video. Poll until it is ready (up to ~10 minutes).
    let ready = false;
    for (let attempt = 0; attempt < 120 && !ready; attempt++) {
      await sleep(5000);
      const s = await igFetch<{ status_code: string; status?: string }>(
        `${graph()}/${container.id}?fields=status_code,status`,
        { headers: auth },
        "Instagram status check",
      );
      if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
        throw new ApiError(`Instagram could not process the video: ${s.status || s.status_code}`);
      }
      ready = s.status_code === "FINISHED";
    }
    if (!ready) throw new ApiError("Instagram took too long to process the video. Try again later.");

    const published = await igFetch<{ id: string }>(
      `${graph()}/${account.accountId}/media_publish`,
      { method: "POST", headers: auth, body: form({ creation_id: container.id }) },
      "Instagram publish",
    );

    try {
      const info = await igFetch<{ permalink?: string }>(
        `${graph()}/${published.id}?fields=permalink`,
        { headers: auth },
        "Instagram permalink",
      );
      return {
        url: info.permalink,
        message: post.privacy === "private" ? "Instagram has no private posts, so this Reel is public." : undefined,
      };
    } catch {
      return { message: "Published. Instagram did not return a link." };
    }
  },
};
