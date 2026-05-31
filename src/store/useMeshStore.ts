// ─────────────────────────────────────────────────────────────
// src/store/useMeshStore.ts — app state + MeshNode lifecycle
// ─────────────────────────────────────────────────────────────
import { create } from 'zustand';
import { MeshNode } from '../mesh/MeshNode';
import { BleTransport } from '../ble/BleTransport';
import { MockTransport } from '../mesh/MockTransport';
import { loadOrCreateIdentity, panicWipe, setHandle } from '../crypto/identity';
import { ChatMessage, Peer } from '../mesh/types';
import { Peripheral } from '../ble/NativeFarosBle';
import type { Identity } from '../crypto/identity';

/** Held outside the store so handlers can mutate the live identity. */
let identityRef: Identity | undefined;

/** Use the mock transport when running on a simulator or before the
 *  native peripheral module is linked, so the app is always usable. */
const useMock = !Peripheral.available || __DEV__;

interface MeshState {
  ready: boolean;
  mock: boolean;
  myId: string;
  myHandle: string;
  peers: Peer[];
  messages: ChatMessage[];
  channel: string;
  sosActive: boolean;
  node?: MeshNode;

  init: () => Promise<void>;
  send: (text: string) => void;
  triggerSOS: (note?: string) => Promise<void>;
  setChannel: (c: string) => void;
  updateHandle: (handle: string) => Promise<void>;
  wipe: () => Promise<void>;
}

export const useMeshStore = create<MeshState>((set, get) => ({
  ready: false,
  mock: useMock,
  myId: '',
  myHandle: '',
  peers: [],
  messages: [],
  channel: 'mesh',
  sosActive: false,

  init: async () => {
    if (get().node) return;
    const identity = await loadOrCreateIdentity();
    identityRef = identity;
    const transport = useMock ? new MockTransport() : new BleTransport();
    const node = new MeshNode(identity, transport);

    node.setHandlers({
      message: (m) =>
        set((s) => ({
          messages: [...s.messages, m].slice(-500),
          sosActive: s.sosActive || !!m.sos,
        })),
      peers: (peers) => set({ peers }),
      status: (id, status, hops) =>
        set((s) => ({
          messages: s.messages.map((m) => (m.id === id ? { ...m, status, hops } : m)),
        })),
    });

    await node.start();
    set({
      node,
      ready: true,
      myId: identity.peerId,
      myHandle: identity.handle,
      messages: [
        {
          id: 'sys-boot',
          channel: 'mesh',
          from: 'sys',
          handle: 'ΦΑΡΟΣ',
          text: useMock
            ? 'Ενεργός σε MOCK mode — προσομοίωση γειτονιάς.'
            : 'Ενεργός · σαρώνω για κοντινές συσκευές…',
          ts: Date.now(),
          hops: 0,
          mine: false,
          encrypted: false,
          status: 'delivered',
        },
      ],
    });
  },

  send: (text) => {
    const { node, channel } = get();
    if (!node || !text.trim()) return;
    const id = node.sendChannel(channel, text.trim());
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id,
          channel,
          from: node.myId,
          handle: node.myHandle,
          text: text.trim(),
          ts: Date.now(),
          hops: 0,
          mine: true,
          encrypted: true,
          status: 'sending',
        },
      ],
    }));
    // optimistic → relayed
    setTimeout(
      () =>
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === id && m.status === 'sending' ? { ...m, status: 'relayed' } : m,
          ),
        })),
      900,
    );
  },

  triggerSOS: async (note) => {
    const { node } = get();
    if (!node) return;
    set({ channel: 'sos', sosActive: true });
    const id = await node.sendSOS(note ?? '');
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id,
          channel: 'sos',
          from: node.myId,
          handle: node.myHandle,
          text: note || 'ΕΚΠΕΜΠΩ ΣΗΜΑ ΚΙΝΔΥΝΟΥ — τοποθεσία κοινοποιήθηκε στο mesh',
          ts: Date.now(),
          hops: 0,
          mine: true,
          encrypted: true,
          status: 'relayed',
          sos: true,
        },
      ],
    }));
  },

  setChannel: (channel) => set({ channel }),

  updateHandle: async (handle) => {
    const { node } = get();
    if (identityRef) await setHandle(identityRef, handle);
    set({ myHandle: handle });
    node?.announce(); // tell neighbours our new handle
  },

  wipe: async () => {
    const { node } = get();
    await node?.stop();
    await panicWipe();
    set({ node: undefined, ready: false, peers: [], messages: [], sosActive: false });
  },
}));
