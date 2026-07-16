// Relais WebSocket minimal : transporte des blobs déjà chiffrés entre les
// deux appareils d'un même salon, sans jamais les lire ni les stocker.
// Aucune base de données, aucun compte, aucune dépendance à un tiers
// (Supabase, Firebase, etc.) — ce petit serveur est fait pour être
// auto-hébergé (VPS, Raspberry Pi...).

import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8080;
const MAX_ROOM_ID_LENGTH = 64;
const MAX_MESSAGE_BYTES = 64 * 1024; // une image encodée en base64 tiendrait large, un texte largement
const MAX_PEERS_PER_ROOM = 2; // conversation à deux, comme le reste de l'appli

const rooms = new Map(); // room_id -> Set<WebSocket>

function isValidRoomId(roomId) {
  return typeof roomId === 'string' && roomId.length > 0 && roomId.length <= MAX_ROOM_ID_LENGTH;
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://relay.local');
  const roomId = url.searchParams.get('room');

  if (!isValidRoomId(roomId)) {
    ws.close(1008, 'room invalide');
    return;
  }

  let peers = rooms.get(roomId);
  if (!peers) {
    peers = new Set();
    rooms.set(roomId, peers);
  }
  if (peers.size >= MAX_PEERS_PER_ROOM) {
    ws.close(1008, 'salon plein');
    return;
  }
  peers.add(ws);

  ws.on('message', (data, isBinary) => {
    if (data.length > MAX_MESSAGE_BYTES) return;
    // Relaie tel quel aux autres appareils du salon : le contenu n'est
    // jamais lu, jamais parsé, jamais stocké sur disque.
    for (const peer of peers) {
      if (peer !== ws && peer.readyState === peer.OPEN) {
        peer.send(data, { binary: isBinary });
      }
    }
  });

  ws.on('close', () => {
    peers.delete(ws);
    if (peers.size === 0) rooms.delete(roomId);
  });

  ws.on('error', () => ws.close());
});

console.log(`Relais chat sécurisé en écoute sur le port ${PORT}`);
