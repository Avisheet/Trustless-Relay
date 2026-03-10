/**
 * useHardwareIdentity Hook
 * 
 * React hook for managing hardware-anchored identity.
 * Supports both real ESP32 hardware (via WebSerial) and
 * software-simulated devices through the IHardwareDevice abstraction.
 * 
 * Handles:
 * - Device mode switching (hardware ↔ simulated)
 * - Nonce challenge verification on connect
 * - Automatic daily key rotation (simulated mode)
 * - Serial log access for debugging
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type {
  IHardwareDevice,
  DeviceMode,
  DeviceInfo,
  SerialLogEntry,
  NonceChallenge,
} from "../hardware/deviceInterface";
import { RealESP32Device } from "../hardware/esp32SerialDevice";
import { SimulatedESP32Device } from "../hardware/simulatedDevice";
import {
  createSoftwareIdentity,
  rotateIdentity,
  verifyNonceChallenge,
  isRotationDue,
  type Identity,
  type LineagePacket,
} from "../hardware/identityManager";

// ── Types ──────────────────────────────────────────────────────────────

export interface HardwareIdentityState {
  identity: Identity | null;
  connected: boolean;
  mode: "hardware" | "software" | "none";
  error: string | null;
  loading: boolean;
  lastRotation: LineagePacket | null;
  deviceInfo: DeviceInfo | null;
  lastChallenge: NonceChallenge | null;
}

export interface HardwareIdentityActions {
  connectHardware: () => Promise<void>;
  initSoftwareIdentity: (username?: string) => Promise<void>;
  forceRotation: () => Promise<LineagePacket | null>;
  disconnect: () => void;
  performChallenge: () => Promise<NonceChallenge | null>;
  getSerialLog: () => SerialLogEntry[];
  clearSerialLog: () => void;
  getDevice: () => IHardwareDevice | null;
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useHardwareIdentity(): [HardwareIdentityState, HardwareIdentityActions] {
  const [state, setState] = useState<HardwareIdentityState>({
    identity: null,
    connected: false,
    mode: "none",
    error: null,
    loading: false,
    lastRotation: null,
    deviceInfo: null,
    lastChallenge: null,
  });

  const deviceRef = useRef<IHardwareDevice | null>(null);
  const rotationTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ── Hardware Connection (Real ESP32 via WebSerial) ──
  const connectHardware = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      // Disconnect existing device if any
      if (deviceRef.current?.connected) {
        await deviceRef.current.disconnect();
      }

      const device = new RealESP32Device();
      deviceRef.current = device;

      // Connect — triggers WebSerial port picker and waits for handshake
      const deviceInfo = await device.connect();

      // Perform nonce challenge to verify device identity
      const challenge = await device.performNonceChallenge();
      const valid = await verifyNonceChallenge(
        challenge.publicKey,
        challenge.nonce,
        challenge.signature
      );

      if (!valid) {
        await device.disconnect();
        throw new Error("ESP32 nonce challenge verification failed — identity not trusted");
      }

      // Create an identity wrapper for protocol compatibility
      // Hardware signing goes through the device, not local keys
      const softId = await createSoftwareIdentity();
      const identity: Identity = {
        ...softId,
        publicKey: deviceInfo.publicKey,
      };

      setState({
        identity,
        connected: true,
        mode: "hardware",
        error: null,
        loading: false,
        lastRotation: null,
        deviceInfo,
        lastChallenge: challenge,
      });
    } catch (err) {
      deviceRef.current = null;
      setState((s) => ({
        ...s,
        loading: false,
        error: `Hardware connection failed: ${(err as Error).message}`,
      }));
    }
  }, []);

  // ── Software/Simulated Identity ──
  const initSoftwareIdentity = useCallback(async (username?: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      // Disconnect existing device if any
      if (deviceRef.current?.connected) {
        await deviceRef.current.disconnect();
      }

      const device = new SimulatedESP32Device(username);
      deviceRef.current = device;

      // Connect simulated device (creates identity internally)
      const deviceInfo = await device.connect();

      // Perform nonce challenge (self-sign + self-verify for protocol exercise)
      const challenge = await device.performNonceChallenge();
      const valid = await verifyNonceChallenge(
        challenge.publicKey,
        challenge.nonce,
        challenge.signature
      );

      if (!valid) {
        console.warn("[Simulated] Self-challenge verification failed, continuing anyway");
      }

      // Use the simulated device's internal identity
      const identity = device.getIdentity()!;

      setState({
        identity,
        connected: true,
        mode: "software",
        error: null,
        loading: false,
        lastRotation: null,
        deviceInfo,
        lastChallenge: challenge,
      });
    } catch (err) {
      deviceRef.current = null;
      setState((s) => ({
        ...s,
        loading: false,
        error: `Simulated identity creation failed: ${(err as Error).message}`,
      }));
    }
  }, []);

  // ── Perform Nonce Challenge (manual / debug) ──
  const performChallenge = useCallback(async (): Promise<NonceChallenge | null> => {
    if (!deviceRef.current?.connected) return null;

    try {
      const challenge = await deviceRef.current.performNonceChallenge();
      const valid = await verifyNonceChallenge(
        challenge.publicKey,
        challenge.nonce,
        challenge.signature
      );

      setState((s) => ({
        ...s,
        lastChallenge: challenge,
        error: valid ? null : "Nonce challenge verification FAILED",
      }));

      return challenge;
    } catch (err) {
      setState((s) => ({
        ...s,
        error: `Challenge failed: ${(err as Error).message}`,
      }));
      return null;
    }
  }, []);

  // ── Key Rotation ──
  const forceRotation = useCallback(async (): Promise<LineagePacket | null> => {
    if (!state.identity) return null;

    try {
      const { identity: newIdentity, lineage } = await rotateIdentity(state.identity);
      setState((s) => ({
        ...s,
        identity: newIdentity,
        lastRotation: lineage,
        deviceInfo: s.deviceInfo
          ? { ...s.deviceInfo, publicKey: newIdentity.publicKey }
          : null,
      }));
      return lineage;
    } catch (err) {
      setState((s) => ({
        ...s,
        error: `Key rotation failed: ${(err as Error).message}`,
      }));
      return null;
    }
  }, [state.identity]);

  // ── Disconnect ──
  const disconnect = useCallback(() => {
    if (deviceRef.current) {
      deviceRef.current.disconnect().catch(console.error);
      deviceRef.current = null;
    }
    if (rotationTimerRef.current) {
      clearInterval(rotationTimerRef.current);
    }
    setState({
      identity: null,
      connected: false,
      mode: "none",
      error: null,
      loading: false,
      lastRotation: null,
      deviceInfo: null,
      lastChallenge: null,
    });
  }, []);

  // ── Serial Log Accessors ──
  const getSerialLog = useCallback((): SerialLogEntry[] => {
    return deviceRef.current?.getSerialLog() || [];
  }, []);

  const clearSerialLog = useCallback((): void => {
    deviceRef.current?.clearSerialLog();
  }, []);

  // ── Device Accessor ──
  const getDevice = useCallback((): IHardwareDevice | null => {
    return deviceRef.current;
  }, []);

  // ── Automatic Rotation Check ──
  useEffect(() => {
    if (!state.identity || !state.connected) return;

    rotationTimerRef.current = setInterval(() => {
      if (state.identity && isRotationDue(state.identity)) {
        console.log("[Identity] Daily rotation due, rotating...");
        forceRotation();
      }
    }, 60_000); // check every minute

    return () => {
      if (rotationTimerRef.current) {
        clearInterval(rotationTimerRef.current);
      }
    };
  }, [state.identity, state.connected, forceRotation]);

  return [
    state,
    {
      connectHardware,
      initSoftwareIdentity,
      forceRotation,
      disconnect,
      performChallenge,
      getSerialLog,
      clearSerialLog,
      getDevice,
    },
  ];
}
