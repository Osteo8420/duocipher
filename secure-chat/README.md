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

## Mise en place (une seule fois)

### 1. Lancer le relais

Voir `/relay-server/README.md`. En local :

```
cd ../relay-server
npm install
npm start
```

### 2. Configurer les variables d'environnement de l'app

```
cp .env.example .env
# VITE_RELAY_URL=ws://localhost:8080 (ou wss://ton-domaine en prod)
```

### 3. Tester en local

```
npm install
npm run dev
```

### 4. Déployer

L'app est un site statique (Vite build) : n'importe quel hébergeur statique
convient (Vercel, Netlify, ou ton propre serveur). Le relais WebSocket, lui,
doit tourner en continu — voir `/relay-server/README.md` pour le déployer
sur un VPS derrière un reverse proxy TLS (`wss://`).

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
