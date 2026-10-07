import { rm } from "node:fs/promises";
import { accountWithToken } from "./accounts";
import { baseUrl, type PlatformId } from "./config";
import { randomId } from "./crypto";
import { platforms } from "./platforms";
import { readDb, updateDb, type Job, type PlatformResult, type PostInput } from "./store";

export async function createJob(userId: string, mediaId: string, post: PostInput): Promise<Job> {
  const job: Job = {
    id: randomId(),
    userId,
    mediaId,
    post,
    createdAt: Date.now(),
    results: Object.fromEntries(post.platforms.map((p) => [p, { status: "queued" }])),
  };
  await updateDb((db) => {
    db.jobs[job.id] = job;
  });
  return job;
}

async function setResult(jobId: string, platform: PlatformId, result: PlatformResult) {
  await updateDb((db) => {
    const job = db.jobs[jobId];
    if (job) job.results[platform] = result;
  });
}

/** Publishes to every selected platform in parallel, then deletes the uploaded file. */
export async function runJob(jobId: string) {
  const db = await readDb();
  const job = db.jobs[jobId];
  const media = job && db.media[job.mediaId];
  if (!job || !media) return;

  const mediaUrl = `${baseUrl()}/api/media/${media.id}`;

  await Promise.all(
    job.post.platforms.map(async (platform) => {
      await setResult(jobId, platform, { status: "running" });
      try {
        const { account, accessToken } = await accountWithToken(job.userId, platform);
        const outcome = await platforms[platform].publish({ account, accessToken, media, mediaUrl, post: job.post });
        await setResult(jobId, platform, { status: "done", ...outcome });
      } catch (error) {
        console.error(`[crosspost] ${platform} failed for job ${jobId}:`, error);
        await setResult(jobId, platform, {
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );

  await updateDb((db) => {
    const stored = db.jobs[jobId];
    if (stored) stored.finishedAt = Date.now();
    delete db.media[media.id];
  });
  await rm(media.filePath, { force: true });
}
