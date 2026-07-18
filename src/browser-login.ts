import http from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { webBase } from "./api";

// Browser sign-in via a localhost callback. No password or key touches the terminal.

/** Open a URL in the user's default browser, best-effort (cross-platform). */
export function openBrowser(url: string): void {
  try {
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
    else if (process.platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    else spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* fall back to the URL we printed — the user can open it manually */
  }
}

const page = (title: string, sub: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:system-ui,sans-serif;background:#fff;color:#0c1512;display:grid;place-items:center;height:100vh;margin:0">` +
  `<div style="text-align:center"><div style="font-size:44px">✓</div><h2 style="margin:.4rem 0">${title}</h2>` +
  `<p style="color:#6a7872">${sub}</p></div>`;

/** Open the browser to sign in and resolve with the session token; `state` guards the callback. */
export function browserLogin(opts: { timeoutMs?: number; accountToken?: string } = {}): Promise<{ token: string }> {
  const state = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (u.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const token = u.searchParams.get("token") ?? "";
      const good = u.searchParams.get("state") === state && token.length > 0;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(good ? page("Signed in", "You can close this tab and return to your terminal.") : page("Sign-in failed", "Please try again from your terminal."));
      clearTimeout(timer);
      server.close();
      good ? resolve({ token }) : reject(new Error("sign-in did not complete"));
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("sign-in timed out — run `scode login` again"));
    }, opts.timeoutMs ?? 180_000);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const link = opts.accountToken ? `&link=${encodeURIComponent(opts.accountToken)}` : "";
      const url = `${webBase()}/cli-auth?port=${port}&state=${state}${link}`;
      process.stderr.write(`\n  Opening your browser to sign in…\n  ${url}\n\n`);
      openBrowser(url);
    });
  });
}
