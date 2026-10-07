import type { NextRequest } from "next/server";
import { getUserId } from "@/lib/session";
import { readDb } from "@/lib/store";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const userId = await getUserId();
  const job = (await readDb()).jobs[id];
  if (!job || job.userId !== userId) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ id: job.id, results: job.results, finished: Boolean(job.finishedAt) });
}
