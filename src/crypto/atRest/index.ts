import { AtRestCiphertext, AtRestStorageDriver, AtRestPlatform } from './types';
import { WebAtRestProvider } from './webCryptoProvider';
import { DesktopAtRestProvider } from './desktopProvider';
import { AndroidAtRestProvider } from './androidProvider';

export * from './types';
export { WebAtRestProvider } from './webCryptoProvider';
export { DesktopAtRestProvider } from './desktopProvider';
export { AndroidAtRestProvider } from './androidProvider';

export function detectPlatform(): AtRestPlatform {
  if (typeof window !== 'undefined') {
    if ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__) {
      return 'tauri';
    }
    if (
      (window as any).Android ||
      (window as any).AndroidKeyStoreBridge ||
      ((window as any).Capacitor && (window as any).Capacitor.getPlatform() === 'android')
    ) {
      return 'android';
    }
  }
  return 'web';
}

export function createAtRestDriver(platform?: AtRestPlatform): AtRestStorageDriver {
  const target = platform || detectPlatform();
  switch (target) {
    case 'tauri':
      return new DesktopAtRestProvider();
    case 'android':
      return new AndroidAtRestProvider();
    case 'web':
    default:
      return new WebAtRestProvider();
  }
}

export function isEncryptedAtRest(record: any): record is AtRestCiphertext {
  return (
    record &&
    typeof record === 'object' &&
    record.encrypted === true &&
    record.v === 1 &&
    record.algorithm === 'AES-256-GCM' &&
    typeof record.iv === 'string' &&
    typeof record.ciphertext === 'string'
  );
}
