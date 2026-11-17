# ePOS-Brief

Your personal daily briefing, delivered by thermal printer.

Application web (Node.js + Express + Bootstrap) qui imprime chaque matin un ticket de briefing sur une Epson TM-T88V en réseau : météo, tâches Trello avec cases à cocher, encart URGENT, agenda iCloud, info trafic train, état du homelab, actus RSS, anniversaires et zone de remarques à remplir au stylo.

## Installation

Prérequis : Node.js 20 ou plus, et PM2 (`npm install -g pm2`).

```bash
cd epos-brief
npm install --omit=dev
pm2 start ecosystem.config.js
pm2 save
pm2 startup    # affiche la commande à lancer pour redémarrer l'app au boot
```

L'interface est sur `http://<ip-du-serveur>:3000`. Le port et l'adresse d'écoute se changent dans `ecosystem.config.js` (`PORT`, `HOST`).

Au premier lancement, l'interface demande de créer le compte (un seul compte, mot de passe haché avec bcrypt).

Commandes utiles : `pm2 logs epos-brief`, `pm2 restart epos-brief`.

## Installation avec Docker

Prérequis : Docker avec le plugin Compose.

```bash
cd epos-brief
docker compose up -d --build
```

- L'interface est sur `http://<ip-du-serveur>:3000` (port à changer dans `docker-compose.yml`).
- Les données (réglages, compte, historique) sont dans le volume `epos-data`, conservé quand on reconstruit l'image.
- Mise à jour : remplacer les fichiers du projet, puis `docker compose up -d --build`.
- Logs : `docker compose logs -f`.
- Pas besoin de PM2 : Docker relance le conteneur (`restart: unless-stopped`), y compris au démarrage de la machine.
- L'imprimante et les services du réseau local (Uptime Kuma, Prometheus, Wallos) sont joignables depuis le conteneur par leur adresse IP habituelle.

Reprendre les réglages d'une installation PM2 : exporter les réglages avec les secrets (Réglages > Sauvegarde), puis les importer dans la nouvelle instance. Ou copier tout le dossier `data` dans le volume :

```bash
docker compose up -d
docker cp ./data/. epos-brief:/app/data/
docker compose exec -u root epos-brief chown -R node:node /app/data
docker compose restart
```

## Mise en route

1. **Réglages > Imprimante** : adresse IP de l'imprimante, port 9100, puis « Imprimer un ticket de test ». Le ticket de test vérifie les accents, la largeur (42 colonnes) et les tailles de caractères.
2. **Réglages > Planning** : heure d'impression et modèle de ticket pour chaque jour de la semaine (ou « Pas d'impression »).
3. Activer les sources voulues. Chaque onglet a un bouton « Tester » qui utilise les réglages enregistrés.
4. **Modèles** : aperçu des modèles, modèle personnalisé (blocs et ordre), logo ASCII, nombre de lignes de remarques.
5. **Tableau de bord** : aperçu du ticket avec les vraies données, « Imprimer maintenant », historique et réimpression.

## Sources

| Source | Ce qu'il faut | Remarques |
|---|---|---|
| Météo | rien | Open-Meteo, sans clé. Chercher la ville dans l'onglet. |
| Trello | clé d'API + token | trello.com/power-ups/admin. Une liste d'un tableau. L'étiquette `URGENT` (réglable) envoie la carte dans l'encart. |
| Agenda | identifiant Apple + mot de passe d'app | CalDAV sur `caldav.icloud.com`. Plusieurs calendriers à cocher, plus des liens ICS au choix. |
| Anniversaires | le même compte iCloud | Contacts lus en CardDAV, gardés 6 h en mémoire. |
| Train | clé d'API SNCF | numerique.sncf.com/startup/api. Encart imprimé seulement si un événement du jour contient le mot-clé (mot entier). |
| Homelab | clé d'API Uptime Kuma, adresse Prometheus | Uptime Kuma : page `/metrics`. Prometheus : alertes actives de gravité `critical` (réglable) via `/api/v1/alerts`. |
| Actus | adresses de flux RSS | Titres répartis entre les flux. |
| Marées | rien | API marine Open-Meteo, sans clé. Modèle Week-end. Courbe imprimée en image, ou horaires seuls. Hauteurs par rapport au niveau moyen, coefficient estimé. |
| Wallos | adresse + clé d'API | Prélèvements du jour ; le lundi, aussi ceux du week-end. |
| Ecowatt | ID client + ID secret RTE | data.rte-france.com, API Ecowatt v5. Encart seulement les jours orange ou rouge. |

Jours fériés et changements d'heure : calculés par l'app, sans API. Le planning permet de choisir le modèle des jours fériés, ou de ne pas imprimer.

Une source en panne n'empêche pas l'impression : son bloc affiche « indisponible » et le reste du ticket sort.

## Échecs d'impression

Avant d'imprimer, l'app interroge l'état de l'imprimante (capot ouvert, plus de papier). En cas d'échec d'une impression planifiée, elle réessaie (nombre de tentatives et délai réglables), puis envoie un message sur le webhook Discord si tout a échoué. Une impression manuelle n'est pas retentée : l'erreur s'affiche directement.

## Sauvegarde des réglages

Réglages > Sauvegarde : export de tous les réglages en JSON, avec ou sans les secrets (clés, tokens, mots de passe, webhook Discord), et import d'un fichier exporté. À l'import, les secrets vides ou absents du fichier gardent leur valeur actuelle. Le compte de connexion et l'historique ne sont pas exportés.

## Données et sécurité

- Tout est dans le dossier `data/` (réglages, compte, 90 derniers tickets). Le sauvegarder suffit pour tout restaurer.
- Les clés et mots de passe des sources sont stockés en clair dans `data/settings.db`. L'interface ne les réaffiche jamais.
- L'app est prévue pour un réseau local, en HTTP.

## Tests

```bash
npm install
npm test
```

Les tests utilisent une fausse imprimante TCP et des réponses d'API enregistrées. Aucun appel réseau externe.
