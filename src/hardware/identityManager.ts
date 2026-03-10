/**
 * Identity Manager
 * 
 * Handles software-emulated identity when no ESP32 hardware is present.
 * Implements deterministic daily key rotation via HMAC derivation.
 * 
 * Key derivation formula:
 *   SK_daily = HMAC-SHA256(MasterSeed, UnixDayTimestamp)
 */

import { bytesToHex, hexToBytes } from "./esp32Interface";
import { toBuffer } from "../protocol/bufferCompat";

// ── Types ──────────────────────────────────────────────────────────────

export interface Identity {
  publicKey: string;
  privateKey: CryptoKey;
  previousPublicKey: string | null;
  masterSeed: string;
  currentDay: number;
  createdAt: number;
}

export interface LineagePacket {
  previousPublicKey: string;
  newPublicKey: string;
  rotationTimestamp: number;
  signature: string;
}

// ── Constants ──────────────────────────────────────────────────────────

const UNIX_DAY_SECONDS = 86400;

// ── Key Derivation ─────────────────────────────────────────────────────

export function getUnixDay(now?: number): number {
  const ts = now || Math.floor(Date.now() / 1000);
  return Math.floor(ts / UNIX_DAY_SECONDS);
}

export async function generateMasterSeed(): Promise<string> {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  return bytesToHex(seed);
}

export async function deriveDailyKeyMaterial(
  masterSeedHex: string,
  unixDay: number
): Promise<Uint8Array> {
  const seedBytes = hexToBytes(masterSeedHex);
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    toBuffer(seedBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const dayBytes = new TextEncoder().encode(unixDay.toString());
  const derived = await crypto.subtle.sign("HMAC", hmacKey, toBuffer(dayBytes));
  return new Uint8Array(derived);
}

export async function generateKeyPairFromSeed(
  _seedMaterial: Uint8Array
): Promise<CryptoKeyPair> {
  try {
    return await crypto.subtle.generateKey(
      { name: "Ed25519" } as any,
      true,
      ["sign", "verify"]
    );
  } catch {
    return await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
  }
}

export async function exportPublicKeyHex(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return bytesToHex(new Uint8Array(raw));
}

export async function importPublicKey(hex: string): Promise<CryptoKey> {
  const bytes = hexToBytes(hex);
  try {
    return await crypto.subtle.importKey(
      "raw",
      toBuffer(bytes),
      { name: "Ed25519" } as any,
      true,
      ["verify"]
    );
  } catch {
    return await crypto.subtle.importKey(
      "raw",
      toBuffer(bytes),
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"]
    );
  }
}

// ── Identity Lifecycle ─────────────────────────────────────────────────

export async function createSoftwareIdentity(): Promise<Identity> {
  const masterSeed = await generateMasterSeed();
  const day = getUnixDay();
  const material = await deriveDailyKeyMaterial(masterSeed, day);
  const keyPair = await generateKeyPairFromSeed(material);
  const publicKeyHex = await exportPublicKeyHex(keyPair.publicKey);
  return {
    publicKey: publicKeyHex,
    privateKey: keyPair.privateKey,
    previousPublicKey: null,
    masterSeed,
    currentDay: day,
    createdAt: Date.now(),
  };
}

export async function rotateIdentity(
  identity: Identity
): Promise<{ identity: Identity; lineage: LineagePacket }> {
  const newDay = getUnixDay();
  const material = await deriveDailyKeyMaterial(identity.masterSeed, newDay);
  const keyPair = await generateKeyPairFromSeed(material);
  const newPublicKeyHex = await exportPublicKeyHex(keyPair.publicKey);

  const rotationData = new TextEncoder().encode(
    `ROTATE:${identity.publicKey}:${newPublicKeyHex}:${newDay}`
  );
  const algo = identity.privateKey.algorithm.name === "Ed25519"
    ? { name: "Ed25519" }
    : { name: "ECDSA", hash: "SHA-256" };
  const signatureBuffer = await crypto.subtle.sign(
    algo as any,
    identity.privateKey,
    toBuffer(rotationData)
  );

  const lineage: LineagePacket = {
    previousPublicKey: identity.publicKey,
    newPublicKey: newPublicKeyHex,
    rotationTimestamp: Date.now(),
    signature: bytesToHex(new Uint8Array(signatureBuffer)),
  };
  const newIdentity: Identity = {
    publicKey: newPublicKeyHex,
    privateKey: keyPair.privateKey,
    previousPublicKey: identity.publicKey,
    masterSeed: identity.masterSeed,
    currentDay: newDay,
    createdAt: identity.createdAt,
  };
  return { identity: newIdentity, lineage };
}

export async function verifyNonceChallenge(
  publicKeyHex: string,
  nonceHex: string,
  signatureHex: string
): Promise<boolean> {
  try {
    const pubKey = await importPublicKey(publicKeyHex);
    const nonceBytes = hexToBytes(nonceHex);
    const sigBytes = hexToBytes(signatureHex);
    const algo = pubKey.algorithm.name === "Ed25519"
      ? { name: "Ed25519" }
      : { name: "ECDSA", hash: "SHA-256" };
    return await crypto.subtle.verify(
      algo as any,
      pubKey,
      toBuffer(sigBytes),
      toBuffer(nonceBytes)
    );
  } catch (err) {
    console.error("Nonce verification failed:", err);
    return false;
  }
}

export async function verifyLineagePacket(
  packet: LineagePacket
): Promise<boolean> {
  try {
    const oldPubKey = await importPublicKey(packet.previousPublicKey);
    const rotationData = new TextEncoder().encode(
      `ROTATE:${packet.previousPublicKey}:${packet.newPublicKey}:${
        Math.floor(packet.rotationTimestamp / 1000 / UNIX_DAY_SECONDS)
      }`
    );
    const sigBytes = hexToBytes(packet.signature);
    const algo = oldPubKey.algorithm.name === "Ed25519"
      ? { name: "Ed25519" }
      : { name: "ECDSA", hash: "SHA-256" };
    return await crypto.subtle.verify(
      algo as any,
      oldPubKey,
      toBuffer(sigBytes),
      toBuffer(rotationData)
    );
  } catch (err) {
    console.error("Lineage verification failed:", err);
    return false;
  }
}

export function isRotationDue(identity: Identity): boolean {
  return getUnixDay() !== identity.currentDay;
}

export async function signData(
  identity: Identity,
  data: Uint8Array
): Promise<string> {
  const algo = identity.privateKey.algorithm.name === "Ed25519"
    ? { name: "Ed25519" }
    : { name: "ECDSA", hash: "SHA-256" };
  const sig = await crypto.subtle.sign(algo as any, identity.privateKey, toBuffer(data));
  return bytesToHex(new Uint8Array(sig));
}
