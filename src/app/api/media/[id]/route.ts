import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { readDb } from "@/lib/store";

/**
 * Serves an uploaded video so Instagram can download it while publishing.
 * The id is random and the file is deleted once publishing finishes.
 */
async function serve(req: NextRequest, ctx: RouteContext<"/api/media/[id]">, head: boolean) {
  const { id } = await ctx.params;
  const media = (await readDb()).media[id];
  if (!media) return new Response("Not found", { status: 404 });

  const headers = new Headers({
    "Content-Type": media.contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  });

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
  let start = 0;
  let end = media.size - 1;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), end);
    } else {
      start = Math.max(0, media.size - Number(range[2]));
    }
    if (start > end) {
      headers.set("Content-Range", `bytes */${media.size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${media.size}`);
  }
  headers.set("Content-Length", String(end - start + 1));
  const status = range && (range[1] || range[2]) ? 206 : 200;

  if (head) return new Response(null, { status, headers });
  const stream = Readable.toWeb(createReadStream(media.filePath, { start, end })) as ReadableStream;
  return new Response(stream, { status, headers });
}

export function GET(req: NextRequest, ctx: RouteContext<"/api/media/[id]">) {
  return serve(req, ctx, false);
}

export function HEAD(req: NextRequest, ctx: RouteContext<"/api/media/[id]">) {
  return serve(req, ctx, true);
}
