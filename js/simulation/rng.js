/* simulation/rng.js — deterministic PRNG so the whole simulation is
   seed-reproducible (same seed -> same event sequence, same entity
   population). mulberry32: small, fast, good-enough distribution for
   a game simulation (not cryptographic, not trying to be).

   THE STREAM'S POSITION IS READABLE. A generator like this one is a seed plus
   how many numbers have been drawn from it, and the second half used to live
   only inside the closure. That made the run unsaveable in the one way that
   matters: restoring a world by re-seeding would hand it the numbers it had
   already used, so day 4 would replay day 1's draws under day 3's world.
   position()/setPosition() expose that counter and nothing else -- the counter
   IS the whole state of mulberry32, so a saved position resumes the stream
   exactly rather than approximately. No caller may derive anything from the
   value: it is an opaque 32-bit token whose only legitimate use is being handed
   back to setPosition. */
const FWRng = (() => {
  function mulberry32(seed) {
    let a = seed >>> 0;
    const next = function next() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.position = () => a >>> 0;
    next.setPosition = (v) => { a = v >>> 0; return a; };
    return next;
  }

  function createRng(seed) {
    const next = mulberry32(seed >>> 0);
    return {
      next,
      int(min, max) { return Math.floor(next() * (max - min + 1)) + min; },
      pick(arr) { return arr[Math.floor(next() * arr.length)]; },
      chance(p) { return next() < p; },
      position() { return next.position(); },
      setPosition(v) { return next.setPosition(v); }
    };
  }

  return { createRng, mulberry32 };
})();
