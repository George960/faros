// ─────────────────────────────────────────────────────────────
// src/mesh/MeshNode.ts — the mesh routing engine
//
// Responsibilities:
//  • encode/sign/encrypt outgoing packets
//  • flood-forward packets with TTL + duplicate suppression
//  • reassemble fragments, decode, decrypt, and surface app events
//  • track neighbours and infer hop distance
// ─────────────────────────────────────────────────────────────
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import { Transport, NeighbourInfo } from './transport';
import { encodePacket, decodePacket } from './protocol';
import { fragment, Reassembler } from './fragment';
import { openDM, packChannelPayload, sealDM, unpackChannelPayload } from '../crypto/cipher';
import { Identity } from '../crypto/identity';
import {
  ChatMessage,
  DEDUP_TTL_MS,
  DEFAULT_TTL,
  MeshPacket,
  PacketType,
  Peer,
  PEER_TIMEOUT_MS,
} from './types';
import { Outbox } from './Outbox';
import { encodeFix, getFix } from '../location/geo';

type MessageHandler = (m: ChatMessage) => void;
type PeerHandler = (peers: Peer[]) => void;
type StatusHandler = (packetId: string, status: ChatMessage['status'], hops: number) => void;

const rid = (n: number) =>
  Array.from(nacl.randomBytes(n), (b) => b.toString(16).padStart(2, '0')).join('');

export class MeshNode {
  private peers = new Map<string, Peer>();
  private keys = new Map<string, Uint8Array>(); // peerId -> pubKey
  private seen = new Map<string, number>(); // packetId -> ts (dedup)
  private linkToPeer = new Map<string, string>(); // transport link -> peerId
  private reasm = new Reassembler();
  private fragSeq = 0;
  private sweeper?: ReturnType<typeof setInterval>;
  private outbox = new Outbox();

  private onMessage?: MessageHandler;
  private onPeers?: PeerHandler;
  private onStatus?: StatusHandler;

  constructor(private id: Identity, private transport: Transport) {}

  // ── lifecycle ──
  async start() {
    await this.outbox.load();
    this.transport.onFrame((link, frame, rssi) => this.handleFrame(link, frame, rssi));
    this.transport.onNeighbours((nb) => this.handleNeighbours(nb));
    await this.transport.start(this.id.peerId);
    this.announce();
    this.sweeper = setInterval(() => this.sweep(), 10000);
  }
  async stop() {
    if (this.sweeper) clearInterval(this.sweeper);
    await this.transport.stop();
  }

  // ── subscriptions ──
  setHandlers(h: { message?: MessageHandler; peers?: PeerHandler; status?: StatusHandler }) {
    this.onMessage = h.message;
    this.onPeers = h.peers;
    this.onStatus = h.status;
  }

  // ── outbound API ──
  announce() {
    const payload = packChannelPayload(this.id.handle, util.encodeBase64(this.id.publicKey));
    this.originate(PacketType.ANNOUNCE, '', '', payload);
  }

  sendChannel(channel: string, text: string): string {
    const payload = packChannelPayload(this.id.handle, text);
    return this.originate(PacketType.MESSAGE, '', channel, payload);
  }

  sendDM(toPeerId: string, text: string): string | null {
    const pub = this.keys.get(toPeerId);
    if (!pub) return null;
    const payload = sealDM(text, pub, this.id.secretKey);
    return this.originate(PacketType.MESSAGE, toPeerId, 'dm', payload);
  }

  async sendSOS(note: string): Promise<string> {
    const fix = await getFix();
    const body = note || 'ΣΗΜΑ ΚΙΝΔΥΝΟΥ';
    // payload format: "note\n@lat,lon,acc" (location omitted if unavailable)
    const text = fix ? `${body}\n@${encodeFix(fix)}` : body;
    const payload = packChannelPayload(this.id.handle, text);
    return this.originate(PacketType.SOS, '', 'sos', payload);
  }

  /** Re-flood pending store-and-forward packets (called when peers appear). */
  private flushOutbox() {
    for (const o of this.outbox.pending()) {
      const bytes = util.decodeBase64(o.bytesB64);
      const id = this.fragSeq++ & 0xffff;
      for (const frame of fragment(bytes, id)) this.transport.broadcast(frame).catch(() => {});
    }
  }

  private originate(type: PacketType, to: string, channel: string, payload: Uint8Array): string {
    const packet: MeshPacket = {
      type,
      id: rid(8),
      from: this.id.peerId,
      to,
      ttl: DEFAULT_TTL,
      ts: Date.now(),
      channel,
      payload,
    };
    this.seen.set(packet.id, Date.now());
    const bytes = encodePacket(packet);
    // keep MESSAGE/SOS for store-and-forward retransmission
    if (type === PacketType.MESSAGE || type === PacketType.SOS) {
      this.outbox.add(packet.id, util.encodeBase64(bytes));
    }
    this.floodBytes(bytes);
    return packet.id;
  }

  // ── inbound ──
  private handleFrame(link: string, frame: Uint8Array, rssi: number) {
    const packetBytes = this.reasm.push(link, frame);
    if (!packetBytes) return; // still reassembling
    const packet = decodePacket(packetBytes);
    if (!packet) return;

    // duplicate suppression
    if (this.seen.has(packet.id)) return;
    this.seen.set(packet.id, Date.now());

    // learn neighbour ↔ peer mapping + hop distance
    const hops = DEFAULT_TTL - packet.ttl + 1;
    if (hops === 1) this.linkToPeer.set(link, packet.from);
    this.touchPeer(packet.from, rssi, hops);

    switch (packet.type) {
      case PacketType.ANNOUNCE:
        this.ingestAnnounce(packet, rssi, hops);
        break;
      case PacketType.MESSAGE:
      case PacketType.SOS:
        this.ingestMessage(packet, hops);
        break;
      case PacketType.ACK: {
        const ackedId = util.encodeUTF8(packet.payload);
        this.outbox.markAcked(ackedId);
        this.onStatus?.(ackedId, 'delivered', hops);
        break;
      }
    }

    // relay onward if TTL remains and not addressed solely to us
    if (packet.ttl > 1 && packet.to !== this.id.peerId) {
      this.floodBytes(encodePacket({ ...packet, ttl: packet.ttl - 1 }));
    }
  }

  private ingestAnnounce(p: MeshPacket, rssi: number, hops: number) {
    const { handle, text: pubB64 } = unpackChannelPayload(p.payload);
    try {
      this.keys.set(p.from, util.decodeBase64(pubB64));
    } catch {}
    const peer = this.peers.get(p.from);
    if (peer) {
      peer.handle = handle;
      peer.verified = true;
      peer.pubKey = pubB64;
      this.touchPeer(p.from, rssi, hops);
    }
    this.emitPeers();
  }

  private ingestMessage(p: MeshPacket, hops: number) {
    let handle = this.peers.get(p.from)?.handle ?? p.from.slice(0, 6);
    let text: string;
    let encrypted = false;

    if (p.channel === 'dm') {
      const pub = this.keys.get(p.from);
      const opened = pub ? openDM(p.payload, pub, this.id.secretKey) : null;
      if (!opened) return; // not for us / undecryptable
      text = opened;
      encrypted = true;
    } else {
      const unpacked = unpackChannelPayload(p.payload);
      handle = unpacked.handle || handle;
      text = unpacked.text;
    }

    const msg: ChatMessage = {
      id: p.id,
      channel: p.type === PacketType.SOS ? 'sos' : p.channel || 'mesh',
      from: p.from,
      handle,
      text,
      ts: p.ts,
      hops,
      mine: false,
      encrypted,
      status: 'delivered',
      sos: p.type === PacketType.SOS,
    };
    this.onMessage?.(msg);

    // auto-ack direct messages addressed to us
    if (p.to === this.id.peerId) this.sendAck(p.id, p.from);
  }

  private sendAck(packetId: string, to: string) {
    this.originate(PacketType.ACK, to, '', util.decodeUTF8(packetId));
  }

  // ── neighbours ──
  private lastNbCount = 0;
  private handleNeighbours(nb: NeighbourInfo[]) {
    // prune links that vanished
    const active = new Set(nb.map((n) => n.link));
    for (const [link] of this.linkToPeer) if (!active.has(link)) this.linkToPeer.delete(link);
    // re-announce so freshly connected neighbours learn us
    this.announce();
    // a new neighbour appeared → retry pending store-and-forward packets
    if (nb.length > this.lastNbCount) this.flushOutbox();
    this.lastNbCount = nb.length;
  }

  private touchPeer(peerId: string, rssi: number, hops: number) {
    if (peerId === this.id.peerId) return;
    const existing = this.peers.get(peerId);
    this.peers.set(peerId, {
      id: peerId,
      handle: existing?.handle ?? peerId.slice(0, 6),
      pubKey: existing?.pubKey ?? '',
      rssi,
      hops: existing ? Math.min(existing.hops, hops) : hops,
      lastSeen: Date.now(),
      verified: existing?.verified ?? false,
    });
    this.emitPeers();
  }

  // ── plumbing ──
  private floodBytes(bytes: Uint8Array) {
    const id = this.fragSeq++ & 0xffff;
    for (const frame of fragment(bytes, id)) {
      this.transport.broadcast(frame).catch(() => {});
    }
  }

  private emitPeers() {
    this.onPeers?.(Array.from(this.peers.values()).sort((a, b) => a.hops - b.hops));
  }

  private sweep() {
    const now = Date.now();
    for (const [id, ts] of this.seen) if (now - ts > DEDUP_TTL_MS) this.seen.delete(id);
    for (const [id, p] of this.peers) if (now - p.lastSeen > PEER_TIMEOUT_MS) this.peers.delete(id);
    this.reasm.sweep();
    this.emitPeers();
  }

  get myId() {
    return this.id.peerId;
  }
  get myHandle() {
    return this.id.handle;
  }
  isMock() {
    return this.transport.isMock();
  }
}
