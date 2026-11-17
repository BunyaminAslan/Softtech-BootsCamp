// browser.js — Playwright MCP'nin (.mcp.json: --browser chromium) ihtiyaç duyduğu Chromium'un tespiti.
// Plugin tarayıcıyı kendisi indirmez (~150 MB, kullanıcı onayı gerekir); yalnızca yokluğunu bildirir.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const INSTALL_CMD = "npx playwright install chromium";

function browsersDir(env = process.env, platform = process.platform) {
  if (env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== "0") return env.PLAYWRIGHT_BROWSERS_PATH;
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "ms-playwright");
  if (platform === "darwin") return path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  return path.join(os.homedir(), ".cache", "ms-playwright");
}

function playwrightChromium(env = process.env, platform = process.platform) {
  const dir = browsersDir(env, platform);
  let installed = false;
  try {
    installed = fs.readdirSync(dir).some((d) => /^chromium/.test(d));
  } catch (_) {}
  const deps = platform === "linux" ? "; sistem kütüphaneleri eksikse: sudo npx playwright install-deps chromium" : "";
  return { dir, installed, install: INSTALL_CMD, hint: `${INSTALL_CMD} (sudo gerekmez)${deps}` };
}

module.exports = { browsersDir, playwrightChromium, INSTALL_CMD };

// Playwright MCP'nin kendi playwright-core'unun istediği Chromium revizyonu (npx önbelleğinden).
// Kurulu Chromium başka revizyondaysa MCP başlar ama tarayıcı açılamaz (canlı test F9, 0.11.5).
// Dönüş: null (paket önbellekte yok) | { revision, dir, installed, install }
function mcpChromium(mcpVersion, env = process.env, platform = process.platform) {
  const cache = env.npm_config_cache || (platform === "win32"
    ? path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "npm-cache")
    : path.join(os.homedir(), ".npm"));
  let entries = [];
  try { entries = fs.readdirSync(path.join(cache, "_npx")); } catch (_) { return null; }
  for (const e of entries) {
    const nm = path.join(cache, "_npx", e, "node_modules");
    try {
      const v = JSON.parse(fs.readFileSync(path.join(nm, "@playwright", "mcp", "package.json"), "utf8")).version;
      if (mcpVersion && v !== mcpVersion) continue;
      const core = path.join(nm, "playwright-core");
      const b = JSON.parse(fs.readFileSync(path.join(core, "browsers.json"), "utf8")).browsers.find((x) => x.name === "chromium");
      if (!b) continue;
      const dir = path.join(browsersDir(env, platform), "chromium-" + b.revision);
      return { revision: b.revision, dir, installed: fs.existsSync(dir), install: `node "${path.join(core, "cli.js")}" install chromium` };
    } catch (_) { /* bu girdi MCP değil */ }
  }
  return null;
}
module.exports.mcpChromium = mcpChromium;
