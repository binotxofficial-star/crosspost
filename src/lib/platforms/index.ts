import type { PlatformId } from "../config";
import { instagram } from "./instagram";
import { tiktok } from "./tiktok";
import type { Platform } from "./types";
import { youtube } from "./youtube";

export const platforms: Record<PlatformId, Platform> = { tiktok, instagram, youtube };
