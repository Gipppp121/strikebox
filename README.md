# strikebox

Browser team deathmatch in first person. Pick CT or T and play against everyone who opened the same link. Up to 16 players per room; when a room is full the next player opens a new one.

## Run it on your computer

Needs Node.js 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:8080 and pick a team. Open a second tab to play against yourself.

People on the same Wi-Fi can join with your local IP, for example http://192.168.0.12:8080.

| setting | default | what it does |
|---|---|---|
| `PORT` | 8080 | port for the page and the game server |
| `BOTS` | 0 | bots per team when a team is short, 0 means humans only |
| `MAX_ROOM` | 16 | players per room, split between the teams |
| `MAX_CONN` | 400 | connections on the whole server |
| `MAX_PER_IP` | 4 | connections from one address |

## Put it online

Any host that runs Node and supports WebSockets works. On Render:

1. Push this folder to a GitHub repo.
2. On render.com: New, Web Service, pick the repo.
3. Build command `npm install`, start command `npm start`.
4. Open the `onrender.com` link it gives you. Post that link on X.

## Controls

| key | action |
|---|---|
| WASD | move |
| mouse | aim |
| left click | shoot |
| R | reload |
| Space | jump |
| Shift | walk |
| Tab | scoreboard |
| M | switch team |
| Esc | release the mouse |
| N | sound on or off |

On a phone, turn it sideways. Left thumb moves, right thumb looks, hold FIRE to shoot and aim at the same time. TEAM and SCORE are in the top left corner.

Phones get lighter graphics: no shadows, no antialiasing, lower resolution. Sounds are made in the browser, no audio files.

## How it works

`server.js` runs the rooms. Each room keeps every player's position, health and score, checks every shot against the map and the other players, and sends a snapshot to everyone 15 times a second. Damage is decided on the server, not in the browser.

What keeps it up: messages over 2 KB are dropped, every connection is rate limited and cut off if it floods, every number from a client is checked, dead connections are closed after 15 seconds, slow clients are skipped instead of queued, and an error in one room does not stop the others. `/health` returns rooms, players and sockets.

`public/game.js` draws the map with three.js, moves your player, and smooths everyone else between snapshots.

`public/shared.js` is the map and the collision and hit math, used by both sides.

The page has `twitter:card` player tags that point at `/embed` on whatever domain serves it, so once it is hosted on https the link can open as a playable card on X. Inside that card the mouse cannot always be locked, so the game falls back to: hold the left button to look and shoot.

## Files

```
server.js          match server and static files
public/index.html  page, HUD, menu
public/game.js     client
public/shared.js   map, collision, hit tests
public/sfx.js      synthesized sounds
public/vendor/     three.js
```
