#!/usr/bin/env node
import { _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const repoRoot = resolve(new URL("../../..", import.meta.url).pathname);
const mainEntry = join(repoRoot, "apps/desktop/out/main/index.js");
const desktopRoot = join(repoRoot, "apps/desktop");

function resolveLaunchTarget() {
  if (process.env.RALTIC_DESKTOP_APP) {
    return { executablePath: process.env.RALTIC_DESKTOP_APP, args: [] };
  }
  if (process.env.ELECTRON_EXECUTABLE_PATH) {
    return { executablePath: process.env.ELECTRON_EXECUTABLE_PATH, args: [mainEntry] };
  }
  const packaged = findPackagedApp();
  if (packaged) return { executablePath: packaged, args: [] };
  try {
    return { executablePath: require("electron"), args: [mainEntry] };
  } catch (e) {
    throw new Error(
      "Electron executable not found. Run pnpm install with Electron postinstall enabled, " +
      "run `pnpm --filter @raltic/desktop package` first, or set ELECTRON_EXECUTABLE_PATH for dev smoke / RALTIC_DESKTOP_APP for a packaged app.",
      { cause: e },
    );
  }
}

function findPackagedApp() {
  const candidates = process.platform === "darwin"
    ? [
        join(desktopRoot, "release/mac-arm64/Raltic.app/Contents/MacOS/Raltic"),
        join(desktopRoot, "release/mac/Raltic.app/Contents/MacOS/Raltic"),
        join(desktopRoot, "release/mac-x64/Raltic.app/Contents/MacOS/Raltic"),
      ]
    : process.platform === "win32"
      ? [join(desktopRoot, "release/win-unpacked/Raltic.exe")]
      : [
          join(desktopRoot, "release/linux-unpacked/raltic"),
          join(desktopRoot, "release/linux-unpacked/Raltic"),
        ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function html(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>fixture</title></head><body>${body}</body></html>`;
}

const server = createServer((req, res) => {
  if (req.url === "/desktop/launch") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html("<h1>Desktop Launch Fixture</h1>"));
    return;
  }
  if (req.url === "/s/fixture") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html("<h1>Workspace Fixture</h1>"));
    return;
  }
  if (req.url === "/api/v1/bridge/connect" && req.method === "POST") {
    res.writeHead(200, { "content-type": "application/json" });
    const { port } = server.address();
    res.end(JSON.stringify({
      wsUrl: `ws://127.0.0.1:${port}`,
      token: "desktop-smoke-token",
      userId: "usr_desktop_smoke",
      serverId: "srv_desktop_smoke",
      agents: [],
      channels: [],
    }));
    return;
  }
  if (req.url === "/api/v1/bridge/heartbeat" && req.method === "POST") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

const home = await mkdtemp(join(tmpdir(), "raltic-desktop-smoke-"));
let app;
const appLogs = [];
try {
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  const launchTarget = resolveLaunchTarget();
  app = await electron.launch({
    executablePath: launchTarget.executablePath,
    args: launchTarget.args,
    env: {
      ...process.env,
      HOME: home,
      RALTIC_WEB_URL: origin,
      RALTIC_API_URL: origin,
      RALTIC_DESKTOP_ENTRY_PATH: "/desktop/launch",
      RALTIC_DESKTOP_LAUNCH_PATH: "/desktop/launch",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
  });
  const child = app.process();
  child.stdout?.on("data", (chunk) => appLogs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => appLogs.push(String(chunk)));

  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  if (new URL(win.url()).pathname !== "/desktop/launch") {
    throw new Error(`expected /desktop/launch, got ${win.url()}`);
  }

  const hasPreload = await win.evaluate(() => typeof window.raltic?.connectBridge === "function");
  if (!hasPreload) throw new Error("window.raltic.connectBridge was not exposed");

  const connectResult = await win.evaluate(async (originArg) => {
    return window.raltic.connectBridge({
      apiKey: "ck_desktopSmokeMachineKey1234567890",
      serverId: "srv_desktop_smoke",
      serverUrl: originArg,
    });
  }, origin);
  if (!connectResult?.running || connectResult.serverId !== "srv_desktop_smoke") {
    throw new Error(`connectBridge did not start the bridge: ${JSON.stringify(connectResult)}\n${appLogs.join("").slice(-4000)}`);
  }

  const configPath = join(home, ".raltic/desktop/config.json");
  const saved = JSON.parse(await readFile(configPath, "utf8"));
  if (saved.apiKey !== "ck_desktopSmokeMachineKey1234567890" || saved.serverId !== "srv_desktop_smoke" || saved.serverUrl !== origin) {
    throw new Error(`unexpected saved config: ${JSON.stringify(saved)}`);
  }
  if (!Array.isArray(saved.keys) || saved.keys[0]?.serverId !== "srv_desktop_smoke") {
    throw new Error(`expected multi-key config entry for smoke server: ${JSON.stringify(saved)}`);
  }
  if (process.platform !== "win32") {
    const mode = (await stat(configPath)).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new Error(`config file mode must be 0600-compatible, got ${(mode).toString(8)}`);
    }
  }

  await win.goto(`${origin}/s/fixture`);
  const forbidden = await win.evaluate(async (originArg) => {
    try {
      await window.raltic.connectBridge({
        apiKey: "ck_desktopSmokeMachineKey1234567890",
        serverId: "srv_desktop_smoke",
        serverUrl: originArg,
      });
      return false;
    } catch {
      return true;
    }
  }, origin);
  if (!forbidden) throw new Error("/s/* was allowed to call connectBridge");

  console.log("desktop smoke ok");
} finally {
  await app?.close().catch(() => {});
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(home, { recursive: true, force: true });
}
