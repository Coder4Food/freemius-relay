const crypto = require('crypto');

const HASH_PREFIX = 'scrypt';
const DEFAULT_SALT_BYTES = 16;
const DEFAULT_KEYLEN = 64;

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(DEFAULT_SALT_BYTES).toString('hex');
  const derivedKey = crypto
    .scryptSync(String(password || ''), salt, DEFAULT_KEYLEN)
    .toString('hex');

  return [HASH_PREFIX, salt, derivedKey].join('$');
}

function verifyPassword(password, storedHash) {
  const text = String(storedHash || '').trim();
  const parts = text.split('$');
  let salt = '';
  let expected = '';
  let actual = '';

  if (parts.length !== 3 || parts[0] !== HASH_PREFIX) {
    return false;
  }

  salt = parts[1] || '';
  expected = parts[2] || '';
  actual = crypto
    .scryptSync(String(password || ''), salt, DEFAULT_KEYLEN)
    .toString('hex');

  return timingSafeEqualText(actual, expected);
}

module.exports = {
  createPasswordHash,
  verifyPassword,
};
