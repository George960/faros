// ─────────────────────────────────────────────────────────────
// src/mesh/Outbox.ts — store-and-forward.
//
// In a mesh, a recipient may be out of range right now but reachable
// later (someone walks closer, a relay node appears). The outbox keeps
// recent packets and re-broadcasts them when the neighbour set grows,
// so messages eventually propagate instead of being lost.
//
// Persisted to disk so messages survive an app restart during a crisis.
// ─────────────────────────────────────────────────────────────
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORE = '@faros/outbox/v1';

export interface Outgoing {
  packetId: string;
  bytesB64: string; // encoded packet, base64
  ts: number;
  attempts: number;
  acked: boolean;
}

const MAX_AGE_MS = 30 * 60 * 1000; // keep 30 min
const MAX_ATTEMPTS = 6;

export class Outbox {
  private items = new Map<string, Outgoing>();
  private loaded = false;

  async load() {
    if (this.loaded) return;
    try {
      const raw = await AsyncStorage.getItem(STORE);
      if (raw) for (const o of JSON.parse(raw) as Outgoing[]) this.items.set(o.packetId, o);
    } catch {}
    this.loaded = true;
  }

  private async persist() {
    try {
      await AsyncStorage.setItem(STORE, JSON.stringify(Array.from(this.items.values())));
    } catch {}
  }

  add(packetId: string, bytesB64: string) {
    this.items.set(packetId, { packetId, bytesB64, ts: Date.now(), attempts: 0, acked: false });
    this.persist();
  }

  markAcked(packetId: string) {
    const o = this.items.get(packetId);
    if (o) {
      o.acked = true;
      this.items.delete(packetId);
      this.persist();
    }
  }

  /** Packets still worth retransmitting; prunes stale/acked/exhausted. */
  pending(): Outgoing[] {
    const cut = Date.now() - MAX_AGE_MS;
    const out: Outgoing[] = [];
    for (const [id, o] of this.items) {
      if (o.acked || o.ts < cut || o.attempts >= MAX_ATTEMPTS) {
        this.items.delete(id);
        continue;
      }
      o.attempts++;
      out.push(o);
    }
    this.persist();
    return out;
  }

  size() {
    return this.items.size;
  }
}
