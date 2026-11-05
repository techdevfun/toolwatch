import { createHash } from "node:crypto";

/** sha256 hex of a string or buffer. */
export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** sha256 of several parts joined with a newline (order matters). */
export function sha256Parts(parts: string[]): string {
  return sha256(parts.join("\n"));
}
