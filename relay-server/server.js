// Relais WebSocket minimal : transporte des blobs déjà chiffrés entre les
// deux appareils d'un même salon, sans jamais les lire ni les stocker.
// Sert aussi, en option, les fichiers statiques du build de l'app
// (secure-chat/dist) sur le même port — un seul process, un seul
// hébergeur, aucune dépendance à un tiers (Supabase, Vercel, etc.).

import { WebSocketServer } from 'ws';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 8080;
const MAX_ROOM_ID_LENGTH = 64;
const MAX_MESSAGE_BYTES = 64 * 1024; // une image encodée en base64 tiendrait large, un texte largement
const MAX_PEERS_PER_ROOM = 2; // conversation à deux, comme le reste de l'appli

// Par défaut, sert le build de l'app si présent juste à côté (structure du
// dépôt : secure-chat/ et relay-server/ côte à côte). STATIC_DIR permet de
// pointer ailleurs, ou de désactiver en mettant STATIC_DIR="".
const DEFAULT_STATIC_DIR = path.join(__dirname, '..', 'secure-chat', 'dist');
const STATIC_DIR = process.env.STATIC_DIR !== undefined
  ? (process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : null)
  : (fs.existsSync(DEFAULT_STATIC_DIR) ? DEFAULT_STATIC_DIR : null);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function serveStatic(req, res) {
  if (!STATIC_DIR) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Pas de front configuré (voir STATIC_DIR dans le README)');
    return;
  }

  const requestedPath = decodeURIComponent(new URL(req.url, 'http://relay.local').pathname);
  let filePath = path.join(STATIC_DIR, path.normalize(requestedPath));

  // Empêche de sortir du dossier statique (path traversal).
  if (filePath !== STATIC_DIR && !filePath.startsWith(STATIC_DIR + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || stat.isDirectory()) filePath = path.join(STATIC_DIR, 'index.html'); // fallback SPA
    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
      res.end(content);
    });
  });
}

const rooms = new Map(); // room_id -> Set<WebSocket>

function isValidRoomId(roomId) {
  return typeof roomId === 'string' && roomId.length > 0 && roomId.length <= MAX_ROOM_ID_LENGTH;
}

const httpServer = http.createServer(serveStatic);
const wss = new WebSocketServer({ server: httpServer });

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

httpServer.listen(PORT, () => {
  const staticInfo = STATIC_DIR ? ` + front (${STATIC_DIR})` : ' (sans front, STATIC_DIR non trouvé)';
  console.log(`Relais chat sécurisé en écoute sur le port ${PORT}${staticInfo}`);
});
