/**
 * Copies public/ → docs/ for GitHub Pages (Settings → Pages → branch main, folder /docs).
 * Run: npm run sync-docs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const pub = path.join(root, "public");
const docs = path.join(root, "docs");

if (!fs.existsSync(pub)) {
  console.error("Missing public/");
  process.exit(1);
}

fs.rmSync(docs, { recursive: true, force: true });
fs.cpSync(pub, docs, { recursive: true });
fs.writeFileSync(path.join(docs, ".nojekyll"), "");

const panelDir = path.join(docs, "admin", "panel");
fs.mkdirSync(panelDir, { recursive: true });
const redirectHtml = `<!DOCTYPE html>
<html lang="ka"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ადმინ პანელი…</title>
<script>
(function () {
  var parts = location.pathname.split("/").filter(Boolean);
  var repo = parts[0] || "restaurant";
  location.replace(location.origin + "/" + repo + "/index.html?gh_panel=1");
})();
</script>
</head><body style="font-family:sans-serif;padding:2rem">იტვირთება…</body></html>
`;
fs.writeFileSync(path.join(panelDir, "index.html"), redirectHtml, "utf8");

console.log("docs/ synced from public/ (+ .nojekyll, admin/panel redirect)");
