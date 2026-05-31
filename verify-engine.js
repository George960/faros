// verify-engine.js — runs the REAL mesh logic (ported 1:1 from src/mesh)
// in plain Node, with zero dependencies, to prove the design is correct.
//
//   node verify-engine.js
//
// This is the same wire format, fragmentation and flood/TTL/dedup
// algorithm used by MeshNode.ts — just with Buffer for UTF8 instead
// of tweetnacl-util so it runs without npm install.

const assert = require('assert');

// ── protocol.ts (ported) ─────────────────────────────────────
const MAGIC = 0xfa, VERSION = 1;
const PacketType = { ANNOUNCE: 1, MESSAGE: 2, ACK: 3, SOS: 4 };
const enc = (s) => new Uint8Array(Buffer.from(s, 'utf8'));
const dec = (b) => Buffer.from(b).toString('utf8');
const hexToBytes = (hex, len) => {
  const out = new Uint8Array(len);
  for (let i = 0; i < len && i * 2 < hex.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
};
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function encodePacket(p) {
  const ch = enc(p.channel);
  const buf = new Uint8Array(53 + ch.length + 2 + p.payload.length);
  const dv = new DataView(buf.buffer);
  buf[0] = MAGIC; buf[1] = VERSION; buf[2] = p.type; buf[3] = p.ttl & 0xff;
  buf.set(hexToBytes(p.id, 8), 4);
  buf.set(hexToBytes(p.from, 16), 12);
  buf.set(hexToBytes(p.to || '', 16), 28);
  dv.setBigUint64(44, BigInt(p.ts));
  buf[52] = ch.length; buf.set(ch, 53);
  let off = 53 + ch.length;
  dv.setUint16(off, p.payload.length); off += 2;
  buf.set(p.payload, off);
  return buf;
}
function decodePacket(buf) {
  if (buf.length < 53 || buf[0] !== MAGIC || buf[1] !== VERSION) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const id = bytesToHex(buf.slice(4, 12));
  const from = bytesToHex(buf.slice(12, 28));
  const toRaw = bytesToHex(buf.slice(28, 44));
  const to = /^0+$/.test(toRaw) ? '' : toRaw;
  const ts = Number(dv.getBigUint64(44));
  const chLen = buf[52];
  const channel = dec(buf.slice(53, 53 + chLen));
  let off = 53 + chLen;
  const payLen = dv.getUint16(off); off += 2;
  return { type: buf[2], ttl: buf[3], id, from, to, ts, channel, payload: buf.slice(off, off + payLen) };
}

// ── fragment.ts (ported) ─────────────────────────────────────
const FRAGMENT_SIZE = 180, HEADER = 4, DATA = FRAGMENT_SIZE - HEADER;
function fragment(packet, msgId) {
  const count = Math.max(1, Math.ceil(packet.length / DATA));
  const frames = [];
  for (let i = 0; i < count; i++) {
    const slice = packet.slice(i * DATA, (i + 1) * DATA);
    const frame = new Uint8Array(HEADER + slice.length);
    frame[0] = (msgId >> 8) & 0xff; frame[1] = msgId & 0xff; frame[2] = i; frame[3] = count;
    frame.set(slice, HEADER);
    frames.push(frame);
  }
  return frames;
}
class Reassembler {
  constructor() { this.buffers = new Map(); }
  push(sender, frame) {
    const msgId = (frame[0] << 8) | frame[1], index = frame[2], count = frame[3];
    const key = `${sender}:${msgId}`;
    let p = this.buffers.get(key);
    if (!p) { p = { count, parts: new Array(count), received: 0 }; this.buffers.set(key, p); }
    if (!p.parts[index]) { p.parts[index] = frame.slice(HEADER); p.received++; }
    if (p.received === p.count) {
      this.buffers.delete(key);
      const total = p.parts.reduce((s, x) => s + x.length, 0);
      const out = new Uint8Array(total); let off = 0;
      for (const part of p.parts) { out.set(part, off); off += part.length; }
      return out;
    }
    return null;
  }
}

// ── a minimal node that floods like MeshNode.ts ──────────────
const DEFAULT_TTL = 7;
let RID = 0;
const rid = (n) => (RID++).toString(16).padStart(n * 2, '0');

class SimNode {
  constructor(id) {
    this.id = id;
    this.neighbours = [];      // other SimNodes in BLE range
    this.seen = new Set();     // dedup cache
    this.reasm = new Reassembler();
    this.delivered = [];       // messages surfaced to "app"
    this.relayCount = 0;
  }
  connect(other) { this.neighbours.push(other); }

  originate(text, channel = 'mesh') {
    const packet = {
      type: PacketType.MESSAGE, id: rid(8), from: this.id, to: '',
      ttl: DEFAULT_TTL, ts: Date.now(), channel, payload: enc(text),
    };
    this.seen.add(packet.id);
    this._flood(packet);
    return packet.id;
  }
  _flood(packet) {
    const bytes = encodePacket(packet);
    const frames = fragment(bytes, RID & 0xffff);
    for (const nb of this.neighbours) for (const f of frames) nb._recv(this.id, f);
  }
  _recv(fromLink, frame) {
    const bytes = this.reasm.push(fromLink, frame);
    if (!bytes) return;
    const packet = decodePacket(bytes);
    if (!packet || this.seen.has(packet.id)) return;   // dedup
    this.seen.add(packet.id);
    const hops = DEFAULT_TTL - packet.ttl + 1;
    if (packet.type === PacketType.MESSAGE)
      this.delivered.push({ id: packet.id, text: dec(packet.payload), hops });
    if (packet.ttl > 1 && packet.to !== this.id) {     // relay
      this.relayCount++;
      this._flood({ ...packet, ttl: packet.ttl - 1 });
    }
  }
}

// ── TESTS ────────────────────────────────────────────────────
let pass = 0;
const ok = (name) => { console.log('  \x1b[32m✓\x1b[0m ' + name); pass++; };

// 1. packet round-trip
{
  const p = { type: PacketType.MESSAGE, id: 'aabbccdd11223344',
    from: 'f'.repeat(32), to: '', ttl: 7, ts: 1700000000000,
    channel: 'mesh', payload: enc('Γειά σου κόσμε 🌍') };
  const back = decodePacket(encodePacket(p));
  assert.strictEqual(back.channel, 'mesh');
  assert.strictEqual(dec(back.payload), 'Γειά σου κόσμε 🌍');
  assert.strictEqual(back.from, 'f'.repeat(32));
  assert.strictEqual(back.ts, 1700000000000);
  ok('packet encode→decode round-trip (incl. UTF-8 + emoji)');
}

// 2. fragmentation of a large payload
{
  const big = 'x'.repeat(900);
  const p = { type: PacketType.MESSAGE, id: rid(8), from: '0'.repeat(32),
    to: '', ttl: 7, ts: Date.now(), channel: 'mesh', payload: enc(big) };
  const bytes = encodePacket(p);
  const frames = fragment(bytes, 7);
  assert.ok(frames.length > 1, 'should split into multiple frames');
  assert.ok(frames.every((f) => f.length <= FRAGMENT_SIZE), 'each frame within BLE size');
  const r = new Reassembler();
  let out = null;
  for (const f of frames) out = r.push('peerA', f) || out;
  assert.deepStrictEqual(dec(decodePacket(out).payload), big);
  ok(`fragmentation+reassembly across ${frames.length} BLE frames`);
}

// 3. out-of-order reassembly
{
  const p = { type: PacketType.MESSAGE, id: rid(8), from: '0'.repeat(32),
    to: '', ttl: 7, ts: Date.now(), channel: 'mesh', payload: enc('y'.repeat(500)) };
  const frames = fragment(encodePacket(p), 9).reverse(); // arrive backwards
  const r = new Reassembler();
  let out = null;
  for (const f of frames) out = r.push('peerB', f) || out;
  assert.ok(out && dec(decodePacket(out).payload) === 'y'.repeat(500));
  ok('reassembly works even when frames arrive out of order');
}

// 4. MULTI-HOP delivery: A — B — C  (A and C are NOT directly connected)
{
  const A = new SimNode('a'.repeat(32));
  const B = new SimNode('b'.repeat(32));
  const C = new SimNode('c'.repeat(32));
  A.connect(B); B.connect(A);          // A <-> B
  B.connect(C); C.connect(B);          // B <-> C   (A cannot reach C directly)
  A.originate('SOS από τον Α!');
  const atC = C.delivered.find((m) => m.text === 'SOS από τον Α!');
  assert.ok(atC, 'message reached C');
  assert.strictEqual(atC.hops, 2, 'C sees it as 2 hops away');
  assert.strictEqual(B.relayCount, 1, 'B relayed exactly once');
  ok('multi-hop flood: A→B→C delivered at correct hop count');
}

// 5. DEDUP / loop suppression in a triangle  A—B—C—A
{
  const A = new SimNode('a'.repeat(32));
  const B = new SimNode('b'.repeat(32));
  const C = new SimNode('c'.repeat(32));
  [[A,B],[B,A],[B,C],[C,B],[A,C],[C,A]].forEach(([x,y]) => x.connect(y));
  A.originate('μία φορά μόνο');
  // each of B and C must deliver the message exactly once despite the loop
  const bCount = B.delivered.filter((m) => m.text === 'μία φορά μόνο').length;
  const cCount = C.delivered.filter((m) => m.text === 'μία φορά μόνο').length;
  assert.strictEqual(bCount, 1, 'B delivered once');
  assert.strictEqual(cCount, 1, 'C delivered once');
  ok('dedup suppresses loops in a cyclic mesh (delivered exactly once)');
}

// 6. TTL exhaustion stops infinite propagation
{
  // chain of 10 nodes; TTL 7 means it can travel at most 7 hops
  const nodes = Array.from({ length: 10 }, (_, i) => new SimNode(String(i).repeat(32).slice(0,32)));
  for (let i = 0; i < nodes.length - 1; i++) { nodes[i].connect(nodes[i+1]); nodes[i+1].connect(nodes[i]); }
  nodes[0].originate('μακρινό μήνυμα');
  const reached = nodes.map((n) => n.delivered.some((m) => m.text === 'μακρινό μήνυμα'));
  const maxReached = reached.lastIndexOf(true);
  assert.ok(maxReached <= 7, `propagation bounded by TTL (reached node ${maxReached})`);
  ok(`TTL bounds propagation (reached node #${maxReached}, ≤7 as designed)`);
}

console.log(`\n\x1b[32m${pass}/6 tests passed\x1b[0m — mesh engine verified.\n`);
