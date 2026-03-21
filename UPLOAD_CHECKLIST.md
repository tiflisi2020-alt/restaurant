# Before you push — quick checklist

- [ ] You are logged into GitHub as **`tiflisi2020-alt`** (or another user with **Write** on `tiflisi2020-alt/restaurant`).
- [ ] Old GitHub credentials removed from **Windows Credential Manager** (so the wrong account is not used).
- [ ] You have a **Personal Access Token** with **`repo`** scope if using HTTPS.
- [ ] You ran `npm install` locally only; **`node_modules/`** is **not** committed (see `.gitignore`).
- [ ] You understand **`git push --force`** replaces the remote `main` branch.

Then run:

```powershell
cd "C:\Users\Restaurant Tiflis\restaurant-tiflis"
git push -u origin main
```

If rejected → `git push -u origin main --force` (only if you intend to replace GitHub’s `main`).
