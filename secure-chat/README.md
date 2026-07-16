# Chat sécurisé — chiffrement de bout en bout

Messagerie web (PWA) entre deux téléphones. Le chiffrement se fait
entièrement sur les appareils ; le relais (auto-hébergé, voir
`/relay-server`) ne transporte que des blobs chiffrés qu'il ne peut jamais
lire, et il n'y a ni compte ni numéro de téléphone ni annuaire central.

## Comment ça marche (résumé)

1. Chaque téléphone génère sa propre paire de clés ECDH (P-256) d'identité
   localement, au premier lancement. La clé privée ne quitte jamais
   l'appareil.
2. La personne A clique « Créer un salon » → un QR code s'affiche, contenant
   sa clé publique et un identifiant de salon aléatoire.
3. La personne B scanne ce QR code avec la caméra, puis renvoie sa propre
   clé publique dans le même salon (en clair — une clé publique n'est pas
   un secret).
4. Chaque téléphone calcule alors, indépendamment, le même secret initial
   (Diffie-Hellman sur courbe elliptique) — ce secret ne circule jamais
   sur le réseau.
5. Ce secret initial sert de racine à un **Double Ratchet** (le même
   principe que Signal, voir `src/ratchet.js`) : chaque message est chiffré
   avec une clé différente, et chaque fois que la conversation change de
   sens, un nouveau secret Diffie-Hellman est mélangé dans la racine. Une
   clé qui fuit ne compromet ni les messages précédents (forward secrecy)
   ni, après quelques échanges, les suivants (post-compromise security).
6. Les messages chiffrés (AES-256-GCM) transitent par le relais WebSocket
   (`/relay-server`), qui ne fait que les retransmettre à l'autre appareil
   connecté au même salon — sans jamais les stocker ni les lire.

## Mise en place

### En développement (front et relais séparés, avec hot-reload)

```
cd ../relay-server && npm install && npm start   # relais sur :8080
cp .env.example .env                              # VITE_RELAY_URL=ws://localhost:8080
npm install && npm run dev                        # app sur :5173
```

### En production : un seul serveur (recommandé)

Le relais (`/relay-server`) peut aussi servir le build de l'app sur son
propre port — un seul process à déployer, aucun hébergeur tiers (pas de
Vercel). Voir `/relay-server/README.md` pour le détail ; en résumé :

```
npm run build            # génère secure-chat/dist
cd ../relay-server
npm install
npm start                 # sert l'app ET le relais sur le même port
```

Pas de `VITE_RELAY_URL` à renseigner dans ce cas : l'app se connecte
automatiquement à sa propre origine. Mettre un reverse proxy TLS
(Caddy/nginx) devant pour du `https://`/`wss://` — la caméra l'exige.

### Alternative : front sur Vercel/Netlify, relais à part

Toujours possible si tu préfères garder les deux séparés : déployer
`secure-chat/` (site statique) sur Vercel/Netlify, le relais ailleurs (VPS),
et renseigner `VITE_RELAY_URL=wss://...` dans les variables d'environnement
du front.

Une fois en ligne, ouvrez l'URL sur les deux téléphones (Safari/Chrome).
La caméra nécessite HTTPS.

## Limites honnêtes de cette version

- **Vérification d'identité au moment du handshake, pas dans la durée** :
  un code de sécurité (dérivé des deux clés publiques) s'affiche dans le
  chat pour être comparé à voix haute entre les deux téléphones, ce qui
  détecte une interception du tout premier QR code (attaque de l'homme
  du milieu). Mais rien ne re-vérifie ce code par la suite : si les
  deux personnes ne le comparent jamais, l'attaque reste possible.
- **Métadonnées visibles par l'opérateur du relais** : même auto-hébergé,
  le relais voit les IP, horodatages et tailles des messages de connexions
  à un salon donné (pas son contenu). Éliminer complètement cette fuite
  demanderait de sortir du navigateur (Tor ne tourne pas dans une PWA) —
  compromis assumé pour rester simple et utilisable sur iOS comme Android
  sans rien installer.
- **Historique non persistant** : les messages ne sont pas stockés
  après fermeture de l'app (aucune base de données locale, et le relais
  ne garde rien non plus). À ajouter si besoin (IndexedDB, chiffré aussi).
- **Un seul salon actif par navigateur** à la fois dans cette version.
- **Pas de rattrapage hors-ligne** : si un appareil se déconnecte, les
  messages envoyés entre-temps sont perdus (pas de file d'attente côté
  relais). Le Double Ratchet suppose une livraison en direct et dans
  l'ordre ; gérer les messages hors-ligne demanderait d'implémenter aussi
  la gestion des clés de message "sautées".
