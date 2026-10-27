import Phaser from 'phaser';
import tileKeys from '@tile-keys';

/**
 * All available tile texture keys from public/assets/tiles/.
 * The keys are discovered at build time by the Vite tile-discovery plugin,
 * so they always match the actual files on disk — no mismatches.
 */
const TILE_KEYS = tileKeys;

/**
 * Weighted tile selection list for natural-looking ground.
 * Grass and dirt appear more frequently as base ground tiles;
 * numbered tiles provide occasional variety.
 */
const GROUND_TILES = (() => {
  const weighted = [];
  // Base ground tiles are heavily weighted to prevent "random object" noise.
  // Grass and dirt are the only true ground tiles in the asset pack.
  for (let i = 0; i < 80; i++) weighted.push('grass');
  for (let i = 0; i < 20; i++) weighted.push('dirt');
  return weighted;
})();

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  /**
   * Preload – load sprite images and tiles; generate bullet/blood textures.
   */
  preload() {
    // Player sprite – top-down survivor facing right (51x43, rotation 0 = right)
    this.load.image('player', 'assets/sprites/survivor1_gun.png');

    // Enemy sprite – top-down zombie facing right (35x43, rotation 0 = right)
    this.load.image('enemy', 'assets/sprites/zombie1_hold.png');
    this.load.image('robot', 'assets/sprites/robot1_hold.png');

    // Floor tiles – load all tile images from assets/tiles/ (auto-discovered)
    // Named tiles (dirt, grass) plus numbered tiles tile_01 through tile_NN
    TILE_KEYS.forEach((key) => {
      this.load.image(key, `assets/tiles/${key}.png`);
    });

    // Bullet texture – a small white rectangle (8x4)
    const bulletGfx = this.make.graphics({ x: 0, y: 0, add: false });
    bulletGfx.fillStyle(0xffffff, 1);
    bulletGfx.fillRect(0, 0, 8, 4);
    bulletGfx.generateTexture('bullet', 8, 4);
    bulletGfx.destroy();

    // Blood particle – small red circle
    const bloodGfx = this.make.graphics({ x: 0, y: 0, add: false });
    bloodGfx.fillStyle(0xb00000, 1);
    bloodGfx.fillCircle(2, 2, 2);
    bloodGfx.generateTexture('bloodParticle', 4, 4);
    bloodGfx.destroy();

    // XP Gem – cyan diamond
    const gemGfx = this.make.graphics({ x: 0, y: 0, add: false });
    gemGfx.fillStyle(0x00ffff, 1);
    gemGfx.beginPath();
    gemGfx.moveTo(8, 0);
    gemGfx.lineTo(16, 8);
    gemGfx.lineTo(8, 16);
    gemGfx.lineTo(0, 8);
    gemGfx.closePath();
    gemGfx.fillPath();
    gemGfx.generateTexture('gem', 16, 16);
    gemGfx.destroy();

    // Heart Gem – red heart
    const heartGfx = this.make.graphics({ x: 0, y: 0, add: false });
    heartGfx.fillStyle(0xff0000, 1);
    // Draw a simple heart shape using circles and a triangle
    heartGfx.fillCircle(4, 4, 4);
    heartGfx.fillCircle(12, 4, 4);
    heartGfx.fillTriangle(0, 6, 16, 6, 8, 16);
    heartGfx.generateTexture('heart', 16, 16);
    heartGfx.destroy();
  }

  create() {
    // ---- 0. World bounds ----
    const worldWidth = 2000;
    const worldHeight = 2000;
    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    this.physics.world.setBounds(0, 0, worldWidth, worldHeight);
    // ---- Background floor – varied ground using random tile combinations ----
    this.renderGround(worldWidth, worldHeight);

    // ---- Player stats ----
    this.invulnerable = false;
    this.gameOver = false;
    this.upgradeScreenVisible = false;
    this.startTime = this.time.now;

    // ---- Persistent stats (loaded from localStorage) ----
    this.loadProgress();

    // Derived stats from persistent upgrades
    this.maxHP = 5 + (this.progress.upgrades.maxHP || 0);
    this.hp = this.maxHP;
    this.playerSpeed = 200 + this.progress.upgrades.moveSpeed * 50;
    this.pickupRange = 50 + this.progress.upgrades.pickupRange * 25;
    this.bulletSpeed = 400 + this.progress.upgrades.gunPower * 100;
    this.bulletDamage = 1 + this.progress.upgrades.gunPower;
    this.fireRate = Math.max(100, 800 - this.progress.upgrades.fireRate * 100);
    this.lastFiredTime = 0;

    // XP collected this run (spend on the post-death upgrade screen)
    this.xp = this.progress.currentXP;
    this.progress.currentXP = this.xp;

    // ---- HUD (fixed to camera) ----
    this.hpText = this.add.text(16, 16, `HP: ${this.hp}/${this.maxHP}`, {
      fontSize: '24px',
      color: '#00ff00',
      fontStyle: 'bold',
    });
    this.hpText.setScrollFactor(0);
    this.hpText.setDepth(10);
    this.timerText = this.add.text(16, 48, 'Survived: 0s', {
      fontSize: '24px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    this.timerText.setScrollFactor(0);
    this.timerText.setDepth(10);
    // XP display
    this.xpText = this.add.text(16, 80, `XP: ${this.xp}`, {
      fontSize: '24px',
      color: '#00ffff',
      fontStyle: 'bold',
    });
    this.xpText.setScrollFactor(0);
    this.xpText.setDepth(10);

    // ---- 1. Player ----
    this.player = this.physics.add.sprite(worldWidth / 2, worldHeight / 2, 'player');
    this.player.setCollideWorldBounds(true);
    this.player.setDepth(1);
    // Circular physics body sized to the character body (diameter ~36, centered)
    this.player.body.setCircle(18, 7.5, 3.5);
    // Follow the player instantly (no smoothing) so they appear immediately
    this.cameras.main.startFollow(this.player, false, 1, 1);
    this.cameras.main.centerOn(this.player.x, this.player.y);

    // Persistent stats – keep a live reference so spend/save stays simple
    this.upgradeCosts = {
      gunPower: () => (this.progress.upgrades.gunPower + 1) * 10,
      moveSpeed: () => (this.progress.upgrades.moveSpeed + 1) * 10,
      pickupRange: () => (this.progress.upgrades.pickupRange + 1) * 10,
    };

    // Keyboard controls (WASD / Arrow)
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = {
      up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      left: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      down: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    // ---- 2. Enemy swarm group ----
    this.enemies = this.physics.add.group();
    // Bullet group – for player projectiles
    this.bullets = this.physics.add.group();
    // XP gems dropped by killed zombies
    this.gems = this.physics.add.group();
    // Player↔gem collection overlap (attraction handled in updateGems)
    this.physics.add.overlap(this.player, this.gems, this.collectGem, undefined, this);
    // Periodic spawn timer
    this.spawnTimer = this.time.addEvent({
      delay: 1500,
      callback: this.spawnWave,
      callbackScope: this,
      loop: true,
    });

    // ---- 3. Blood system ----
    // Particle emitter for burst effect – using the new ParticleEmitter signature (Phaser 3.60+)
    this.bloodEmitter = this.add.particles(0, 0, 'bloodParticle', {
      speed: { min: 50, max: 200 },
      lifespan: 800,
      quantity: 15,
      scale: { start: 1, end: 0 },
      on: false,
    });
    // Permanent blood splatter graphics layer (static textures)
    this.bloodLayer = this.add.graphics({ x: 0, y: 0 });
    this.bloodLayer.setDepth(0);

    // ---- 4. Upgrade engine data structure ----
    // Combat upgrades that scale per level
    this.bladeGroup = this.physics.add.group();
    this.physics.add.overlap(this.bladeGroup, this.enemies, this.onBladeHit, undefined, this);

    this.upgrades = [
      {
        name: 'Spinning Blade',
        key: 'spinningBlade',
        baseSpeed: 2,
        baseSize: 12,
        baseCount: 1,
        get level() { return this.scene.progress.upgrades.spinningBlade; },
        get speed() { return this.baseSpeed + (this.level - 1) * 0.5; },
        get size() { return this.baseSize * Math.pow(1.2, this.level - 1); },
        get count() { return this.level; },
        scene: this,
      },
      {
        name: 'Piercing Projectiles',
        key: 'piercingProjectiles',
        get level() { return this.scene.progress.upgrades.piercingProjectiles; },
        get penetration() { return this.level; },
        scene: this,
      },
    ];

    this.createBlades();

    // ---- 5. Touch / Mouse controls ----
    // Simple relative movement: pointer down sets a target direction
    this.input.on('pointerdown', (pointer) => {
      // During game over, let the upgrade screen handle input; otherwise restart
      if (this.gameOver) {
        if (!this.upgradeScreenVisible) {
          this.scene.restart();
        }
        return;
      }
      this.pointerTarget = pointer;
    });
    this.input.on('pointerup', () => {
      this.pointerTarget = null;
    });
    this.input.on('pointermove', (pointer) => {
      if (this.pointerTarget && pointer.isDown) {
        this.pointerTarget = pointer;
      }
    });

    // Space bar for shooting
    this.fireKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    // R key for restart (also used during game over)
    this.restartKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);

    // Player vs enemy – overlap (no physics shoving), enemy is NOT destroyed
    this.physics.add.overlap(this.player, this.enemies, this.onPlayerHit, undefined, this);
    // Bullet vs enemy collision – destroys both and spawns blood
    this.physics.add.overlap(this.bullets, this.enemies, this.onBulletHit, undefined, this);
  }

  /**
   * Render the ground layer onto a single RenderTexture for performance.
   * Tiles are 64x64; the world is tiled in a grid and each cell gets a
   * randomly-selected tile from the weighted GROUND_TILES pool so the
   * ground looks varied rather than a single repeated texture.
   */
  renderGround(worldWidth, worldHeight) {
    const tileSize = 64;
    const cols = Math.ceil(worldWidth / tileSize);
    const rows = Math.ceil(worldHeight / tileSize);

    // Create a persistent render texture to hold the full ground layer
    const ground = this.add.renderTexture(0, 0, worldWidth, worldHeight);
    ground.setOrigin(0, 0);
    ground.setDepth(-2);

    const tileCount = GROUND_TILES.length;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // Weighted random selection from GROUND_TILES
        const key = GROUND_TILES[Phaser.Math.Between(0, tileCount - 1)];
        ground.draw(key, col * tileSize, row * tileSize);
      }
    }
  }

  update() {
    if (this.gameOver) {
      // During the upgrade screen, R continues; otherwise R restarts
      if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
        if (this.upgradeScreenVisible) {
          this.continueFromUpgradeScreen();
        } else {
          this.scene.restart();
        }
      }
      return;
    }

    this.handlePlayerMovement();
    this.updateBlades();
    this.updateEnemies();
    this.handleShooting();
    this.updateGems();
    this.updateHUD();
  }

  /** Update the HUD with current HP and survival time */
  updateHUD() {
    this.hpText.setText(`HP: ${this.hp}/${this.maxHP}`);
    const survived = Math.floor((this.time.now - this.startTime) / 1000);
    this.timerText.setText(`Survived: ${survived}s`);
    this.xpText.setText(`XP: ${this.xp}`);
  }

  /** Handle keyboard and pointer based movement */
  handlePlayerMovement() {
    const speed = this.playerSpeed;
    let vx = 0;
    let vy = 0;

    // Keyboard
    if (this.cursors.left.isDown || this.wasd.left.isDown) vx -= speed;
    if (this.cursors.right.isDown || this.wasd.right.isDown) vx += speed;
    if (this.cursors.up.isDown || this.wasd.up.isDown) vy -= speed;
    if (this.cursors.down.isDown || this.wasd.down.isDown) vy += speed;

    // Pointer (touch / mouse) – move toward pointer while pressed
    if (this.pointerTarget) {
      const angle = Phaser.Math.Angle.Between(
        this.player.x,
        this.player.y,
        this.pointerTarget.worldX,
        this.pointerTarget.worldY
      );
      vx = Math.cos(angle) * speed;
      vy = Math.sin(angle) * speed;
    }

    this.player.setVelocity(vx, vy);
    // Rotate sprite to face movement direction (optional)
    if (vx !== 0 || vy !== 0) {
      this.player.rotation = Math.atan2(vy, vx);
    }
  }

  /** Handle shooting – space bar fires a bullet forward */
  handleShooting() {
    // Auto-fire whenever the time since last shot exceeds the fireRate
    if (this.time.now - this.lastFiredTime > this.fireRate) {
      this.fireBullet();
      this.lastFiredTime = this.time.now;
    }
  }

  /** Create a bullet that travels in the player's facing direction */
  fireBullet() {
    const isTriple = this.progress.upgrades.tripleShot > 0;
    
    if (isTriple) {
      // Shoot 3 bullets spread out
      this.spawnBullet(this.player.rotation);
      this.spawnBullet(this.player.rotation - Phaser.Math.DegToRad(12));
      this.spawnBullet(this.player.rotation + Phaser.Math.DegToRad(12));
    } else {
      // Standard single shot
      this.spawnBullet(this.player.rotation);
    }
  }

  /** Helper to spawn a single bullet at a specific angle */
  spawnBullet(angle) {
    const speed = this.bulletSpeed;
    // Spawn bullet at the gun tip
    const lengthOffset = 24;
    const sideOffset = 10;
    const spawnX = this.player.x + Math.cos(angle) * lengthOffset + Math.cos(angle + Math.PI / 2) * sideOffset;
    const spawnY = this.player.y + Math.sin(angle) * lengthOffset + Math.sin(angle + Math.PI / 2) * sideOffset;

    const bullet = this.bullets.create(spawnX, spawnY, 'bullet');
    bullet.setDepth(1);
    bullet.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    bullet.rotation = angle;
    
    // Set penetration from upgrade
    const piercingLvl = this.progress.upgrades.piercingProjectiles;
    bullet.setData('penetration', piercingLvl);

    bullet.lifespan = 2000;
    this.time.addEvent({
      delay: bullet.lifespan,
      callback: () => { if (bullet.active) bullet.destroy(); },
      callbackScope: this,
    });
  }

  /** Spawn a wave of enemies, occasionally including a robot */
  spawnWave() {
    // 80% chance of zombie, 20% chance of robot
    if (Math.random() < 0.2) {
      this.spawnEnemy('robot', 4, 50); // Robots: 4 HP, 50 XP
    } else {
      this.spawnEnemy('enemy', 1, 10); // Zombies: 1 HP, 10 XP
    }
  }

  /** Spawn an enemy at a random off-screen location and head toward the player */
  spawnEnemy(textureKey = 'enemy', hp = 1, xpValue = 10) {
    const worldWidth = this.physics.world.bounds.width;
    const worldHeight = this.physics.world.bounds.height;
    // Choose a side (0=top,1=right,2=bottom,3=left)
    const side = Phaser.Math.Between(0, 3);
    let x, y;
    const margin = 50;
    switch (side) {
      case 0: // top
        x = Phaser.Math.Between(-margin, worldWidth + margin);
        y = -margin;
        break;
      case 1: // right
        x = worldWidth + margin;
        y = Phaser.Math.Between(-margin, worldHeight + margin);
        break;
      case 2: // bottom
        x = Phaser.Math.Between(-margin, worldWidth + margin);
        y = worldHeight + margin;
        break;
      case 3: // left
        x = -margin;
        y = Phaser.Math.Between(-margin, worldHeight + margin);
        break;
    }
    const enemy = this.enemies.create(x, y, textureKey);
    enemy.setCollideWorldBounds(false);
    // Circular physics body sized to the enemy body (diameter ~30, centered)
    enemy.body.setCircle(15, 2.5, 6.5);
    // Set enemy stats
    enemy.setData('hp', hp);
    enemy.setData('xpValue', xpValue);
    enemy.setData('type', textureKey === 'enemy' ? 'zombie' : 'robot');

    // Compute direction toward player
    // Robots (80-100 speed) are faster than Zombies (40-60 speed)
    const baseSpeed = textureKey === 'robot' ? 90 : 50;
    const speed = baseSpeed + Phaser.Math.Between(-10, 10);
    const angle = Phaser.Math.Angle.Between(x, y, this.player.x, this.player.y);
    enemy.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    enemy.setData('angle', angle);
    // Rotate to face player
    enemy.rotation = angle;
  }

  /** Update enemies – adjust velocity each frame toward player */
  updateEnemies() {
    this.enemies.getChildren().forEach((enemy) => {
      const type = enemy.getData('type');
      const baseSpeed = type === 'robot' ? 90 : 50;
      const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y);
      enemy.setVelocity(Math.cos(angle) * baseSpeed, Math.sin(angle) * baseSpeed);
      enemy.rotation = angle;
    });
  }

  /** Called when player overlaps an enemy – costs 1 HP, no destroy, then invulnerable */
  onPlayerHit(player, enemy) {
    // Ignore while invulnerable or already game over
    if (this.invulnerable || this.gameOver) {
      return;
    }

    // Lose 1 HP
    this.hp -= 1;
    this.spawnBlood(enemy.x, enemy.y);

    // Flash + become invulnerable for 1s
    this.invulnerable = true;
    this.player.alpha = 0;
    this.tweens.add({
      targets: this.player,
      alpha: { from: 0, to: 1 },
      duration: 100,
      repeat: 9,
      yoyo: true,
      onComplete: () => {
        this.invulnerable = false;
        this.player.alpha = 1;
      },
    });

    // Fallback timer to guarantee invulnerability ends after exactly 1s
    this.time.delayedCall(1000, () => {
      this.invulnerable = false;
      this.player.alpha = 1;
    });

    if (this.hp <= 0) {
      this.triggerGameOver();
    }
  }

  /** End the game: pause physics, show GAME OVER overlay */
  triggerGameOver() {
    this.gameOver = true;
    this.hp = 0;
    this.updateHUD();

    // Stop enemy spawning
    if (this.spawnTimer) {
      this.spawnTimer.remove(false);
    }

    // Pause physics so enemies freeze in place
    this.physics.pause();

    // Stop player movement
    this.player.setVelocity(0, 0);
    this.player.alpha = 1;

    // Persist the XP earned this run so it is available on the upgrade screen
    this.progress.currentXP = this.xp;
    this.saveProgress();

    // Show the post-death upgrade selection screen
    this.showUpgradeScreen();
  }

  /** Called when a bullet hits an enemy – destroys both and spawns blood */
  onBulletHit(bullet, enemy) {
    // Damage enemy
    let hp = enemy.getData('hp') || 1;
    hp -= this.bulletDamage;
    enemy.setData('hp', hp);

    // Visual feedback for hit
    this.spawnBlood(enemy.x, enemy.y);

    // Handle penetration
    let penetration = bullet.getData('penetration') || 0;
    if (penetration > 0) {
      bullet.setData('penetration', penetration - 1);
      // Brief invulnerability for enemy to this specific bullet to prevent multi-hits
      // But actually Phaser's overlap with group already handles this mostly.
      // We'll just let it fly.
    } else {
      bullet.destroy();
    }

    if (hp <= 0) {
      // Drop loot
      const xpValue = enemy.getData('xpValue') || 10;
      const type = enemy.getData('type') || 'zombie';
      
      // Track kill in persistence
      if (this.progress.kills[type] !== undefined) {
        this.progress.kills[type]++;
      } else {
        this.progress.kills[type] = 1;
      }
      this.saveProgress();

      this.dropLoot(enemy.x, enemy.y, xpValue);
      enemy.destroy();
    }
  }

  /** Blood burst + permanent splatter */
  spawnBlood(x, y) {
    // Burst particles
    this.bloodEmitter.explode(10, x, y);
    // Permanent splatter – draw a few random red circles onto the bloodLayer graphics
    const splatterCount = Phaser.Math.Between(5, 12);
    for (let i = 0; i < splatterCount; i++) {
      const offsetX = Phaser.Math.Between(-12, 12);
      const offsetY = Phaser.Math.Between(-12, 12);
      const radius = Phaser.Math.Between(2, 6);
      this.bloodLayer.fillStyle(0x8b0000, 0.7);
      this.bloodLayer.fillCircle(x + offsetX, y + offsetY, radius);
    }
  }

  // ------------------------------------------------------------------
  // Persistence
  // ------------------------------------------------------------------

  /** Load saved XP, upgrades, and stats from localStorage (or defaults). */
  loadProgress() {
    const saved = localStorage.getItem('topdown-survival-progress');
    if (saved) {
      try {
        this.progress = JSON.parse(saved);
      } catch (e) {
        this.progress = this.defaultProgress();
      }
    } else {
      this.progress = this.defaultProgress();
    }
    
    // Ensure nested objects exist for older save files
    if (!this.progress.kills) {
      this.progress.kills = { zombie: 0, robot: 0 };
    }
    if (!this.progress.upgrades) {
      this.progress.upgrades = this.defaultProgress().upgrades;
    }

    // Ensure every upgrade key exists even if an older save is missing one
    this.progress.upgrades = Object.assign(this.defaultProgress().upgrades, this.progress.upgrades);
    
    // Use the XP from the save file if it exists, otherwise start at 0
    // (Note: currentXP is updated by the game when you die or spend it)
    if (this.progress.currentXP === undefined) {
      this.progress.currentXP = 0;
    }
  }

  defaultProgress() {
    return {
      currentXP: 0,
      kills: {
        zombie: 0,
        robot: 0,
      },
      upgrades: {
        gunPower: 0,
        moveSpeed: 0,
        pickupRange: 0,
        fireRate: 0,
        tripleShot: 0,
        spinningBlade: 0,
        piercingProjectiles: 0,
        maxHP: 0,
      },
    };
  }

  saveProgress() {
    localStorage.setItem('topdown-survival-progress', JSON.stringify(this.progress));
  }

  // ------------------------------------------------------------------
  // XP gems
  // ------------------------------------------------------------------

  /** Drop an XP gem or occasionally a heart gem */
  dropLoot(x, y, xpValue) {
    // 10% chance to drop a heart gem if not at full HP, otherwise XP gem
    if (this.hp < this.maxHP && Math.random() < 0.1) {
      this.spawnHeart(x, y);
    } else {
      this.spawnGem(x, y, xpValue);
    }
  }

  /** Spawn an XP gem at a world position (called when a zombie dies). */
  spawnGem(x, y, xpValue = 10) {
    const gem = this.gems.create(x, y, 'gem');
    gem.setDepth(1);
    gem.body.allowGravity = false;
    gem.body.setSize(16, 16);
    gem.setData('xpValue', xpValue);
  }

  /** Spawn a heart gem that heals the player. */
  spawnHeart(x, y) {
    const heart = this.gems.create(x, y, 'heart');
    heart.setDepth(1);
    heart.body.allowGravity = false;
    heart.body.setSize(16, 16);
    heart.setData('isHeart', true);
  }

  /** Attract nearby gems toward the player based on the pickup range. */
  updateGems() {
    const gems = this.gems.getChildren();
    if (gems.length === 0) return;

    const px = this.player.x;
    const py = this.player.y;
    const pullSpeed = 180;

    for (let i = 0; i < gems.length; i++) {
      const gem = gems[i];
      const dx = px - gem.x;
      const dy = py - gem.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < this.pickupRange && dist > 0.5) {
        gem.body.setVelocity((dx / dist) * pullSpeed, (dy / dist) * pullSpeed);
      } else if (dist > 0.5) {
        // Not yet in range – drift to a standstill
        gem.body.setVelocity(0, 0);
      }
    }
  }

  /** Collected when a gem overlaps the player. */
  collectGem(player, gem) {
    if (gem.getData('isHeart')) {
      this.hp = Math.min(this.hp + 1, this.maxHP);
      this.updateHUD();
    } else {
      const reward = gem.getData('xpValue') || 10;
      this.xp += reward;
      this.progress.currentXP = this.xp;
      this.xpText.setText(`XP: ${this.xp}`);
    }
    gem.destroy();
  }

  // ------------------------------------------------------------------
  // Spinning Blades
  // ------------------------------------------------------------------

  /** Create blade sprites based on the current level. */
  createBlades() {
    this.bladeGroup.clear(true, true);
    const bladeDef = this.upgrades.find(u => u.key === 'spinningBlade');
    const level = bladeDef.level;
    if (level <= 0) return;

    const count = bladeDef.count;
    const size = bladeDef.size;

    // Use a white circle for the blade
    const bladeGfx = this.make.graphics({ x: 0, y: 0, add: false });
    bladeGfx.fillStyle(0xffffff, 0.8);
    bladeGfx.fillCircle(size, size, size);
    bladeGfx.generateTexture(`blade_${level}`, size * 2, size * 2);
    bladeGfx.destroy();

    for (let i = 0; i < count; i++) {
      const blade = this.bladeGroup.create(this.player.x, this.player.y, `blade_${level}`);
      blade.setDepth(1);
      blade.body.setCircle(size);
    }
  }

  /** Update blade positions to orbit the player. */
  updateBlades() {
    const bladeDef = this.upgrades.find(u => u.key === 'spinningBlade');
    const level = bladeDef.level;
    if (level <= 0) return;

    const blades = this.bladeGroup.getChildren();
    const time = this.time.now / 1000;
    const speed = bladeDef.speed;
    const radius = 80;

    blades.forEach((blade, i) => {
      const angle = (time * speed) + (i * (Math.PI * 2) / blades.length);
      blade.x = this.player.x + Math.cos(angle) * radius;
      blade.y = this.player.y + Math.sin(angle) * radius;
    });
  }

  /** Damage enemies on blade contact. */
  onBladeHit(blade, enemy) {
    // To prevent rapid damage, we'd need a cooldown per enemy
    // For now, let's just do a small amount of damage or rely on the physics overlap rate
    const lastHit = enemy.getData('lastBladeHit') || 0;
    if (this.time.now - lastHit < 500) return;

    enemy.setData('lastBladeHit', this.time.now);
    
    let hp = enemy.getData('hp') || 1;
    hp -= 1; // Blades do 1 damage
    enemy.setData('hp', hp);
    this.spawnBlood(enemy.x, enemy.y);

    if (hp <= 0) {
      const xpValue = enemy.getData('xpValue') || 10;
      const type = enemy.getData('type') || 'zombie';
      if (this.progress.kills[type] !== undefined) this.progress.kills[type]++;
      this.saveProgress();
      this.dropLoot(enemy.x, enemy.y, xpValue);
      enemy.destroy();
    }
  }

  // ------------------------------------------------------------------
  // Post-death upgrade screen
  // ------------------------------------------------------------------

  /** Build the camera-fixed upgrade selection overlay shown on death. */
  showUpgradeScreen() {
    const cam = this.cameras.main;
    const cx = cam.width / 2;
    const cy = cam.height / 2;

    // Dimmed full-screen background
    const bg = this.add.rectangle(cx, cy, cam.width, cam.height, 0x000000, 0.75);
    bg.setScrollFactor(0);
    bg.setDepth(30);

    const title = this.add.text(cx, cy - 140, 'GAME OVER', {
      fontSize: '48px',
      color: '#ff0000',
      fontStyle: 'bold',
      align: 'center',
    });
    title.setScrollFactor(0);
    title.setDepth(31);
    title.setOrigin(0.5);

    // Display kill counts
    const killsText = `Kills: ${this.progress.kills.zombie} Zombies | ${this.progress.kills.robot} Robots`;
    const killsLabel = this.add.text(cx, cy - 100, killsText, {
      fontSize: '18px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    killsLabel.setScrollFactor(0);
    killsLabel.setDepth(31);
    killsLabel.setOrigin(0.5);

    const xpLabel = this.add.text(cx, cy - 65, `XP to spend: ${this.xp}`, {
      fontSize: '28px',
      color: '#00ffff',
      fontStyle: 'bold',
      align: 'center',
    });
    xpLabel.setScrollFactor(0);
    xpLabel.setDepth(31);
    xpLabel.setOrigin(0.5);
    this.upgradeScreenXPText = xpLabel;

    const upgradeDefs = [
      { key: 'gunPower', label: 'Gun Power', color: '#ffff00' },
      { key: 'fireRate', label: 'Fire Rate', color: '#ff8888' },
      { key: 'moveSpeed', label: 'Movement Speed', color: '#00ff00' },
      { key: 'pickupRange', label: 'Pickup Range', color: '#00ffff' },
      { key: 'tripleShot', label: 'Triple Shot', color: '#ff00ff' },
      { key: 'spinningBlade', label: 'Spinning Blade', color: '#ffaa00' },
      { key: 'piercingProjectiles', label: 'Piercing Projectiles', color: '#aaaaff' },
      { key: 'maxHP', label: 'Max Health', color: '#ff5555' },
    ];

    this.upgradeButtons = [];
    upgradeDefs.forEach((def, i) => {
      const btn = this.add.text(cx, cy + 10 + i * 70, this.upgradeButtonText(def.key), {
        fontSize: '24px',
        color: def.color,
        fontStyle: 'bold',
        backgroundColor: '#333333',
        padding: { x: 12, y: 6 },
      });
      btn.setScrollFactor(0);
      btn.setDepth(31);
      btn.setOrigin(0.5);
      btn.setInteractive();
      btn.on('pointerdown', (pointer) => {
        pointer.event.stopPropagation();
        this.applyUpgrade(def.key);
      });
      this.upgradeButtons.push({ key: def.key, text: btn });
    });

    const resetBtn = this.add.text(cx - 150, cy + 260, 'RESET DATA', {
      fontSize: '20px',
      color: '#ffaaaa',
      fontStyle: 'bold',
      backgroundColor: '#442222',
      padding: { x: 12, y: 8 },
    });
    resetBtn.setScrollFactor(0);
    resetBtn.setDepth(31);
    resetBtn.setOrigin(0.5);
    resetBtn.setInteractive();
    resetBtn.on('pointerdown', (pointer) => {
      pointer.event.stopPropagation();
      localStorage.removeItem('topdown-survival-progress');
      this.scene.restart();
    });

    const continueBtn = this.add.text(cx + 100, cy + 260, 'CONTINUE (R)', {
      fontSize: '26px',
      color: '#ffffff',
      fontStyle: 'bold',
      backgroundColor: '#555555',
      padding: { x: 20, y: 10 },
    });
    continueBtn.setScrollFactor(0);
    continueBtn.setDepth(31);
    continueBtn.setOrigin(0.5);
    continueBtn.setInteractive();
    continueBtn.on('pointerdown', (pointer) => {
      pointer.event.stopPropagation();
      this.continueFromUpgradeScreen();
    });

    this.upgradeScreenVisible = true;
  }

  /** Label text for an upgrade button (level + cost / affordability). */
  upgradeButtonText(key) {
    const labelMap = {
      gunPower: 'Gun Power',
      fireRate: 'Fire Rate',
      moveSpeed: 'Movement Speed',
      pickupRange: 'Pickup Range',
      tripleShot: 'Triple Shot',
      spinningBlade: 'Spinning Blade',
      piercingProjectiles: 'Piercing Projectiles',
      maxHP: 'Max Health',
    };
    const lvl = this.progress.upgrades[key];
    
    // Custom cost for Max HP
    if (key === 'maxHP') {
      const cost = 50;
      const affordable = this.xp >= cost;
      return `Max Health (Lv ${lvl}) — ${affordable ? '[Buy 50 XP]' : '(Cost 50 XP)'}`;
    }

    // Triple shot is a one-time upgrade for 500 XP
    if (key === 'tripleShot') {
      if (lvl > 0) return 'Triple Shot (MAX)';
      const cost = 500;
      const affordable = this.xp >= cost;
      return `Triple Shot — ${affordable ? '[Buy 500 XP]' : '(Cost 500 XP)'}`;
    }

    const cost = (lvl + 1) * 10;
    const affordable = this.xp >= cost;
    return `${labelMap[key]} (Lv ${lvl}) — ${affordable ? `[Buy ${cost} XP]` : `(Cost ${cost} XP)`}`;
  }

  /** Spend available XP to buy one level of the named upgrade. */
  applyUpgrade(key) {
    if (!this.upgradeScreenVisible) return;
    const lvl = this.progress.upgrades[key];
    
    let cost;
    if (key === 'maxHP') {
      cost = 50;
    } else if (key === 'tripleShot') {
      if (lvl > 0) return;
      cost = 500;
    } else {
      cost = (lvl + 1) * 10;
    }

    if (this.xp < cost) return;

    this.xp -= cost;
    this.progress.currentXP = this.xp;
    this.progress.upgrades[key] = lvl + 1;
    this.saveProgress();

    // Refresh button labels + XP counter
    this.upgradeButtons.forEach((entry) => {
      entry.text.setText(this.upgradeButtonText(entry.key));
    });
    if (this.upgradeScreenXPText) {
      this.upgradeScreenXPText.setText(`XP to spend: ${this.xp}`);
    }
  }

  /** Reset this run's XP, persist, and restart the scene. */
  continueFromUpgradeScreen() {
    if (!this.upgradeScreenVisible) return;
    this.upgradeScreenVisible = false;
    // XP is now persisted and accumulates across runs
    this.saveProgress();
    this.scene.restart();
  }
}
