# Entropy Results Dashboard — Vercel

Browse research figures, nested experiment folders, metrics, and metadata in Google Drive. Search, filters, favorites, file previews, and side-by-side comparisons use the existing explorer UI.

The recovered local project was a Google Apps Script app, rather than a Firebase app. It now includes a Vercel target with static browser assets and Node.js functions, using Node.js 22. Personal mode connects each viewer's Google account. Shared mode uses one backend Drive account and a persistent common catalog.

**For collaborators: use [shared backend mode](SHARED-SETUP.md).** It connects Drive once on the server, saves a common catalog and thumbnails in private Vercel Blob storage, and rebuilds through Vercel Queues. Viewers enter a shared dashboard password and do not connect Google Drive. A refresh loads the existing catalog; re-indexing is an explicit background job. Shared mode adds server credentials and durable storage; the personal OAuth setup below remains available by default until `DASHBOARD_MODE=shared` is configured.

Shared mode also includes **[saved research boards](SHARED-SETUP.md#saved-research-boards)**: pin figures, charts, CSV tables and experiment metrics onto a canvas, add notes, drag/resize tiles, and save a named layout that collaborators can reopen through a board link. Boards use the same private backend storage, with revision checks to protect concurrent edits.

## Deploy on Vercel

1. Upload/push **this project directory**, including `api/`, `web/`, `src/`, `scripts/`, `package.json`, `package-lock.json`, and `vercel.json`, to your repository. If it is inside a larger repository, set Vercel's Root Directory to `entropy-results-dashboard`.
2. Create/import the Vercel project. Framework preset: **Other**. Build command: **`npm run build`**. Output directory: **`public`**. These settings are already in `vercel.json`; keep the Node runtime at **22.x**. Uploading only the generated `public/` folder would omit the API.
3. In a Google Cloud project, enable **Google Drive API**, configure the OAuth consent screen, and create an **OAuth 2.0 client ID → Web application**. The Firebase project can be reused as the Google Cloud project if desired; Firebase services are not required.
4. Add the exact dashboard origin (for example `https://your-dashboard.vercel.app`) to the OAuth client's **Authorized JavaScript origins**. Add your custom domain separately if used. For local testing add `http://localhost:3000`. Preview deployments have different origins and must be authorized separately. This uses a popup token flow, so no redirect callback route is required.
5. If the Google consent app is in Testing, add the Google account you will use as a **test user**. Sign in with an account that can read Figures. The existing folder does not need to be made public. A broadly distributed external app using Drive's restricted scope may require Google's verification; this guide describes the private/test-user setup.
6. Set these Vercel environment variables for each intended environment, then build/redeploy:

   | Variable | Value |
   | --- | --- |
   | `GOOGLE_CLIENT_ID` | Your OAuth **web** client ID ending in `.apps.googleusercontent.com`. This identifier is public and enters the browser bundle. |
   | `GOOGLE_DRIVE_ROOT_ID` | Optional; defaults to the existing Figures folder, `1qXAMcNrZuqk4wlGbqZlmHydQ-cSthbIV`. Applies to build and API. |

   `.env.example` documents the settings. Never put a Google client secret, service-account private key, refresh token, or connector token in these variables or browser source. The Vercel version does not need them.
7. Open the dashboard, choose **Connect Google Drive**, approve read access, then choose **Start indexing Figures**. After completion, open actual figures and an experiment's summary to verify live access.

No deployment was performed by the local migration. A local build/test pass does not verify your Google OAuth configuration or the production account's Drive permissions.

## Indexing and privacy

- Google Identity Services provides a short-lived access token after your click. It stays in browser memory, is sent over HTTPS to the same-origin API, and is never saved to local storage, cookies, the build, or a server database. Reconnect when it expires; scan progress can then resume.
- The server makes authenticated **read-only** Drive requests and checks each requested folder/file is still inside the configured root before serving it. It never writes to your research folders. The page shell contains no results; file APIs require a Google bearer token and responses use `private, no-store`.
- The API permits readers of the configured Drive folder to browse it after authorization. Drive sharing determines access; there is no additional owner-only allowlist. Original Drive links still use the viewer's own Google session.
- Scans fetch **one folder page per request**, preserving nested paths and pagination. Checkpoints and the last finished catalog are stored in **IndexedDB**, partitioned by Google account and root folder. Vercel instances need no persistent filesystem or shared memory.
- Closing the tab pauses scanning; **Resume index** continues the saved work. The previous completed catalog remains visible during a refresh. A new browser/device creates its own catalog. Clearing site storage removes the cached catalog. **Disconnect** removes the current account's catalog in this browser; favorite figure IDs are local browser preferences.
- **Enable refresh while open** checks for a six-hour-old catalog while the page is visible and Google authorization is valid. It is not a cloud background job; no Firebase trigger or Vercel cron is installed. It is disabled again on reload.
- Modern browsers with IndexedDB and Web Locks are required. Web Locks serialize indexing across tabs. A failed page stays queued for retry; expired Drive pagination tokens restart the current folder with ID deduplication.
- Inline text/JSON/CSV downloads are capped at 512 KB. CSV tables show up to 100 data rows and 30 columns, including quoted cells. Original image downloads are capped at 2.8 MB so base64 responses fit Vercel's function payload limit. Larger images/PDFs use Google thumbnails when available, with full originals linked in Drive. Thumbnail URLs and bearer tokens are not returned in API responses.
- Metric labels retain their evaluation split/block and source file. Large summary displays are bounded, with a warning linking them to the complete source. Unsupported summaries stay accessible as files; no metric or result is inferred to fill gaps.

## Local development and checks

Use Node.js **22.x**:

```sh
npm ci
cp .env.example .env.local
# Edit .env.local with your public OAuth client ID.
npm run dev
```

Open `http://localhost:3000`. The local server runs the same API and static build as the Vercel target. It binds only to the local machine. The public build can be generated without credentials; it displays a setup message until `GOOGLE_CLIENT_ID` is configured.

```sh
npm run check
npm test
npm run build
node scripts/browser-qa.cjs
node scripts/vercel-browser-qa.cjs
# Test the shared build separately:
DASHBOARD_MODE=shared npm run build
node scripts/shared-browser-qa.cjs
```

Browser checks use synthetic results and require Playwright's Chromium (or `ENTROPY_CHROME` pointing at an existing compatible browser). If absent, install the test browser with `npx playwright-core install chromium`. They test the local UI/API/indexing contract, not Google's real consent popup or deployed previews.

## Source layout

| Path | Purpose |
| --- | --- |
| `api/dashboard.js` | Stateless Vercel Node function; authenticated, bounded Drive reads. |
| `api/index-worker.js`, `lib/shared*.cjs` | Shared catalog API, password sessions, and durable background worker. |
| `api/original.js` | Authenticated, on-demand streaming of originals in shared mode. |
| `lib/owner-drive.cjs`, `private-store.cjs` | Read-only backend Google account and private Blob storage adapter. |
| `web/vercel.js` | Google connection, API transport, account-partitioned browser storage. |
| `web/indexer.js` | Resumable folder scan and atomic completed snapshots. |
| `web/shared.js` | Shared password entry and saved-catalog viewer. |
| `web/boards.js`, `boards.css`, `lib/boards.cjs` | Shared canvas UI, source-linked tiles and revision-protected persistent boards. |
| `src/Core.gs` | Shared pure path classification and metric/catalog transformations. |
| `src/Index.html`, `Client.html`, `Styles.html` | Existing explorer interface. |
| `scripts/build.cjs`, `dev.cjs` | Static build and local API server. |
| `public/` | Generated assets only; rebuilt on Vercel. |
| `vercel.json` | Hosting, build, function duration, and response headers. |

The earlier Apps Script target, manual installer, and deployment record are preserved. Its instructions are in [APPS-SCRIPT.md](APPS-SCRIPT.md). `npm run deploy` still refers to the **legacy Apps Script deployment**; use Vercel's import/deploy workflow for this version. Do not run the old installer to deploy on Vercel.

References: [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js), [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json), [Vercel payload limits](https://vercel.com/docs/functions/limitations), [Google token flow](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [Drive thumbnails](https://developers.google.com/workspace/drive/api/guides/file-metadata).
