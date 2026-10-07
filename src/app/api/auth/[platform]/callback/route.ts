import { NextResponse, type NextRequest } from "next/server";
import { saveAccount } from "@/lib/accounts";
import { baseUrl, isPlatform } from "@/lib/config";
import { unsign } from "@/lib/crypto";
import { platforms } from "@/lib/platforms";
import { getUserId } from "@/lib/session";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/auth/[platform]/callback">) {
  const { platform } = await ctx.params;
  if (!isPlatform(platform)) return new Response("Unknown platform", { status: 404 });

  const home = (params: Record<string, string>) => {
    const res = NextResponse.redirect(`${baseUrl()}/?${new URLSearchParams(params)}`);
    res.cookies.delete(`cp_state_${platform}`);
    return res;
  };

  const url = req.nextUrl;
  const label = platforms[platform].label;
  const denied = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (denied) return home({ error: `${label}: ${denied}` });

  const expected = unsign(req.cookies.get(`cp_state_${platform}`)?.value);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const userId = await getUserId();
  if (!expected || state !== expected || !code || !userId) {
    return home({ error: `${label} login expired or was started in another browser. Please try again.` });
  }

  try {
    await saveAccount(userId, platform, await platforms[platform].connect(code));
    return home({ connected: platform });
  } catch (error) {
    console.error(`[crosspost] ${platform} connect failed:`, error);
    return home({ error: error instanceof Error ? error.message : `Could not connect ${label}.` });
  }
}
