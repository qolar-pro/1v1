# BREACH 1v1

A top-down 2.5D tactical shooter for the browser. Two players, one link, no accounts, no server. Inspired by round-based tactical shooters, built as its own thing — original weapons, original maps.

> **This is Phase 1 of a multi-phase build in progress.** See `BUILD_PROGRESS.md` for current status, what's implemented, and what's still ahead. Right now: two players can create/join a match by link and move around as colored dots with host-authoritative netcode. No combat, maps, or economy yet.

## Running it

```bash
npm install
npm run dev
```

Open the printed local URL, click **Create Match**, and open the share link it gives you in a second tab (or send it to someone else) to join as the second player.

## Building for deployment

```bash
npm run build
```

Produces a static `dist/` folder. Drop it on Netlify, Vercel, GitHub Pages, or any static host — no server, no configuration.

## Networking model

Pure peer-to-peer over WebRTC (via [Trystero](https://github.com/dmotz/trystero), serverless signaling). The player who creates the match is the **host** and runs the only real game simulation; the joining player is a thin client.

```
   Host (authoritative)                    Joiner (thin client)
   ┌──────────────────┐                    ┌──────────────────┐
   │ own input         │                   │ own input         │
   │  → simulate now    │                  │  → predict locally │
   │                    │   input @ 60fps   │  → send to host    │
   │ joiner input queue │ <───────────────  │                    │
   │  → applied @ 30Hz   │                  │                    │
   │                    │  snapshot @ 30Hz  │  → reconcile        │
   │ world state         │ ───────────────> │  → interpolate host │
   └──────────────────┘                    └──────────────────┘
```

- **Host → client**: authoritative snapshots at 30Hz (positions, angles, velocities).
- **Client → host**: input packets every client frame.
- **Client-side prediction**: the joiner simulates its own movement immediately using the same movement code the host runs, then reconciles against each incoming snapshot (small corrections glide in over 100ms; larger ones snap).
- **Remote interpolation**: both sides render the other player ~100ms in the past, interpolated between the two most recent samples, and freeze (never extrapolate) past 250ms.

**The host can cheat.** There is no server to stop it — a modified host client could ignore hit detection, see through walls, etc. Only play with people you trust. This tradeoff is what makes the game free to run with zero infrastructure.

## Swapping art

All visuals are procedural (drawn in code) for now — see `src/render/GameScene.ts`. Once the game is fully playable, `src/data/assets.manifest.ts` (added in a later phase) will map logical asset keys to either a procedural generator or a file in `public/assets/`, so swapping in generated art will be a manifest edit, not a code change.

## Project layout

See `BUILD_PROGRESS.md` for the phase-by-phase build order and decision log. Source layout follows:

```
src/
  main.ts        bootstrap, room routing
  net/            Trystero wiring, host/client sessions, wire protocol
  sim/            pure simulation code — no Phaser, no DOM, deterministic
  render/         Phaser scene(s)
  ui/             DOM overlays (menu, debug HUD)
  config.ts       tunable constants
```
