/* simulation/clock.js — sim time, decoupled from render/frame time.
   A day is a 24h cycle with named shifts so event probability can vary
   by time of day later (Phase 24 in the product spec) without this
   module knowing anything about events. Pure logic: no Phaser, no DOM,
   no setInterval — the caller drives it by calling tick()/advanceBy(). */
const FWSimClock = (() => {
  const SECONDS_PER_DAY = 86400;

  const SHIFTS = [
    { name: 'night', from: 22, to: 6 },
    { name: 'morning', from: 6, to: 12 },
    { name: 'peak', from: 12, to: 18 },
    { name: 'evening', from: 18, to: 22 }
  ];

  function shiftForHour(hour) {
    const s = SHIFTS.find(s => s.from < s.to ? (hour >= s.from && hour < s.to) : (hour >= s.from || hour < s.to));
    return s ? s.name : 'night';
  }

  class SimClock {
    constructor(opts = {}) {
      this.speed = opts.speed || 1;       // real-time multiplier (1x/5x/20x/100x)
      this.running = opts.running !== false;
      this.day = opts.day || 1;
      this.simSeconds = opts.startSimSeconds != null ? opts.startSimSeconds : 6 * 3600; // default 06:00
    }

    setSpeed(x) { this.speed = Math.max(0, x); }
    pause() { this.running = false; }
    resume() { this.running = true; }

    // Advance by a real-time delta (ms), scaled by speed. Returns sim-seconds elapsed.
    tick(realDeltaMs) {
      if (!this.running || realDeltaMs <= 0) return 0;
      return this.advanceBy((realDeltaMs / 1000) * this.speed);
    }

    // Advance by a raw amount of sim-seconds, no real-time coupling.
    // Used for offline/background fast-forward (Phase 8) independent of rendering.
    advanceBy(simSecondsAmount) {
      if (simSecondsAmount <= 0) return 0;
      this.simSeconds += simSecondsAmount;
      while (this.simSeconds >= SECONDS_PER_DAY) {
        this.simSeconds -= SECONDS_PER_DAY;
        this.day += 1;
      }
      return simSecondsAmount;
    }

    hour() { return Math.floor(this.simSeconds / 3600); }
    shift() { return shiftForHour(this.hour()); }

    timeOfDay() {
      const h = Math.floor(this.simSeconds / 3600) % 24;
      const m = Math.floor((this.simSeconds % 3600) / 60);
      const s = Math.floor(this.simSeconds % 60);
      const pad = n => String(n).padStart(2, '0');
      return `${pad(h)}:${pad(m)}:${pad(s)}`;
    }

    toJSON() {
      return { speed: this.speed, running: this.running, day: this.day, simSeconds: this.simSeconds };
    }

    static fromJSON(json) {
      return new SimClock({ speed: json.speed, running: json.running, day: json.day, startSimSeconds: json.simSeconds });
    }
  }

  return { SimClock, shiftForHour, SECONDS_PER_DAY };
})();
