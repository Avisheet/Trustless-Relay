# ⚡ Sovereign Messenger

**A hardware-anchored, end-to-end encrypted messaging prototype implementing three custom cryptographic protocols.**

> Built for hackathon demonstration — runs entirely in the browser with optional ESP32 hardware identity anchoring via WebSerial.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Protocol Stack](#protocol-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Running the Project](#running-the-project)
- [Using the Application](#using-the-application)
- [Hardware Mode (ESP32)](#hardware-mode-esp32)
- [Running Tests](#running-tests)
- [MQTT Broker Setup](#mqtt-broker-setup)
- [Technical Details](#technical-details)
- [Security Tests Included](#security-tests-included)
- [Technology Stack](#technology-stack)
- [Troubleshooting](#troubleshooting)

---

## Overview

Sovereign Messenger is a zero-trust messaging system where:

- **Identity is device-anchored** — either a physical ESP32 via WebSerial or a software-simulated device
- **Every message is signed** — PICP (Proof of Identity Communication Protocol) ensures authenticity
- **Messages are hash-chained** — TTL-Chain creates an immutable lineage, detecting tampering or reordering
- **Messages self-destruct** — configurable TTL (30 seconds to 24 hours) with automatic shredding
- **The broker is untrusted** — MQTT relay sees only opaque encrypted blobs; all verification is client-side
- **Encryption is ephemeral** — AES-256-GCM with per-message session keys; plaintext exists only in memory

---

## Protocol Stack

```
┌─────────────────────────────────────────────┐
│            Application Layer (UI)           │
├─────────────────────────────────────────────┤
│  WIMP/1 – Wallet Identity Messaging Protocol│
│  Packet structure, serialization, routing   │
├─────────────────────────────────────────────┤
│  PICP – Proof of Identity Communication     │
│  Ed25519/ECDSA-P256 packet signatures       │
├─────────────────────────────────────────────┤
│  TTL-Chain – Time Locked Lineage Chain      │
│  SHA-256 hash-linked message chain          │
├─────────────────────────────────────────────┤
│  AES-256-GCM End-to-End Encryption          │
│  Ephemeral session keys, zero-knowledge     │
├─────────────────────────────────────────────┤
│  MQTT Transport (Untrusted Relay)           │
│  mqtt.js over WebSocket (ws://localhost:9001)│
├─────────────────────────────────────────────┤
│  Identity Layer                             │
│  ESP32 Hardware (WebSerial) OR Simulator    │
│  Daily key rotation: SK = HMAC-SHA256(Seed, Day)│
└─────────────────────────────────────────────┘
```

---

## Architecture

```
  ┌──────────────────────────────────────┐
  │       IHardwareDevice Interface       │
  │  connect / disconnect / challenge     │
  │  signData / getPublicKey / serialLog  │
  └────────────┬───────────┬─────────────┘
               │           │
   ┌───────────┴──┐  ┌─────┴───────────────┐
   │ RealESP32    │  │ SimulatedESP32       │
   │ (WebSerial)  │  │ (Web Crypto API)     │
   │ Text protocol│  │ identityManager.ts   │
   └──────────────┘  └─────────────────────┘
               │           │
               ▼           ▼
   ┌──────────────────────────────────────┐
   │       useHardwareIdentity Hook        │
   │  Mode switching, nonce challenge,     │
   │  key rotation, serial log access      │
   └──────────────┬───────────────────────┘
                  │
   ┌──────────────┴───────────────────────┐
   │       useMessageLifecycle Hook        │
   │  Send: encrypt → sign → chain → MQTT │
   │  Recv: validate → verify → decrypt   │
   │  Auto-shred expired messages          │
   └──────────────┬───────────────────────┘
                  │
   ┌──────────────┴───────────────────────┐
   │          useMQTT Hook                 │
   │  MQTT over WebSocket transport        │
   │  Topic: /wimp/v1/inbox/<hash(pk)>     │
   └──────────────────────────────────────┘
```

---

## Project Structure

```
sovereign-messenger/
├── pages/
│   ├── _app.tsx                 # Next.js app wrapper
│   ├── index.tsx                # Main messenger page (3-column layout)
│   └── tests.tsx                # Browser test runner page
│
├── src/
│   ├── hardware/
│   │   ├── deviceInterface.ts   # IHardwareDevice abstraction interface
│   │   ├── esp32Interface.ts    # Legacy ESP32 JSON interface + hex/nonce helpers
│   │   ├── esp32SerialDevice.ts # Real ESP32 via WebSerial (text protocol)
│   │   ├── identityManager.ts   # Software identity, HMAC key derivation, rotation
│   │   ├── serialParser.ts      # Text-based serial protocol line parser
│   │   └── simulatedDevice.ts   # Simulated ESP32 device (Web Crypto backed)
│   │
│   ├── protocol/
│   │   ├── bufferCompat.ts      # Node 24 / TS 5.7+ ArrayBuffer compatibility shim
│   │   ├── encryption.ts        # AES-256-GCM encrypt/decrypt with ephemeral keys
│   │   ├── picpSignature.ts     # PICP Ed25519/ECDSA packet signing & verification
│   │   ├── ttlChain.ts          # SHA-256 hash-linked message chain (TTL-Chain)
│   │   └── wimpPacket.ts        # WIMP/1 packet structure, serialization, hashing
│   │
│   ├── mqtt/
│   │   ├── mqttClient.ts        # MQTT browser client (mqtt.js over WebSocket)
│   │   └── topicManager.ts      # Topic derivation: /wimp/v1/inbox/<hash(pk)>
│   │
│   ├── transport/
│   │   ├── localBus.ts          # In-browser pub/sub message bus (Demo Mode)
│   │   └── types.ts             # Shared TransportState/TransportActions types
│   │
│   ├── chat/
│   │   ├── chatReducer.ts       # Reducer-based chat state (messages, alerts, chain)
│   │   ├── messageGraph.ts      # DAG message graph
│   │   └── messageValidator.ts  # Full validation pipeline (deserialize→verify→decrypt)
│   │
│   ├── hooks/
│   │   ├── useHardwareIdentity.ts  # Identity lifecycle (device abstraction + rotation)
│   │   ├── useLocalTransport.ts    # Local in-browser transport hook (Demo Mode)
│   │   ├── useMessageLifecycle.ts  # Message send/receive/expire orchestration
│   │   └── useMQTT.ts             # MQTT connection, subscribe, publish
│   │
│   ├── ui/
│   │   ├── ChatWindow.tsx          # Message display with SIG/CHAIN/TTL indicators
│   │   ├── ContactList.tsx         # Peer list with add-contact form
│   │   ├── DebugPanel.tsx          # Protocol debug inspector (chain, packets, MQTT)
│   │   ├── HardwareConnect.tsx     # Identity mode selector (Simulator ↔ ESP32)
│   │   ├── HardwareDebugPanel.tsx  # Serial I/O log, device info, test buttons
│   │   ├── MessageComposer.tsx     # Input with TTL selector (30s – 24h)
│   │   └── SecurityStatusPanel.tsx # Real-time security dashboard (6 indicators)
│   │
│   ├── tests/
│   │   ├── protocolTests.ts     # 13 cryptographic security tests
│   │   └── mqttSimulation.ts    # Multi-client + attack simulation
│   │
│   ├── types/
│   │   └── globals.d.ts         # WebSerial API type declarations
│   │
│   └── styles/
│       └── globals.css          # Tailwind base + sovereign dark theme
│
├── mosquitto/
│   └── mosquitto.conf           # MQTT broker config (WS:9001, MQTT:1883)
│
├── package.json                 # Dependencies and scripts
├── tsconfig.json                # TypeScript configuration
├── tailwind.config.js           # Tailwind sovereign color theme
├── postcss.config.js            # PostCSS config
├── next.config.js               # Next.js config
└── README.md                    # This file
```

---

## Prerequisites

| Requirement | Version | Purpose |
|---|---|---|
| **Node.js** | v18+ (LTS recommended) | Runtime & build tooling |
| **npm** | v9+ (comes with Node) | Package management |
| **Mosquitto** *(optional)* | v2.0+ | MQTT broker — only for multi-tab real networking |
| **Chrome/Edge** | v89+ | Best experience; required for ESP32 WebSerial |

> **💡 For hackathon demo:** You only need **Node.js**. Everything else is optional. The app runs 100% in-browser with the built-in Demo Mode.

---

## Quick Start (30 seconds)

```bash
# 1. Install dependencies (one-time)
npm install

# 2. Start the dev server
npm run dev

# 3. Open in Chrome/Edge → http://localhost:3000
```

Then click the **▶ Start Demo** button on the page. That's it — you're messaging!

### Demo Walkthrough

1. **Click ▶ Start Demo** → creates a simulated identity ("alice") and auto-connects the local transport
2. A **bob** contact appears in the sidebar → click it to select
3. **Type a message** and hit Enter → the full protocol pipeline runs:
   - AES-256-GCM encryption → PICP signature → TTL-Chain linking → serialization → local delivery
4. Watch the **Security Status** panel light up green ✅
5. Open the **Debug Panel** (right sidebar) to inspect raw packets, chain state, and topics
6. Try **🎲 Challenge** to run a live nonce verification
7. Try **🔄 Rotate** to perform a key rotation (Previous Key appears)
8. Change TTL to **30s** and send — watch the message auto-shred!

### Transport Modes

| Mode | Toggle | What It Does |
|------|--------|-------------|
| **🏠 Demo** (default) | Header toggle | Local in-browser message bus — zero setup, works offline |
| **📡 MQTT** | Header toggle | Real MQTT broker via WebSocket — for multi-tab/multi-device demos |

---

## Running the Project

### Step 1: Install Dependencies

```bash
npm install
```

This installs:
- **next** (v14.2) — React framework with pages router
- **react** & **react-dom** (v18.3) — UI library
- **mqtt** (v5.5) — Browser MQTT client over WebSocket
- **uuid** (v9.0) — Unique ID generation
- **typescript** (v5.4) — Type checking
- **tailwindcss** (v3.4) — Utility-first CSS

### Step 2: Start Development Server

```bash
npm run dev
```

The dev server starts at **http://localhost:3000** with hot-reload.

### Step 3: Open the App

Open **http://localhost:3000** in **Chrome** or **Edge** (required for WebSerial support).

### Step 4: Create an Identity

1. In the **🔐 Identity** panel (top-left), select a mode:
   - **💻 Simulator** — Software-emulated device (works everywhere, no hardware needed)
   - **🔌 ESP32 Hardware** — Real ESP32 via USB/WebSerial (requires compatible firmware)
2. For Simulator mode, optionally enter a username (e.g., `alice`), then click **Start Simulator**
3. The app generates a cryptographic identity (ECDSA P-256 / Ed25519) and displays your public key
4. A nonce challenge is automatically performed to verify the identity

### Step 5: Multi-User Chat (requires MQTT broker)

To test messaging between two users:

1. [Set up Mosquitto](#mqtt-broker-setup) (see below)
2. Open **two browser tabs** at `http://localhost:3000`
3. In Tab 1: Start simulator as `alice`
4. In Tab 2: Start simulator as `bob`
5. In each tab: copy the public key from the Identity panel
6. In each tab: click **+ Add** in Contacts, paste the other tab's key, give it a label
7. Select the contact, type a message, pick a TTL, and send!
8. Watch messages appear in the other tab with ✓ SIG and ⛓ OK verification status

### Production Build

```bash
npm run build    # Type-check + build optimized bundle
npm start        # Start production server on port 3000
```

---

## Using the Application

### Main Interface (3-Column Layout)

| Column | Contents |
|---|---|
| **Left Sidebar** | 🔐 Identity panel, 👥 Contact list, 🛡️ Security status |
| **Center** | 💬 Chat window with verification badges, 📝 Message composer with TTL |
| **Right Sidebar** | 🔧 Hardware debug panel, 🐛 Protocol debug panel |

### Identity Panel Features

- **Mode Toggle**: Switch between 💻 Simulator and 🔌 ESP32 Hardware before connecting
- **Username Input**: Custom label for simulated devices (e.g., `alice`, `bob`)
- **Device Info**: Shows username, firmware version, mode, and truncated public key
- **🎲 Challenge**: Perform a nonce challenge to cryptographically verify device identity
- **🔄 Rotate**: Force a daily key rotation (generates lineage packet linking old → new key)
- **⏏ Disconnect**: Clear identity state and disconnect device

### Message Security Indicators

Each message bubble displays real-time verification status:
- **✓ SIG** (green) — Ed25519/ECDSA signature cryptographically verified
- **✗ SIG** (red) — Signature verification **failed** (possible forgery)
- **⛓ OK** (green) — Hash-chain lineage intact (parent_hash matches)
- **⛓ BREAK** (yellow) — Chain lineage broken (possible tampering/reordering)
- **⏱ Xs** — Countdown until message self-destructs (TTL remaining)

### TTL Options

When composing a message, select the time-to-live:
- 30 seconds · 1 minute · 5 minutes · 15 minutes · 1 hour · 24 hours
- Expired messages are automatically **shredded** — plaintext is zeroed from memory

### Hardware Debug Panel (🔧)

- **Serial Log**: Live TX/RX log with timestamps showing all serial communication
- **Device Info**: Username, public key, firmware version, connection mode
- **Last Challenge**: Nonce, signature, and timestamp of most recent challenge
- **Test Actions**: Manual nonce challenge and data signing test buttons
- **Auto-refresh**: Toggle live log updates (500ms polling)

### Protocol Debug Panel (🐛)

- Current public key, subscribed MQTT topics, chain state (last hash, message count)
- MQTT broker connection status and error details
- Packet inspector — click any message to see raw JSON structure with verification metadata

---

## Hardware Mode (ESP32)

### Requirements

- ESP32 dev board with USB-Serial (CP2102, CH340, etc.)
- Chrome or Edge browser (WebSerial API required)
- ESP32 firmware implementing the text-based serial protocol below

### ESP32 Text Protocol

The firmware must communicate over serial at **115200 baud** using newline-delimited text:

**Device → Browser (on connect / reset):**
```
USERNAME:alice
PUBLIC_KEY:abcdef0123456789...
FIRMWARE:1.0.0
READY
```

**Browser → Device (nonce challenge):**
```
NONCE:abcdef0123456789...
```

**Device → Browser (challenge response):**
```
SIGNATURE:abcdef0123456789...
```

**Browser → Device (sign arbitrary data):**
```
SIGN:abcdef0123456789...
```

**Device → Browser (signed data):**
```
SIGNED:abcdef0123456789...
```

**Device → Browser (error):**
```
ERROR:description of the error
```

### Connecting Hardware

1. Plug ESP32 into a USB port
2. In the Identity panel, select **🔌 ESP32 Hardware**
3. Click **Connect ESP32**
4. Browser prompts for serial port — select your ESP32
5. App waits up to 10s for handshake (USERNAME + PUBLIC_KEY + READY)
6. Nonce challenge is automatically performed and verified
7. Device info and serial log appear in the Hardware Debug panel

---

## Running Tests

### Browser Test Runner

1. Start the dev server: `npm run dev`
2. Navigate to **http://localhost:3000/tests**
3. Click **Run Protocol Tests** — runs 13 security tests
4. Click **Run MQTT Simulation** — simulates multi-client messaging (no broker needed)
5. Click **Run Attack Simulation** — simulates MitM, replay, and forgery attacks

### Console Access

Open browser DevTools console (`F12`) and run:

```javascript
await runProtocolTests()    // 13 protocol security tests
await runMQTTSimulation()   // Multi-client message exchange
await runAttackSimulation() // Attack detection tests
```

---

## MQTT Broker Setup

> **Optional** — only needed for multi-user messaging between browser tabs. Single-user mode and all protocol tests work without MQTT.

### Option A: Install Mosquitto

**Windows (winget):**
```bash
winget install EclipseFoundation.Mosquitto
```

**Windows (chocolatey):**
```bash
choco install mosquitto
```

**macOS:**
```bash
brew install mosquitto
```

**Ubuntu/Debian:**
```bash
sudo apt install mosquitto
```

### Option B: Start with project config

```bash
mosquitto -c mosquitto/mosquitto.conf -v
```

Expected output:
```
Opening websockets listen socket on port 9001.
Opening ipv4 listen socket on port 1883.
```

This starts:
- **Port 9001** — WebSocket listener (for the browser MQTT client)
- **Port 1883** — Standard MQTT listener (for tools like MQTT Explorer)
- **No authentication** — broker is an untrusted relay by design

### Option C: Docker

```bash
docker run -it --rm -p 9001:9001 -p 1883:1883 ^
  -v %cd%/mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf ^
  eclipse-mosquitto
```

### Verifying the Broker

Once running, the app auto-connects when you create an identity. Check the **🛡️ Security Status** panel — "MQTT Relay" turns green when connected.

---

## Technical Details

### Key Derivation

```
MasterSeed   = 32 random bytes (generated once per identity)
UnixDay      = floor(unix_timestamp / 86400)
SK_daily     = HMAC-SHA256(MasterSeed, UnixDay)
KeyPair      = generateKey(Ed25519) or generateKey(ECDSA P-256)
```

Key rotation is checked every 60 seconds. When the Unix day changes, a new key pair is derived and a signed lineage packet links the old public key to the new one.

### Encryption Flow

```
1. Generate random AES-256-GCM session key (32 bytes)
2. Encrypt plaintext with session key → ciphertext + 12-byte IV + auth tag
3. Derive wrapping key = SHA-256(sort(sender_pk, receiver_pk))
4. Wrap session key with AES-GCM using wrapping key + random IV
5. Payload = base64(JSON({ iv, ciphertext, ephemeralKey, authTag }))
```

Decryption reverses the process. Session keys are destroyed on message expiry.

### Message Chain (TTL-Chain)

```
[GENESIS] → hash(msg₁) → hash(msg₂) → hash(msg₃) → ...
    ↑                                        ↑
parent_hash="GENESIS"              parent_hash=hash(msg₂)
```

Each packet's `parent_hash` must equal `SHA-256(JSON.stringify(previous_packet))`. A mismatch triggers a ⛓ BREAK warning — the message is still shown but flagged.

### WIMP/1 Packet Structure

```json
{
  "protocol":    "WIMP/1",
  "sender_pk":   "abcdef0123...",
  "receiver_pk": "789abc0123...",
  "timestamp":   1710000000000,
  "parent_hash": "GENESIS",
  "expiry":      1710000300000,
  "ciphertext":  "base64_encrypted_payload...",
  "signature":   "ed25519_or_ecdsa_hex..."
}
```

### Topic Derivation

```
inbox_topic = "/wimp/v1/inbox/" + SHA-256(public_key_hex)[0:8]
```

The broker never sees raw public keys or plaintext — only opaque topics and encrypted blobs.

---

## Security Tests Included

| # | Test | What It Proves |
|---|------|----------------|
| 1 | Encryption round-trip | Encrypt → Decrypt produces original plaintext |
| 2 | Signature verification | Valid Ed25519/ECDSA signatures pass verification |
| 3 | Forgery detection | Modified signatures are **rejected** |
| 4 | Tampering detection | Modified packet content invalidates signature |
| 5 | Replay detection | Old timestamps rejected by 5-minute drift check |
| 6 | Chain verification | Correct parent hashes pass TTL-Chain validation |
| 7 | Reordering detection | Wrong parent hash triggers chain break |
| 8 | Full chain audit | End-to-end chain integrity verification |
| 9 | Broken chain audit | Missing/inserted links are detected |
| 10 | Key rotation | Lineage packet correctly signs old_pk → new_pk |
| 11 | Serialization | JSON round-trip preserves all packet fields |
| 12 | Temporal expiration | Expired packets are detected and rejected |
| 13 | Cross-identity | Wrong key pair **cannot** decrypt messages |

---

## Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14.2 + TypeScript 5.4 + React 18.3 |
| Styling | Tailwind CSS 3.4 (custom sovereign dark theme) |
| Cryptography | Web Crypto API — Ed25519, ECDSA P-256, AES-256-GCM, SHA-256, HMAC |
| Transport | mqtt.js 5.5 over WebSocket |
| Hardware | WebSerial API (Chrome/Edge) for ESP32 |
| Broker | Eclipse Mosquitto (untrusted relay) |
| Identity | HMAC-SHA256 daily key derivation with signed rotation lineage |

---

## Scripts Reference

| Command | Description |
|---|---|
| `npm run dev` | Start development server with hot-reload (http://localhost:3000) |
| `npm run build` | Production build with TypeScript type checking |
| `npm start` | Start optimized production server |
| `npm run lint` | Run ESLint checks |

---

## Troubleshooting

### App won't start / "Cannot find module"

```bash
# Full clean reinstall
Remove-Item -Recurse -Force node_modules, .next, package-lock.json
npm install
npm run dev
```

If VS Code shows red squiggles but `npm run build` passes, press **Ctrl+Shift+P** → **TypeScript: Restart TS Server**.

### ESP32 not detected / "WebSerial Not Available"

1. **Must use Chrome or Edge** — Firefox and Safari don't support WebSerial
2. **Must be localhost** — WebSerial requires HTTPS or localhost origin
3. **VS Code's built-in Simple Browser does NOT support WebSerial** — copy the URL and open in real Chrome
4. **Install USB-serial driver** — most ESP32 boards use CP2102 or CH340 chipsets:
   - CP2102: [Silicon Labs driver](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers)
   - CH340: [WCH driver](http://www.wch-ic.com/downloads/CH341SER_ZIP.html)
5. **Check Device Manager** → Ports (COM & LPT) — you should see a COM port
6. **Try a different USB cable** — some cables are charge-only (no data)
7. **Press RST** on the ESP32 after connecting — the firmware must send the handshake
8. **Fallback**: Use **💻 Simulator** mode — it exercises the same protocols without hardware

### MQTT connection fails

- MQTT is **optional** — use **🏠 Demo** mode (default) for zero-setup messaging
- For real MQTT: install Mosquitto and run `mosquitto -c mosquitto/mosquitto.conf -v`
- Check that port **9001** is not blocked by firewall
- Switch transport mode with the **🏠 Demo / 📡 MQTT** toggle in the header

### Port 3000 already in use

```powershell
# Kill whatever is using port 3000
Get-Process -Id (Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force
npm run dev
```

### Build fails with ArrayBuffer type errors (Node 24+)

The project includes `src/protocol/bufferCompat.ts` to handle Node 24's stricter `Uint8Array<ArrayBufferLike>` generics. Ensure `"skipLibCheck": true` is in `tsconfig.json` (it is by default).

---

## 🎤 Hackathon Presentation Notes

### Elevator Pitch
> "We built a messaging system where your identity lives on a hardware chip, not a server. Every message is cryptographically signed, hash-chained for tamper detection, encrypted end-to-end, and self-destructs on a timer — all running in the browser with zero trust in the transport layer."

### Key Demo Moments

1. **▶ Start Demo** → identity created with Web Crypto API (show the public key)
2. **Send a message** → open Debug Panel to show the WIMP packet structure with signature, chain hash, and encrypted payload
3. **🎲 Challenge** → live nonce-challenge-response proving identity ownership
4. **🔄 Rotate** → daily key rotation with lineage preservation
5. **30s TTL** → send a message and watch it auto-shred (Security Status shows expiration countdown)
6. **Security Tests** → navigate to `/tests` to run 13 automated cryptographic attack simulations
7. **ESP32 mode** → if hardware is available, show the WebSerial handshake and hardware-signed nonces

### What Makes This Different

| Feature | Traditional Messaging | Sovereign Messenger |
|---------|----------------------|---------------------|
| Identity | Server account | Hardware-anchored key pair |
| Signing | Trust the server | Every packet signed (PICP) |
| Ordering | Server timestamp | SHA-256 hash chain (TTL-Chain) |
| Encryption | Server-mediated | AES-256-GCM, per-message keys |
| Persistence | Forever on server | Self-destructing (30s – 24h) |
| Broker | Trusted | Untrusted relay (sees only blobs) |

---

## License

Hackathon prototype — built for demonstration purposes.
