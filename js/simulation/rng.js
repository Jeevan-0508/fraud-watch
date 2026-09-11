/* simulation/rng.js — deterministic PRNG so the whole simulation is
   seed-reproducible (same seed -> same event sequence, same entity
   population). mulberry32: small, fast, good-enough distribution for
   a game simulation (not cryptographic, not trying to be). */
const FWRng = (() => {
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createRng(seed) {
    const next = mulberry32(seed >>> 0);
    return {
      next,
      int(min, max) { return Math.floor(next() * (max - min + 1)) + min; },
      pick(arr) { return arr[Math.floor(next() * arr.length)]; },
      chance(p) { return next() < p; }
    };
  }

  return { createRng, mulberry32 };
})();
