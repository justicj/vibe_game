# AGENTS.md

> Internal documentation for the **Top-Down Survival** game repository.
> This file describes the project layout, architecture, conventions, and patterns
> so that future code changes (including AI-assisted ones) stay consistent.

---

## Project Overview

**Top-Down Survival** is a Phaser 3 top-down survival shooter built with Vite.
The player fights off endless waves of zombies on a large tiled world, with
simple controls (WASD/Arrows + Space to shoot) and dual keyboard/mouse-touch
support.

- **Name in `package.json`:** `topdown-survival`
- **Engine:** Phaser ^3.60.0
- **Bundler:** Vite ^5.0.0
- **Entry point:** `src/main.js`
- **Game scene:** `src/scenes/GameScene.js`

---

## Repository Layout

```
vibe_game/
├── index.html              # HTML shell — mounts game into <div id="game">
├── vite.config.js          # Vite config + tileDiscoveryPlugin
├── package.json            # Dependencies & npm scripts
├── Modelfile               # LLM config (Qwen2.5 Coder, low temp)
├── README.md               # Minimal project title
├── AGENTS.md               # This file
├── public/                 # Static assets served at root
│   └── assets/
│       ├── tiles/          # ~536 tile PNGs: dirt.png, grass.png, tile_01.png … tile_548.png
│       └── sprites/        # Character sprites: survivor*, zombie*, robot*
└── dist/                   # Built output (index.html + assets/ + JS bundle)
    ├── index.html
    └── assets/
        └── index-*.js      # Bundled game code
```

### Source files

| File                      | Responsibility                                           |
| ------------------------- | --------------------------------------------------------
| `src/main.js`             | Phaser configuration (800×600, arcade physics) + boot    |
| `src/scenes/GameScene.js` | All gameplay: player, enemies, shooting, UI, ground      |

### npm scripts

| Script      | Runs                  |
| ----------- | --------------------- |
| `dev`       | `vite` — dev server    |
| `build`     | `vite build` — prod    |
| `preview`   | `vite preview` — serve |

---

## Key Architecture Patterns

### 1. Virtual Module `@tile-keys` (Tile Auto-Discovery)

The `vite.config.js` contains a custom Vite plugin — `tileDiscoveryPlugin()` —
that implements a **virtual module** named `@tile-keys`.

**How it works:**
- `resolveId` intercepts imports of `@tile-keys` and maps them to an
  internal ID `\0tile-keys` (the `\0` marks it as virtual/unsolvable on disk).
- `load` reads the `public/assets/tiles/` directory on disk at build/dev time.
- It collects all `*.png` filenames, strips extensions, **excludes** `dirt` and
  `grass`, **sorts** the remaining keys alphabetically (string sort, so
  `tile_10` sorts before `tile_2`... however in practice the keys are zero-padded
  `tile_01` through `tile_548`), then prepends `['dirt', 'grass']` as the first
  two entries.
- The sorted array is exported as the module's default export.

**Consumption in code:**
```js
// GameScene.js
import tileKeys from '@tile-keys';
const TILE_KEYS = tileKeys;
```

**Why this matters:**
- Adding or removing a tile PNG file **automatically** updates the game — no
  manual tile-count constants to maintain.
- The plugin falls back gracefully to just `['dirt', 'grass']` if the tiles
  directory doesn't exist yet.

### 2. Weighted Ground Tile System

`GameScene.js` builds a weighted `GROUND_TILES` array at module load:
- `'grass'` × 80 (most common)
- `'dirt'` × 20
- Numbered tiles are **excluded** from the random ground generation to avoid
  placing furniture/objects as floor. They remain loaded and available for
  manual placement.

Tiles are drawn onto a single `RenderTexture` (64×64 grid) covering the entire
2000×2000 world. Using a render texture means the ground is drawn once, not per
frame — important for performance with many tile variants.

### 3. Phaser Scene Lifecycle

The game has a **single scene**: `GameScene`. There are no menus, no pause
screen, no level transitions — it's a pure survival wave.

- **`preload()`** — Loads sprite images, dynamically loads all tiles from
  `TILE_KEYS`, and generates procedural textures (`bullet` as an 8×4 white
  rectangle, `bloodParticle` as a red circle).
- **`create()`** — Sets up world bounds (2000×2000), renders ground, creates
  player + HUD, configures physics groups (enemies, bullets), sets up the
  upgrade engine data structure, and binds input (keyboard + pointer).
- **`update()`** — Per-frame: handle movement → update enemies → handle
  shooting → update HUD. Paused entirely during game over.

### 4. Player System

- **Sprite:** `survivor1_gun.png` (51×43, rotation 0 = facing right)
- **Physics body:** Circle, radius 18, centered with offset (7.5, 3.5)
- **Movement:** Speed 200 px/s. Supports both keyboard (WASD/arrows) and
  pointer/touch (move toward pointer while pressed). Sprite rotates to face
  movement direction.
- **Controls:**
  - `SPACE` → fire bullet in facing direction
  - `R` → restart (only during game over)
  - Pointer down → move toward pointer
  - Pointer up → stop moving
  - Any tap during game over → restart

### 5. Combat & Weapons

- **Bullet:** 8×4 white rectangle, speed 400 px/s, lifespan 2s (auto-destroy).
  Spawns at gun-tip offset from player center.
- **Enemies:** `zombie1_hold.png` (35×43, rotation 0 = right). Spawn every
  1.5s from random off-screen edge. Move at constant speed ~80 px/s with
  ±20 random variance. Homing: re-aim toward player each frame.
- **Collision model:** Uses `overlap` (not `collider`) — enemies push the player
  but not each other. On hit, player loses 1 HP, gets 1s of invulnerability
  (flashing alpha), no knockback.
- **Upgrade engine:** Two upgrade types defined in `this.upgrades`:
  - **Spinning Blade** — orbiting melee (level-based speed/size/count scaling)
  - **Piercing Projectiles** — ranged with penetration (level-based scaling)
  Both use exponential scaling: `value = base × 2^(level-1)` with size using
  a 1.5× modifier. *(Note: upgrades are defined but the player must trigger
  them — currently via the upgrade button system not yet wired for input.)*

### 6. Blood / VFX System

Two systems:
1. **Particle burst:** A `ParticleEmitter` using `bloodParticle` texture
  (Phaser 3.60+ constructor signature) for one-shot explosions on hit.
2. **Permanent splatter:** A `Graphics` object (`bloodLayer`, depth -1) that
  draws random red circles that persist on the ground.

### 7. Camera & UI

- Camera follows the player **instantly** (no lerp) — this is intentional for
  the feel of the game.
- HUD elements (`hpText`, `timerText`) are fixed to camera via `setScrollFactor(0)`
  and given `depth 10` so they appear above world content.
- Game over overlay is also camera-fixed, centered, with `depth 20`.

---

## Conventions & Code Style

- **ES modules** (`import`/`export`) throughout — `index.html` uses
  `type="module"`.
- **Imports use `.js` extensions** (e.g., `import GameScene from './scenes/GameScene.js'`).
- **Classes use JSDoc** `/** ... */` block comments for methods.
- **Constants are module-level** where appropriate (e.g., `TILE_KEYS`,
  `GROUND_TILES`).
- **Magic numbers** are often inlined but documented in comments (e.g.,
  physics body offsets, bullet spawn offsets, upgrade scaling factors).
- **`tile-keys` virtual module** is the source of truth for tile inventory —
  never hardcode tile counts or individual numbered tile keys.
- **Naming:** camelCase for JS identifiers, PascalCase for classes and scene
  names. Asset file names use snake_case or `base_name + suffix` patterns
  (e.g., `survivor1_gun`, `zombie1_hold`).

---

## Asset Guide

### Tiles (`public/assets/tiles/`)

- **Format:** PNG
- **Count:** 536 files (including `dirt.png` and `grass.png`)
- **Naming convention:** Two tiers:
  - Named (semantic): `dirt.png`, `grass.png`
  - Numbered: `tile_01.png` through `tile_548.png` (zero-padded to 2 digits)
    - Note: Files are sorted **lexicographically** (string sort), not
      numerically. Always zero-pad to maintain correct ordering.
- **Grid:** 64×64 px tiles, drawn on a RenderTexture covering 2000×2000
- **Adding a new tile:** Drop a new `tile_NN.png` file — it will auto-appear in
  the game via the `@tile-keys` plugin. No JS changes needed.

### Sprites (`public/assets/sprites/`)

| File                   | Used as  | Notes                          |
| ---------------------- | -------- | ------------------------------ |
| `survivor1_gun.png`    | `player` | Main player sprite             |
| `survivor1_hold.png`   | (unused) | Idle/alt player frame          |
| `survivor1_stand.png`  | (unused) | Idle/alt player frame          |
| `survivor1_machine.png`| (unused) | Alt weapon player sprite       |
| `survivor1_reload.png` | (unused) | Reload animation frame         |
| `survivor1_silencer.png`| (unused)| Silenced weapon sprite         |
| `zombie1_hold.png`     | `enemy`  | Main enemy sprite              |
| `robot1_hold.png`      | (unused) | Potential enemy variant        |

---

## Build & Dev Workflow

1. **Development:**
   ```bash
   npm install
   npm run dev
   ```
   - Vite dev server starts with `open: true` (auto-opens browser).
   - URL: `http://localhost:5173` (default).

2. **Production build:**
   ```bash
   npm run build
   ```
   - Output: `dist/` directory.
   - The `@tile-keys` virtual module is resolved at build time — the tile
     array is baked into the final JS bundle as a JSON literal.
   - Vite handles asset copying from `public/` automatically.

3. **Preview build:**
   ```bash
   npm run preview
   ```

---

## Known Design Decisions & Gotchas

- **Single scene architecture:** The entire game lives in one Phaser scene.
  If you add menus or multiple scenes, consider creating `src/scenes/` with
  separate files (e.g., `MenuScene.js`, `GameOverScene.js`).
- **RenderTexture ground:** The ground is drawn once to a `RenderTexture` in
  `renderGround()`. Adding/removing tiles and rebuilding hot-reloads will
  regenerate this texture. Changing `renderGround()` requires a full reload.
- **Invulnerability timing:** Both a tween (9 flashes × 100ms) and a
  `delayedCall(1000)` guard the invulnerability window — this redundancy
  ensures it always resets.
- **Enemy physics:** Enemies do **not** collide with each other — they pass
  through in a swarm. They only `overlap` the player (no physics pushback
  beyond velocity). This is intentional for the "horde" feel.
- **Upgrade system placeholder:** The `this.upgrades` array is defined but
  not yet wired to game input for leveling. If implementing, add UI buttons
  in `create()` and wire `level` increments.
- **World size:** Hardcoded 2000×2000. Change `worldWidth` / `worldHeight`
  in `create()` and the ground render will adapt automatically.
- **No audio:** The game currently has no sound. Adding audio assets would
  go in `public/assets/audio/` and be loaded in `preload()`.

---

## Adding New Features — Checklist

| What                            | Where                                              |
| ------------------------------- | -------------------------------------------------- |
| New scene                       | `src/scenes/YourScene.js`, add to `scene` array in `main.js` |
| New sprite texture              | Drop in `public/assets/sprites/`, load in `preload()` |
| New tile                        | Drop PNG in `public/assets/tiles/` (auto-discovered) |
| New input key                   | Add in `create()` using `this.input.keyboard.addKey()` |
| New enemy behavior              | Modify `updateEnemies()` or add to `spawnEnemy()` |
| New projectile / weapon type    | Extend the `upgrades` array + `fireBullet()` logic |
| UI element                      | Use `setScrollFactor(0)` to keep it camera-fixed |
