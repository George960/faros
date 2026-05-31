# CLAUDE.md — ΦΑΡΟΣ (Faros)

Project context for Claude Code. Read this first.

## What this is
Offline Bluetooth LE **mesh chat** app. No internet, no servers, no accounts.
End-to-end encrypted. Built for everyday use *and* for disasters (earthquakes,
floods) when cellular networks are down. Includes an **SOS beacon** that carries
GPS coordinates across the mesh.

- **Stack:** React Native 0.74.5 + TypeScript, zustand, tweetnacl, react-native-svg,
  react-native-ble-plx, @react-native-community/geolocation.
- **Each phone is both BLE roles at once:** central (scan/connect via ble-plx)
  AND peripheral (advertise + GATT server via the custom native module).
- Messages **flood** with a TTL hop counter + dedup cache; relayed onward by each
  node so they reach peers several hops away.

## Architecture (read in this order)
1. `README.md` — full overview + how it works.
2. `FINISH-LINE.md` — exactly what's done and what remains.
3. `src/mesh/types.ts` — shared types + constants.
4. `src/mesh/protocol.ts`, `fragment.ts` — wire format + BLE fragmentation.
5. `src/mesh/MeshNode.ts` — the routing engine (flood/TTL/dedup/relay/ack/SOS/outbox).
6. `src/mesh/transport.ts` + `MockTransport.ts` + `src/ble/BleTransport.ts` — link layer.
7. `src/ble/NativeFarosBle.ts` + native modules (`android/.../ble/`, `ios/Faros/FarosBle.*`).
8. `src/store/useMeshStore.ts` — zustand state bridging engine ↔ React.
9. `src/ui/` — ChatScreen, MeshRadar, SettingsScreen.

## DEBUG IN THIS ORDER (one layer at a time — do not skip ahead)
Solve each layer fully before moving to the next. This prevents 15 errors at once.

1. **`npm install`** — get dependencies clean first.
2. **`npm run verify`** — pure mesh logic, zero deps. MUST print `6/6`. If this
   fails, the bug is in protocol/fragment/flood logic — fix there, nowhere else.
3. **`npm run tsc`** — TypeScript type-check (no build). Fix all type errors.
4. **Mock-mode build:** `npm run android` (or `npm run ios`). App must launch and
   show the radar with simulated peers. `useMock` is auto-true in `__DEV__`.
5. **Real BLE:** set `const useMock = false` in `src/store/useMeshStore.ts`, then
   build to **2+ physical devices** (peripheral mode does NOT exist on simulators).

## Rules / conventions
- **Do not weaken the security model.** E2E encryption (nacl.box / X25519),
  no servers, no analytics, no data collection. Keep it that way.
- **Do not bypass OS permissions or app-store rules.** The iOS background BLE
  behaviour (overflow advertising) is an Apple design constraint, not a bug to
  hack around. Tune it via state restoration + duty-cycling only.
- Keep the transport layer swappable (the `Transport` interface). Don't couple
  `MeshNode` to BLE specifics.
- Greek UI strings are intentional — keep them.
- Prefer small, isolated fixes. After any change to mesh logic, re-run
  `npm run verify`.
- TypeScript is `strict`. No `any` unless unavoidable (native bridge edges only).

## Known real-world constraints (NOT bugs)
- iOS background advertising is slow (overflow channel). Android nodes act as
  relay anchors. Foreground is full-speed.
- BLE throughput is low — text only, keep payloads small.
- Continuous scan/advertise drains battery — duty-cycling is already in
  `BleTransport` (`SCAN_BURST_MS` / `SCAN_REST_MS`); tune on-device.

## Commands
```
npm install        # deps
npm run verify     # prove the engine (6/6)
npm run tsc        # type-check
npm run lint       # eslint
npm run android    # build+run Android
npm run ios         # build+run iOS (needs: npm run pods first)
```

## When asking Claude Code for help
Tell it which layer (1–5 above) you're on and paste the EXACT error output.
Fix the current layer before touching the next.
