# BREACH 1v1

A first-person tactical shooter for the browser. Counter-Strike-style round structure, economy, and gunplay feel, rendered in real 3D (Three.js, WebGL) with pointer-lock mouse-look. Two players, one link, no accounts, no server. Original weapons, original maps, no trademarked names or assets anywhere.

> This started as a top-down 2.5D build and was converted to full 3D first-person mid-project. See `BUILD_PROGRESS.md` — "The 3D pivot" — for what changed, what didn't, and why. The netcode/sim/rounds/economy layer is untouched by the pivot; only rendering, camera, and input changed.

See `BUILD_PROGRESS.md` for the full build log and Director Decision history.

## Running it

```bash
npm install
npm run dev
```

Open the printed local URL. Pick a nickname and a map, click **Create Match**, and send the share link it gives you to the other player (or open it yourself in a second tab/browser) to join. Click the game canvas to lock the mouse for looking around (standard FPS pointer-lock — click again if focus is lost). Works cross-play between a desktop browser (WASD + mouse-look) and a phone (virtual joystick + drag-to-look + a dedicated fire button, landscape only).

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
   └────────────────────┘                   │  → render 3D scene/HUD      │
                                             └────────────────────┘
```

- **Host → client**: snapshots at 30Hz — both players' full combat/economy state (position, facing/yaw, hp, armor, weapon, ammo, money, round phase, bomb state) plus one-shot events (shots, plants, round transitions) for effects/audio.
- **Client → host**: input packets every client render frame (movement relative to camera facing, camera yaw, buttons), plus discrete buy/rematch requests on their own channel.
- **Client-side prediction**: the joiner predicts its own movement, ammo, reload, and inaccuracy locally using the exact same code the host runs, then reconciles against each incoming snapshot (small corrections glide in over 100ms; larger ones snap). Damage is never predicted — only the host can kill you.
- **Remote interpolation**: both sides render the other player ~100ms in the past, interpolated between the two most recent samples, frozen (never extrapolated) past 250ms.
- **Lag-compensated hitscan**: when resolving a shot, the host rewinds the *target's* hitbox to where it was at the shooter's perceived render time (accounting for the shooter's own interpolation delay, plus half their RTT if they're the client), capped at 250ms.
- **Vision**: the simulation is still a flat 2D plane underneath (camera pitch is client-only and never affects hit detection), but visibility itself is now handled by real 3D occlusion — walls and props are actual 3D geometry, so the opponent is hidden behind them by ordinary WebGL depth-testing rather than a synthetic 2D vision-cone mask. `sim/raycast.ts`'s line-of-sight check is still used, just for a narrower job now: audio occlusion and whether to spawn cosmetic shot effects.

**The host can cheat.** There is no server to stop it — a modified host client could ignore hit detection, see through walls, grant itself infinite money, etc. Only play with people you trust. This tradeoff is what makes the game free to run with zero infrastructure. There is no anti-cheat, and none is planned — see `BUILD_PROGRESS.md`.

## Swapping art

All visuals are procedural (Three.js primitive geometry + flat materials, no textures) — see `src/render/Scene3D.ts` and `Effects.ts`. Generated-texture integration (Replicate) was started but is blocked on an MCP server restart to pick up an API token — see the Phase 8 note in `BUILD_PROGRESS.md`.

## Project layout

```
src/
  main.ts          bootstrap, room routing, nickname/map selection
  net/              Trystero wiring, host/client sessions, wire protocol
  sim/              pure simulation code — no renderer, no DOM, deterministic
                     (movement, collision, raycast/LOS, combat, rounds,
                      economy, grenades — shared verbatim by host and client)
  render/           Three.js scene/camera, effects, HUD wiring, input schemes
  audio/            Web Audio engine + procedural sound synthesis
  ui/               DOM overlays: menu, buy sheet, scoreboard, results,
                     touch controls, connection status
  data/             weapons.ts (balance table), maps/*.json
  config.ts         tunable constants (speeds, timers, damage, prices, …)
```
