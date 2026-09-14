# BREACH 1v1 — Build Progress

## Current phase

**Phase 1: Netcode skeleton — DONE.**
Next up: **Phase 2: World + vision** (map JSON loader, collision, raycast FOV, fog of war, Depot map).

## What's done (Phase 1)

- Vite + TypeScript (strict, `noUncheckedIndexedAccess`, no `any`) + Phaser 3 scaffolded. `npm run build` produces a static `dist/` with zero server config.
- Trystero P2P wired up: nostr signaling strategy first, falls back to the BitTorrent tracker strategy (`@trystero-p2p/torrent`) after a 6s timeout if no peer shows up (`src/net/trystero.ts`).
- Room id lives in the URL hash (`#r=XXXXXX`). Landing menu → **Create Match** generates the id, flags this tab as host in `localStorage`, and shows a copyable share link while waiting for a peer. Opening a link without the host flag joins as the client.
- `src/sim/` is pure (no Phaser/DOM imports): `movement.ts` (accel/friction/speed-cap integration), `world.ts` (spawn points), `types.ts`, `interpolate.ts` (generic timestamped-sample interpolation, used both directions).
- Host-authoritative loop: host simulates its own player every render frame (zero added latency for the host), runs a fixed 30Hz tick that applies buffered joiner inputs and emits delta-ish compact snapshots (`src/net/host.ts`).
- Client-side prediction + reconciliation: joiner predicts its own movement locally from its own inputs (same `stepPlayer` function the host runs), buffers unacked inputs by seq, and on each snapshot rewinds to the acked state and replays. Corrections under 2px smooth over 100ms instead of snapping (`src/net/client.ts`).
- Remote-player interpolation: both sides render the other player 100ms in the past, interpolated between the two bracketing samples, frozen (never extrapolated) past 250ms.
- Compact wire protocol: tuples instead of objects (`src/net/protocol.ts`). Measured on a live nostr-relay connection: input packets ~17–24 bytes, snapshots ~52–61 bytes.
- On-screen debug HUD (top-left): role/strategy, ping (via `room.ping`), tick, input/snapshot byte size, reconciliation correction magnitude, peer-disconnect flag.
- Two colored circles (teal = host, amber = joiner) with a facing-direction line and a white "you are here" ring on the local player. WASD + mouse aim + Shift-to-walk.

## Known issues / deferred to later phases

- No player-vs-player collision yet (by design — collision geometry is Phase 2). Players currently pass through each other.
- No reconnect UI beyond `stats.connected` flipping false in the debug HUD (full 3s-grace reconnect overlay + "Host left" screen is Phase 7 per the build order).
- No mobile/touch input layer yet (Phase 6).
- `HostSession`/`ClientSession.dispose()` don't yet tear down `setInterval` ping timers on the client side, and there's no "leave match" flow — acceptable for a single-session tab lifetime today, will matter once rematch/menu-return exists (Phase 7).
- Nickname entry is not implemented — deferred to Phase 7 polish per the spec's build order (Phase 1's gate is movement netcode, not full menu UX).

## Playtesting notes

Verified with a scripted two-context Playwright session (headless Chromium, `--disable-background-timer-throttling` etc. to avoid headless rAF throttling) against the Vite dev server: both peers connect over nostr, positions stay in agreement within ~1px between the host's and joiner's own views of the same player, reconciliation correction stayed at 0.00–0.04px throughout continuous movement (no rubber-banding), and both circles render correctly on both screens with no console errors. Screenshots confirmed visually.

Headless Chromium throttles `requestAnimationFrame` for background/occluded windows even with anti-throttling flags applied, which slows *simulated* movement speed in a two-window automated test (each frame's `dt` is correctly computed and capped at 100ms, but far fewer frames fire) — this is a test-harness artifact, not a game bug: velocity was observed ramping to and capping at exactly `RUN_SPEED` (220px/s), confirming the physics itself is correct.

## Director Decisions

- **DD-001**: Used Trystero's `nostr` strategy as primary signaling with `@trystero-p2p/torrent` as a sequential fallback (join nostr, wait up to 6s for a peer, then leave and join torrent) rather than racing both simultaneously. Simpler to reason about, and the spec's wording ("nostr strategy, with torrent as fallback") reads as sequential. Both strategies rendezvous on the same `(appId, roomId)`, so this doesn't cost correctness, only worst-case latency when nostr relays are unreachable.
- **DD-002**: The Trystero version installed (`0.25.4`) doesn't expose an unreliable/unordered data channel option in its public API (`makeAction` has no such config) — packets are sent over Trystero's default reliable channel. Mitigated by keeping packets small and frequent and by designing the protocol to tolerate out-of-order/duplicate delivery via tick/seq numbers regardless. Revisit if a future Trystero version exposes channel config.
- **DD-003**: Player state is a fixed 2-slot tuple (`[hostState, joinerState]`) rather than a `Record<peerId, PlayerState>`, since this is strictly 1v1. Let the snapshot wire format use fixed-position tuples instead of keyed objects, which is both simpler and smaller on the wire. A third peer joining an existing room is currently just ignored (no rejection UI yet) — acceptable for Phase 1, worth a small guard later.
- **DD-004**: Host's own player is simulated immediately every render frame (not just at the 30Hz tick), since the host is authoritative and gets zero-latency local feel "for free." Only the joiner's inputs are buffered and applied on the 30Hz tick. The host *also* interpolates its rendering of the joiner (buffered at tick rate, sampled with the same interpolation delay/extrapolation-cap logic the client uses for the host) so the joiner doesn't visibly step at 30Hz on the host's 60fps screen.
- **DD-005**: `PlayerWire` includes `vx`/`vy` (not just `x`/`y`/`angle`) so that replay-on-reconcile on the client starts from the host's true velocity rather than the client's own stale predicted velocity. Slightly bigger snapshot, meaningfully more correct reconciliation.
- **DD-006**: Added a `window.__breachGame` / `window.__breachSession` debug hook, gated behind `import.meta.env.DEV` (stripped from production builds by Vite's dead-code elimination). Used for scripted Playwright playtesting this phase; kept because it's low-cost and will keep being useful for later-phase playtesting.
