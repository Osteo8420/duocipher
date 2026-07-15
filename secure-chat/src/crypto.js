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

// Génère une paire de clés ECDH (courbe P-256) ou récupère celle déjà stockée
// localement (IndexedDB) pour cet appareil. La clé privée ne quitte jamais
// l'appareil et n'est jamais transmise nulle part.
export async function getOrCreateKeyPair() {
  const existing = await get(KEYPAIR_STORAGE_KEY);
  if (existing) return existing;

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // la clé publique reste exportable même à false ; ça évite que la clé PRIVÉE le soit
    ['deriveKey']
  );
  await set(KEYPAIR_STORAGE_KEY, keyPair);
  return keyPair;
}

export async function exportPublicKeyB64(publicKey) {
  const raw = await crypto.subtle.exportKey('raw', publicKey);
  return arrayBufferToBase64(raw);
}

export async function importPeerPublicKey(b64) {
  const raw = base64ToArrayBuffer(b64);
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'ECDH', namedCurve: 'P-256' },
    [],
    []
  );
}

// Calcule le secret partagé (Diffie-Hellman sur courbe elliptique).
// Les deux appareils obtiennent la MÊME clé AES sans qu'elle ait jamais
// circulé sur le réseau — c'est le cœur mathématique du système.
export async function deriveSharedKey(privateKey, peerPublicKey) {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptMessage(sharedKey, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    new TextEncoder().encode(plaintext)
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return arrayBufferToBase64(combined);
}

export async function decryptMessage(sharedKey, b64) {
  const combined = base64ToArrayBuffer(b64);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    ciphertext
  );
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
