const crypto = require('crypto');

const password = process.argv[2];

if (!password) {
    console.error('Usage: node utils/hash-password.js "Bulldog3_Lusty1_Footbath9_Clench4_Unleash8"');
    process.exit(1);
}

const hash = crypto.createHash('sha256').update(password).digest('hex');
console.log(hash);
