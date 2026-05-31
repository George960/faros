// ─────────────────────────────────────────────────────────────
// src/mesh/types.ts — shared mesh types
// ─────────────────────────────────────────────────────────────

/** A 16-byte peer id derived from the public key. Hex string. */
export type PeerId = string;

export enum PacketType {
  ANNOUNCE = 1, // identity/handle broadcast
  MESSAGE = 2, // chat message (channel or DM)
  ACK = 3, // delivery acknowledgement
  SOS = 4, // emergency beacon (highest priority)
}

/** Decoded application-level packet (before fragmentation). */
export interface MeshPacket {
  type: PacketType;
  /** unique per-packet id (8 bytes hex) for dedup + ack */
  id: string;
  /** origin peer id */
  from: PeerId;
  /** destination peer id, or '' for broadcast/channel */
  to: PeerId | '';
  /** time-to-live: how many more hops allowed */
  ttl: number;
  /** unix ms at origin */
  ts: number;
  /** channel name for MESSAGE (e.g. "mesh", "sos"), else '' */
  channel: string;
  /** opaque payload bytes (ciphertext for MESSAGE/SOS, plaintext meta otherwise) */
  payload: Uint8Array;
}

export interface Peer {
  id: PeerId;
  handle: string;
  /** public key, base64 */
  pubKey: string;
  rssi: number;
  /** hop distance: 1 = direct neighbour */
  hops: number;
  lastSeen: number;
  verified: boolean;
}

export interface ChatMessage {
  id: string;
  channel: string;
  from: PeerId;
  handle: string;
  text: string;
  ts: number;
  hops: number;
  mine: boolean;
  encrypted: boolean;
  status: 'sending' | 'relayed' | 'delivered' | 'failed';
  sos?: boolean;
}

export const DEFAULT_TTL = 7;
export const MAX_PACKET_BYTES = 2048;
/** Conservative BLE payload per fragment (after MTU negotiation headroom). */
export const FRAGMENT_SIZE = 180;
/** How long a packet id stays in the dedup cache (ms). */
export const DEDUP_TTL_MS = 5 * 60 * 1000;
/** Drop a peer if not heard from in this window (ms). */
export const PEER_TIMEOUT_MS = 60 * 1000;
