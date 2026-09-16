const { Client } = require('pg');
const regions = [
  'ap-northeast-1', 'ap-northeast-2', 'ap-south-1', 'ap-southeast-1', 'ap-southeast-2',
  'ca-central-1', 'eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3',
  'sa-east-1', 'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2'
];
const projectRef = 'ciulqktarpydorkkfmqh';
const pass = 'BNpRiBPgWYYaZGDX';
async function test() {
  for (const region of regions) {
    const url = `postgresql://postgres.${projectRef}:${pass}@aws-0-${region}.pooler.supabase.com:6543/postgres?sslmode=require`;
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 3000 });
    try {
      await client.connect();
      console.log(`SUCCESS: ${region}`);
      await client.end();
      return region;
    } catch (e) {
      if (e.message && e.message.includes('password authentication failed')) {
         console.log(`AUTH FAILED: ${region}`);
      }
    }
  }
  console.log('FAIL: None matched');
}
test();
