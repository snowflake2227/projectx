const crypto = require('crypto');

const password = process.argv[2];

if (!password) {
    console.error('Usage: node utils/hash-password.js "<strong-password>"');
    process.exit(1);
}

const hash = crypto.createHash('sha256').update(password).digest('hex');
console.log(hash);
