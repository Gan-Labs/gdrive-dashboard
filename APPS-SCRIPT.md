# Original Apps Script deployment

A standalone Google Apps Script web app for the project's **Figures** folder. The deployed app and its catalog run in your Google account. This folder contains the development source and tools; the research files stay in Drive.

## Current state

Implementation is complete locally. All 19 backend/contract tests and 23 browser UI checks passed, and clasp 3.4.1 is installed. Version 1 was deployed and its cloud source was verified. The browser checks used synthetic RPC responses; the deployed page currently shows a Google access error for the user, so live authorization, Drive indexing, and real previews remain unverified.

## Manual browser installation

Open [manual-upload/START-HERE.html](manual-upload/START-HERE.html) in your browser for Copy buttons and step-by-step instructions. A compact ZIP is also available at [entropy-results-dashboard-manual.zip](entropy-results-dashboard-manual.zip).

The manual package bundles the complete dashboard into **Code.gs**, with **appsscript.json** as the second file. Create a new standalone project using the Google account that should own the dashboard, paste the two files, run `setup`, and deploy from the Apps Script editor. The guide describes the exact settings and how to verify account access to Figures. Uploading the ZIP to an ordinary Drive folder stores the files; the running app is created by the Apps Script deployment steps.

The existing launch document still points to the earlier deployment. After manual deployment, replace its link with the new web-app URL. The earlier deployment is preserved.

Regenerate the manual package after source edits with `node scripts/package-manual.cjs` (Node 20+ and Python 3).

## Install and deploy

In **Mac Terminal**, run:

```zsh
cd "/Users/havenville/Library/CloudStorage/SynologyDrive-Light/1-Research/repos/entropy-results-dashboard"
./setup-and-deploy.command
```

The launcher:

1. Uses an existing Node.js 20+ installation.
2. Checks source syntax and runs the automated tests.
3. Runs the browser interface checks using the existing test browser and Playwright installation. The UI checks use synthetic RPC responses, so these do not verify live Drive image loading.
4. Installs clasp 3.4.1 under `.tools/` and keeps npm's download cache under `.cache/npm/`.
5. Opens Google sign-in. Choose the account that can access Figures. The login token is saved outside this synced project, at `~/.config/entropy-results-dashboard/.clasprc.json`, with restrictive permissions.
6. Creates a standalone project in My Drive, uploads the source, checks cloud source readback, and deploys a version with **Only myself** access. Later runs reuse the same project and deployment.
7. Reads the deployed version and web-app entry point back from Google, saves `deployment.json`, and opens the returned dashboard URL.

If Google reports that Apps Script API access is disabled, enable **Google Apps Script API** at <https://script.google.com/home/usersettings> using the same account, then rerun the launcher. No copy/paste of credentials is required.

On first visit, authorize the app's Drive access, then choose **Start indexing Figures**. Choose **Enable automatic refresh** to install the five-minute continuation trigger; a new full catalog is started about every six hours. Indexing also proceeds while the dashboard is open. For editor-based authorization, open the created Apps Script project, select `setup`, and click Run once.

Success prints `DEPLOYED AND SOURCE VERIFIED` and the actual URL returned by Google. This confirms deployment and source readback. It does not substitute for checking live previews and interactions after signing in.

## Features

- Collections matching the existing experiment groups.
- Search by filename, path, experiment, dataset, model, class, bitrate, and GOP.
- Lazy figure thumbnails and full-size previews, with Drive links when previews are unavailable.
- Comparison of two to four figures, favorites stored in browser preferences, keyboard navigation, and responsive layouts.
- Experiment details with metrics explicitly labeled by split and block, including links to their source files.
- Inline JSON, text, and bounded CSV previews. Large CSVs and model checkpoints remain links to Drive.
- A durable catalog and resumable index. Readers keep the last complete snapshot while a refresh runs.
- Private app data in a new My Drive folder. No writes to the research results.

## Files and storage

| Path | Purpose |
| --- | --- |
| `src/` | Source uploaded to Apps Script: server, catalog transformations, HTML, CSS, client, manifest. |
| `scripts/` | Local checking, testing, authentication wrapper, and deployment helpers. |
| `tests/` | Automated tests with synthetic fixtures; no experiment files. |
| `.tools/` | Local clasp installation; created on setup and ignored by source upload. |
| `.cache/` | npm cache and project-creation recovery marker. |
| `.clasp.json` | Cloud project ID and upload configuration. |
| `deployment.json` | Last deployment ID, Google-returned URL, version, and source verification status. |
| `test-artifacts/` | Local UI test screenshots and report. The screenshots show synthetic test data. |

Only `src/` is uploaded. Credentials, tests, tools, logs, and browser test data are excluded. The code has no application package dependencies; clasp is a development tool. Allow roughly 1 GB for tools and caches, although the source is much smaller. The launcher reuses the existing Node and browser.

After deployment, the local copy can be removed without stopping the hosted app. Future editing can use the browser editor, or the project can be downloaded again with clasp. Preserve access to the Google account that owns the script.

## Checks

```zsh
node scripts/check.cjs
node --test tests/*.test.cjs
node scripts/browser-qa.cjs
```

Use Node 20+ for these commands. Browser checks require a locally installed compatible Chrome and Playwright; the helper discovers the existing installations on this Mac. `ENTROPY_CHROME` and `ENTROPY_PLAYWRIGHT_PATH` can specify other installations.

The backend tests cover path classification, metric split attribution, zero values, pagination, continuation after errors, stable snapshots, duplicate IDs, lock contention, malformed sidecars, moved files, large files, and safe previews. Live Google authorization, advanced Drive service behavior, production latency, and full-resolution image rendering require a deployed app and signed-in browser.

## Updating

Rerun `./setup-and-deploy.command` after editing. The helper updates the existing deployment URL and verifies the deployed source. `src/appsscript.json` fixes owner-only access. The helper refuses unexpected upload file sets or a readback that does not confirm private access.

Do not edit in the browser and then push an older local copy: pushing replaces the cloud source. Pull browser edits first if you choose to mix editing workflows.

## Configuration

`src/Server.gs` contains the verified Figures folder ID, batch size, inline preview limits, and refresh interval. `src/Core.gs` recognizes the current folder naming conventions and JSON summary schemas. Other files remain searchable and available through Drive links even when their metrics schema is not recognized.
