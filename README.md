# BREACH 1v1

A top-down 2.5D tactical shooter for the browser. Counter-Strike-style round structure, economy, and gunplay feel — rendered top-down with a vision cone. Two players, one link, no accounts, no server. Original weapons, original maps, no trademarked names or assets anywhere.

See `BUILD_PROGRESS.md` for the full build log and Director Decision history.

## Running it

```bash
npm install
npm run dev
```

Open the printed local URL. Pick a nickname and a map, click **Create Match**, and send the share link it gives you to the other player (or open it yourself in a second tab/browser) to join. Works cross-play between a desktop browser (WASD + mouse) and a phone (dual virtual sticks, landscape only).

## Building for deployment

```bash
npm run build
```

Produces a static `dist/` folder — drop it on Netlify, Vercel, GitHub Pages, or any static host with zero configuration. No server, no environment variables, no build-time secrets.

## Networking model

Pure peer-to-peer over WebRTC via [Trystero](https://github.com/dmotz/trystero) (nostr relays for signaling, falling back to BitTorrent trackers if nostr doesn't connect within 6s — no server either way). The player who creates the match is the **host** and runs the only real game simulation, round timer, economy, and hit detection; the joining player is a thin client.

```
   Host (authoritative)                     Joiner (thin client)
   ┌────────────────────┐                   ┌────────────────────┐
   │ own input            │                 │ own input            │
   │  → simulate now        │               │  → predict locally      │
   │                        │  input @ 60fps │  → send to host          │
   │ joiner input queue     │ <───────────── │                          │
   │  → applied @ 30Hz        │              │                          │
   │  → hitscan + lag comp      │            │                          │
   │  → rounds/economy/bomb       │          │                          │
   │                          snapshot @ 30Hz │  → reconcile own state    │
   │ world + match state       │ ───────────> │  → interpolate host        │
   └────────────────────┘                   │  → render vision/HUD/events │
                                             └────────────────────┘
```

- **Host → client**: snapshots at 30Hz — both players' full combat/economy state (position, hp, armor, weapon, ammo, money, round phase, bomb state) plus one-shot events (shots, plants, round transitions) for effects/audio.
- **Client → host**: input packets every client render frame, plus discrete buy/rematch requests on their own channel.
- **Client-side prediction**: the joiner predicts its own movement, ammo, reload, and inaccuracy locally using the exact same code the host runs, then reconciles against each incoming snapshot (small corrections glide in over 100ms; larger ones snap). Damage is never predicted — only the host can kill you.
- **Remote interpolation**: both sides render the other player ~100ms in the past, interpolated between the two most recent samples, frozen (never extrapolated) past 250ms.
- **Lag-compensated hitscan**: when resolving a shot, the host rewinds the *target's* hitbox to where it was at the shooter's perceived render time (accounting for the shooter's own interpolation delay, plus half their RTT if they're the client), capped at 250ms.
- **Fog of war**: both sides independently compute the same wall/smoke-occluded vision cone from authoritative positions, so the opponent is only ever rendered — and its effects (tracers, impacts) only ever shown — when actually visible. Never drawn through a wall.

**The host can cheat.** There is no server to stop it — a modified host client could ignore hit detection, see through walls, grant itself infinite money, etc. Only play with people you trust. This tradeoff is what makes the game free to run with zero infrastructure. There is no anti-cheat, and none is planned — see `BUILD_PROGRESS.md`.

## Swapping art

All visuals are procedural (drawn in code) — see `src/render/GameScene.ts`, `VisionRenderer.ts`, `Effects.ts`. This is Phase A of the spec's two-phase art plan; Phase B (swapping in generated textures/sprites through a `data/assets.manifest.ts` indirection) was not built this session — see the note at the bottom of `BUILD_PROGRESS.md` for why and what the next step looks like.

## Project layout

```
src/
  main.ts          bootstrap, room routing, nickname/map selection
  net/              Trystero wiring, host/client sessions, wire protocol
  sim/              pure simulation code — no Phaser, no DOM, deterministic
                     (movement, collision, raycast/vision, combat, rounds,
                      economy, grenades — shared verbatim by host and client)
  render/           Phaser scene, vision mask, effects, HUD, input schemes
  audio/            Web Audio engine + procedural sound synthesis
  ui/               DOM overlays: menu, buy sheet, scoreboard, results,
                     touch controls, connection status
  data/             weapons.ts (balance table), maps/*.json
  config.ts         tunable constants (speeds, timers, damage, prices, …)
```
