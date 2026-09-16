import { env } from './src/config/env';
import { storage } from './src/lib/storage';

async function main() {
  try {
    // Note: storage.upload expects Buffer in the type definition, so we need to ts-ignore or cast it for this test
    // Actually in JS it won't type check unless we cast it to any
    await (storage as any).upload('test/hello2.txt', new Blob([Buffer.from('hello')]), 'text/plain');
    console.log('Upload success');
  } catch (err) {
    console.error('Upload error:', err);
  }
}
main();
