# vibe_game

## Characters and weapons

- **Survivor:** Automatically fires bullets in the direction they are facing.
- **Hitman:** Starts with one visible spinning blade, even with no purchased
  upgrades. Blades continuously orbit the player and damage nearby enemies,
  with a 500 ms hit cooldown per enemy. Spinning Blade upgrades increase the
  blade count, size, and orbit speed above level 1. The first blade orbits
  40 pixels from the player; each additional blade orbits 24 pixels farther
  out, alternating clockwise and counterclockwise.

### Weapon upgrades

- **Gun Power / Blade Power:** Increases damage for both characters, bullet
  speed for the Survivor, and blade orbit speed for the Hitman.
- **Fire Rate / Orbit Speed:** Increases the Survivor's firing rate and the
  Hitman's blade orbit speed.
- **Triple Shot / Triple Blades:** Fires three bullets for the Survivor.
  Gives the Hitman at least three blades on progressively wider,
  counter-rotating orbits; higher Spinning Blade levels can still provide
  more than three.

Upgrade names match the selected character, but purchases and levels remain
shared between characters. Existing saves carry over without resetting progress.

Move with WASD, arrow keys, or by holding the pointer toward a destination.
Held mouse/touch movement follows the pointer's current screen position as the
camera scrolls; you do not need to keep moving the mouse to continue traveling.
The player stops within 8 world pixels of the pointer without flipping direction.
After a game over, press R to continue with the same character and saved upgrades.

Tap or click **Menu** during a run (or press **Escape**) to pause. Choose
**Resume** to continue, **End Run & Upgrade** to spend XP immediately without
returning to character selection, or **Quit to Menu** to return to character
selection. Both end-run options save collected XP and upgrades. On the upgrade
screen, **Continue** starts a fresh run with the same character. Escape also
resumes. Pausing freezes enemies, weapons, timers, and survival time. The menu
uses native buttons with touch targets that stay at least 48 CSS pixels tall,
even when the game canvas shrinks on mobile.

The main menu shows each character's weapon and highlights the current selection.
Choose a card, then use the labeled Play button to start. The game scales to fit
the browser window while preserving its 800x600 play area.

## Publishing to GitHub Pages

1. In the repository's **Settings > Pages > Build and deployment**, set
   **Source** to **GitHub Actions**.
2. Commit and push the game, assets, lockfile, and
   [deployment workflow](.github/workflows/deploy-pages.yml) to `main`.
3. The workflow installs dependencies with `npm ci`, builds the game with
   Node.js 24, and deploys only `dist/`. You can also run it manually from
   **Actions > Deploy game to GitHub Pages > Run workflow**.
4. Open the URL reported by the deployment. Without a custom domain, this
   repository's site is `https://justicj.github.io/vibe_game/`.

The workflow reads the site's base path from GitHub Pages and passes it to
Vite as `PAGES_BASE_PATH`. Both the JavaScript bundle and Phaser asset loaders
use that path, supporting project sites and root/custom-domain sites without
hardcoding the repository name. No personal access token or `gh-pages` branch
is needed; the workflow uses GitHub's built-in token.

To preview the project-site build locally:

```bash
PAGES_BASE_PATH=/vibe_game/ npm run build
PAGES_BASE_PATH=/vibe_game/ npm run preview
```

Open `http://localhost:4173/vibe_game/`. Ordinary `npm run dev` and
`npm run build` still default to `/` when `PAGES_BASE_PATH` is unset.