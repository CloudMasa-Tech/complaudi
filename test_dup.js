const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const items = await prisma.complianceItem.findMany({ where: { ruleCode: 'MSME_UDYAM_REGISTRATION' } });
  console.log(items);
}
main();
