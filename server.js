import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
let PORT = Number(process.env.PORT);
if (!Number.isFinite(PORT) || PORT < 1 || PORT > 65535) PORT = 3000;
/** 0.0.0.0 = 127.0.0.1 + other PCs on LAN. Override with HOST=127.0.0.1 if needed. */
const HOST = (process.env.HOST && String(process.env.HOST).trim()) || "0.0.0.0";
if (process.env.PORT && String(process.env.PORT).trim() !== "" && PORT !== 3000) {
  console.warn(`Note: PORT is ${PORT} (not 3000). Use http://127.0.0.1:${PORT}/ in the browser.`);
}

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

const publicDir = path.join(__dirname, "public");
const adminLoginHtml = path.resolve(publicDir, "admin", "index.html");
const mainIndexHtml = path.resolve(publicDir, "index.html");

function sendNoCache(_req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  next();
}

function sendAdminLogin(_req, res, next) {
  res.sendFile(adminLoginHtml, (err) => (err ? next(err) : undefined));
}

function sendMainIndex(_req, res, next) {
  res.sendFile(mainIndexHtml, (err) => (err ? next(err) : undefined));
}

app.get("/admin", sendNoCache, sendAdminLogin);
app.get("/admin/", sendNoCache, sendAdminLogin);
app.get("/admin/panel", sendNoCache, sendMainIndex);
app.get("/admin/panel/", sendNoCache, sendMainIndex);

app.get("/", sendMainIndex);
app.get("/index.html", sendMainIndex);

app.use(express.static(publicDir));

app.use((_req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
});

function onListen() {
  const addr = server.address();
  const boundPort = typeof addr === "object" && addr ? addr.port : PORT;
  console.log("");
  console.log("========== Restaurant Tiflis — site server ==========");
  console.log(`Listening on ${HOST}:${boundPort}`);
  console.log(`  Site:  http://127.0.0.1:${boundPort}/`);
  console.log(`  Admin: http://127.0.0.1:${boundPort}/admin`);
  console.log(`  Check: http://127.0.0.1:${boundPort}/ping.txt  (must show: ok)`);
  console.log("Keep this window open. Press Ctrl+C to stop.");
  console.log("========================================");
  console.log("");
}

function onListenError(err) {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Close the other app using it, or in PowerShell run: $env:PORT='3001'; npm start`
    );
  } else {
    console.error(err);
  }
  process.exit(1);
}

const server = app.listen(PORT, HOST, onListen);
server.on("error", onListenError);
