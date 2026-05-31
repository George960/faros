// ─────────────────────────────────────────────────────────────
// src/ble/NativeFarosBle.ts — JS wrapper for the native peripheral
//
// react-native-ble-plx covers the CENTRAL role (scan + connect).
// It does NOT provide a GATT *server* / advertiser, which a mesh
// node also needs. That half lives in a small native module:
//   • Android: android/.../FarosBleModule.kt  (BLE advertiser + GATT server)
//   • iOS:     ios/Faros/FarosBle.swift        (CBPeripheralManager)
//
// This wrapper gives the rest of the app a typed interface and
// degrades gracefully (no-op) if the native module isn't linked yet.
// ─────────────────────────────────────────────────────────────
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

const LINKED = (NativeModules as any).FarosBle;

export interface NativePeripheral {
  startAdvertising(serviceUuid: string, txChar: string, rxChar: string): Promise<void>;
  stopAdvertising(): Promise<void>;
  /** Notify all subscribed centrals with a frame (base64). */
  notify(base64Frame: string): Promise<void>;
  /** Subscribe to frames written by centrals to our RX characteristic. */
  onWrite(cb: (base64Frame: string) => void): () => void;
  available: boolean;
}

class RealPeripheral implements NativePeripheral {
  available = true;
  private emitter = new NativeEventEmitter(LINKED);

  startAdvertising(s: string, tx: string, rx: string) {
    return LINKED.startAdvertising(s, tx, rx);
  }
  stopAdvertising() {
    return LINKED.stopAdvertising();
  }
  notify(b64: string) {
    return LINKED.notify(b64);
  }
  onWrite(cb: (b64: string) => void) {
    const sub = this.emitter.addListener('FarosBleWrite', (e: { data: string }) => cb(e.data));
    return () => sub.remove();
  }
}

class NoopPeripheral implements NativePeripheral {
  available = false;
  async startAdvertising() {
    console.warn(
      `[FarosBle] native peripheral not linked on ${Platform.OS}. ` +
        `Central scanning still works, but this device won't advertise. ` +
        `Build the native module (see README) to enable full mesh.`,
    );
  }
  async stopAdvertising() {}
  async notify() {}
  onWrite() {
    return () => {};
  }
}

export const Peripheral: NativePeripheral = LINKED ? new RealPeripheral() : new NoopPeripheral();
