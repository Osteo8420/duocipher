// Client du relais auto-hébergé (voir /relay-server). Remplace Supabase :
// une simple connexion WebSocket, jamais de compte, jamais de base de
// données tierce. Le relais ne reçoit et ne retransmet que des blobs déjà
// chiffrés — il ne peut techniquement rien déchiffrer.

// Si VITE_RELAY_URL n'est pas défini, on suppose que le relais sert cette
// page lui-même (déploiement combiné front+relais sur un seul serveur, voir
// relay-server/README.md) et on se connecte à la même origine.
function sameOriginRelayUrl() {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}`;
}

const RELAY_URL = import.meta.env.VITE_RELAY_URL || sameOriginRelayUrl();

// Ouvre une connexion WebSocket vers un salon et l'utilise à la fois pour
// écouter (onMessage) et pour envoyer (send) — une seule connexion par
// participant, tenue ouverte pendant toute la conversation.
export function connectToRoom(roomId, onMessage) {
  const ws = new WebSocket(`${RELAY_URL}/?room=${encodeURIComponent(roomId)}`);
  const pendingSends = [];

  ws.onopen = () => {
    for (const payload of pendingSends.splice(0)) ws.send(JSON.stringify(payload));
  };
  ws.onmessage = (event) => {
    try {
      onMessage(JSON.parse(event.data));
    } catch {
      // message malformé : ignoré silencieusement
    }
  };

  return {
    send(payload) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
      else pendingSends.push(payload); // la connexion n'est pas encore ouverte
    },
    close() {
      ws.close();
    },
  };
}
