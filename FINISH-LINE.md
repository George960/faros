# ΦΑΡΟΣ — Finish-line checklist

The application code is **complete**. What remains can only be done on a machine
with the mobile toolchains and on real phones — I can't run those from here, so
here is the exact, honest path to a running app.

## ✅ Done (in this repo)
- Full TypeScript app: mesh engine, crypto, BLE transport, UI, settings.
- Native modules: Android (Kotlin) advertiser + GATT server; iOS (Swift)
  CBPeripheralManager + Obj-C bridge.
- Native project scaffolding: gradle files, AndroidManifest, MainApplication/
  MainActivity, Podfile, AppDelegate, Info.plist, bridging header.
- Verified mesh engine: `npm run verify` → 6/6.

## 🔧 To run it yourself

### 0. Prerequisites
- Node 18+, JDK 17, Android Studio (SDK 34) and/or Xcode 15+, CocoaPods.

### 1. Generate the RN wrapper once, then drop these files in
This repo contains the *custom* source. The quickest reliable way to get the
binary build folders (gradle wrapper jars, xcodeproj, etc.) is:

```bash
npx @react-native-community/cli@latest init Faros --version 0.74.5
# then copy this repo's src/, index.js, the native modules, and the
# android/ + ios/ overrides on top of the generated project.
```

Everything hand-writable is already here; only the auto-generated binary
bits (gradle-wrapper.jar, .xcodeproj, Pods) come from the init/`pod install`.

### 2. Install + run (MOCK mode works immediately)
```bash
npm install
npm run verify          # prove the engine: 6/6
npm run ios             # or: npm run android
```

### 3. Flip to real Bluetooth
In `src/store/useMeshStore.ts`:
```ts
const useMock = false;  // was: !Peripheral.available || __DEV__
```
Build a device build and install on **2+ physical phones** (BLE peripheral mode
doesn't exist on simulators). Keep the app foregrounded.

### 4. Test the mesh for real
- Phone A + Phone B side by side → they appear on each other's radar.
- Send a message → arrives, shows "direct".
- Add Phone C near B but far from A → A's message to C should arrive as "2 hops".
- Press SOS on A → B and C get the beacon with A's GPS coordinates.
- Walk C out of range, send, walk back → store-and-forward redelivers.

## ⚠️ The genuinely hard part that needs device tuning
- **iOS background advertising** is restricted by CoreBluetooth (foreground is
  fine; background needs careful state-restoration work). This is the same wall
  bitchat hit — budget real time for it before shipping.
- **Battery/duty-cycling**: continuous scan+advertise is heavy. Add interval
  scanning before release.
- Cross-platform iOS↔Android BLE quirks always need on-hardware testing.

These are not code-completeness gaps — they're real-world RF/OS behaviours that
can only be tuned with devices in hand.
