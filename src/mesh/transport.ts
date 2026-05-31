// ─────────────────────────────────────────────────────────────
// src/mesh/transport.ts — pluggable link layer
//
// The mesh engine doesn't care HOW bytes move between phones.
// Any backend (real BLE, or the in-app mock) implements this.
// ─────────────────────────────────────────────────────────────

export interface NeighbourInfo {
  /** stable key for this radio link (e.g. BLE device id) */
  link: string;
  rssi: number;
}

export interface Transport {
  /** Begin advertising + scanning. Resolves once radios are up. */
  start(myAdvertisedId: string): Promise<void>;
  stop(): Promise<void>;

  /** Broadcast raw bytes to every currently-connected neighbour. */
  broadcast(frame: Uint8Array): Promise<void>;

  /** Fired when a frame arrives from a neighbour. */
  onFrame(cb: (link: string, frame: Uint8Array, rssi: number) => void): void;

  /** Fired when neighbour set changes (connect/disconnect). */
  onNeighbours(cb: (neighbours: NeighbourInfo[]) => void): void;

  isMock(): boolean;
}
