import { computeBlake3, computeBlake3Chain, bytesToBase64, base64ToBytes } from './primitives';
import { Blake3ChainState, DecryptedMessage } from './types';

export function initializeBlake3Chain(conversationId: string): Blake3ChainState {
  const initSeed = new TextEncoder().encode(`ychat-blake3-init:${conversationId}`);
  const initialDigest = computeBlake3(initSeed);
  return {
    conversationId,
    currentHash: bytesToBase64(initialDigest),
    blockCount: 0
  };
}

export function appendMessageToBlake3Chain(
  chainState: Blake3ChainState,
  message: DecryptedMessage,
  rawCiphertext: string
): Blake3ChainState {
  const prevHashBytes = base64ToBytes(chainState.currentHash);
  const blockData = new TextEncoder().encode(
    `${message.id}:${message.sequence}:${message.senderDeviceId}:${message.timestamp}:${rawCiphertext}`
  );
  const nextHashBytes = computeBlake3Chain(prevHashBytes, blockData);

  return {
    conversationId: chainState.conversationId,
    currentHash: bytesToBase64(nextHashBytes),
    blockCount: chainState.blockCount + 1
  };
}

export function verifyHistoryIntegrity(
  messages: Array<{ message: DecryptedMessage; rawCiphertext: string }>,
  expectedFinalHash: string,
  conversationId: string
): boolean {
  if (messages.length === 0) return true;
  let runningChain = initializeBlake3Chain(conversationId);
  for (const item of messages) {
    runningChain = appendMessageToBlake3Chain(runningChain, item.message, item.rawCiphertext);
  }
  return runningChain.currentHash === expectedFinalHash;
}
