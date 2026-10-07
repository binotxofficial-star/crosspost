import { after } from "next/server";
import { parseHashtags, parseTags } from "@/lib/caption";
import { isPlatform, type PlatformId } from "@/lib/config";
import { createJob, runJob } from "@/lib/jobs";
import { platforms } from "@/lib/platforms";
import { getUserId } from "@/lib/session";
import { readDb } from "@/lib/store";

// Uploading to three platforms and waiting for them to process can take a while.
export const maxDuration = 900;

type Body = {
  mediaId?: string;
  title?: string;
  description?: string;
  hashtags?: string;
  tags?: string;
  privacy?: string;
  platforms?: string[];
};

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return Response.json({ error: "Connect an account first." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const db = await readDb();
  const media = body.mediaId ? db.media[body.mediaId] : undefined;
  if (!media || media.userId !== userId) {
    return Response.json({ error: "Upload the video again, the file was not found." }, { status: 400 });
  }

  const title = (body.title || "").trim();
  if (!title) return Response.json({ error: "Please add a title." }, { status: 400 });

  const accounts = db.users[userId]?.accounts ?? {};
  const selected = [...new Set(body.platforms ?? [])].filter(isPlatform) as PlatformId[];
  const missing = selected.filter((p) => !accounts[p]);
  if (!selected.length) return Response.json({ error: "Pick at least one platform." }, { status: 400 });
  if (missing.length) return Response.json({ error: `Connect ${missing.map((p) => platforms[p].label).join(", ")} first.` }, { status: 400 });

  const job = await createJob(userId, media.id, {
    title: title.slice(0, 2200),
    description: (body.description || "").trim().slice(0, 5000),
    hashtags: parseHashtags(body.hashtags || ""),
    tags: parseTags(body.tags || ""),
    privacy: body.privacy === "private" ? "private" : "public",
    platforms: selected,
  });

  after(() => runJob(job.id).catch((error) => console.error("[crosspost] job crashed:", error)));
  return Response.json({ jobId: job.id });
}
