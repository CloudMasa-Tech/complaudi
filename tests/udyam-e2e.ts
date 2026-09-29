import { getBizVerifyUdyamProvider } from '../src/lib/verifications/providers/udyam';
import readline from 'readline';

async function main() {
  const provider = getBizVerifyUdyamProvider({
    baseUrl: 'https://bizverify.regibiz.in',
    serviceToken: 'dev-bizverify-service-token'
  });

  const udyamNo = 'UDYAM-TN-28-0008330';
  console.log(`Starting Udyam E2E for ${udyamNo}...`);

  const sessionRes = await provider.createSession(udyamNo);
  if (!sessionRes.success) {
    console.error('Session failed:', sessionRes.error);
    process.exit(1);
  }

  console.log('Session ID:', sessionRes.sessionId);
  console.log('Captcha Image data URL ready.');

  // For testing, since we can't solve visual captcha automatically here easily without user interaction, 
  // maybe we just output the Base64 to a file and ask for input in the terminal?
  const fs = require('fs');
  fs.writeFileSync('captcha.html', `<img src="${sessionRes.captchaImage}" />`);
  console.log('Open captcha.html to see the CAPTCHA.');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('Enter CAPTCHA: ', async (captchaText) => {
    rl.close();
    console.log(`Verifying with CAPTCHA: ${captchaText}...`);

    const verifyRes = await provider.verifySession({
      sessionId: sessionRes.sessionId!,
      udyamNumber: udyamNo,
      captcha: captchaText
    });

    if (!verifyRes.success) {
      console.error('Verify failed:', verifyRes.error);
      process.exit(1);
    }

    console.log('VERIFY SUCCESS!');
    console.log(JSON.stringify(verifyRes.data, null, 2));
  });
}

main().catch(console.error);
