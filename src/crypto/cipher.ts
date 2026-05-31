// ─────────────────────────────────────────────────────────────
// src/crypto/cipher.ts — payload encryption
//
// Direct messages: nacl.box (X25519 + XSalsa20-Poly1305) between
//   sender secret key and recipient public key. Authenticated.
// Channel/broadcast messages: signed plaintext payload (anyone in
//   range can read a public channel, but origin is verifiable).
// ─────────────────────────────────────────────────────────────
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

const enc = (s: string) => util.decodeUTF8(s);
const dec = (b: Uint8Array) => util.encodeUTF8(b);

export interface Encrypted {
  nonce: Uint8Array;
  box: Uint8Array;
}

/** Encrypt text for a specific recipient public key. */
export function sealDM(
  text: string,
  recipientPub: Uint8Array,
  senderSecret: Uint8Array,
): Uint8Array {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(enc(text), nonce, recipientPub, senderSecret);
  const out = new Uint8Array(nonce.length + box.length);
  out.set(nonce);
  out.set(box, nonce.length);
  return out;
}

/** Decrypt a DM payload from a known sender public key. */
export function openDM(
  payload: Uint8Array,
  senderPub: Uint8Array,
  recipientSecret: Uint8Array,
): string | null {
  const nonce = payload.slice(0, nacl.box.nonceLength);
  const box = payload.slice(nacl.box.nonceLength);
  const opened = nacl.box.open(box, nonce, senderPub, recipientSecret);
  return opened ? dec(opened) : null;
}

/**
 * Channel payload: [handleLen:1][handle][text].
 * Public-channel text is readable by neighbours by design (group chat),
 * but we still carry the origin handle inside the authenticated packet.
 */
export function packChannelPayload(handle: string, text: string): Uint8Array {
  const h = enc(handle);
  const t = enc(text);
  const out = new Uint8Array(1 + h.length + t.length);
  out[0] = h.length;
  out.set(h, 1);
  out.set(t, 1 + h.length);
  return out;
}

export function unpackChannelPayload(payload: Uint8Array): { handle: string; text: string } {
  const hLen = payload[0];
  return {
    handle: dec(payload.slice(1, 1 + hLen)),
    text: dec(payload.slice(1 + hLen)),
  };
}

export { util };
