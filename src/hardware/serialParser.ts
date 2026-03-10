/**
 * Serial Text Protocol Parser
 * 
 * Parses the text-based protocol used by ESP32 firmware.
 * 
 * Protocol format (text lines, newline-delimited):
 * 
 * Device → Browser (on startup / connect):
 *   USERNAME:alice
 *   PUBLIC_KEY:abcdef0123456789...
 *   FIRMWARE:1.0.0                    (optional)
 *   READY
 * 
 * Browser → Device:
 *   NONCE:abcdef0123456789...
 *   SIGN:abcdef0123456789...
 *   PING
 * 
 * Device → Browser (responses):
 *   SIGNATURE:abcdef0123456789...
 *   SIGNED:abcdef0123456789...
 *   PONG
 *   ERROR:description
 */

// ── Types ──────────────────────────────────────────────────────────────

export type SerialMessageType =
  | "USERNAME"
  | "PUBLIC_KEY"
  | "FIRMWARE"
  | "READY"
  | "NONCE"
  | "SIGN"
  | "PING"
  | "SIGNATURE"
  | "SIGNED"
  | "PONG"
  | "ERROR"
  | "UNKNOWN";

export interface ParsedSerialMessage {
  type: SerialMessageType;
  value: string;
  raw: string;
}

export interface DeviceHandshake {
  username: string;
  publicKey: string;
  firmwareVersion?: string;
}

// ── Parser ─────────────────────────────────────────────────────────────

/**
 * Parse a single line of the serial text protocol.
 * Lines are formatted as "TYPE:value" or just "TYPE" for no-value commands.
 */
export function parseSerialLine(line: string): ParsedSerialMessage {
  const trimmed = line.trim();
  if (!trimmed) {
    return { type: "UNKNOWN", value: "", raw: line };
  }

  const colonIndex = trimmed.indexOf(":");
  if (colonIndex === -1) {
    // No-value commands: READY, PING, PONG
    const cmd = trimmed.toUpperCase();
    if (cmd === "READY" || cmd === "PING" || cmd === "PONG") {
      return { type: cmd as SerialMessageType, value: "", raw: line };
    }
    return { type: "UNKNOWN", value: trimmed, raw: line };
  }

  const prefix = trimmed.substring(0, colonIndex).toUpperCase();
  const value = trimmed.substring(colonIndex + 1);

  const knownTypes: SerialMessageType[] = [
    "USERNAME", "PUBLIC_KEY", "FIRMWARE", "NONCE",
    "SIGN", "SIGNATURE", "SIGNED", "ERROR",
  ];

  if (knownTypes.includes(prefix as SerialMessageType)) {
    return { type: prefix as SerialMessageType, value, raw: line };
  }

  return { type: "UNKNOWN", value: trimmed, raw: line };
}

/**
 * Validate that a hex string is well-formed.
 */
export function isValidHex(hex: string): boolean {
  return /^[0-9a-fA-F]*$/.test(hex) && hex.length % 2 === 0 && hex.length > 0;
}

/**
 * Parse a complete device handshake from accumulated lines.
 * Expects at least USERNAME and PUBLIC_KEY lines, plus READY.
 * Returns null if the handshake is incomplete.
 */
export function parseHandshake(lines: ParsedSerialMessage[]): DeviceHandshake | null {
  let username: string | null = null;
  let publicKey: string | null = null;
  let firmwareVersion: string | undefined;
  let ready = false;

  for (const msg of lines) {
    switch (msg.type) {
      case "USERNAME":
        username = msg.value;
        break;
      case "PUBLIC_KEY":
        if (isValidHex(msg.value)) {
          publicKey = msg.value;
        }
        break;
      case "FIRMWARE":
        firmwareVersion = msg.value;
        break;
      case "READY":
        ready = true;
        break;
    }
  }

  if (!username || !publicKey || !ready) {
    return null;
  }

  return { username, publicKey, firmwareVersion };
}

// ── Line Accumulator ───────────────────────────────────────────────────

/**
 * SerialLineAccumulator
 * 
 * Buffers incoming serial data and emits complete newline-delimited lines.
 * Handles partial reads from the serial stream.
 */
export class SerialLineAccumulator {
  private buffer = "";

  /**
   * Feed raw data from the serial stream.
   * Returns an array of complete lines (without newlines).
   */
  feed(data: string): string[] {
    this.buffer += data;
    const lines: string[] = [];
    let nlIndex: number;

    while ((nlIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.substring(0, nlIndex).replace(/\r$/, "");
      this.buffer = this.buffer.substring(nlIndex + 1);
      if (line.length > 0) {
        lines.push(line);
      }
    }

    return lines;
  }

  /** Clear the internal buffer */
  reset(): void {
    this.buffer = "";
  }

  /** Get the current partial buffer contents (for debugging) */
  getPartial(): string {
    return this.buffer;
  }
}
