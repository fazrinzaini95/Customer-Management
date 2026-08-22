// Usage: node scripts/hash-password.js "yourPassword123"
// Prints a bcrypt hash you can paste into a manual INSERT/UPDATE against
// the users table — useful for fixing an account directly in Supabase's
// SQL editor without going through the app. Normal signup already hashes
// passwords automatically; this is just for manual/admin recovery.
const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.js "yourPassword"');
  process.exit(1);
}

bcrypt.hash(password, 10).then((hash) => {
  console.log(hash);
});
