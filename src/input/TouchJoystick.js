export default class TouchJoystick {
  constructor(element) {
    this.element = element;
    this.thumb = element.querySelector('.joystick-thumb');
    this.vector = { x: 0, y: 0 };
    this.pointerId = null;
    this.enabled = false;
    this.touchDetected = navigator.maxTouchPoints > 0;
    this.coarsePointer = window.matchMedia('(any-pointer: coarse)');

    this.detectTouch = (event) => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        this.touchDetected = true;
        this.updateVisibility();
      }
    };
    this.updateVisibility = () => {
      this.element.hidden = !this.enabled || !(this.touchDetected || this.coarsePointer.matches);
    };
    this.onDown = (event) => {
      if (!this.enabled || this.pointerId !== null || event.pointerType === 'mouse') return;
      event.preventDefault();
      event.stopPropagation();
      this.pointerId = event.pointerId;
      this.element.setPointerCapture(event.pointerId);
      this.updateVector(event);
    };
    this.onMove = (event) => {
      if (event.pointerId !== this.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      this.updateVector(event);
    };
    this.onEnd = (event) => {
      if (event.pointerId !== this.pointerId) return;
      event.stopPropagation();
      this.reset();
    };
    this.onReset = () => this.reset();
    this.onVisibility = () => {
      if (document.hidden) this.reset();
    };
    this.stopInput = (event) => event.stopPropagation();
    this.legacyEvents = ['mousedown', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'touchcancel'];

    element.addEventListener('pointerdown', this.onDown);
    element.addEventListener('pointermove', this.onMove);
    element.addEventListener('pointerup', this.onEnd);
    element.addEventListener('pointercancel', this.onEnd);
    element.addEventListener('lostpointercapture', this.onEnd);
    this.legacyEvents.forEach((name) => element.addEventListener(name, this.stopInput));
    document.addEventListener('pointerdown', this.detectTouch, true);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', this.onReset);
    window.addEventListener('resize', this.onReset);
    this.coarsePointer.addEventListener('change', this.updateVisibility);
    this.updateVisibility();
  }

  /** Map thumb displacement to analog movement, with a small central dead zone. */
  updateVector(event) {
    const bounds = this.element.getBoundingClientRect();
    const radius = (bounds.width - this.thumb.offsetWidth) / 2;
    const dx = event.clientX - (bounds.left + bounds.width / 2);
    const dy = event.clientY - (bounds.top + bounds.height / 2);
    const distance = Math.hypot(dx, dy);
    const deflection = Math.min(distance / radius, 1);
    const deadZone = 0.15;
    const magnitude = Math.max(0, (deflection - deadZone) / (1 - deadZone));
    this.vector.x = distance > 0 ? (dx / distance) * magnitude : 0;
    this.vector.y = distance > 0 ? (dy / distance) * magnitude : 0;
    const thumbScale = distance > radius ? radius / distance : 1;
    this.element.style.setProperty('--stick-x', `${dx * thumbScale}px`);
    this.element.style.setProperty('--stick-y', `${dy * thumbScale}px`);
  }

  /** Return to neutral and release ownership of the controlling finger. */
  reset() {
    const pointerId = this.pointerId;
    this.pointerId = null;
    this.vector.x = 0;
    this.vector.y = 0;
    this.element.style.removeProperty('--stick-x');
    this.element.style.removeProperty('--stick-y');
    if (pointerId !== null && this.element.hasPointerCapture(pointerId)) {
      this.element.releasePointerCapture(pointerId);
    }
  }

  /** Hide and neutralize the stick outside active gameplay. */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.reset();
    this.updateVisibility();
  }

  /** Remove DOM listeners when the gameplay scene stops or restarts. */
  destroy() {
    this.setEnabled(false);
    const element = this.element;
    element.removeEventListener('pointerdown', this.onDown);
    element.removeEventListener('pointermove', this.onMove);
    element.removeEventListener('pointerup', this.onEnd);
    element.removeEventListener('pointercancel', this.onEnd);
    element.removeEventListener('lostpointercapture', this.onEnd);
    this.legacyEvents.forEach((name) => element.removeEventListener(name, this.stopInput));
    document.removeEventListener('pointerdown', this.detectTouch, true);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('blur', this.onReset);
    window.removeEventListener('resize', this.onReset);
    this.coarsePointer.removeEventListener('change', this.updateVisibility);
  }
}
