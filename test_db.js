const fs = require('fs');
const { Pool } = require('pg');

const envPath = 'c:/Users/lenovo/OneDrive/Desktop/capstone/.env.local';
const env = fs.readFileSync(envPath, 'utf-8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL')).split('=')[1].replace(/['"\r]/g, '');

const pool = new Pool({ connectionString: dbUrl });

pool.query('SELECT * FROM fuelrecords ORDER BY fuel_record_id DESC LIMIT 5')
  .then(res => {
    console.log(JSON.stringify(res.rows, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
