// ─────────────────────────────────────────────────────────────
// FarosBle.swift — iOS peripheral half WITH background support.
//
// What changed vs. the basic version:
//   1. State restoration: both managers register a restore identifier so
//      iOS relaunches the app (into the background) when a BLE event
//      arrives, instead of the mesh going dark when the screen locks.
//   2. We re-attach our service + advertising on restoration.
//   3. Advertising uses the local-name + service-UUID so other devices
//      (incl. backgrounded iOS, via the overflow area) can still find us.
//
// This is the correct, Apple-sanctioned way to keep a BLE mesh alive in
// the background — no private APIs, no entitlement abuse. It requires the
// `bluetooth-central` + `bluetooth-peripheral` UIBackgroundModes (already
// in Info.plist).
//
// Caveat that no code can remove: while backgrounded, iOS throttles
// advertising and moves the service UUID to a slower "overflow" channel.
// Discovery is slower in background; foreground is full-speed. Android
// nodes (which scan aggressively) act as good relay anchors.
// ─────────────────────────────────────────────────────────────
import Foundation
import CoreBluetooth
import React

private let kPeripheralRestoreId = "com.faros.ble.peripheral"

@objc(FarosBle)
class FarosBle: RCTEventEmitter, CBPeripheralManagerDelegate {

    private var peripheral: CBPeripheralManager!
    private var txChar: CBMutableCharacteristic!
    private var rxChar: CBMutableCharacteristic!
    private var service: CBMutableService!
    private var serviceUUID: CBUUID!
    private var txUUID: CBUUID!
    private var rxUUID: CBUUID!
    private var pendingStart = false
    private var serviceAdded = false
    private var subscribedCentrals: [CBCentral] = []
    // queue of frames we couldn't send yet (e.g. before powered on)
    private var outQueue: [Data] = []

    override init() {
        super.init()
        // Restoration identifier => iOS can relaunch us in the background.
        peripheral = CBPeripheralManager(
            delegate: self,
            queue: nil,
            options: [CBPeripheralManagerOptionRestoreIdentifierKey: kPeripheralRestoreId]
        )
    }

    override func supportedEvents() -> [String]! { ["FarosBleWrite", "FarosBleState"] }
    override static func requiresMainQueueSetup() -> Bool { true }

    // MARK: - JS API
    @objc(startAdvertising:tx:rx:resolver:rejecter:)
    func startAdvertising(_ service: String, tx: String, rx: String,
                          resolver resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
        serviceUUID = CBUUID(string: service)
        txUUID = CBUUID(string: tx)
        rxUUID = CBUUID(string: rx)
        if peripheral.state == .poweredOn {
            setupService()
            startAdv()
        } else {
            pendingStart = true   // deferred until didUpdateState
        }
        resolve(nil)
    }

    @objc(stopAdvertising:rejecter:)
    func stopAdvertising(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        peripheral.stopAdvertising()
        resolve(nil)
    }

    @objc(notify:resolver:rejecter:)
    func notify(_ base64Frame: String,
                resolver resolve: RCTPromiseResolveBlock,
                rejecter reject: RCTPromiseRejectBlock) {
        guard let data = Data(base64Encoded: base64Frame) else { resolve(nil); return }
        sendOrQueue(data)
        resolve(nil)
    }

    // MARK: - internal
    private func setupService() {
        guard !serviceAdded else { return }
        txChar = CBMutableCharacteristic(type: txUUID, properties: [.notify],
                                         value: nil, permissions: [.readable])
        rxChar = CBMutableCharacteristic(type: rxUUID,
                                         properties: [.write, .writeWithoutResponse],
                                         value: nil, permissions: [.writeable])
        service = CBMutableService(type: serviceUUID, primary: true)
        service.characteristics = [txChar, rxChar]
        peripheral.add(service)
        serviceAdded = true
    }

    private func startAdv() {
        peripheral.startAdvertising([
            CBAdvertisementDataServiceUUIDsKey: [serviceUUID!],
            CBAdvertisementDataLocalNameKey: "FAROS"
        ])
    }

    private func sendOrQueue(_ data: Data) {
        guard serviceAdded, txChar != nil else { outQueue.append(data); return }
        let targets = subscribedCentrals.isEmpty ? nil : subscribedCentrals
        let ok = peripheral.updateValue(data, for: txChar, onSubscribedCentrals: targets)
        if !ok { outQueue.append(data) }   // transmit queue full → retry later
    }

    // Called by iOS when the transmit queue has space again.
    func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
        while !outQueue.isEmpty {
            let data = outQueue.removeFirst()
            let targets = subscribedCentrals.isEmpty ? nil : subscribedCentrals
            if !peripheral.updateValue(data, for: txChar, onSubscribedCentrals: targets) {
                outQueue.insert(data, at: 0)   // still full, stop and wait
                break
            }
        }
    }

    // MARK: - State restoration
    func peripheralManager(_ peripheral: CBPeripheralManager,
                           willRestoreState dict: [String: Any]) {
        // Recover services iOS kept alive across the background relaunch.
        if let services = dict[CBPeripheralManagerRestoredStateServicesKey] as? [CBMutableService],
           let first = services.first {
            service = first
            serviceAdded = true
            serviceUUID = first.uuid
            for ch in first.characteristics ?? [] {
                if ch.properties.contains(.notify) { txChar = ch as? CBMutableCharacteristic }
                if ch.properties.contains(.write) { rxChar = ch as? CBMutableCharacteristic }
            }
        }
    }

    func peripheralManagerDidUpdateState(_ p: CBPeripheralManager) {
        sendEvent(withName: "FarosBleState", body: ["state": p.state.rawValue])
        if p.state == .poweredOn {
            if pendingStart || serviceAdded {
                pendingStart = false
                setupService()
                startAdv()
            }
        }
    }

    func peripheralManager(_ p: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        for req in requests {
            if req.characteristic.uuid == rxUUID, let value = req.value {
                sendEvent(withName: "FarosBleWrite", body: ["data": value.base64EncodedString()])
            }
            p.respond(to: req, withResult: .success)
        }
    }

    func peripheralManager(_ p: CBPeripheralManager, central: CBCentral,
                           didSubscribeTo characteristic: CBCharacteristic) {
        if !subscribedCentrals.contains(central) { subscribedCentrals.append(central) }
    }

    func peripheralManager(_ p: CBPeripheralManager, central: CBCentral,
                           didUnsubscribeFrom characteristic: CBCharacteristic) {
        subscribedCentrals.removeAll { $0 == central }
    }
}
