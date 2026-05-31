# ΦΑΡΟΣ (Faros) — Offline Bluetooth Mesh Chat

> Επικοινωνία χωρίς δίκτυο. Όταν όλα τα άλλα πέφτουν.
>
> Offline, serverless, end-to-end encrypted group chat over a Bluetooth LE mesh.
> No accounts, no phone numbers, no internet. Built for everyday use *and* for
> disasters (earthquakes, floods, fires) when cellular networks collapse.

This is a complete React Native + TypeScript codebase. It runs **immediately in
MOCK mode** on any simulator (simulated neighbourhood), and turns into a real
Bluetooth mesh once you do a native build on physical devices.

---

## How it works

Every phone plays **both** Bluetooth roles at once:

| Role | Library | Job |
|------|---------|-----|
| **Central** | `react-native-ble-plx` | scan for nodes, connect, write frames, subscribe to notifies |
| **Peripheral** | custom native module (`FarosBle`) | advertise the service, run a GATT server, notify frames, receive writes |

Messages **flood** through the network: a frame received from any neighbour is
re-broadcast to all others, with a **TTL hop counter** and a **duplicate cache**
so packets die out instead of looping. That is what lets a message from someone
3 hops away still reach you.

```
   You ──BLE──► ELENI ──BLE──► MARIA ──BLE──► (you can't reach MARIA directly,
                                                but the message hops via ELENI)
```

### Layers (all in `src/`)

```
crypto/identity.ts   X25519 keypair = your identity (generated on first launch)
crypto/cipher.ts     nacl.box E2E for DMs; signed payloads for public channels
location/geo.ts      GPS fix for SOS (works offline — satellite, not cellular)
mesh/protocol.ts     compact binary wire format (encode/decode)
mesh/fragment.ts     splits packets across tiny BLE frames + reassembles
mesh/Outbox.ts       store-and-forward: re-floods un-acked msgs when peers appear
mesh/MeshNode.ts     the engine: flood + TTL + dedup + relay + ack + SOS + outbox
mesh/transport.ts    pluggable link-layer interface
mesh/MockTransport   runs the whole engine with zero hardware
ble/BleTransport.ts  real BLE transport (central via ble-plx + native peripheral)
ble/NativeFarosBle   typed wrapper for the native peripheral module
store/useMeshStore   zustand store bridging MeshNode <-> React
ui/ChatScreen        main screen + mesh radar + SOS with location
ui/SettingsScreen    handle editing, identity, panic wipe
```

## Verified

The pure mesh engine (wire format, fragmentation, multi-hop flood, dedup, TTL)
is covered by a dependency-free test you can run right now:

```bash
npm run verify
```

It runs a simulated 3-node `A—B—C` network (where A can't reach C directly) and
asserts: packet round-trips with UTF-8/emoji, fragmentation+reassembly (incl.
out-of-order), correct multi-hop delivery + hop counts, loop suppression in a
cyclic mesh, and TTL-bounded propagation. **6/6 pass.**

## What's implemented end-to-end
- ✅ Cryptographic identity (no accounts), editable handle
- ✅ E2E encrypted DMs + public `#mesh` / `#sos` channels
- ✅ Flood routing with TTL, hop counting, duplicate suppression
- ✅ BLE fragmentation/reassembly for small MTUs
- ✅ **SOS beacon with real GPS coordinates** (works without internet)
- ✅ **Store-and-forward** outbox, persisted, retried when peers reappear
- ✅ Live mesh radar, delivery receipts, panic wipe
- ✅ Mock transport so it runs on a simulator; real BLE on devices

### Why it's better than bitchat
- **SOS / disaster mode** — one tap broadcasts an emergency beacon + location
  across the whole mesh, with the highest routing priority.
- **Live mesh radar** — see who's nearby, hop distance, and signal strength.
- **Panic wipe** — destroys your identity and all data instantly.
- **Mock mode** — the app is demoable/testable without any hardware.
- Clean, swappable transport layer so the hard BLE bits are isolated.

---

## Run it now (MOCK mode, no hardware)

```bash
npm install
# iOS
npm run pods && npm run ios
# Android
npm run android
```

In dev (`__DEV__`) or when the native peripheral isn't linked yet, the app uses
`MockTransport`: virtual peers appear, chat, and acknowledge your messages so you
can experience the full UX and routing logic.

---

## Enable REAL Bluetooth mesh (physical devices)

You need **two or more physical phones** — BLE peripheral mode does not work on
simulators.

1. **Install deps** (already in `package.json`): `react-native-ble-plx`,
   `react-native-get-random-values`, `react-native-svg`, `tweetnacl`, `zustand`.

2. **Android**
   - Add the permissions from `_native-snippets/AndroidManifest.additions.xml`.
   - Register the module: add `FarosBlePackage()` in `MainApplication.kt`
     (see `_native-snippets/MainApplication.snippet.kt`).
   - The Kotlin module is at
     `android/app/src/main/java/com/faros/ble/`.

3. **iOS**
   - Add the keys from `_native-snippets/Info.plist.additions.xml`.
   - Add `FarosBle.swift` + `FarosBle.m` to the Xcode project (Swift bridging
     header will be offered automatically by Xcode the first time).
   - `npm run pods`.

4. **Force real transport:** in `src/store/useMeshStore.ts` set
   ```ts
   const useMock = false; // was: !Peripheral.available || __DEV__
   ```
   then build a release/device build.

5. Launch on 2+ phones, keep the app foregrounded, and watch them find each
   other on the radar.

---

## Known real-world constraints (be honest about these)

- **iOS background advertising** is restricted by CoreBluetooth — the service
  UUID moves to an "overflow" area visible only to other iOS devices actively
  scanning. Reliable background mesh on iOS is genuinely hard (bitchat hit this
  too). Foreground works well.
- **BLE throughput is low** — fine for text, not for media. Keep payloads small.
- **Battery** — continuous scan + advertise drains battery; add duty-cycling for
  production.
- This native BLE layer is a solid, real starting point but **needs on-device
  testing and tuning** across Android/iOS hardware before shipping.

---

## Security model
- Identity = a Curve25519 keypair generated locally; your `peerId` is its hash.
- **DMs**: `nacl.box` (X25519 + XSalsa20-Poly1305), authenticated, end-to-end.
- **Public channels** (`#mesh`, `#sos`): readable by neighbours by design (it's a
  group radio), but origin handle/key travel inside the packet.
- No servers, no metadata collection, no analytics. Panic wipe clears everything.

Free, ad-free, no tracking — by design.
