# Relais auto-hébergé pour secure-chat

Un serveur (une centaine de lignes, une seule dépendance : `ws`) qui
relaie des blobs déjà chiffrés entre les deux appareils d'un salon. Il ne
stocke rien sur disque et ne lit jamais le contenu des messages — il ne
fait que retransmettre. En option, il sert aussi le build statique de
l'app sur le même port, pour n'avoir qu'un seul serveur à déployer (pas
besoin de Vercel/Netlify en plus).

## Déploiement combiné (front + relais sur un seul serveur) — recommandé

```
cd ../secure-chat
npm install
npm run build        # génère secure-chat/dist

cd ../relay-server
npm install
npm start
```

Par défaut, `server.js` sert automatiquement `../secure-chat/dist` s'il
existe (structure du dépôt : les deux dossiers côte à côte) — rien à
configurer. Ouvre `http://localhost:8080` : l'app est servie, et se
connecte au relais sur cette même origine sans avoir besoin de
`VITE_RELAY_URL`.

## Déployer sur un VPS

1. Cloner le dépôt sur le serveur (ou copier `relay-server/` + `secure-chat/`).
2. `cd secure-chat && npm install && npm run build`
3. `cd ../relay-server && npm install --omit=dev`
4. Lancer en arrière-plan avec un gestionnaire de process (`pm2 start server.js`
   ou un service systemd).
5. Mettre un reverse proxy TLS devant (nginx, Caddy) — la caméra du
   navigateur (scan QR) exige HTTPS, et ça chiffre aussi le transport
   WebSocket (défense en profondeur : le contenu est déjà chiffré de bout
   en bout, mais ça évite de laisser voir en clair les métadonnées de
   connexion sur le réseau).

Exemple minimal avec Caddy (`Caddyfile`) — un seul port à exposer, HTTP et
WebSocket passent par le même reverse proxy :

```
tondomaine.fr {
  reverse_proxy localhost:8080
}
```

C'est tout : pas de variable d'environnement à renseigner côté app, le
front et le relais partagent la même origine.

## Déploiement séparé (front sur Vercel/Netlify, relais à part)

Toujours possible si tu préfères : ne lance que le relais (`STATIC_DIR=""
npm start` pour désactiver la partie statique), déploie `secure-chat/`
sur ton hébergeur statique préféré, et renseigne `VITE_RELAY_URL=wss://...`
dans ses variables d'environnement.

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
