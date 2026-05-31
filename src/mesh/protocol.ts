// ─────────────────────────────────────────────────────────────
// src/mesh/protocol.ts — compact binary wire format
//
// Layout (big-endian):
//   [0]      magic 0xFA
//   [1]      version (1)
//   [2]      type (PacketType)
//   [3]      ttl
//   [4..11]  packet id (8 bytes)
//   [12..27] from peer id (16 bytes)
//   [28..43] to peer id (16 bytes, zero = broadcast)
//   [44..51] timestamp (uint64 ms)
//   [52]     channel length (n)
//   [53..]   channel utf8 (n bytes)
//   [..]     payload length (uint16) + payload bytes
// ─────────────────────────────────────────────────────────────
import { MeshPacket, PacketType } from './types';
import util from 'tweetnacl-util';

const MAGIC = 0xfa;
const VERSION = 1;
const enc = (s: string) => util.decodeUTF8(s);
const dec = (b: Uint8Array) => util.encodeUTF8(b);

const hexToBytes = (hex: string, len: number): Uint8Array => {
  const out = new Uint8Array(len);
  for (let i = 0; i < len && i * 2 < hex.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
};
const bytesToHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function encodePacket(p: MeshPacket): Uint8Array {
  const ch = enc(p.channel);
  const total = 53 + ch.length + 2 + p.payload.length;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  buf[0] = MAGIC;
  buf[1] = VERSION;
  buf[2] = p.type;
  buf[3] = p.ttl & 0xff;
  buf.set(hexToBytes(p.id, 8), 4);
  buf.set(hexToBytes(p.from, 16), 12);
  buf.set(hexToBytes(p.to || '', 16), 28);
  dv.setBigUint64(44, BigInt(p.ts));
  buf[52] = ch.length;
  buf.set(ch, 53);
  let off = 53 + ch.length;
  dv.setUint16(off, p.payload.length);
  off += 2;
  buf.set(p.payload, off);
  return buf;
}

export function decodePacket(buf: Uint8Array): MeshPacket | null {
  if (buf.length < 53 || buf[0] !== MAGIC || buf[1] !== VERSION) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const type = buf[2] as PacketType;
  const ttl = buf[3];
  const id = bytesToHex(buf.slice(4, 12));
  const from = bytesToHex(buf.slice(12, 28));
  const toRaw = bytesToHex(buf.slice(28, 44));
  const to = /^0+$/.test(toRaw) ? '' : toRaw;
  const ts = Number(dv.getBigUint64(44));
  const chLen = buf[52];
  const channel = dec(buf.slice(53, 53 + chLen));
  let off = 53 + chLen;
  const payLen = dv.getUint16(off);
  off += 2;
  const payload = buf.slice(off, off + payLen);
  return { type, ttl, id, from, to, ts, channel, payload };
}

export { bytesToHex, hexToBytes };
