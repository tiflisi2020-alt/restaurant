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

Or double-click `start-server.bat` (port **8844**).

Open: `http://localhost:8844/`

If an empty `web-server` folder remains in your user directory, you can delete it manually.
