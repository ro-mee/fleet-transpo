import fs from 'fs';
import { query } from './src/lib/db.js';

const env = fs.readFileSync('.env.local', 'utf-8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL')).split('=')[1];
process.env.DATABASE_URL = dbUrl.trim();

async function checkTrip() {
  try {
    const { rows } = await query(
      `SELECT * FROM trips ORDER BY updated_at DESC LIMIT 1`
    );
    console.log(Object.keys(rows[0]));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkTrip();
