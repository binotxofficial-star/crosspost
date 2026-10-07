import type { NextRequest } from "next/server";
import { removeAccount } from "@/lib/accounts";
import { isPlatform } from "@/lib/config";
import { getUserId } from "@/lib/session";

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/accounts/[platform]">) {
  const { platform } = await ctx.params;
  if (!isPlatform(platform)) return Response.json({ error: "Unknown platform" }, { status: 404 });
  const userId = await getUserId();
  if (userId) await removeAccount(userId, platform);
  return Response.json({ ok: true });
}
