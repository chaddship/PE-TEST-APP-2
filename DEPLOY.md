# Deploy on Render (fix for yesterday’s errors)

## The bug that often caused failure

The start script used to force `PORT=3847`.  
Render assigns its own port (e.g. 10000). If the app ignores it, **deploy fails** or shows “Application failed to respond.”

That is fixed. Start command must be only:

```text
node server/index.js
```

## Step-by-step (do exactly this)

### 1. Unzip on a computer
You need a folder that looks like:

```text
pe-test-app/
  package.json
  server/
  public/
  data/
  README.md
```

Not a single zip sitting in the repo root with no `package.json` at the top.

### 2. GitHub repo
- New repository
- Upload **these files at the root** of the repo (so `package.json` is visible on the first page of the repo)
- If GitHub shows `pe-test-app/pe-test-app/package.json` (double folder), Render will fail — fix by moving files up one level

### 3. Render settings
1. [https://dashboard.render.com](https://dashboard.render.com) → **New +** → **Web Service**
2. Connect the GitHub repo
3. Fill in:

| Field | Value |
|--------|--------|
| Name | pe-test-app (any name) |
| Region | Oregon (or closest) |
| Root Directory | **leave blank** (unless files are in a subfolder) |
| Runtime | **Node** |
| Build Command | `echo ok` |
| Start Command | `node server/index.js` |
| Instance type | Free |

4. Click **Create Web Service**
5. Open **Logs** — you should see: `PE Test App listening on 0.0.0.0:...`
6. When status is **Live**, open the `.onrender.com` URL in Safari

### 4. Log in
- Teacher: `teacher@school.edu` / `teacher123`
- Admin: `admin@school.edu` / `admin123`

## If it still fails — read the log line

| Log message | Fix |
|-------------|-----|
| `Cannot find module` | `package.json` not at repo root (double folder) |
| `Application exited early` | Wrong start command — use `node server/index.js` only |
| `No open HTTP ports` | App not using `process.env.PORT` — use the fixed zip |
| `404` on site | Root directory wrong on Render |
| Build failed | Set build command to `echo ok` |

## Free tier note
Render free services **spin down** after idle sleep. First open after a while can take 30–60 seconds. That is normal, not a crash.
