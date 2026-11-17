// What crosses the IPC boundary for the Connectors panel. Types only.
//
// The panel reports on two connectors that Claude Code uses: Wagonwheel's own (an MCP server the app
// ships) and the iCloud Mail one (which lives outside the app, in ~/.claude/connectors). It never
// reports a secret: only whether things are in place.

export type ClaudeConnectorState =
  /** Not registered with Claude Code. */
  | "not_connected"
  /** Registered, and pointing at this app. */
  | "connected"
  /** Registered, but pointing at a different copy of the app (an older install, say). */
  | "elsewhere"
  /** This is a development run, which has no stable path to register. */
  | "dev_build";

export interface ClaudeConnectorStatus {
  state: ClaudeConnectorState;
  /** When connected: Claude Code may read but not change anything. */
  readOnly: boolean;
  /** Claude Code's command-line tool was found, so the panel can connect and disconnect for you. */
  claudeFound: boolean;
  /** The command that registers this connector, for the person to copy and run themselves. */
  command: string;
  /** The same, for a connection that can read but not change anything. */
  commandReadOnly: string;
  /** When "elsewhere": the program the existing registration runs. */
  registeredProgram: string | null;
}

export interface IcloudConnectorStatus {
  /** The connector's files are on this Mac (~/.claude/connectors/icloud-mail). */
  installed: boolean;
  /** It is registered with Claude Code. */
  registered: boolean;
  /** The iCloud address it was registered for. */
  address: string | null;
  /** The app-specific password is in the Keychain. Null when the address is not known. */
  passwordStored: boolean | null;
  /** The Terminal command that stores the password (it prompts for it; it contains no secret). */
  storeCommand: string | null;
}

export interface ConnectorsStatus {
  claude: ClaudeConnectorStatus;
  icloud: IcloudConnectorStatus;
}

/** The result of asking the iCloud connector to sign in: what it printed. */
export interface IcloudCheck {
  ok: boolean;
  output: string;
}
