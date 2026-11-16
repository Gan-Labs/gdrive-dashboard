# Shared dashboard: one backend Drive connection

This mode addresses the collaborator workflow: connect the Figures folder on the server once, build one saved catalog, and let viewers browse it with a shared password. Visitors do not sign in to Google. Refreshing the page uses the saved catalog. Re-indexing happens only when requested, and a Vercel queue worker continues after the browser closes.

The existing Google OAuth mode stays active until you set `DASHBOARD_MODE=shared` and redeploy. Your browser's earlier index cannot automatically become the backend catalog; the shared backend needs one initial index.

## 1. Give a backend service account read access

1. Open [Google Cloud service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts) in the project where Google Drive API is enabled.
2. Create a service account, for example `gdrive-dashboard`. No project-wide IAM role or domain-wide delegation is needed for this folder-sharing setup.
3. Open that service account → **Keys → Add key → Create new key → JSON**. Keep the downloaded JSON for the Vercel setting below.
4. Copy the service account's email address, ending in `iam.gserviceaccount.com`.
5. Open the existing [Figures folder](https://drive.google.com/drive/folders/1qXAMcNrZuqk4wlGbqZlmHydQ-cSthbIV) in Drive → **Share**. Add that service-account email as **Viewer**. Subfolders/files must inherit that access; limited-access items may need separate sharing.

The backend requests only `drive.readonly`. It reads Figures and descendants; it does not write to research files. It can read only files shared with its service account. Collaborators get access through the dashboard password, without changing their own Drive permissions. The Google OAuth consent/test-user setup is not used by this service-account mode.

## 2. Connect private Vercel Blob storage

In the Vercel `gdrive-dashboard` project, open **Storage** and create or connect a **Blob store with Private access**. Connect it to **Production**. Confirm it supplies `BLOB_READ_WRITE_TOKEN` to the project. Do not create a public store for the catalog.

The app stores catalog snapshots, scan checkpoints, cached figure thumbnails, and shared research boards here. It uses Vercel Queues for background work; the `drive-index` consumer is declared in `vercel.json`, and the SDK authenticates automatically on Vercel. If Vercel requests enabling its Queues beta for the project/team, enable it before indexing. No queue token is entered in the frontend.

Blob storage, queue operations, function execution, and bandwidth use your Vercel allowances. Check your plan's limits. No paid upgrade or resource has been provisioned by this source change. Previous snapshots and cached image versions are retained; repeated refreshes can grow storage. There is no automatic deletion job.

## 3. Set these Vercel environment variables

In **Project → Settings → Environment Variables**, use **Production** initially:

| Key | Value |
| --- | --- |
| `DASHBOARD_MODE` | `shared` |
| `DASHBOARD_PASSWORD` | Your shared dashboard password. Any nonempty password is accepted; there is no minimum length. Share it with your collaborators. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The complete contents of the downloaded JSON key file, including its braces. Paste it directly into the Vercel value field. |
| `BLOB_READ_WRITE_TOKEN` | Supplied by the connected **private** Blob store. |
| `GOOGLE_DRIVE_ROOT_ID` | Optional; the existing Figures ID is already the default. |

`DASHBOARD_PASSWORD`, `GOOGLE_SERVICE_ACCOUNT_JSON`, and `BLOB_READ_WRITE_TOKEN` are **server-only secrets**. Do not send their values in Slack, commit them, or put them in `GOOGLE_CLIENT_ID`. The build exposes only the mode, root folder ID, and personal-mode OAuth client ID. Shared mode does not need `GOOGLE_CLIENT_ID` or a Google OAuth client secret.

Keep the existing build settings: **Other**, `npm run build`, output `public`, Node **22.x**, install `npm ci`. **Redeploy after changing environment variables**, because the mode is part of the browser build as well as the API runtime.

## 4. Build once, then browse

1. Open the deployed site, enter the dashboard password, and click **Start indexing Figures**.
2. The API enqueues work and returns promptly. Background workers scan folders, save progress, and cache thumbnails. You can close the tab; opening it again shows saved status and the last complete snapshot.
3. Once the initial index finishes, every collaborator sees that same saved catalog immediately after entering the password. The HTTP-only session cookie lasts seven days, so ordinary page reloads do not require entering it again.
4. Gallery tiles request cached thumbnails when Drive provides them. Full original images stream through the authenticated backend only when opened, without delivering the Google token to viewers. Text/JSON/CSV previews are also loaded on demand. The original/download route accepts stored files up to 50 MB; larger files and Google-native documents require direct Drive access. Folder links still open Drive and require separate sharing there.
5. Click **Refresh index** to pick up new or changed results. The previous complete catalog stays visible until the new version is fully published. There is no automatic fresh scan on ordinary page load.

If the queue or Drive connection fails, work pauses/resumes from a stored checkpoint. Folder-page progress is saved as each page completes. The index banner shows connection errors immediately, including invalid service-account settings, a disabled Drive API, inaccessible folders, and rate limits. Repeated failures stop retrying and show a Resume action. Enable Drive API in the Google Cloud project that owns the service-account credentials, not only the project that owns the personal OAuth client. Check the Vercel worker logs and service-account sharing before resuming. Workers use conditional writes to avoid concurrent viewers corrupting progress. An expired pagination cursor restarts only the current folder with file-ID deduplication.

Status comes from that same durable checkpoint, so a conflicting status write cannot strand a resumed worker. Reopening an active scan watches its progress without restarting it. The private storage adapter validates checkpoint ETags at the origin and reuses unchanged data, avoiding repeated downloads of the full folder tree during polling.

## Saved research boards

In shared mode, **Research boards** appears in the sidebar. Create a named board, or use **Pin to board** on a figure/file. Experiment details have **Pin metrics to board**; CSV sources appear as tables, and images/charts use cached previews. Multiple selected figures can be pinned together from the selection tray.

- Arrange results on the dotted canvas: drag tile headers, resize their lower-right corners, pan empty space or scroll, and use zoom or **Fit content**. Arrow keys on a tile header move it; Shift + arrows resize it.
- Use **Add note** for observations. Edit the board title/description, then click **Save board**. Pinning a result saves it immediately; later layout/note edits need Save. Unsaved changes have an explicit status and a page-leave warning.
- **Copy board link** opens that same board for another collaborator after they enter the dashboard password. Layouts, titles and notes live in private Blob storage, so they survive page reloads, browser changes and server restarts. All password holders can edit; this is shared access, not individual user roles.
- Edits are not synchronized live. If another person saves first, your stale save is rejected and your draft stays intact. Reload the saved version or **Save draft as a copy** rather than overwrite their changes.
- Tiles link to indexed sources, rather than freezing another copy of the experiment. They follow the current published catalog after refresh; missing sources are labeled unavailable and the tile/layout is preserved. Expanding an image loads its original on demand. For a frozen research record, keep immutable source files in Drive.
- Each workspace supports up to 50 boards and 100 tiles per board, within bounded request/storage sizes. Removing a tile does not delete its Drive source. Boards are namespaced to the configured root folder; changing the root switches workspaces, preserving the old data.

No additional environment variable or storage service is needed beyond the shared setup above. Personal OAuth mode and Apps Script do not expose shared boards. If an index predates the boards feature, refresh it once before pinning experiment metrics so the backend has its experiment references.

## Access and lifecycle

- Anyone who knows the dashboard password can browse the indexed results, including images served using the backend account, edit shared boards, and request an index refresh. Do not use this mode for results that should be shown to only a subset of password holders.
- Change `DASHBOARD_PASSWORD` and redeploy to invalidate existing password sessions. **Sign out** clears the browser's session cookie. No Google credential is delivered to viewers.
- Old Vercel deployment URLs retain their old environment settings. Protect or remove those deployments when revoking access, rather than relying on changing only the production alias.
- The shared catalog is independent of browser storage and serverless instance memory. Its record pages are bounded so large folder trees fit Vercel's function response limit.
- This is a saved mirror. Cached figures/metadata can remain available until the index is refreshed, even if files change in Drive. Disabling access requires rotating the dashboard password or disabling the deployment; removing the service account alone does not erase already cached data.
- To return to individual Google login, set `DASHBOARD_MODE=personal` (or remove it), keep `GOOGLE_CLIENT_ID`, and redeploy. Existing private Blob data is preserved.
- The app does not delete Drive results or old cached snapshots. Review retained storage in Vercel separately if cleanup is wanted.

## Validation and limitations

Local tests exercise shared authentication, session persistence, cached collaborator access, duplicate workers, failed refreshes, queue-submission failures, snapshot publication, saved board layouts/notes, source validation and concurrent-edit protection with synthetic Drive/storage/queue implementations. Browser checks cover pinning figures/CSV/metrics, drag/resize, reload, a second collaborator, edit-conflict recovery and mobile overflow. Real service-account permissions, private Blob access, queue delivery, and production thumbnail latency require testing after these settings are configured. Do not infer live activation from a passing local build.

References: [Google service accounts](https://developers.google.com/identity/protocols/oauth2/service-account), [private Blob](https://vercel.com/docs/vercel-blob/private-storage), [consistent private reads](https://vercel.com/changelog/vercel-blob-now-supports-consistent-reads-on-private-storage), [Vercel Queues](https://vercel.com/docs/queues/quickstart).
