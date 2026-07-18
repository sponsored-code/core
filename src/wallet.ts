import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from "@noble/hashes/utils";

// EIP-191 personal_sign, client side. The private key never leaves this machine.

const strip0x = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);

export function addressFromPublicKey(pubUncompressed: Uint8Array): string {
  const hash = keccak_256(pubUncompressed.slice(1)); // drop the 0x04 prefix
  return "0x" + bytesToHex(hash.slice(-20));
}

export function addressFromPrivateKey(privHex: string): string {
  const pub = secp256k1.getPublicKey(hexToBytes(strip0x(privHex)), false);
  return addressFromPublicKey(pub);
}

function personalHash(message: string): Uint8Array {
  const msg = utf8ToBytes(message);
  const prefix = utf8ToBytes(`\x19Ethereum Signed Message:\n${msg.length}`);
  return keccak_256(concatBytes(prefix, msg));
}

/** Sign a UTF-8 message with EIP-191 personal_sign. Returns 0x r||s||v (65 bytes). */
export function signMessage(privHex: string, message: string): string {
  const sig = secp256k1.sign(personalHash(message), hexToBytes(strip0x(privHex)));
  const v = 27 + sig.recovery;
  return "0x" + bytesToHex(sig.toCompactRawBytes()) + v.toString(16).padStart(2, "0");
}

export const isValidPrivateKey = (k: string): boolean => /^0x[0-9a-fA-F]{64}$/.test(k);
