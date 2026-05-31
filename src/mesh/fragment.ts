// ─────────────────────────────────────────────────────────────
// src/mesh/fragment.ts — split packets across small BLE frames
// and reassemble them on the receiving side.
//
// Frame layout: [msgId:2][index:1][count:1][...data]
// ─────────────────────────────────────────────────────────────
import { FRAGMENT_SIZE } from './types';

const HEADER = 4;
const DATA = FRAGMENT_SIZE - HEADER;

export function fragment(packet: Uint8Array, msgId: number): Uint8Array[] {
  const count = Math.max(1, Math.ceil(packet.length / DATA));
  const frames: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const slice = packet.slice(i * DATA, (i + 1) * DATA);
    const frame = new Uint8Array(HEADER + slice.length);
    frame[0] = (msgId >> 8) & 0xff;
    frame[1] = msgId & 0xff;
    frame[2] = i;
    frame[3] = count;
    frame.set(slice, HEADER);
    frames.push(frame);
  }
  return frames;
}

interface Partial {
  count: number;
  parts: (Uint8Array | undefined)[];
  received: number;
  at: number;
}

export class Reassembler {
  private buffers = new Map<string, Partial>();

  /** Feed a frame; returns the full packet when complete, else null. */
  push(senderKey: string, frame: Uint8Array): Uint8Array | null {
    if (frame.length < HEADER) return null;
    const msgId = (frame[0] << 8) | frame[1];
    const index = frame[2];
    const count = frame[3];
    const key = `${senderKey}:${msgId}`;
    let p = this.buffers.get(key);
    if (!p) {
      p = { count, parts: new Array(count), received: 0, at: Date.now() };
      this.buffers.set(key, p);
    }
    if (!p.parts[index]) {
      p.parts[index] = frame.slice(HEADER);
      p.received++;
    }
    if (p.received === p.count) {
      this.buffers.delete(key);
      const totalLen = p.parts.reduce((s, x) => s + (x?.length ?? 0), 0);
      const out = new Uint8Array(totalLen);
      let off = 0;
      for (const part of p.parts) {
        if (part) {
          out.set(part, off);
          off += part.length;
        }
      }
      return out;
    }
    return null;
  }

  /** Drop half-finished reassemblies older than `maxAgeMs`. */
  sweep(maxAgeMs = 30000) {
    const cut = Date.now() - maxAgeMs;
    for (const [k, v] of this.buffers) if (v.at < cut) this.buffers.delete(k);
  }
}
