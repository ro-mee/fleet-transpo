import bcrypt from 'bcryptjs';
import { query } from './src/lib/db.js';

async function run() {
  const hash = await bcrypt.hash('driver123', 10);
  await query(
    `UPDATE employees SET password_hash = $1 
     WHERE email IN (
       SELECT e.email FROM employees e 
       JOIN roles r ON e.role_id = r.role_id 
       WHERE r.role_name = 'driver' AND e.status = 'Active' 
       ORDER BY e.email LIMIT 2
     )`,
    [hash]
  );
  console.log('Passwords updated');
  process.exit(0);
}
run();
