import type { PostInput } from "./store";

/** Turns "#travel food, #Street-Food" into ["#travel", "#food", "#StreetFood"]. */
export function parseHashtags(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[\s,]+/)) {
    const word = raw.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (!word || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    out.push(`#${word}`);
  }
  return out;
}

/** Comma separated keywords for YouTube, e.g. "street food, lahore, vlog". */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(",")) {
    const tag = raw.trim().replace(/[<>]/g, "");
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max - 1).join("").trimEnd() + "…";
}

function joinParts(...parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join("\n\n");
}

/** TikTok puts the whole caption in `title` (max 2200 characters). */
export function tiktokCaption(post: PostInput): string {
  return truncate(joinParts(post.title, post.description, post.hashtags.join(" ")), 2200);
}

/** Instagram captions: max 2200 characters and 30 hashtags. */
export function instagramCaption(post: PostInput): string {
  return truncate(joinParts(post.title, post.description, post.hashtags.slice(0, 30).join(" ")), 2200);
}

export function youtubeMetadata(post: PostInput) {
  const title = truncate(post.title.replace(/[<>]/g, "") || "Untitled", 100);
  const description = truncate(
    joinParts(post.description, post.hashtags.join(" ")).replace(/[<>]/g, ""),
    4900,
  );
  // YouTube caps the combined tag length at 500 characters.
  const tags: string[] = [];
  let total = 0;
  for (const tag of post.tags) {
    const cost = tag.length + (tag.includes(" ") ? 2 : 0) + (tags.length ? 1 : 0);
    if (total + cost > 500) break;
    tags.push(tag);
    total += cost;
  }
  return { title, description, tags };
}
