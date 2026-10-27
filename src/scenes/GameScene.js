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
  // Base ground tiles are heavily weighted
  for (let i = 0; i < 50; i++) weighted.push('grass');
  for (let i = 0; i < 25; i++) weighted.push('dirt');
  // All numbered tiles (skipping dirt & grass at indices 0 and 1)
  // appear at lower frequency for variety
  tileKeys.slice(2).forEach((key) => weighted.push(key));
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
    this.maxHP = 5;
    this.hp = this.maxHP;
    this.invulnerable = false;
    this.gameOver = false;
    this.startTime = this.time.now;

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

    // ---- 1. Player ----
    this.player = this.physics.add.sprite(worldWidth / 2, worldHeight / 2, 'player');
    this.player.setCollideWorldBounds(true);
    this.player.setDepth(1);
    // Circular physics body sized to the character body (diameter ~36, centered)
    this.player.body.setCircle(18, 7.5, 3.5);
    // Follow the player instantly (no smoothing) so they appear immediately
    this.cameras.main.startFollow(this.player, false, 1, 1);
    this.cameras.main.centerOn(this.player.x, this.player.y);

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
    // Periodic spawn timer
    this.spawnTimer = this.time.addEvent({
      delay: 1500,
      callback: this.spawnEnemy,
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
    this.upgrades = [
      {
        name: 'Spinning Blade',
        level: 1,
        baseSpeed: 200,
        baseSize: 8,
        baseCount: 1,
        get speed() { return this.baseSpeed * Math.pow(2, this.level - 1); },
        get size() { return this.baseSize * Math.pow(1.5, this.level - 1); },
        get count() { return this.baseCount * Math.pow(2, this.level - 1); },
      },
      {
        name: 'Piercing Projectiles',
        level: 1,
        baseSpeed: 300,
        baseSize: 4,
        baseCount: 2,
        get speed() { return this.baseSpeed * Math.pow(2, this.level - 1); },
        get size() { return this.baseSize * Math.pow(1.5, this.level - 1); },
        get count() { return this.baseCount * Math.pow(2, this.level - 1); },
      },
    ];

    // ---- 5. Touch / Mouse controls ----
    // Simple relative movement: pointer down sets a target direction
    this.input.on('pointerdown', (pointer) => {
      // During game over, any tap restarts the scene
      if (this.gameOver) {
        this.scene.restart();
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
      // Restart on R key while game over
      if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
        this.scene.restart();
      }
      return;
    }

    this.handlePlayerMovement();
    this.updateEnemies();
    this.handleShooting();
    this.updateHUD();
  }

  /** Update the HUD with current HP and survival time */
  updateHUD() {
    this.hpText.setText(`HP: ${this.hp}/${this.maxHP}`);
    const survived = Math.floor((this.time.now - this.startTime) / 1000);
    this.timerText.setText(`Survived: ${survived}s`);
  }

  /** Handle keyboard and pointer based movement */
  handlePlayerMovement() {
    const speed = 200;
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
    if (Phaser.Input.Keyboard.JustDown(this.fireKey)) {
      this.fireBullet();
    }
  }

  /** Create a bullet that travels in the player's facing direction */
  fireBullet() {
    const speed = 400;
    const angle = this.player.rotation;
    // Spawn bullet at the gun tip
    // lengthOffset: distance forward from player center (~24px)
    // sideOffset: distance perpendicular from center line (~10px) to align with the gun barrel
    const lengthOffset = 24;
    const sideOffset = 10;
    const spawnX = this.player.x + Math.cos(angle) * lengthOffset + Math.cos(angle + Math.PI / 2) * sideOffset;
    const spawnY = this.player.y + Math.sin(angle) * lengthOffset + Math.sin(angle + Math.PI / 2) * sideOffset;

    const bullet = this.bullets.create(spawnX, spawnY, 'bullet');
    bullet.setDepth(1);
    bullet.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    bullet.lifespan = 2000;
    this.time.addEvent({
      delay: bullet.lifespan,
      callback: () => bullet.destroy(),
      callbackScope: this,
    });
  }

  /** Spawn an enemy at a random off-screen location and head toward the player */
  spawnEnemy() {
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
    const enemy = this.enemies.create(x, y, 'enemy');
    enemy.setCollideWorldBounds(false);
    // Circular physics body sized to the enemy body (diameter ~30, centered)
    enemy.body.setCircle(15, 2.5, 6.5);
    // Compute direction toward player
    const angle = Phaser.Math.Angle.Between(x, y, this.player.x, this.player.y);
    const speed = 80 + Phaser.Math.Between(-20, 20);
    enemy.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    enemy.setData('angle', angle);
    // Rotate to face player
    enemy.rotation = angle;
  }

  /** Update enemies – could add behaviors like homing */
  updateEnemies() {
    // Simple homing: adjust velocity each frame toward player
    this.enemies.getChildren().forEach((enemy) => {
      const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y);
      const speed = 80; // constant speed
      enemy.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
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

    // Game Over text – fixed to camera
    const survived = Math.floor((this.time.now - this.startTime) / 1000);
    const overlay = this.add.text(
      this.cameras.main.scrollX + this.cameras.main.width / 2,
      this.cameras.main.scrollY + this.cameras.main.height / 2,
      `GAME OVER\n\nsurvived ${survived}s\n\ntap or press R to restart`,
      {
        fontSize: '32px',
        color: '#ff0000',
        fontStyle: 'bold',
        align: 'center',
        padding: { x: 10, y: 10 },
      }
    );
    overlay.setScrollFactor(0);
    overlay.setDepth(20);
    overlay.setOrigin(0.5, 0.5);
  }

  /** Called when a bullet hits an enemy – destroys both and spawns blood */
  onBulletHit(bullet, enemy) {
    // Remove bullet
    bullet.destroy();
    // Destroy enemy and spawn blood
    this.spawnBlood(enemy.x, enemy.y);
    enemy.destroy();
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
}
