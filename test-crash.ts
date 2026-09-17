import { parseMcaMasterDataPdf } from './src/lib/mcaMasterData.ts';
import { importMcaMasterData } from './src/modules/companies/companies.service.ts';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const text = 'CIN U72900TN2020PTC138472 Company Name FOO Registered Address BAR';
  const parsed = parseMcaMasterDataPdf(text);
  
  // mock actor
  const actor = {
    id: 'b2f56722-e421-4fa2-935f-155e99499839', // Need a real user ID? We can just bypass DB by testing only parse.
    email: 'admin@cloudmasa.com',
    role: 'SUPER_ADMIN',
    organizationId: 'org_id'
  };

  // We can't easily mock DB calls without real data, but maybe we can just see if the parse result has undefineds that crash Prisma.
  console.log('Parsed:', JSON.stringify(parsed, null, 2));
}

run().catch(console.error).finally(() => prisma.$disconnect());
