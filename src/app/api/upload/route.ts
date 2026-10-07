import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dataDir, maxUploadBytes } from "@/lib/config";
import { randomId } from "@/lib/crypto";
import { getOrCreateUserId } from "@/lib/session";
import { updateDb } from "@/lib/store";

// MP4 and MOV are the formats TikTok, Instagram Reels and YouTube all accept.
const TYPES: Record<string, string> = { "video/mp4": ".mp4", "video/quicktime": ".mov" };

/** The browser sends the raw file as the request body, so large videos are streamed to disk. */
export async function PUT(req: Request) {
  const contentType = (req.headers.get("content-type") || "").split(";")[0].trim();
  const ext = TYPES[contentType];
  if (!ext) return Response.json({ error: "Please upload an MP4 or MOV video." }, { status: 415 });

  const limit = maxUploadBytes();
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > limit) {
    return Response.json({ error: `Video is too large. The limit is ${Math.round(limit / 1048576)} MB.` }, { status: 413 });
  }
  if (!req.body) return Response.json({ error: "Empty upload." }, { status: 400 });

  const userId = await getOrCreateUserId();
  const id = randomId();
  const dir = path.join(dataDir(), "media");
  const filePath = path.join(dir, `${id}${ext}`);
  await mkdir(dir, { recursive: true });

  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      size += chunk.length;
      done(size > limit ? new Error("too-large") : null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(req.body as import("node:stream/web").ReadableStream), counter, createWriteStream(filePath));
  } catch (error) {
    await rm(filePath, { force: true });
    if ((error as Error).message === "too-large") {
      return Response.json({ error: `Video is too large. The limit is ${Math.round(limit / 1048576)} MB.` }, { status: 413 });
    }
    throw error;
  }
  if (size === 0) {
    await rm(filePath, { force: true });
    return Response.json({ error: "Empty upload." }, { status: 400 });
  }

  const fileName = decodeURIComponent(req.headers.get("x-file-name") || `video${ext}`).slice(0, 200);
  await updateDb((db) => {
    db.media[id] = { id, userId, fileName, filePath, size, contentType, createdAt: Date.now() };
  });
  return Response.json({ mediaId: id, size });
}
