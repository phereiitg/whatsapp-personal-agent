// test_db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres.yrwhkgnsmwqnrxnvzbfe:%40Prakhar1609%23@aws-1-ap-south-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

pool.query('SELECT NOW();')
  .then(res => {
    console.log('✅ Connected to Supabase! Time:', res.rows[0].now);
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
  })
  .finally(() => pool.end());
