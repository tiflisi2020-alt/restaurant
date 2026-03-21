# Restaurant Tiflis — website

Single project folder for the live site and admin.

## Layout

| Path | Purpose |
|------|--------|
| `server.js` | Express server |
| `public/index.html` | Main site + embedded admin |
| `public/admin/index.html` | Admin login (`/admin`) |
| `legacy-static-site/` | Old static copy (GitHub Pages); not used by the server |

## Run

```bash
npm install
npm start
```

Or double-click `start-server.bat` (port **3000**).

Open: `http://127.0.0.1:3000/`

If an empty `web-server` folder remains in your user directory, you can delete it manually.

## GitHub Pages (static preview)

GitHub Pages **does not run** `server.js`. This repo includes a **`docs/`** copy of `public/` for static hosting.

1. After changing files in **`public/`**, run: **`npm run sync-docs`** (updates `docs/`).
2. On GitHub: **Settings → Pages → Build and deployment → Branch: `main` → Folder: `/docs`** → Save.
3. Site URL: **`https://tiflisi2020-alt.github.io/restaurant/`** (may take 1–2 minutes after push).

Full booking + admin on a real server still needs **Node** (e.g. Railway, Render) or local `npm start`.

## Upload to GitHub

Remote is already set to **`https://github.com/tiflisi2020-alt/restaurant.git`**.

1. **Use an account that can push** to that repo (owner `tiflisi2020-alt`, or a collaborator with write access).
2. **Windows:** Control Panel → Credential Manager → Windows Credentials → remove any `git:https://github.com` entry so Git asks you to sign in again.
3. **Token:** [GitHub → Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens) → generate (classic) with **`repo`** scope. When `git push` asks for a password, paste the **token**, not your GitHub password.

```powershell
cd "C:\Users\Restaurant Tiflis\restaurant-tiflis"
git status
git push -u origin main
```

If Git says **updates were rejected** (remote already has different commits), and you want GitHub to match **this** folder exactly:

```powershell
git push -u origin main --force
```

That **overwrites** the `main` branch on GitHub. Use only if you accept replacing what is there.

**Note:** GitHub Pages serves static files only; it does **not** run `server.js`. For the full app online, use a Node host (Railway, Render, Fly.io, VPS, etc.).
