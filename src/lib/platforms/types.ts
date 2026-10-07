import type { PlatformId } from "../config";
import type { Account, Media, PostInput } from "../store";

/** A freshly connected account, before tokens are encrypted and stored. */
export type ConnectedAccount = {
  accountId: string;
  name: string;
  avatarUrl?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
};

export type RefreshedTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
};

export type PublishContext = {
  account: Account;
  accessToken: string;
  media: Media;
  /** Public HTTPS link to the video file, for platforms that pull the file themselves. */
  mediaUrl: string;
  post: PostInput;
};

export type PublishOutcome = {
  url?: string;
  message?: string;
};

export type Platform = {
  id: PlatformId;
  label: string;
  authorizeUrl(state: string): string;
  connect(code: string): Promise<ConnectedAccount>;
  /** Returns null when the platform has no way to refresh this token. */
  refresh(account: Account, refreshToken: string | undefined, accessToken: string): Promise<RefreshedTokens | null>;
  /** How long before expiry the token should be refreshed, in ms. */
  refreshWindowMs: number;
  publish(ctx: PublishContext): Promise<PublishOutcome>;
};
