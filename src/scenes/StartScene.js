import Phaser from 'phaser';

export default class StartScene extends Phaser.Scene {
  constructor() {
    super('StartScene');
  }

  preload() {
    this.load.setBaseURL(import.meta.env.BASE_URL);
    this.load.image('player', 'assets/sprites/survivor1_gun.png');
    this.load.image('hitman', 'assets/sprites/hitman1_gun.png');
  }

  create() {
    const { width, height } = this.scale;
    const centerX = width / 2;

    this.add.rectangle(width / 2, height / 2, width, height, 0x111111);

    this.add.text(centerX, 64, 'SHOOTER - SURVIVAL', {
      fontSize: '40px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(centerX, 128, 'Select Your Character', {
      fontSize: '22px',
      color: '#aaaaaa',
    }).setOrigin(0.5);

    let selectedChar = 'player';
    const characters = [
      {
        key: 'player',
        name: 'Survivor',
        description: 'Auto-firing gun.\nKeep your distance.',
        color: 0x00ff88,
        textColor: '#00ff88',
        x: centerX - 136,
      },
      {
        key: 'hitman',
        name: 'Hitman',
        description: 'Orbiting blades.\nFight up close.',
        color: 0xffaa00,
        textColor: '#ffaa00',
        x: centerX + 136,
      },
    ];

    const cards = characters.map((character) => {
      const card = this.add.rectangle(character.x, 294, 240, 228, 0x222222)
        .setInteractive({ useHandCursor: true });

      this.add.sprite(character.x, 234, character.key).setScale(1.4);
      this.add.text(character.x, 288, character.name, {
        fontSize: '24px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      this.add.text(character.x, 338, character.description, {
        fontSize: '16px',
        color: '#bbbbbb',
        align: 'center',
        lineSpacing: 6,
        wordWrap: { width: 208 },
      }).setOrigin(0.5);

      const status = this.add.text(character.x, 386, '', {
        fontSize: '14px',
        color: character.textColor,
        fontStyle: 'bold',
      }).setOrigin(0.5);

      card.on('pointerdown', () => {
        selectedChar = character.key;
        updateSelection();
      });
      card.on('pointerover', () => card.setFillStyle(0x333333));
      card.on('pointerout', () => updateSelection());

      return { character, card, status };
    });

    const startBtn = this.add.rectangle(centerX, height - 112, 280, 52, 0x008844)
      .setInteractive({ useHandCursor: true });

    const startLabel = this.add.text(centerX, height - 112, '', {
      fontSize: '22px',
      color: '#ffffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    const updateSelection = () => {
      cards.forEach(({ character, card, status }) => {
        const selected = character.key === selectedChar;
        card.setStrokeStyle(selected ? 3 : 1, selected ? character.color : 0x555555);
        card.setFillStyle(selected ? 0x29332f : 0x222222);
        status.setText(selected ? 'SELECTED' : 'CLICK TO SELECT');
      });
      const selected = characters.find(character => character.key === selectedChar);
      startLabel.setText(`PLAY AS ${selected.name.toUpperCase()}`);
    };
    updateSelection();

    startBtn.on('pointerover', () => startBtn.setFillStyle(0x00aa55));
    startBtn.on('pointerout', () => startBtn.setFillStyle(0x008844));
    startBtn.on('pointerdown', () => {
      this.scene.start('GameScene', { selectedCharacter: selectedChar });
    });

    this.add.text(centerX, height - 54, 'WASD / Arrows or hold pointer to move', {
      fontSize: '16px',
      color: '#aaaaaa',
    }).setOrigin(0.5);

    this.add.text(centerX, height - 28, 'Weapons attack automatically', {
      fontSize: '14px',
      color: '#888888',
    }).setOrigin(0.5);
  }
}
