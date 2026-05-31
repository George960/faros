package com.faros.ble

// ─────────────────────────────────────────────────────────────
// FarosBleModule.kt — native peripheral half of the mesh.
// Advertises the ΦΑΡΟΣ service, runs a GATT server with a TX
// (notify) and RX (write) characteristic, and bridges frames
// to/from JS as base64 strings.
//
// react-native-ble-plx handles the central (scan/connect) half;
// this module is everything ble-plx can't do on Android.
// ─────────────────────────────────────────────────────────────

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.ParcelUuid
import android.util.Base64
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID

class FarosBleModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {

    override fun getName() = "FarosBle"

    private val manager get() = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val adapter get() = manager.adapter

    private var advertiser: BluetoothLeAdvertiser? = null
    private var gattServer: BluetoothGattServer? = null
    private var txChar: BluetoothGattCharacteristic? = null
    private val subscribers = mutableSetOf<BluetoothDevice>()

    private lateinit var serviceUuid: UUID
    private lateinit var txUuid: UUID
    private lateinit var rxUuid: UUID

    private fun emit(data: String) {
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("FarosBleWrite", Arguments.createMap().apply { putString("data", data) })
    }

    @ReactMethod
    fun startAdvertising(service: String, tx: String, rx: String, promise: Promise) {
        try {
            serviceUuid = UUID.fromString(service)
            txUuid = UUID.fromString(tx)
            rxUuid = UUID.fromString(rx)
            startGattServer()
            startAdvertiser()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ADV_FAIL", e)
        }
    }

    private fun startGattServer() {
        val server = manager.openGattServer(ctx, gattCallback)
        val service = BluetoothGattService(serviceUuid, BluetoothGattService.SERVICE_TYPE_PRIMARY)

        txChar = BluetoothGattCharacteristic(
            txUuid,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ,
        ).apply {
            addDescriptor(
                BluetoothGattDescriptor(
                    UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"),
                    BluetoothGattDescriptor.PERMISSION_WRITE,
                ),
            )
        }
        val rxChar = BluetoothGattCharacteristic(
            rxUuid,
            BluetoothGattCharacteristic.PROPERTY_WRITE or
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE,
        )
        service.addCharacteristic(txChar)
        service.addCharacteristic(rxChar)
        server.addService(service)
        gattServer = server
    }

    private fun startAdvertiser() {
        advertiser = adapter.bluetoothLeAdvertiser
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .build()
        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addServiceUuid(ParcelUuid(serviceUuid))
            .build()
        advertiser?.startAdvertising(settings, data, advertiseCallback)
    }

    @ReactMethod
    fun stopAdvertising(promise: Promise) {
        advertiser?.stopAdvertising(advertiseCallback)
        gattServer?.close()
        gattServer = null
        subscribers.clear()
        promise.resolve(null)
    }

    @ReactMethod
    fun notify(base64Frame: String, promise: Promise) {
        val bytes = Base64.decode(base64Frame, Base64.NO_WRAP)
        val char = txChar
        if (char == null) {
            promise.resolve(null); return
        }
        char.setValue(bytes)
        subscribers.forEach { device ->
            gattServer?.notifyCharacteristicChanged(device, char, false)
        }
        promise.resolve(null)
    }

    // Required for RN NativeEventEmitter on the JS side.
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartFailure(errorCode: Int) {}
    }

    private val gattCallback = object : BluetoothGattServerCallback() {
        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray,
        ) {
            if (characteristic.uuid == rxUuid) {
                emit(Base64.encodeToString(value, Base64.NO_WRAP))
            }
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
            }
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray,
        ) {
            // CCCD write => subscribe/unsubscribe to notifications
            if (value.isNotEmpty() && value[0].toInt() != 0) subscribers.add(device)
            else subscribers.remove(device)
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
            }
        }

        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_DISCONNECTED) subscribers.remove(device)
        }
    }
}
