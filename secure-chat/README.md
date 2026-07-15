# Chat sécurisé — chiffrement de bout en bout

Messagerie web (PWA) entre deux téléphones. Le chiffrement se fait
entièrement sur les appareils ; le serveur (Supabase) ne relaie que des
blobs chiffrés qu'il ne peut jamais lire.

## Comment ça marche (résumé)

1. Chaque téléphone génère sa propre paire de clés ECDH (P-256) localement,
   au premier lancement. La clé privée ne quitte jamais l'appareil.
2. La personne A clique « Créer un salon » → un QR code s'affiche, contenant
   sa clé publique et un identifiant de salon aléatoire.
3. La personne B scanne ce QR code avec la caméra, puis renvoie sa propre
   clé publique dans le même salon (en clair — une clé publique n'est pas
   un secret).
4. Chaque téléphone calcule alors, indépendamment, le même secret partagé
   (Diffie-Hellman sur courbe elliptique) — ce secret ne circule jamais
   sur le réseau.
5. Tous les messages sont chiffrés avec AES-256-GCM avant d'être envoyés,
   et déchiffrés uniquement à la réception. Supabase ne stocke que du
   texte chiffré illisible.

## Mise en place (une seule fois)

### 1. Créer un projet Supabase (gratuit)
Aller sur https://supabase.com, créer un projet.

### 2. Créer la table qui relaie les messages chiffrés
Dans l'éditeur SQL de Supabase, exécuter :

```sql
create table messages (
  id bigint generated always as identity primary key,
  room_id text not null,
  payload jsonb not null,
  created_at timestamptz default now()
);

alter table messages enable row level security;

create policy "Anyone can insert" on messages
  for insert to anon with check (true);

create policy "Anyone can read" on messages
  for select to anon using (true);

alter publication supabase_realtime add table messages;
```

Note honnête : ces règles sont volontairement permissives (n'importe qui
connaissant un `room_id` peut lire/écrire dans ce salon) — exactement
comme un facteur qui accepte de transporter n'importe quelle enveloppe.
Ce n'est pas un problème de confidentialité puisque le contenu est
chiffré, mais retenez que le `room_id` doit rester aussi difficile à
deviner qu'un mot de passe (il l'est : 12 caractères aléatoires).

### 3. Récupérer les clés du projet
Dans Supabase : Project Settings → API → copier `Project URL` et `anon public key`.

### 4. Configurer les variables d'environnement
```
cp .env.example .env
# puis remplir VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY
```

### 5. Tester en local
```
npm install
npm run dev
```

### 6. Déployer sur Vercel
```
npm install -g vercel
vercel
```
Ajouter les deux variables d'environnement dans les réglages du projet
Vercel (Settings → Environment Variables), puis redéployer.

Une fois en ligne, ouvrez l'URL sur les deux téléphones (Safari/Chrome).
La caméra nécessite HTTPS — Vercel le fournit automatiquement.

## Limites honnêtes de cette version

- **La clé privée est techniquement exportable** (`extractable: true`)
  pour permettre l'export de la clé publique en QR code. Une version
  plus stricte utiliserait deux paires de clés distinctes ou une
  dérivation qui évite ce compromis.
- **Pas de vérification d'identité dans le temps** : si quelqu'un
  intercepte le tout premier QR code (l'échange initial), il peut
  s'insérer au milieu (attaque de l'homme du milieu). Signal résout ça
  avec des "codes de sécurité" à comparer périodiquement — non
  implémenté ici.
- **Historique non persistant** : les messages ne sont pas stockés
  après fermeture de l'app (aucune base de données locale). À ajouter
  si besoin (IndexedDB, chiffré aussi).
- **Un seul salon actif par navigateur** à la fois dans cette version.
