// Double Ratchet (l'algorithme derrière Signal), version simplifiée.
//
// Deux mécanismes combinés :
// - Un ratchet symétrique (HMAC) : chaque message utilise une clé de
//   chiffrement différente, dérivée à sens unique de la précédente. Si une
//   clé de message fuit, elle ne permet de déchiffrer que CE message
//   (forward secrecy).
// - Un ratchet Diffie-Hellman : à chaque fois que la conversation change
//   de sens (l'autre personne répond), un nouveau secret DH est mélangé
//   dans la racine. Même si tout l'état d'une chaîne fuit, la conversation
//   "se soigne" toute seule dès l'échange suivant (post-compromise
//   security).
//
// Simplification assumée : cette appli n'a pas de file d'attente hors
// ligne (voir README) — les messages arrivent dans l'ordre sur une
// connexion WebSocket en direct. La gestion des clés de message "sautées"
// (nécessaire pour rattraper des messages arrivés dans le désordre ou
// après une coupure) n'est donc pas implémentée ici.

import {
  generateEphemeralKeyPair,
  exportPublicKeyB64,
  importPeerPublicKey,
  dh,
  hkdf,
  hmacSha256,
  encryptWithKey,
  decryptWithKey,
} from './crypto.js';

async function kdfRootKey(rootKey, dhOutput) {
  const output = await hkdf(dhOutput, rootKey, 'secure-chat-double-ratchet-root', 64);
  return { rootKey: output.slice(0, 32), chainKey: output.slice(32, 64) };
}

async function kdfChainKey(chainKey) {
  const messageKey = await hmacSha256(chainKey, new Uint8Array([0x01]));
  const nextChainKey = await hmacSha256(chainKey, new Uint8Array([0x02]));
  return { messageKey, nextChainKey };
}

export class DoubleRatchet {
  constructor() {
    this.dhSelf = null;     // CryptoKeyPair courant côté local
    this.dhPeerB64 = null;  // dernière clé publique connue du pair (base64)
    this.dhPeer = null;     // sa version importée (CryptoKey)
    this.rootKey = null;
    this.chainKeySend = null;
    this.chainKeyRecv = null;
  }

  // "Bob" : la personne qui a créé le salon et affiche le QR code. Elle
  // réutilise sa paire de clés d'identité comme premier tour du ratchet et
  // attend le premier message de l'autre pour obtenir sa chaîne d'envoi.
  static initAsResponder(rootKeySeed, ownIdentityKeyPair) {
    const r = new DoubleRatchet();
    r.dhSelf = ownIdentityKeyPair;
    r.rootKey = rootKeySeed;
    return r;
  }

  // "Alice" : la personne qui scanne le QR code. Elle génère tout de suite
  // une paire de clés éphémère et calcule sa première chaîne d'envoi à
  // partir de la clé d'identité de Bob (reçue dans le QR code).
  static async initAsInitiator(rootKeySeed, peerIdentityPublicKeyB64) {
    const r = new DoubleRatchet();
    r.dhSelf = await generateEphemeralKeyPair();
    r.dhPeerB64 = peerIdentityPublicKeyB64;
    r.dhPeer = await importPeerPublicKey(peerIdentityPublicKeyB64);
    const dhOutput = await dh(r.dhSelf.privateKey, r.dhPeer);
    const { rootKey, chainKey } = await kdfRootKey(rootKeySeed, dhOutput);
    r.rootKey = rootKey;
    r.chainKeySend = chainKey;
    return r;
  }

  async _dhRatchetStep(newPeerPublicKeyB64) {
    this.dhPeerB64 = newPeerPublicKeyB64;
    this.dhPeer = await importPeerPublicKey(newPeerPublicKeyB64);

    // Chaîne de réception : avec la paire de clés qu'on avait déjà.
    const dhRecv = await dh(this.dhSelf.privateKey, this.dhPeer);
    const recvKdf = await kdfRootKey(this.rootKey, dhRecv);
    this.rootKey = recvKdf.rootKey;
    this.chainKeyRecv = recvKdf.chainKey;

    // Chaîne d'envoi : on se génère une nouvelle paire de clés fraîche.
    this.dhSelf = await generateEphemeralKeyPair();
    const dhSend = await dh(this.dhSelf.privateKey, this.dhPeer);
    const sendKdf = await kdfRootKey(this.rootKey, dhSend);
    this.rootKey = sendKdf.rootKey;
    this.chainKeySend = sendKdf.chainKey;
  }

  async encrypt(plaintext) {
    if (!this.chainKeySend) {
      throw new Error("Pas de chaîne d'envoi : en attente du premier message du pair.");
    }
    const { messageKey, nextChainKey } = await kdfChainKey(this.chainKeySend);
    this.chainKeySend = nextChainKey;
    const ciphertext = await encryptWithKey(messageKey, plaintext);
    const header = { dh: await exportPublicKeyB64(this.dhSelf.publicKey) };
    return { header, ciphertext };
  }

  async decrypt(header, ciphertext) {
    if (header.dh !== this.dhPeerB64) {
      await this._dhRatchetStep(header.dh);
    }
    if (!this.chainKeyRecv) {
      throw new Error('Pas de chaîne de réception : le pair doit envoyer un premier message.');
    }
    const { messageKey, nextChainKey } = await kdfChainKey(this.chainKeyRecv);
    this.chainKeyRecv = nextChainKey;
    return decryptWithKey(messageKey, ciphertext);
  }
}
