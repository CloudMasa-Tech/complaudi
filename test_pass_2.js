const { Client } = require('pg');

async function test(pass) {
  const url = `postgresql://postgres.ciulqktarpydorkkfmqh:${encodeURIComponent(pass)}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`;
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    console.log(`SUCCESS with password: ${pass}`);
    await client.end();
    return true;
  } catch (e) {
    console.log(`FAILED with password: ${pass} - Error: ${e.message}`);
    return false;
  }
}

async function run() {
  const p1 = 'BNpRiBPgWYYaZGDX';
  const p2 = '.S@xCh.C)APHg9A';
  if (await test(p1)) return;
  if (await test(p2)) return;
}

run();
