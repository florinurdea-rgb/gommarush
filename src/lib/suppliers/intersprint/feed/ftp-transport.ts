import "server-only";
import { Writable } from "node:stream";
import { Client } from "basic-ftp";
import type { DiscoveredFile, FeedTransport } from "@/lib/suppliers/intersprint/feed/lifecycle";

// The FTP implementation of the feed transport.
//
// STATUS: NEVER EXECUTED AGAINST THE REAL SERVER. The environment this was
// written in has no route to port 21 and holds no Inter-Sprint credentials, so
// while the lifecycle above is exhaustively tested against a fake, this file's
// conversation with vsftpd is not. It is therefore READ-ONLY BY DEFAULT: a
// first run can look and fetch, but cannot move or destroy a supplier file
// until someone enables writes deliberately.
//
// CREDENTIALS COME FROM THE ENVIRONMENT AND NOWHERE ELSE. Never a constant,
// never a fixture, never a log line, never the handoff. This module is
// `server-only` so a mistaken import from a client component fails the build
// rather than shipping a password to a browser.
//
// The endpoint is PLAIN FTP (security finding 2): the password and every byte
// cross the internet in clear text. `secure: true` is honoured if the server
// ever gains FTPS, which remains the standing recommendation.

export class FtpConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FtpConfigurationError";
  }
}

export class FtpWriteRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FtpWriteRefusedError";
  }
}

export interface FtpConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  /** Passive mode is what the provisioned server expects. */
  readonly secure: boolean;
  /** The chroot-relative root holding incoming/processing/processed/failed. */
  readonly baseDirectory: string;
  readonly timeoutMs: number;
  /**
   * Whether this transport may move files. FALSE unless explicitly enabled:
   * an unverified client that can move a supplier's only copy of a file is
   * the one failure here that cannot be undone.
   */
  readonly allowWrites: boolean;
}

/** Reads FTP configuration from the environment. Values are never logged. */
export function readFtpConfig(env: NodeJS.ProcessEnv = process.env): FtpConfig {
  const host = env.INTERSPRINT_FTP_HOST?.trim();
  const user = env.INTERSPRINT_FTP_USER?.trim();
  const password = env.INTERSPRINT_FTP_PASSWORD;

  const missing = [
    !host && "INTERSPRINT_FTP_HOST",
    !user && "INTERSPRINT_FTP_USER",
    !password && "INTERSPRINT_FTP_PASSWORD",
  ].filter(Boolean);

  if (missing.length > 0) {
    // Names only. Printing a value here would put the password in a log.
    throw new FtpConfigurationError(
      `Inter-Sprint FTP is not configured: missing ${missing.join(", ")}`
    );
  }

  const port = Number(env.INTERSPRINT_FTP_PORT ?? "21");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new FtpConfigurationError(`INTERSPRINT_FTP_PORT is not a valid port: ${String(port)}`);
  }

  return {
    host: host as string,
    port,
    user: user as string,
    password: password as string,
    // Defaults to plain FTP because that is what the endpoint currently is.
    // Unrecognised values resolve to the CURRENT reality rather than silently
    // claiming a security property the server does not have.
    secure: env.INTERSPRINT_FTP_SECURE === "true",
    baseDirectory: env.INTERSPRINT_FTP_BASE_DIR?.trim() || "/",
    timeoutMs: Number(env.INTERSPRINT_FTP_TIMEOUT_MS ?? "30000"),
    // Fails closed: anything other than the exact string enables nothing.
    allowWrites: env.INTERSPRINT_FTP_ALLOW_WRITES === "true",
  };
}

function joinPath(base: string, ...parts: string[]): string {
  const segments = [base, ...parts]
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter((part) => part !== "");
  return `/${segments.join("/")}`;
}

/**
 * Rejects a filename that could escape its directory.
 *
 * The names come from a remote server we do not control. A '../' in one, fed
 * into a move, would write outside the chroot-relative tree.
 */
function assertSafeName(fileName: string): string {
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
    throw new FtpConfigurationError(`refusing an unsafe remote filename: ${JSON.stringify(fileName)}`);
  }
  return fileName;
}

export class FtpFeedTransport implements FeedTransport {
  private readonly config: FtpConfig;

  constructor(config: FtpConfig) {
    this.config = config;
  }

  /** Opens a connection, runs the operation, and always closes it. */
  private async withClient<T>(operation: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client(this.config.timeoutMs);
    // basic-ftp logs the control channel, including the USER command, when
    // verbose is on. It stays off so no credential reaches a log.
    client.ftp.verbose = false;
    try {
      await client.access({
        host: this.config.host,
        port: this.config.port,
        user: this.config.user,
        password: this.config.password,
        secure: this.config.secure,
      });
      return await operation(client);
    } finally {
      client.close();
    }
  }

  async list(directory: string): Promise<DiscoveredFile[]> {
    return this.withClient(async (client) => {
      const entries = await client.list(joinPath(this.config.baseDirectory, directory));
      return entries
        .filter((entry) => entry.isFile)
        .map((entry) => ({
          name: entry.name,
          sizeBytes: entry.size,
          modifiedAt: entry.modifiedAt ?? null,
        }));
    });
  }

  async download(directory: string, fileName: string): Promise<Buffer> {
    assertSafeName(fileName);
    return this.withClient(async (client) => {
      const chunks: Buffer[] = [];
      const sink = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback();
        },
      });
      await client.downloadTo(sink, joinPath(this.config.baseDirectory, directory, fileName));
      return Buffer.concat(chunks);
    });
  }

  async move(
    fromDirectory: string,
    fileName: string,
    toDirectory: string,
    toFileName: string
  ): Promise<void> {
    if (!this.config.allowWrites) {
      throw new FtpWriteRefusedError(
        "Inter-Sprint FTP transport is read-only. Set INTERSPRINT_FTP_ALLOW_WRITES=true to enable moving supplier files, and only once this client has been verified against the real server."
      );
    }
    assertSafeName(fileName);
    assertSafeName(toFileName);

    await this.withClient(async (client) => {
      await client.rename(
        joinPath(this.config.baseDirectory, fromDirectory, fileName),
        joinPath(this.config.baseDirectory, toDirectory, toFileName)
      );
    });
  }
}
