import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes, createCipheriv, createDecipheriv, hkdfSync, createHmac } from "node:crypto";

// Local account state under ~/.scode, AES-256-GCM encrypted at rest, keyed by an HKDF subkey of a
// per-install random master key (~/.scode/key, mode 0600).

export function scodeDir(): string {
  return process.env.SCODE_HOME || join(homedir(), ".scode");
}
function keyPath(): string {
  return join(scodeDir(), "key");
}
function credPath(): string {
  return join(scodeDir(), "credential.enc");
}
function sessionPath(): string {
  return join(scodeDir(), "session.enc");
}
export function configFile(): string {
  return join(scodeDir(), "config.json");
}

function master(): Buffer {
  mkdirSync(scodeDir(), { recursive: true });
  if (!existsSync(keyPath())) {
    writeFileSync(keyPath(), randomBytes(32));
    try {
      chmodSync(keyPath(), 0o600);
    } catch {
      /* windows */
    }
  }
  return readFileSync(keyPath());
}
function subkey(info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master(), Buffer.alloc(0), info, 32));
}

// AES-256-GCM encrypt/decrypt a token to a file, keyed by an HKDF subkey (info).
function encTo(path: string, info: string, token: string): void {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", subkey(info), iv);
  const ct = Buffer.concat([c.update(token, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  mkdirSync(scodeDir(), { recursive: true });
  writeFileSync(path, JSON.stringify({ iv: iv.toString("base64"), ct: ct.toString("base64"), tag: tag.toString("base64") }));
  try {
    chmodSync(path, 0o600);
  } catch {
    /* windows */
  }
}
function decFrom(path: string, info: string): string | null {
  try {
    const { iv, ct, tag } = JSON.parse(readFileSync(path, "utf8"));
    const d = createDecipheriv("aes-256-gcm", subkey(info), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function saveCredential(token: string): void {
  encTo(credPath(), "enc", token);
}
export function readCredential(): string | null {
  return decFrom(credPath(), "enc");
}
export function hasCredential(): boolean {
  return existsSync(credPath());
}
export function clearCredential(): void {
  rmSync(credPath(), { force: true });
}

export function saveSession(token: string): void {
  encTo(sessionPath(), "session-enc", token);
}
export function readSession(): string | null {
  return decFrom(sessionPath(), "session-enc");
}
export function hasSession(): boolean {
  return existsSync(sessionPath());
}
export function clearSession(): void {
  rmSync(sessionPath(), { force: true });
}

/** HMAC keyed to this install — used to detect out-of-band edits to managed state. */
export function installHmac(data: string): string {
  return createHmac("sha256", subkey("mac")).update(data).digest("base64url");
}

export function readConfig(): { apiBase?: string } {
  try {
    return JSON.parse(readFileSync(configFile(), "utf8")) as { apiBase?: string };
  } catch {
    return {};
  }
}
export function writeConfig(c: { apiBase?: string }): void {
  mkdirSync(scodeDir(), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(c, null, 2) + "\n");
}

export const isValidEvmAddress = (a: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(a);
export const shortAddr = (a: string): string => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
export const maskToken = (t: string): string => (t.length > 13 ? `${t.slice(0, 9)}…${t.slice(-4)}` : t);
