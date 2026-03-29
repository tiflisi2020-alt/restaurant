import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { OAuth2Client } from "google-auth-library";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const googleClientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
/** Comma-separated. Only these Google accounts may open admin after Sign-In. */
const adminGoogleEmails = (process.env.ADMIN_GOOGLE_EMAILS || "tiflisi2020@gmail.com")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const oauth2Client = new OAuth2Client();
const app = express();
let PORT = Number(process.env.PORT);
if (!Number.isFinite(PORT) || PORT < 1 || PORT > 65535) PORT = 3000;
/** 127.0.0.1 = localhost only. Set HOST=0.0.0.0 to allow other PCs on the LAN. */
const HOST = (process.env.HOST && String(process.env.HOST).trim()) || "127.0.0.1";
if (process.env.PORT && String(process.env.PORT).trim() !== "" && PORT !== 3000) {
  console.warn(`Note: PORT is ${PORT} (not 3000). Use http://127.0.0.1:${PORT}/ in the browser.`);
}

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get("/api/auth/google-config", (_req, res) => {
  res.json({
    enabled: Boolean(googleClientId),
    clientId: googleClientId || null,
  });
});

app.post("/api/auth/google", async (req, res) => {
  if (!googleClientId) {
    res.status(503).json({ ok: false, error: "Google login is not configured (set GOOGLE_CLIENT_ID)." });
    return;
  }
  const credential = req.body && typeof req.body.credential === "string" ? req.body.credential.trim() : "";
  if (!credential) {
    res.status(400).json({ ok: false, error: "Missing credential" });
    return;
  }
  try {
    const ticket = await oauth2Client.verifyIdToken({
      idToken: credential,
      audience: googleClientId,
    });
    const payload = ticket.getPayload();
    const email = (payload && payload.email && String(payload.email).trim().toLowerCase()) || "";
    if (!email) {
      res.status(403).json({ ok: false, error: "No email on Google account" });
      return;
    }
    if (payload.email_verified !== true) {
      res.status(403).json({ ok: false, error: "Google email not verified" });
      return;
    }
    if (!adminGoogleEmails.includes(email)) {
      res.status(403).json({ ok: false, error: "This Google account is not allowed for admin" });
      return;
    }
    res.json({ ok: true, email: payload.email });
  } catch (e) {
    res.status(401).json({ ok: false, error: "Invalid or expired Google sign-in" });
  }
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
  if (googleClientId) {
    console.log("  Google admin sign-in: enabled (ADMIN_GOOGLE_EMAILS / default tiflisi2020@gmail.com)");
  } else {
    console.log("  Google admin sign-in: off (set GOOGLE_CLIENT_ID to enable)");
  }
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
