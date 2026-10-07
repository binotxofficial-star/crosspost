"use client";

import { useEffect, useRef, useState } from "react";
import { parseHashtags, parseTags } from "@/lib/caption";
import type { PlatformId } from "@/lib/config";
import type { PlatformResult } from "@/lib/store";
import { PlatformIcon } from "./platform-icon";

const ORDER: PlatformId[] = ["tiktok", "instagram", "youtube"];
const LABEL: Record<PlatformId, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };
const NOTE: Record<PlatformId, string> = {
  tiktok: "Posts to your TikTok profile.",
  instagram: "Posts a Reel. Needs a Business or Creator account.",
  youtube: "Uploads to your channel. Short vertical videos become Shorts.",
};

type Info = {
  configured: Record<PlatformId, boolean>;
  accounts: Partial<Record<PlatformId, { name: string; avatarUrl?: string; expired: boolean }>>;
  maxUploadBytes: number;
};

type Upload =
  | { status: "idle" }
  | { status: "uploading"; progress: number }
  | { status: "done"; mediaId: string }
  | { status: "error"; error: string };

type Job = { id: string; results: Partial<Record<PlatformId, PlatformResult>>; finished: boolean };

const inputClass =
  "w-full rounded-xl border border-border bg-card px-4 py-3 text-base outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30";

function formatMb(bytes: number) {
  return `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;
}

function videoType(file: File) {
  if (file.type === "video/mp4" || file.type === "video/quicktime") return file.type;
  if (/\.mp4$/i.test(file.name)) return "video/mp4";
  if (/\.mov$/i.test(file.name)) return "video/quicktime";
  return null;
}

export function Dashboard() {
  const [info, setInfo] = useState<Info | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [upload, setUpload] = useState<Upload>({ status: "idle" });
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [tags, setTags] = useState("");
  const [privacy, setPrivacy] = useState<"public" | "private">("public");
  const [excluded, setExcluded] = useState<Set<PlatformId>>(new Set());

  const [job, setJob] = useState<Job | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function loadInfo() {
    return fetch("/api/accounts")
      .then((r) => r.json() as Promise<Info>)
      .then(setInfo)
      .catch(() => setBanner({ kind: "error", text: "Could not reach the server." }));
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected") as PlatformId | null;
    const error = params.get("error");
    if (connected || error) window.history.replaceState(null, "", window.location.pathname);
    loadInfo().then(() => {
      if (connected && LABEL[connected]) setBanner({ kind: "ok", text: `${LABEL[connected]} connected.` });
      else if (error) setBanner({ kind: "error", text: error });
    });
  }, []);

  useEffect(() => {
    if (!job || job.finished) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/jobs/${job.id}`);
      if (res.ok) setJob(await res.json());
    }, 3000);
    return () => clearInterval(timer);
  }, [job]);

  useEffect(() => () => xhrRef.current?.abort(), []);

  const connected = ORDER.filter((p) => info?.accounts[p] && !info.accounts[p]!.expired);
  const chosen = connected.filter((p) => !excluded.has(p));
  const hashtagList = parseHashtags(hashtags);
  const tagList = parseTags(tags);

  async function disconnect(platform: PlatformId) {
    await fetch(`/api/accounts/${platform}`, { method: "DELETE" });
    await loadInfo();
  }

  function pickFile(next: File | null) {
    xhrRef.current?.abort();
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(next ? URL.createObjectURL(next) : null);
    setJob(null);
    if (!next) return setUpload({ status: "idle" });

    const type = videoType(next);
    if (!type) return setUpload({ status: "error", error: "Please choose an MP4 or MOV video." });
    if (info && next.size > info.maxUploadBytes) {
      return setUpload({ status: "error", error: `This video is ${formatMb(next.size)}. The limit is ${formatMb(info.maxUploadBytes)}.` });
    }

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("PUT", "/api/upload");
    xhr.setRequestHeader("Content-Type", type);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(next.name));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUpload({ status: "uploading", progress: e.loaded / e.total });
    };
    xhr.onload = () => {
      let body: { mediaId?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 200 && body.mediaId) setUpload({ status: "done", mediaId: body.mediaId });
      else setUpload({ status: "error", error: body.error || `Upload failed (${xhr.status}).` });
    };
    xhr.onerror = () => setUpload({ status: "error", error: "Upload failed. Check your connection and try again." });
    setUpload({ status: "uploading", progress: 0 });
    xhr.send(next);
  }

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (upload.status !== "done") return setFormError("Wait for the video to finish uploading.");
    if (!title.trim()) return setFormError("Please add a title.");
    if (!chosen.length) return setFormError("Pick at least one connected platform.");

    setSubmitting(true);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: upload.mediaId, title, description, hashtags, tags, privacy, platforms: chosen }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not start publishing.");
      setJob({
        id: body.jobId,
        results: Object.fromEntries(chosen.map((p) => [p, { status: "queued" }])),
        finished: false,
      });
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    pickFile(null);
    setTitle("");
    setDescription("");
    setHashtags("");
    setTags("");
  }

  const busy = submitting || Boolean(job && !job.finished);

  return (
    <div className="space-y-8">
      {banner && (
        <div
          role="status"
          className={`flex items-start justify-between gap-4 rounded-xl border px-4 py-3 text-sm ${
            banner.kind === "ok" ? "border-success/40 text-success" : "border-danger/40 text-danger"
          }`}
        >
          <span>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} className="cursor-pointer font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      <section aria-labelledby="accounts-heading">
        <StepHeading n={1} id="accounts-heading">
          Connect your accounts
        </StepHeading>
        <div className="grid gap-4 sm:grid-cols-3">
          {ORDER.map((p) => {
            const account = info?.accounts[p];
            const configured = info?.configured[p];
            return (
              <div key={p} className="flex flex-col rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-muted">
                    <PlatformIcon platform={p} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold">{LABEL[p]}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {account ? (account.expired ? "Login expired" : account.name) : "Not connected"}
                    </p>
                  </div>
                </div>
                <p className="mt-3 flex-1 text-sm text-muted-foreground">{NOTE[p]}</p>
                <div className="mt-4">
                  {!info ? (
                    <div className="h-10 animate-pulse rounded-xl bg-muted" />
                  ) : account && !account.expired ? (
                    <button
                      type="button"
                      onClick={() => disconnect(p)}
                      className="h-10 w-full cursor-pointer rounded-xl border border-border text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      Disconnect
                    </button>
                  ) : configured ? (
                    <a
                      href={`/api/auth/${p}/start`}
                      className="flex h-10 w-full items-center justify-center rounded-xl bg-primary text-sm font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {account ? "Reconnect" : "Connect"}
                    </a>
                  ) : (
                    <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
                      Server keys for {LABEL[p]} are missing. See the README.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <form onSubmit={publish} className="space-y-8" aria-busy={busy}>
        <section aria-labelledby="video-heading">
          <StepHeading n={2} id="video-heading">
            Add your video
          </StepHeading>
          <div className="grid gap-4 rounded-2xl border border-border bg-card p-5 sm:grid-cols-[200px_1fr]">
            <div className="mx-auto aspect-[9/16] w-full max-w-[200px] overflow-hidden sm:mx-0 rounded-xl bg-muted">
              {preview ? (
                <video src={preview} className="size-full object-cover" controls muted playsInline />
              ) : (
                <div className="grid size-full place-items-center p-4 text-center text-sm text-muted-foreground">
                  Preview shows here
                </div>
              )}
            </div>
            <div className="flex flex-col justify-center gap-3">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border px-4 py-8 text-center transition-colors hover:border-primary focus-within:border-primary">
                <span className="font-semibold">{file ? "Choose a different video" : "Choose a video"}</span>
                <span className="text-sm text-muted-foreground">
                  MP4 or MOV
                  {info ? `, up to ${formatMb(info.maxUploadBytes)}` : ""}. Vertical 9:16 works best on all three.
                </span>
                <input
                  type="file"
                  accept="video/mp4,video/quicktime,.mp4,.mov"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                />
              </label>
              {file && (
                <div className="text-sm" aria-live="polite">
                  <p className="truncate font-medium">
                    {file.name} <span className="text-muted-foreground">({formatMb(file.size)})</span>
                  </p>
                  {upload.status === "uploading" && (
                    <div className="mt-2">
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-200"
                          style={{ width: `${Math.round(upload.progress * 100)}%` }}
                        />
                      </div>
                      <p className="mt-1 text-muted-foreground">Uploading {Math.round(upload.progress * 100)}%</p>
                    </div>
                  )}
                  {upload.status === "done" && <p className="mt-1 text-success">Uploaded, ready to publish.</p>}
                  {upload.status === "error" && <p className="mt-1 text-danger">{upload.error}</p>}
                </div>
              )}
            </div>
          </div>
        </section>

        <section aria-labelledby="details-heading">
          <StepHeading n={3} id="details-heading">
            Title, description and tags
          </StepHeading>
          <div className="space-y-5 rounded-2xl border border-border bg-card p-5">
            <Field label="Title" hint={`${Array.from(title).length}/100. YouTube cuts titles at 100 characters.`} htmlFor="title">
              <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="My Lahore street food tour" required />
            </Field>
            <Field label="Description" hint="Shown under the video on YouTube and in the caption on TikTok and Instagram." htmlFor="description">
              <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className={inputClass} placeholder="What is this video about?" />
            </Field>
            <Field label="Hashtags" hint="Separate with spaces or commas. Added to the end of every caption. Instagram uses the first 30." htmlFor="hashtags">
              <input id="hashtags" value={hashtags} onChange={(e) => setHashtags(e.target.value)} className={inputClass} placeholder="#streetfood #lahore #foodie" />
              {hashtagList.length > 0 && <Chips items={hashtagList} />}
            </Field>
            <Field label="Tags (YouTube)" hint="Comma separated search keywords. Only YouTube uses these." htmlFor="tags">
              <input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} className={inputClass} placeholder="street food, lahore food, desi food" />
              {tagList.length > 0 && <Chips items={tagList} />}
            </Field>
            <fieldset>
              <legend className="mb-2 font-medium">Who can see it</legend>
              <div className="flex flex-wrap gap-2">
                {(["public", "private"] as const).map((value) => (
                  <label
                    key={value}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-4 text-sm font-medium transition-colors ${
                      privacy === value ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                    }`}
                  >
                    <input type="radio" name="privacy" value={value} checked={privacy === value} onChange={() => setPrivacy(value)} className="accent-[var(--primary)]" />
                    {value === "public" ? "Public" : "Private (only me)"}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">Instagram Reels are always public.</p>
            </fieldset>
          </div>
        </section>

        <section aria-labelledby="publish-heading">
          <StepHeading n={4} id="publish-heading">
            Publish
          </StepHeading>
          <div className="space-y-5 rounded-2xl border border-border bg-card p-5">
            {connected.length === 0 ? (
              <p className="text-sm text-muted-foreground">Connect at least one account above to publish.</p>
            ) : (
              <fieldset>
                <legend className="mb-2 font-medium">Post to</legend>
                <div className="flex flex-wrap gap-2">
                  {connected.map((p) => (
                    <label
                      key={p}
                      className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-4 text-sm font-medium transition-colors ${
                        excluded.has(p) ? "border-border hover:bg-muted" : "border-primary bg-primary/10"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={!excluded.has(p)}
                        onChange={() =>
                          setExcluded((prev) => {
                            const next = new Set(prev);
                            if (next.has(p)) next.delete(p);
                            else next.add(p);
                            return next;
                          })
                        }
                        className="accent-[var(--primary)]"
                      />
                      <PlatformIcon platform={p} className="size-4" />
                      {LABEL[p]}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {chosen.includes("tiktok") && (
              <p className="text-sm text-muted-foreground">
                By posting, you agree to TikTok&apos;s{" "}
                <a
                  href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Music Usage Confirmation
                </a>
                .
              </p>
            )}

            {formError && (
              <p role="alert" className="text-sm text-danger">
                {formError}
              </p>
            )}

            {job?.finished ? (
              <button
                type="button"
                onClick={reset}
                className="h-12 w-full cursor-pointer rounded-xl border border-border font-semibold transition-colors hover:bg-muted sm:w-auto sm:px-8"
              >
                Post another video
              </button>
            ) : (
              <button
                type="submit"
                disabled={busy || upload.status !== "done" || !chosen.length}
                className="h-12 w-full cursor-pointer rounded-xl bg-primary font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-8"
              >
                {busy
                  ? "Publishing…"
                  : chosen.length
                    ? `Publish to ${chosen.map((p) => LABEL[p]).join(", ")}`
                    : "Publish"}
              </button>
            )}

            {job && <Results job={job} />}
          </div>
        </section>
      </form>
    </div>
  );
}

function StepHeading({ n, id, children }: { n: number; id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-4 flex items-center gap-3 text-lg font-semibold">
      <span className="grid size-7 place-items-center rounded-full bg-primary text-sm font-bold text-on-primary">{n}</span>
      {children}
    </h2>
  );
}

function Field({ label, hint, htmlFor, children }: { label: string; hint: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-2 block font-medium">
        {label}
      </label>
      {children}
      <p className="mt-1.5 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li key={item} className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
          {item}
        </li>
      ))}
    </ul>
  );
}

const STATUS_TEXT: Record<PlatformResult["status"], string> = {
  queued: "Waiting",
  running: "Uploading and processing…",
  done: "Published",
  failed: "Failed",
};

function Results({ job }: { job: Job }) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border" aria-live="polite">
      {ORDER.filter((p) => job.results[p]).map((p) => {
        const r = job.results[p]!;
        const color = r.status === "done" ? "text-success" : r.status === "failed" ? "text-danger" : "text-muted-foreground";
        return (
          <li key={p} className="flex items-start gap-3 p-4">
            <PlatformIcon platform={p} className="mt-0.5 size-5 shrink-0" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">
                {LABEL[p]} <span className={`ml-1 ${color}`}>{STATUS_TEXT[r.status]}</span>
              </p>
              {r.message && <p className={`mt-1 ${r.status === "failed" ? "text-danger" : "text-warning"}`}>{r.message}</p>}
              {r.url && (
                <a href={r.url} target="_blank" rel="noreferrer" className="mt-1 inline-block break-all text-primary underline">
                  {r.url}
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
