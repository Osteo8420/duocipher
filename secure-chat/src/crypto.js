// Toute la cryptographie utilise l'API Web Crypto native du navigateur.
// Aucune librairie de chiffrement tierce : zéro dépendance externe pour la sécurité elle-même.

import { get, set } from 'idb-keyval';

const KEYPAIR_STORAGE_KEY = 'secure-chat-keypair-v1';

function arrayBufferToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// Génère la paire de clés ECDH (courbe P-256) d'identité de cet appareil,
// ou récupère celle déjà stockée localement (IndexedDB). La clé privée
// n'est pas exportable et ne quitte jamais l'appareil ; elle ne sert
// qu'au tout premier accord de clé (racine du Double Ratchet, voir
// ratchet.js) — jamais à chiffrer un message directement.
export async function getOrCreateKeyPair() {
  const existing = await get(KEYPAIR_STORAGE_KEY);
  if (existing) return existing;

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // la clé publique reste exportable même à false ; ça évite que la clé PRIVÉE le soit
    ['deriveBits']
  );
  await set(KEYPAIR_STORAGE_KEY, keyPair);
  return keyPair;
}

// Paire de clés éphémère, générée à la volée pour chaque pas du Double
// Ratchet — jamais stockée.
export async function generateEphemeralKeyPair() {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}

export async function exportPublicKeyB64(publicKey) {
  const raw = await crypto.subtle.exportKey('raw', publicKey);
  return arrayBufferToBase64(raw);
}

export async function importPeerPublicKey(b64) {
  const raw = base64ToArrayBuffer(b64);
  return crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

// Diffie-Hellman brut : renvoie les octets du secret partagé (et non une
// clé AES toute faite), pour pouvoir les injecter dans le KDF du Double
// Ratchet.
export async function dh(privateKey, publicKey) {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  return new Uint8Array(bits);
}

export async function hkdf(inputKeyMaterial, salt, infoString, lengthBytes) {
  const key = await crypto.subtle.importKey('raw', inputKeyMaterial, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(infoString) },
    key,
    lengthBytes * 8
  );
  return new Uint8Array(bits);
}

export async function hmacSha256(keyBytes, messageBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, messageBytes);
  return new Uint8Array(sig);
}

// Accord de clé initial (l'équivalent du X3DH simplifié) : ECDH entre les
// deux identités d'appareil, étendu par HKDF pour servir de racine au
// Double Ratchet.
export async function deriveInitialRootKey(myPrivateKey, peerPublicKey) {
  const shared = await dh(myPrivateKey, peerPublicKey);
  return hkdf(shared, new Uint8Array(32), 'secure-chat-initial-root-key', 32);
}

export async function encryptWithKey(keyBytes, plaintext) {
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return arrayBufferToBase64(combined);
}

export async function decryptWithKey(keyBytes, b64) {
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const combined = base64ToArrayBuffer(b64);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plainBuf);
}

// Code de vérification affiché sur les deux appareils pour détecter une
// attaque de l'homme du milieu lors de l'échange initial (comme les "codes
// de sécurité" de Signal) : les deux clés publiques triées puis hachées
// donnent la même valeur des deux côtés seulement si personne ne s'est
// inséré au milieu du handshake.
export async function computeSafetyNumber(pubKeyB64A, pubKeyB64B) {
  const [first, second] = [pubKeyB64A, pubKeyB64B].sort();
  const combined = new TextEncoder().encode(first + second);
  const hash = await crypto.subtle.digest('SHA-256', combined);
  const bytes = Array.from(new Uint8Array(hash)).slice(0, 5);
  return bytes.map((b) => String(b).padStart(3, '0')).join(' ');
}

export function randomRoomId() {
  return arrayBufferToBase64(crypto.getRandomValues(new Uint8Array(9)))
    .replace(/[+/=]/g, '')
    .slice(0, 12);
}
