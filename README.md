# Cloudpeek

**A fast, friendly desktop browser for Amazon S3, Cloudflare R2 and Cloudflare D1** — in the spirit of Cyberduck.
Open any bucket, play videos, preview images, upload and download files, rename and move things around, and copy CDN links in one click. Each person enters their **own** keys in the app; nothing is shared and nothing is sent anywhere except to your own storage provider.

[![Latest release](https://img.shields.io/github/v/release/FahadBinAbdullah7/storage-browser?label=latest)](https://github.com/FahadBinAbdullah7/storage-browser/releases/latest)

---

## Install

| I use | Download (always the newest version) |
| --- | --- |
| **Windows** | [Cloudpeek-Windows-Setup.exe](https://github.com/FahadBinAbdullah7/storage-browser/releases/latest/download/Cloudpeek-Windows-Setup.exe) |
| **Mac, Apple Silicon** (M1, M2, M3, M4) | [Cloudpeek-Mac-arm64.dmg](https://github.com/FahadBinAbdullah7/storage-browser/releases/latest/download/Cloudpeek-Mac-arm64.dmg) |
| **Mac, Intel** | [Cloudpeek-Mac-x64.dmg](https://github.com/FahadBinAbdullah7/storage-browser/releases/latest/download/Cloudpeek-Mac-x64.dmg) |

All versions and release notes: <https://github.com/FahadBinAbdullah7/storage-browser/releases>

Not sure which Mac you have? Apple menu → **About This Mac**. If it says *Chip: Apple M…* pick **arm64**; if it says *Processor: Intel…* pick **x64**.

> **Download not starting in your browser?** Open the [release page](https://github.com/FahadBinAbdullah7/storage-browser/releases/latest) and click the file under *Assets*, or use Terminal:
> `curl -L -o ~/Downloads/Cloudpeek.dmg https://github.com/FahadBinAbdullah7/storage-browser/releases/latest/download/Cloudpeek-Mac-arm64.dmg`
> The files are about 130 MB, so the download can take a minute.

### First launch (one-time warning)

The app is **unsigned**, so your system blocks it the first time. This is expected.

**Windows**
1. Run `Cloudpeek-Windows-Setup.exe`.
2. On the blue "Windows protected your PC" screen click **More info → Run anyway**.

**Mac** — newer macOS versions often show *"Cloudpeek is damaged and can't be opened"* or *"cannot be verified"* and may not offer an **Open Anyway** button. Use this exact method, it always works:

1. Open the downloaded `.dmg` and drag **Cloudpeek** into **Applications**.
2. Open **Terminal** (press `⌘ + Space`, type `Terminal`, press Enter).
3. Paste this line and press Enter:
   ```bash
   xattr -cr /Applications/Cloudpeek.app
   ```
4. Open **Cloudpeek** from Applications as normal. You only do this once.

(That command removes the "downloaded from the internet" flag macOS puts on the file. It does nothing else.)

**Or install everything from Terminal in one go** (no warning at all, because the file never gets the flag).
Apple Silicon (M1–M4):
```bash
curl -L -o ~/Downloads/Cloudpeek.dmg https://github.com/FahadBinAbdullah7/storage-browser/releases/latest/download/Cloudpeek-Mac-arm64.dmg
hdiutil attach ~/Downloads/Cloudpeek.dmg -nobrowse -quiet
cp -R /Volumes/Cloudpeek*/Cloudpeek.app /Applications/
hdiutil detach /Volumes/Cloudpeek* -quiet
xattr -cr /Applications/Cloudpeek.app
open /Applications/Cloudpeek.app
```
Intel: same commands, but use `Cloudpeek-Mac-x64.dmg` in the first line.

*If you do see the button:* try opening the app once, then go to **System Settings → Privacy & Security**, scroll to the bottom and click **Open Anyway** (it only appears for about an hour after a blocked attempt).

### Updating

When a new version is out, a banner appears at the top of the app. Click **Update now**, then **Restart**. Nothing downloads or installs without your click.

> Unsigned Mac builds sometimes can't replace themselves. If the update fails, the banner offers **Download manually** — just install the newest DMG over the old app.

---

## Connect to your storage

Click **＋** in the sidebar (or one of the cards on the welcome screen), pick a type, fill in the fields, press **Test**, then **Save**.

### Cloudflare R2

| Field | Where to find it |
| --- | --- |
| **Account ID** | Cloudflare dashboard → **R2** → right-hand panel, or the dashboard URL |
| **Access Key ID** / **Secret Access Key** | R2 → **Manage API tokens** → **Create API token** (Object Read & Write). The secret is shown only once. |
| **Bucket** *(optional)* | Only needed for tokens scoped to a single bucket (they can't list all buckets) |
| **CDN / public domain** *(optional)* | Your public domain for the bucket, e.g. `https://cdn.example.com` |

Docs: [R2 API tokens](https://developers.cloudflare.com/r2/api/tokens/) · [R2 public buckets & custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/)

### Amazon S3 (and S3-compatible)

| Field | Notes |
| --- | --- |
| **Access Key ID** / **Secret Access Key** | From an IAM user — see [managing access keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html) |
| **Region** | e.g. `us-east-1` |
| **Custom endpoint** *(optional)* | For MinIO, Wasabi, Backblaze B2 and other S3-compatible services |
| **Bucket** *(optional)* | If your key isn't allowed to list buckets |
| **CDN / public domain** *(optional)* | e.g. your CloudFront domain |

### Cloudflare D1 (databases)

D1 does not use R2/S3 keys. You need:

- **Account ID** (same as above)
- **API token** with **D1: Read** (or **Edit** to run write queries) — create one at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)

Docs: [D1 overview](https://developers.cloudflare.com/d1/) · [D1 REST API](https://developers.cloudflare.com/api/resources/d1/)

---

## What you can do

**Files and folders**
- Browse buckets and folders with breadcrumbs, **list or grid view**, sorting, and a live filter
- **Thumbnails** for images and videos in grid view
- **Preview and play** video, audio, images, PDFs and text files; use ← → to move through a folder; Esc to close
- **Upload** files or whole folders (button or drag and drop) with progress bars
- **Download** files or entire folders
- **New folder, rename, duplicate, and delete files** — for safety, **folders and buckets can never be deleted** from Cloudpeek
- **Cut / copy / paste** and **drag onto a folder** to move
- **Deep search** (on by default): type 2+ letters to find **folders and files** at any depth under the current folder
- **Searchable bucket list** to find a bucket fast, and **create new buckets** (buckets cannot be deleted)

**Links and sharing**
- **Copy link** gives your permanent **CDN link** (`https://cdn.example.com/folder/file.mp4`) in one click when a CDN domain is set
- **Signed link** with 1 hour / 1 day / 7 day expiry for private files
- Copy **S3 URI** (`s3://bucket/key`), copy **path**, **Open in browser**

**Inspect and tune**
- **Info panel** (Ctrl/⌘+I): size, modified, ETag, storage class, folder totals
- Edit **Content-Type** and **Cache-Control** with one-click presets

**D1**
- Pick a database, browse tables with paging, run SQL (Ctrl/⌘+Enter), **export results to CSV**

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Double-click / Enter | Open folder or preview file |
| Backspace | Go up one folder |
| Delete | Delete selected files (folders are protected) |
| Ctrl/⌘ + A | Select all |
| Ctrl/⌘ + C / X / V | Copy / cut / paste |
| Ctrl/⌘ + D | Duplicate |
| Ctrl/⌘ + I | Toggle info panel |
| Ctrl/⌘ + F | Focus the filter box |
| Esc | Clear selection / close dialogs |
| Shift-click, Ctrl/⌘-click | Select a range / add to selection |

Right-click any item for the full menu.

---

## Privacy and security

- Keys are stored **only on your computer**, encrypted with the operating system keychain (macOS Keychain / Windows DPAPI) via Electron's `safeStorage`.
- Secrets never reach the app's interface layer — it only knows whether a secret exists.
- All requests go **directly from your computer** to Amazon S3 / Cloudflare. There is no Cloudpeek server.
- Use the least-privileged keys you can (for example, a token limited to one bucket).

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| *Access Denied* when listing buckets | Your key may be scoped to one bucket. Enter the bucket name in the connection's **Bucket** field. |
| R2 connection fails | Check the Account ID, and that the key is an **R2 API token** (not a Cloudflare Global API key). |
| Videos won't play | Some formats (e.g. `.mkv`, some `.mov`) aren't supported by the built-in player. Use MP4 (H.264) or WebM, or download the file. |
| Copied link says "Access Denied" | The bucket isn't public. Enable a public domain on the bucket, or use **Signed link**. |
| Copied link uses the wrong domain | Click the 🌐 domain button in the toolbar to change it for this bucket. |
| Mac says the app is damaged / can't be opened | Run `xattr -cr /Applications/Cloudpeek.app` in Terminal, then open it again (see *First launch* above). |
| Update failed | Click **Download manually** in the banner and install the latest build. |

---

## For developers

Built with [Electron](https://www.electronjs.org/), [React](https://react.dev/), [Vite](https://vite.dev/), the [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/) and [electron-updater](https://www.electron.build/auto-update).

```bash
git clone https://github.com/FahadBinAbdullah7/storage-browser.git
cd storage-browser
npm install
node node_modules/electron/install.js   # only if Electron's binary didn't download
npm run dev                              # hot-reloading dev app
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Start Vite and Electron together |
| `npm run build` | Type-check and build the UI into `dist/` |
| `npm run dist:mac` | Build macOS installers (arm64 + x64) into `release/` |
| `npm run dist:win` | Build the Windows installer into `release/` |
| `npm run release` | Build and publish to GitHub Releases (needs `GH_TOKEN`) |

### Project layout

```
electron/   main process: IPC, S3/R2 client, D1 client, encrypted store, updater
src/        React UI (components, styles, types)
```

### Publishing a release

1. Bump `version` in `package.json` (e.g. `1.0.1`).
2. Create a GitHub token with `repo` scope and export it: `export GH_TOKEN=...`
3. Run `npm run release` on each OS you ship (macOS builds both Mac installers; Windows builds the `.exe`).
4. Review the draft on the [Releases page](https://github.com/FahadBinAbdullah7/storage-browser/releases) and publish it.

Installed apps pick up the new version from the release's `latest.yml` / `latest-mac.yml` files and show the **Update now** banner. File names carry no version number, so the "latest" download links above never change.

---

## Feedback

Found a bug or want a feature? Open an issue: <https://github.com/FahadBinAbdullah7/storage-browser/issues>
