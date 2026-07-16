# Relais auto-hébergé pour secure-chat

Un serveur WebSocket minimal (une centaine de lignes, une seule
dépendance : `ws`) qui relaie des blobs déjà chiffrés entre les deux
appareils d'un salon. Il ne stocke rien sur disque et ne lit jamais le
contenu des messages — il ne fait que retransmettre.

## Lancer en local

```
npm install
npm start
```

Le serveur écoute par défaut sur le port 8080 (`PORT=xxxx npm start` pour
changer). Il expose un unique endpoint WebSocket : `ws://host:port/?room=<id>`.

## Déployer sur un VPS

1. Copier ce dossier sur le serveur, `npm install --omit=dev`.
2. Lancer en arrière-plan avec un gestionnaire de process (`pm2 start server.js`
   ou un service systemd).
3. Mettre un reverse proxy TLS devant (nginx, Caddy) pour exposer du `wss://`
   plutôt que du `ws://` en clair — la caméra du navigateur (scan QR) exige
   déjà HTTPS côté app, autant chiffrer le transport WebSocket aussi (défense
   en profondeur : le contenu est déjà chiffré de bout en bout, mais ça évite
   de laisser voir en clair sur le réseau les métadonnées de connexion).

Exemple minimal avec Caddy (`Caddyfile`) :

```
relay.tondomaine.fr {
  reverse_proxy localhost:8080
}
```

4. Renseigner l'URL obtenue (`wss://relay.tondomaine.fr`) dans le `.env` de
   l'app (`VITE_RELAY_URL`).

## Limites honnêtes

- Pas de persistance : si un appareil est hors ligne, les messages envoyés
  entre-temps sont perdus (comme avant, avec Supabase).
- Pas d'authentification du serveur lui-même : n'importe qui connaissant
  l'URL du relais peut s'y connecter à un salon dont il connaît le
  `room_id` (limité à 2 connexions par salon). Le contenu reste illisible
  sans la clé partagée, mais l'opérateur du relais voit les métadonnées de
  connexion (IP, horodatage, taille des messages) de ses propres
  utilisateurs — c'est le compromis assumé pour rester simple (voir
  discussion sur le zéro-serveur/Tor dans le README principal).
