import * as fs from "node:fs";
import * as path from "node:path";

// Where the GitHub sign-in is kept. The token is encrypted with the Mac's keychain (Electron's
// safeStorage) and written to its own small file, never to the workspace database, so a backup,
// an export or a restore can neither carry it away nor overwrite it. The Client ID is public
// and is stored as it is.

/** The part of Electron's safeStorage this needs, so tests can stand in for it. */
export interface SecretBox {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

interface Saved { clientId?: string; login?: string; token?: string }

export class CredentialStore {
  /** The token for this run, when the keychain is not available to keep it. */
  private memory: { token: string; login: string } | null = null;

  constructor(private readonly file: string, private readonly box: SecretBox) {}

  private read(): Saved {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Saved) : {};
    } catch {
      return {};   // no file yet, or one that is not ours: start empty
    }
  }

  private write(saved: Saved): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(saved), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  canKeep(): boolean { return this.box.isAvailable(); }

  clientId(): string | null { return this.read().clientId || null; }

  setClientId(clientId: string): void {
    const saved = this.read();
    // A different app means a different token: the old sign-in no longer belongs to it.
    if (saved.clientId !== clientId) { delete saved.token; delete saved.login; this.memory = null; }
    this.write({ ...saved, clientId });
  }

  token(): string | null {
    if (this.memory) return this.memory.token;
    const saved = this.read();
    if (!saved.token || !this.box.isAvailable()) return null;
    try { return this.box.decrypt(Buffer.from(saved.token, "base64")); } catch { return null; }   // keychain entry gone or changed
  }

  login(): string | null { return this.memory?.login ?? (this.token() ? this.read().login || null : null); }

  saveSignIn(token: string, login: string): void {
    const saved = this.read();
    if (this.box.isAvailable()) {
      this.memory = null;
      this.write({ ...saved, login, token: this.box.encrypt(token).toString("base64") });
    } else {
      this.memory = { token, login };   // lasts until the app quits; nothing secret reaches the disk
      delete saved.token;
      this.write({ ...saved, login });
    }
  }

  /** Forget the sign-in. The Client ID stays. */
  clear(): void {
    this.memory = null;
    const saved = this.read();
    delete saved.token;
    delete saved.login;
    if (Object.keys(saved).length) this.write(saved);
    else fs.rmSync(this.file, { force: true });
  }
}
