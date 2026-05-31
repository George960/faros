// ─────────────────────────────────────────────────────────────
// src/ble/BleTransport.ts — production transport over Bluetooth LE
//
// Each node plays BOTH roles simultaneously:
//   CENTRAL   (react-native-ble-plx): scans for FAROS_SERVICE_UUID,
//             connects to neighbours, writes frames, subscribes to notifies.
//   PERIPHERAL (native module): advertises FAROS_SERVICE_UUID, runs a
//             GATT server, notifies frames, receives writes.
//
// Together this forms a flood mesh: a frame written to / notified by
// any neighbour is handed to MeshNode, which relays it onward.
// ─────────────────────────────────────────────────────────────
import { BleManager, Device, State } from 'react-native-ble-plx';
import util from 'tweetnacl-util';
import { PermissionsAndroid, Platform } from 'react-native';
import { Transport, NeighbourInfo } from '../mesh/transport';
import { Peripheral } from './NativeFarosBle';
import {
  FAROS_SERVICE_UUID,
  FAROS_TX_CHAR_UUID,
  FAROS_RX_CHAR_UUID,
  SCAN_BURST_MS,
  SCAN_REST_MS,
  TARGET_MTU,
} from './constants';

const b64 = (u: Uint8Array) => util.encodeBase64(u);
const fromB64 = (s: string) => util.decodeBase64(s);

export class BleTransport implements Transport {
  // restoreStateIdentifier => iOS relaunches us in the background for BLE events
  private manager = new BleManager({
    restoreStateIdentifier: 'com.faros.ble.central',
    restoreStateFunction: (restored) => {
      // Devices iOS kept connected across a background relaunch.
      const devices = restored?.connectedPeripherals ?? [];
      for (const d of devices) this.reattach(d);
    },
  });
  private connected = new Map<string, Device>();
  private rssi = new Map<string, number>();
  private frameCb?: (link: string, f: Uint8Array, rssi: number) => void;
  private nbCb?: (n: NeighbourInfo[]) => void;
  private scanTimer?: ReturnType<typeof setInterval>;
  private dutyTimer?: ReturnType<typeof setTimeout>;
  private unsubWrite?: () => void;
  private scanning = false;

  isMock() {
    return false;
  }

  async start(): Promise<void> {
    await this.requestPermissions();
    await this.waitForPoweredOn();

    // PERIPHERAL: advertise + accept writes from other centrals.
    await Peripheral.startAdvertising(FAROS_SERVICE_UUID, FAROS_TX_CHAR_UUID, FAROS_RX_CHAR_UUID);
    this.unsubWrite = Peripheral.onWrite((data) =>
      this.frameCb?.('periph', fromB64(data), this.rssi.get('periph') ?? -60),
    );

    // CENTRAL: duty-cycled scan (battery friendly) — scan a burst, rest, repeat.
    this.startDutyCycle();
  }

  /** Scan SCAN_BURST_MS on, SCAN_REST_MS off, to save battery while still
   *  discovering new neighbours regularly. */
  private startDutyCycle() {
    const loop = () => {
      this.scan();
      this.dutyTimer = setTimeout(() => {
        this.manager.stopDeviceScan();
        this.scanning = false;
        this.dutyTimer = setTimeout(loop, SCAN_REST_MS);
      }, SCAN_BURST_MS);
    };
    loop();
  }

  private async reattach(device: Device) {
    try {
      if (!(await device.isConnected())) return;
      this.connected.set(device.id, device);
      await device.discoverAllServicesAndCharacteristics();
      this.subscribe(device);
      this.emitNeighbours();
    } catch {
      this.drop(device.id);
    }
  }

  async stop(): Promise<void> {
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.dutyTimer) clearTimeout(this.dutyTimer);
    this.unsubWrite?.();
    this.manager.stopDeviceScan();
    this.scanning = false;
    await Peripheral.stopAdvertising();
    for (const d of this.connected.values()) {
      try {
        await d.cancelConnection();
      } catch {}
    }
    this.connected.clear();
    this.manager.destroy();
  }

  async broadcast(frame: Uint8Array): Promise<void> {
    const payload = b64(frame);
    // 1) notify our subscribed centrals (peripheral side)
    Peripheral.notify(payload).catch(() => {});
    // 2) write to every neighbour we are connected to (central side)
    for (const [link, device] of this.connected) {
      try {
        await device.writeCharacteristicWithoutResponseForService(
          FAROS_SERVICE_UUID,
          FAROS_RX_CHAR_UUID,
          payload,
        );
      } catch {
        this.drop(link);
      }
    }
  }

  onFrame(cb: (link: string, f: Uint8Array, rssi: number) => void) {
    this.frameCb = cb;
  }
  onNeighbours(cb: (n: NeighbourInfo[]) => void) {
    this.nbCb = cb;
  }

  // ── central scanning / connection ──
  private scan() {
    this.manager.startDeviceScan(
      [FAROS_SERVICE_UUID],
      { allowDuplicates: false },
      (err, device) => {
        if (err || !device) return;
        if (this.connected.has(device.id)) {
          if (device.rssi != null) this.rssi.set(device.id, device.rssi);
          return;
        }
        this.connect(device);
      },
    );
  }

  private async connect(device: Device) {
    try {
      const d = await device.connect({ requestMTU: TARGET_MTU });
      await d.discoverAllServicesAndCharacteristics();
      this.connected.set(d.id, d);
      this.rssi.set(d.id, device.rssi ?? -70);
      this.subscribe(d);
      this.emitNeighbours();
    } catch {
      this.drop(device.id);
    }
  }

  /** Subscribe to a neighbour's TX characteristic + handle disconnect. */
  private subscribe(d: Device) {
    d.monitorCharacteristicForService(FAROS_SERVICE_UUID, FAROS_TX_CHAR_UUID, (e, c) => {
      if (e || !c?.value) {
        if (e) this.drop(d.id);
        return;
      }
      this.frameCb?.(d.id, fromB64(c.value), this.rssi.get(d.id) ?? -70);
    });
    d.onDisconnected(() => this.drop(d.id));
  }

  private drop(link: string) {
    this.connected.delete(link);
    this.rssi.delete(link);
    this.emitNeighbours();
  }

  private emitNeighbours() {
    this.nbCb?.(
      Array.from(this.connected.keys()).map((link) => ({
        link,
        rssi: this.rssi.get(link) ?? -70,
      })),
    );
  }

  // ── platform plumbing ──
  private async requestPermissions() {
    if (Platform.OS !== 'android') return;
    const api = Platform.Version as number;
    const perms =
      api >= 31
        ? [
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          ]
        : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    await PermissionsAndroid.requestMultiple(perms);
  }

  private waitForPoweredOn(): Promise<void> {
    return new Promise((resolve) => {
      const sub = this.manager.onStateChange((state) => {
        if (state === State.PoweredOn) {
          sub.remove();
          resolve();
        }
      }, true);
    });
  }
}
