import { NextResponse, type NextRequest } from "next/server";
import { baseUrl, configuredPlatforms, isPlatform } from "@/lib/config";
import { randomId, sign } from "@/lib/crypto";
import { platforms } from "@/lib/platforms";
import { getOrCreateUserId } from "@/lib/session";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/auth/[platform]/start">) {
  const { platform } = await ctx.params;
  if (!isPlatform(platform)) return new Response("Unknown platform", { status: 404 });
  if (!configuredPlatforms()[platform]) {
    return NextResponse.redirect(`${baseUrl()}/?error=${encodeURIComponent(`${platforms[platform].label} keys are not set up on the server yet.`)}`);
  }

  await getOrCreateUserId();
  const state = randomId();
  const res = NextResponse.redirect(platforms[platform].authorizeUrl(state));
  res.cookies.set(`cp_state_${platform}`, sign(state), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
