# Crosspost

Upload one video, write the title, description, hashtags and tags once, and publish it to
**TikTok**, **Instagram Reels** and **YouTube** at the same time.

Built with Next.js 16 (App Router) and Tailwind CSS 4. It has no database server: tokens, uploads
and job records live in a local folder (`DATA_DIR`).

## How it works

1. The user connects TikTok, Instagram and YouTube with each platform's official OAuth login.
   Tokens are encrypted (AES-256-GCM) before they are saved.
2. The browser streams the video to `/api/upload`, which writes it to disk.
3. `/api/publish` starts a background job that posts to every selected platform in parallel:
   - **YouTube**: resumable upload through the YouTube Data API v3. Title (max 100 chars),
     description + hashtags, and tags.
   - **TikTok**: Content Posting API, direct post with chunked file upload. Title,
     description and hashtags become the caption (max 2200 chars).
   - **Instagram**: Instagram API with Instagram Login. Creates a Reel container from a public
     link to the video (`/api/media/<id>`), waits for processing, then publishes.
4. The page polls `/api/jobs/<id>` and shows the result and link for each platform.
   The video file is deleted when the job finishes.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run build
npm start
```

`PUBLIC_BASE_URL` must be the site's public `https://` address. TikTok and Instagram only accept
https redirect URLs, and Instagram downloads the video from that address. For local testing, run a
tunnel such as `cloudflared tunnel --url http://localhost:3000` and use the URL it prints.

Every platform needs a redirect URL of the form:

```
<PUBLIC_BASE_URL>/api/auth/<platform>/callback
```

### YouTube (Google Cloud)

1. Create a project at console.cloud.google.com and enable **YouTube Data API v3**.
2. Set up the OAuth consent screen and add the scopes `youtube.upload` and `youtube.readonly`.
   While the app is in testing, add your Google accounts as test users.
3. Create an **OAuth client ID** of type *Web application* with the redirect URL
   `.../api/auth/youtube/callback`.
4. Put the client ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### TikTok (developers.tiktok.com)

1. Create an app and add the **Login Kit** and **Content Posting API** products.
2. Turn on **Direct Post**, request the `user.info.basic` and `video.publish` scopes, and add the
   redirect URL `.../api/auth/tiktok/callback`. TikTok also asks you to verify your domain.
3. Put the client key and secret in `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`.

### Instagram (developers.facebook.com)

1. Create a Meta app and add **Instagram** → *API setup with Instagram business login*.
2. Add the redirect URL `.../api/auth/instagram/callback` and request
   `instagram_business_basic` and `instagram_business_content_publish`.
3. Put the Instagram app ID and secret in `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET`.
4. The Instagram account must be a **Business** or **Creator** account. Personal accounts
   cannot publish through the API.

## Limits you should know about

These come from the platforms, not from this app:

- **TikTok**: until your app passes TikTok's audit, every post is forced to *private (only me)*,
  and only a few users can connect. Public posting needs the audit.
- **YouTube**: until your Google Cloud project passes the YouTube API audit, uploads stay
  *private*. The default quota is 10,000 units a day for the whole app, and uploads are the
  most expensive call. Check the current cost in Google's quota calculator before launch.
- **Instagram**: only Business/Creator accounts. Reels must be 3 seconds to 15 minutes, and
  each account has a daily API publishing cap (see `content_publishing_limit` in Meta's docs). To let users outside your Meta app's
  roles connect, the app needs Meta's App Review.
- Videos must be MP4 or MOV. Vertical 9:16 works on all three.

## Hosting

Run it on a server that keeps files and long-running processes, such as a VPS, Railway,
Render or Fly.io with a persistent disk mounted at `DATA_DIR`. Serverless hosts like Vercel
are not a good fit: they cap request body size, wipe the disk between requests and stop
background work early.

## What's next

- Real user accounts (right now each browser gets its own anonymous id in a signed cookie).
- A proper database instead of the JSON file, and a job queue for many users.
- Scheduling posts for later and per-platform caption overrides.

## Project layout

```
src/app/page.tsx                 page shell
src/components/dashboard.tsx     the whole UI (client component)
src/app/api/auth/[platform]/     OAuth start + callback
src/app/api/upload               streams the video to disk
src/app/api/publish              creates a job and runs it after the response
src/app/api/jobs/[id]            job status for the page
src/app/api/media/[id]           serves the video to Instagram
src/lib/platforms/               TikTok, Instagram and YouTube clients
src/lib/caption.ts               hashtag/tag parsing and per-platform caption limits
src/lib/store.ts                 JSON file storage with serialized writes
```
