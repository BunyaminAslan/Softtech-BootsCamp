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
