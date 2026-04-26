const { createPasswordHash } = require('../services/passwords');

const password = process.argv[2] || '';

if (!password) {
  console.error('Usage: node scripts/generate-admin-password-hash.js "your-password"');
  process.exit(1);
}

console.log(createPasswordHash(password));
