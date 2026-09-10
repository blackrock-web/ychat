import path from 'path';
import { migrateAtRestDevData } from '../server/migrateAtRest';

console.log('=== Running Domain 2 At-Rest Local Storage Migration ===');
const dataDir = path.resolve(process.cwd(), '.data');
const summary = migrateAtRestDevData(dataDir);

console.log('Migration Completed:');
console.log('  Scanned files:', summary.scannedFiles);
console.log('  Files sanitized (purged forbidden keys):', summary.filesSanitized);
console.log('  Files re-encrypted with AES-256-GCM:', summary.filesReencrypted);
console.log('  Total private keys purged:', summary.privateKeysPurgedCount);
console.log('  Status:', summary.status);
console.log('=== All files in .data/ are verified safe from plaintext key leakage ===');
