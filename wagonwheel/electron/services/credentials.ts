import * as fs from "node:fs";
import * as path from "node:path";
import type { ServiceProvider } from "../../shared/types.js";
import type { SecretBox } from "../github/credentials.js";

// Where the tokens that read a service's bill are kept. Same rule as the GitHub sign-in: the
// token is encrypted with the Mac's keychain (Electron's safeStorage) and written to its own
// small file, never to the workspace database, so a backup, an export or a restore can neither
// carry it away nor overwrite it. The team id is not secret and is stored as it is.

interface SavedProvider { token?: string; teamId?: string }
type Saved = Partial<Record<ServiceProvider, SavedProvider>>;

export class ServiceTokenStore {
  /** Tokens for this run, when the keychain is not available to keep them. */
  private readonly memory = new Map<ServiceProvider, string>();

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
    if (Object.keys(saved).length === 0) { fs.rmSync(this.file, { force: true }); return; }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(saved), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  canKeep(): boolean { return this.box.isAvailable(); }

  token(provider: ServiceProvider): string | null {
    const held = this.memory.get(provider);
    if (held) return held;
    const saved = this.read()[provider]?.token;
    if (!saved || !this.box.isAvailable()) return null;
    try { return this.box.decrypt(Buffer.from(saved, "base64")); } catch { return null; }   // keychain entry gone or changed
  }

  teamId(provider: ServiceProvider): string | null {
    return this.read()[provider]?.teamId || null;
  }

  has(provider: ServiceProvider): boolean { return this.token(provider) !== null; }

  save(provider: ServiceProvider, token: string, teamId: string | null): void {
    const saved = this.read();
    const entry: SavedProvider = teamId ? { teamId } : {};
    if (this.box.isAvailable()) {
      this.memory.delete(provider);
      entry.token = this.box.encrypt(token).toString("base64");
    } else {
      this.memory.set(provider, token);   // lasts until the app quits; nothing secret reaches the disk
    }
    this.write({ ...saved, [provider]: entry });
  }

  clear(provider: ServiceProvider): void {
    this.memory.delete(provider);
    const saved = this.read();
    delete saved[provider];
    this.write(saved);
  }
}
