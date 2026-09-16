import { env } from './src/config/env';
import { storage } from './src/lib/storage';

async function main() {
  try {
    await storage.upload('test/hello.txt', Buffer.from('hello'), 'text/plain');
    console.log('Upload success');
  } catch (err) {
    console.error('Upload error:', err);
  }
}
main();
