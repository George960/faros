// ─────────────────────────────────────────────────────────────
// src/ble/constants.ts
// ─────────────────────────────────────────────────────────────

/** Custom 128-bit service UUID that identifies a ΦΑΡΟΣ node. */
export const FAROS_SERVICE_UUID = 'f4205000-0000-4661-726f-734d65736821';
/** Characteristic used to write/notify mesh frames. */
export const FAROS_TX_CHAR_UUID = 'f4205001-0000-4661-726f-734d65736821';
export const FAROS_RX_CHAR_UUID = 'f4205002-0000-4661-726f-734d65736821';

export const SCAN_RESTART_MS = 8000;
/** Battery-friendly duty cycle: scan a burst, then rest, then repeat. */
export const SCAN_BURST_MS = 4000;
export const SCAN_REST_MS = 6000;
export const TARGET_MTU = 247; // negotiate up from default 23
