// ─────────────────────────────────────────────────────────────
// src/mesh/MockTransport.ts — runs the FULL mesh engine with no radios.
//
// Spawns a handful of virtual peers that announce themselves and chat,
// so you can run the real app on a simulator and watch the mesh work.
// Swap for BleTransport on a physical device build.
// ─────────────────────────────────────────────────────────────
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import { Transport, NeighbourInfo } from './transport';
import { encodePacket } from './protocol';
import { packChannelPayload } from '../crypto/cipher';
import { DEFAULT_TTL, PacketType } from './types';
import { deriveId } from '../crypto/identity';

const VIRTUAL = [
  { handle: 'ELENI', rssi: -52 },
  { handle: 'KOSTAS', rssi: -61 },
  { handle: 'MARIA', rssi: -74 },
  { handle: 'GIANNIS', rssi: -79 },
];

const CHATTER = [
  'Είμαι καλά, στο πάρκο.',
  'Ο δρόμος προς το κέντρο είναι κλειστός.',
  'Μαζευόμαστε στην πλατεία.',
  'Κανείς με power bank;',
];

const rid = (n: number) =>
  Array.from(nacl.randomBytes(n), (b) => b.toString(16).padStart(2, '0')).join('');

interface VirtualPeer {
  handle: string;
  rssi: number;
  kp: { publicKey: Uint8Array; secretKey: Uint8Array };
  peerId: string;
}

export class MockTransport implements Transport {
  private frameCb?: (link: string, f: Uint8Array, rssi: number) => void;
  private nbCb?: (n: NeighbourInfo[]) => void;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private peers = VIRTUAL.map((v) => {
    const kp = nacl.box.keyPair();
    return { ...v, kp, peerId: deriveId(kp.publicKey) };
  });

  isMock() {
    return true;
  }

  async start(): Promise<void> {
    // Stagger neighbour discovery.
    this.peers.forEach((p, i) => {
      this.timers.push(
        setTimeout(() => {
          this.emitAnnounce(p);
          this.pushNeighbours(i + 1);
        }, 900 + i * 1100),
      );
    });
    // Periodic ambient chatter.
    this.timers.push(
      setInterval(() => {
        const p = this.peers[Math.floor(Math.random() * this.peers.length)];
        this.emitMessage(p, CHATTER[Math.floor(Math.random() * CHATTER.length)]);
      }, 7000),
    );
  }

  async stop(): Promise<void> {
    this.timers.forEach(clearTimeout);
    this.timers.forEach(clearInterval as any);
    this.timers = [];
  }

  async broadcast(): Promise<void> {
    // In mock mode, neighbours auto-ack a moment later.
    this.timers.push(
      setTimeout(() => {
        const p = this.peers[0];
        if (p) this.emitMessage(p, 'Έλαβα το μήνυμά σου ✓', 'mesh');
      }, 1300),
    );
  }

  onFrame(cb: (link: string, f: Uint8Array, rssi: number) => void) {
    this.frameCb = cb;
  }
  onNeighbours(cb: (n: NeighbourInfo[]) => void) {
    this.nbCb = cb;
  }

  private pushNeighbours(count: number) {
    this.nbCb?.(
      this.peers.slice(0, count).map((p) => ({ link: 'mock:' + p.peerId, rssi: p.rssi })),
    );
  }

  private emitAnnounce(p: VirtualPeer) {
    const payload = packChannelPayload(p.handle, util.encodeBase64(p.kp.publicKey));
    const frame = encodePacket({
      type: PacketType.ANNOUNCE,
      id: rid(8),
      from: p.peerId,
      to: '',
      ttl: DEFAULT_TTL,
      ts: Date.now(),
      channel: '',
      payload,
    });
    this.frameCb?.('mock:' + p.peerId, frame, p.rssi);
  }

  private emitMessage(p: VirtualPeer, text: string, channel = 'mesh') {
    const frame = encodePacket({
      type: PacketType.MESSAGE,
      id: rid(8),
      from: p.peerId,
      to: '',
      ttl: DEFAULT_TTL,
      ts: Date.now(),
      channel,
      payload: packChannelPayload(p.handle, text),
    });
    this.frameCb?.('mock:' + p.peerId, frame, p.rssi);
  }
}
