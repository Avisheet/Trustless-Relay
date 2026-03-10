/**
 * useMQTT Hook
 * 
 * React hook for managing MQTT connection and message transport.
 * Handles connection lifecycle, topic subscriptions, and message routing.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  connectBroker,
  subscribeInbox,
  publishPacket,
  disconnectBroker,
  DEFAULT_BROKER_URL,
  type MQTTConnection,
} from "../mqtt/mqttClient";
import { getInboxTopic } from "../mqtt/topicManager";
import { v4 as uuidv4 } from "uuid";

// ── Types ──────────────────────────────────────────────────────────────

export interface MQTTState {
  connected: boolean;
  brokerUrl: string;
  subscribedTopics: string[];
  error: string | null;
  messageCount: number;
}

export interface MQTTActions {
  connect: (brokerUrl?: string) => void;
  subscribe: (publicKeyHex: string) => void;
  publish: (receiverPublicKeyHex: string, serializedPacket: string) => void;
  disconnect: () => void;
}

export type MessageHandler = (topic: string, payload: string) => void;

// ── Hook ───────────────────────────────────────────────────────────────

export function useMQTT(
  onMessage: MessageHandler
): [MQTTState, MQTTActions] {
  const [state, setState] = useState<MQTTState>({
    connected: false,
    brokerUrl: DEFAULT_BROKER_URL,
    subscribedTopics: [],
    error: null,
    messageCount: 0,
  });

  const connectionRef = useRef<MQTTConnection | null>(null);
  const onMessageRef = useRef(onMessage);

  // Keep callback ref up to date
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  // ── Connect ──
  const connect = useCallback((brokerUrl: string = DEFAULT_BROKER_URL) => {
    if (connectionRef.current?.connected) return;

    try {
      const connection = connectBroker({
        brokerUrl,
        clientId: `wimp-${uuidv4().slice(0, 8)}`,
        onMessage: (topic, payload) => {
          setState((s) => ({ ...s, messageCount: s.messageCount + 1 }));
          onMessageRef.current(topic, payload);
        },
        onConnect: () => {
          setState((s) => ({
            ...s,
            connected: true,
            brokerUrl,
            error: null,
          }));
          console.log("[MQTT] Connected to broker:", brokerUrl);
        },
        onDisconnect: () => {
          setState((s) => ({ ...s, connected: false }));
          console.log("[MQTT] Disconnected from broker");
        },
        onError: (error) => {
          setState((s) => ({ ...s, error: error.message }));
          console.error("[MQTT] Error:", error);
        },
      });

      connectionRef.current = connection;
    } catch (err) {
      setState((s) => ({
        ...s,
        error: `Connection failed: ${(err as Error).message}`,
      }));
    }
  }, []);

  // ── Subscribe ──
  const subscribe = useCallback((publicKeyHex: string) => {
    if (!connectionRef.current) return;

    subscribeInbox(connectionRef.current, publicKeyHex);
    const topic = getInboxTopic(publicKeyHex);
    setState((s) => ({
      ...s,
      subscribedTopics: s.subscribedTopics.includes(topic)
        ? s.subscribedTopics
        : [...s.subscribedTopics, topic],
    }));
  }, []);

  // ── Publish ──
  const publish = useCallback(
    (receiverPublicKeyHex: string, serializedPacket: string) => {
      if (!connectionRef.current) {
        throw new Error("MQTT not connected");
      }
      publishPacket(connectionRef.current, receiverPublicKeyHex, serializedPacket);
    },
    []
  );

  // ── Disconnect ──
  const disconnect = useCallback(() => {
    if (connectionRef.current) {
      disconnectBroker(connectionRef.current);
      connectionRef.current = null;
    }
    setState({
      connected: false,
      brokerUrl: DEFAULT_BROKER_URL,
      subscribedTopics: [],
      error: null,
      messageCount: 0,
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (connectionRef.current) {
        disconnectBroker(connectionRef.current);
      }
    };
  }, []);

  return [state, { connect, subscribe, publish, disconnect }];
}
