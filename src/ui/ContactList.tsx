/**
 * ContactList Component — v2 with Auto-Discovery
 *
 * Three ways to add contacts (from easiest to manual):
 *
 * 1. **Discovered Peers** — Auto-detected via BroadcastChannel.
 *    Peers running the app in other tabs/windows appear automatically.
 *    Just click to add them as a contact. Zero effort.
 *
 * 2. **Invite Link** — Copy your link, share it, paste theirs.
 *    Works across devices. Like sharing a WhatsApp invite.
 *
 * 3. **Manual Add** — Paste a raw public key (fallback for power users).
 */

import React, { useState } from "react";
import type { DiscoveredPeer } from "../discovery/peerDiscovery";

// ── Types ──────────────────────────────────────────────────────────────

interface Contact {
  publicKey: string;
  label: string;
  lastSeen: number | null;
}

interface Props {
  contacts: Contact[];
  activeContact: string | null;
  onSelectContact: (publicKey: string) => void;
  onAddContact: (publicKey: string, label: string) => void;

  /** Peers discovered via BroadcastChannel / presence. */
  discoveredPeers?: DiscoveredPeer[];
  /** Shareable invite link for our identity. */
  inviteLink?: string | null;
  /** Callback when user pastes an invite link. */
  onPasteInvite?: (url: string) => boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const truncateKey = (key: string) =>
  key.length > 16 ? `${key.slice(0, 10)}…${key.slice(-6)}` : key;

const SOURCE_ICONS: Record<string, string> = {
  broadcast: "📡",
  invite: "🔗",
  mqtt: "🌐",
  manual: "⌨️",
};

// ── Component ───────────────────────────────────────────────────────────

export default function ContactList({
  contacts,
  activeContact,
  onSelectContact,
  onAddContact,
  discoveredPeers = [],
  inviteLink,
  onPasteInvite,
}: Props) {
  const [showManual, setShowManual] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  // Add from manual form
  const handleManualAdd = () => {
    if (newKey.trim() && newLabel.trim()) {
      onAddContact(newKey.trim(), newLabel.trim());
      setNewKey("");
      setNewLabel("");
      setShowManual(false);
    }
  };

  // Copy invite link
  const handleCopyInvite = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      // Fallback: select & copy
      const ta = document.createElement("textarea");
      ta.value = inviteLink;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    }
  };

  // Paste invite link
  const handlePasteInvite = () => {
    setInviteError(null);
    if (!inviteInput.trim()) return;
    if (onPasteInvite) {
      const ok = onPasteInvite(inviteInput.trim());
      if (ok) {
        setInviteInput("");
      } else {
        setInviteError("Invalid invite link");
      }
    }
  };

  // Add discovered peer as contact
  const handleAddDiscovered = (peer: DiscoveredPeer) => {
    onAddContact(peer.publicKey, peer.username);
  };

  // Filter: show only peers not already in contacts
  const newPeers = discoveredPeers.filter(
    (p) => !contacts.find((c) => c.publicKey === p.publicKey)
  );

  return (
    <div className="bg-sovereign-panel border border-sovereign-border rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-sovereign-accent uppercase tracking-wider">
          👥 Contacts
        </h2>
        <span className="text-[10px] text-sovereign-muted">
          {contacts.length} saved
        </span>
      </div>

      {/* ═══════ SECTION 1: Discovered Peers ═══════ */}
      {newPeers.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-[10px] text-sovereign-muted uppercase tracking-wider flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Discovered Nearby ({newPeers.length})
          </h3>
          {newPeers.map((peer) => (
            <button
              key={peer.publicKey}
              onClick={() => handleAddDiscovered(peer)}
              className="w-full text-left px-3 py-2 rounded text-xs transition-colors
                         bg-green-950/30 hover:bg-green-900/40 border border-green-900/30
                         group"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sovereign-text">
                  {SOURCE_ICONS[peer.source] || "📡"} {peer.username}
                </span>
                <span className="text-[10px] text-green-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  + Add
                </span>
              </div>
              <div className="font-mono text-sovereign-muted mt-0.5">
                {truncateKey(peer.publicKey)}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ═══════ SECTION 2: Saved Contacts ═══════ */}
      <div className="space-y-1">
        {contacts.length === 0 ? (
          <p className="text-xs text-sovereign-muted italic py-2">
            {newPeers.length > 0
              ? "Click a discovered peer above to add them"
              : "No contacts yet — open another tab to discover peers automatically"}
          </p>
        ) : (
          contacts.map((contact) => (
            <button
              key={contact.publicKey}
              onClick={() => onSelectContact(contact.publicKey)}
              className={`w-full text-left px-3 py-2 rounded text-xs transition-colors
                ${
                  activeContact === contact.publicKey
                    ? "bg-sovereign-accent/20 border border-sovereign-accent/30"
                    : "bg-sovereign-bg hover:bg-sovereign-border"
                }`}
            >
              <div className="font-medium text-sovereign-text">
                {contact.label}
              </div>
              <div className="font-mono text-sovereign-muted mt-0.5">
                {truncateKey(contact.publicKey)}
              </div>
            </button>
          ))
        )}
      </div>

      {/* ═══════ SECTION 3: Invite Link ═══════ */}
      <div className="border-t border-sovereign-border pt-3">
        <button
          onClick={() => setShowInvite(!showInvite)}
          className="text-xs text-sovereign-accent hover:underline flex items-center gap-1"
        >
          🔗 {showInvite ? "Hide" : "Invite Link"}
        </button>

        {showInvite && (
          <div className="mt-2 space-y-2">
            {/* Our invite link */}
            {inviteLink ? (
              <div className="space-y-1">
                <label className="text-[10px] text-sovereign-muted">Your invite link:</label>
                <div className="flex gap-1">
                  <input
                    type="text"
                    readOnly
                    value={inviteLink}
                    className="flex-1 bg-sovereign-bg border border-sovereign-border rounded px-2 py-1
                               text-[10px] text-sovereign-text font-mono truncate
                               focus:outline-none"
                  />
                  <button
                    onClick={handleCopyInvite}
                    className="px-2 py-1 bg-sovereign-accent/20 text-sovereign-accent
                               border border-sovereign-accent/30 rounded text-[10px]
                               hover:bg-sovereign-accent/30 transition-colors whitespace-nowrap"
                  >
                    {inviteCopied ? "✓ Copied" : "📋 Copy"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[10px] text-sovereign-muted italic">
                Start a session to generate your invite link
              </p>
            )}

            {/* Paste someone else's invite */}
            <div className="space-y-1">
              <label className="text-[10px] text-sovereign-muted">Paste an invite link:</label>
              <div className="flex gap-1">
                <input
                  type="text"
                  placeholder="https://...?invite=..."
                  value={inviteInput}
                  onChange={(e) => {
                    setInviteInput(e.target.value);
                    setInviteError(null);
                  }}
                  className="flex-1 bg-sovereign-bg border border-sovereign-border rounded px-2 py-1
                             text-[10px] text-sovereign-text font-mono
                             focus:outline-none focus:border-sovereign-accent"
                />
                <button
                  onClick={handlePasteInvite}
                  disabled={!inviteInput.trim()}
                  className="px-2 py-1 bg-sovereign-accent/20 text-sovereign-accent
                             border border-sovereign-accent/30 rounded text-[10px]
                             disabled:opacity-50 disabled:cursor-not-allowed
                             hover:bg-sovereign-accent/30 transition-colors"
                >
                  + Add
                </button>
              </div>
              {inviteError && (
                <p className="text-[10px] text-sovereign-danger">{inviteError}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ═══════ SECTION 4: Manual Add (collapsed) ═══════ */}
      <div className="border-t border-sovereign-border pt-3">
        <button
          onClick={() => setShowManual(!showManual)}
          className="text-xs text-sovereign-muted hover:text-sovereign-text transition-colors"
        >
          ⌨️ {showManual ? "Hide manual add" : "Manual add (advanced)"}
        </button>

        {showManual && (
          <div className="mt-2 space-y-2">
            <input
              type="text"
              placeholder="Label (e.g., Alice)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="w-full bg-sovereign-bg border border-sovereign-border rounded px-2 py-1.5
                         text-xs text-sovereign-text placeholder-sovereign-muted focus:outline-none
                         focus:border-sovereign-accent"
            />
            <textarea
              placeholder="Paste public key (hex)"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              rows={2}
              className="w-full bg-sovereign-bg border border-sovereign-border rounded px-2 py-1.5
                         text-xs text-sovereign-text placeholder-sovereign-muted focus:outline-none
                         focus:border-sovereign-accent font-mono resize-none"
            />
            <button
              onClick={handleManualAdd}
              disabled={!newKey.trim() || !newLabel.trim()}
              className="w-full px-3 py-1.5 bg-sovereign-accent/20 text-sovereign-accent
                         border border-sovereign-accent/30 rounded text-xs
                         disabled:opacity-50 disabled:cursor-not-allowed
                         hover:bg-sovereign-accent/30 transition-colors"
            >
              Add Contact
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
