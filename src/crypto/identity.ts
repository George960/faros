// ─────────────────────────────────────────────────────────────
// src/crypto/identity.ts — device identity (X25519 keypair)
//
// No accounts, no phone numbers. Your identity IS your keypair,
// generated on first launch and stored locally only.
// ─────────────────────────────────────────────────────────────
import AsyncStorage from '@react-native-async-storage/async-storage';
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

const KEY_STORE = '@faros/identity/v1';

export interface Identity {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  /** 16-byte hex id derived from the public key */
  peerId: string;
  handle: string;
}

const deriveId = (pub: Uint8Array): string =>
  Array.from(nacl.hash(pub).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');

const randomHandle = (): string => {
  const tag = Array.from(nacl.randomBytes(2), (b) => b.toString(16).padStart(2, '0')).join('');
  return `ΦΑΡΟΣ-${tag.toUpperCase()}`;
};

export async function loadOrCreateIdentity(): Promise<Identity> {
  const raw = await AsyncStorage.getItem(KEY_STORE);
  if (raw) {
    const parsed = JSON.parse(raw);
    const publicKey = util.decodeBase64(parsed.pub);
    return {
      publicKey,
      secretKey: util.decodeBase64(parsed.sec),
      peerId: deriveId(publicKey),
      handle: parsed.handle,
    };
  }
  const kp = nacl.box.keyPair(); // Curve25519
  const handle = randomHandle();
  await AsyncStorage.setItem(
    KEY_STORE,
    JSON.stringify({ pub: util.encodeBase64(kp.publicKey), sec: util.encodeBase64(kp.secretKey), handle }),
  );
  return { publicKey: kp.publicKey, secretKey: kp.secretKey, peerId: deriveId(kp.publicKey), handle };
}

export async function setHandle(id: Identity, handle: string): Promise<void> {
  id.handle = handle;
  await AsyncStorage.setItem(
    KEY_STORE,
    JSON.stringify({ pub: util.encodeBase64(id.publicKey), sec: util.encodeBase64(id.secretKey), handle }),
  );
}

/** PANIC WIPE — irreversibly destroy identity + all stored data. */
export async function panicWipe(): Promise<void> {
  await AsyncStorage.clear();
}

export { deriveId };
