// PIN protection for Ask Buddy: salted scrypt hash, lockout after repeated mistakes, idle auto-lock.
const crypto = require('crypto');

const MAX_FAILS = 3;
const LOCKOUT_MS = 5 * 60 * 1000;
const IDLE_MS = 10 * 60 * 1000;

function validPin(pin) { return /^\d{4,12}$/.test(String(pin || '')); }

function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, 32);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

function verifyPin(pin, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const got = crypto.scryptSync(String(pin), Buffer.from(rec.salt, 'hex'), 32);
  const want = Buffer.from(rec.hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// state: { count, until } kept in the config. Returns { ok, state, msg }.
function attempt(pin, rec, state, now) {
  const st = Object.assign({ count: 0, until: 0 }, state);
  if (st.until > now) {
    return { ok: false, state: st, msg: 'Too many wrong PINs. Try again in ' + Math.ceil((st.until - now) / 60000) + ' minute(s).' };
  }
  if (verifyPin(pin, rec)) return { ok: true, state: { count: 0, until: 0 } };
  st.count += 1;
  if (st.count >= MAX_FAILS) {
    st.count = 0;
    st.until = now + LOCKOUT_MS;
    return { ok: false, state: st, msg: 'Wrong PIN. Locked for 5 minutes.' };
  }
  return { ok: false, state: st, msg: 'Wrong PIN. ' + (MAX_FAILS - st.count) + ' attempt(s) left.' };
}

module.exports = { validPin, hashPin, verifyPin, attempt, IDLE_MS, MAX_FAILS, LOCKOUT_MS };
