# Manual installation

Open START-HERE.html in your browser for Copy buttons and detailed steps.

This package contains the complete dashboard as Code.gs, plus appsscript.json. No additional HTML files, clasp, npm, or terminal commands are needed for installation.

1. Sign in with the Google account that should own the dashboard. Confirm that this account can open the Figures folder: https://drive.google.com/drive/folders/1qXAMcNrZuqk4wlGbqZlmHydQ-cSthbIV
2. Go to https://script.google.com and create a New project named Entropy Results Dashboard.
3. Replace the default Code.gs contents with the complete Code.gs file from this package.
4. In Project Settings, enable Show appsscript.json manifest file in editor. Return to Editor and replace appsscript.json with the supplied manifest. Save. It enables the advanced Drive API v3 service.
5. Select setup in the function dropdown and click Run. Complete Google's authorization flow for your own project. This checks access to Figures, starts indexing, and installs the refresh trigger. If Drive is missing from Services, add Drive API v3 there.
6. Click Deploy > New deployment > Web app. Set Execute as to Me and Who has access to Only myself. Click Deploy and copy the Web app URL ending in /exec.
7. Open that new URL using the deploying Google account. If a scan is active, choose Resume index to continue immediately; otherwise the installed trigger continues the scan.

For multiple Google accounts, use a browser profile or private window signed in only to the intended account. Google's multi-login limitation can still affect a manually deployed app.

You can move the standalone Apps Script project within your own Drive after creating it. Use a browser bookmark or a launch document containing the new web-app URL to open the dashboard; the Apps Script project itself opens the code editor. The existing launch document still points to the previous deployment until you replace its link.

Uploading this ZIP or an HTML file to an ordinary Drive folder stores a file. Running the dashboard requires the Apps Script setup and deployment above. START-HERE.html is an installation guide, not a connected results dashboard.

Google references:
- Standalone projects: https://developers.google.com/apps-script/guides/standalone
- Web-app deployment: https://developers.google.com/apps-script/guides/web
- Advanced Drive service: https://developers.google.com/apps-script/guides/services/advanced
- Multiple-account troubleshooting: https://developers.google.com/apps-script/guides/support/troubleshooting#issues_with_multiple_google_accounts

Validation: this package is generated from the source that passed 19 automated checks and 23 browser checks using synthetic RPC responses. The bundled entry point and exact embedded HTML are checked during packaging. A live Google sign-in, Drive indexing, and real result previews still need to be verified after your manual deployment.
