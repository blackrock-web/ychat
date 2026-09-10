# YChat Cryptographic Architecture & Protocol Specification

## 1. Overview & Security Paradigm

YChat implements a zero-knowledge, hybrid post-quantum end-to-end encryption (E2EE) protocol. The central messaging server acts strictly as an untrusted ciphertext relay and public key directory. Under this model:
- The server possesses **zero access** to plaintext, private identity keys, ephemeral prekeys, session keys, or message keys.
- Communication confidentiality and authenticity are guaranteed even if the server database, network links, or backend infrastructure are completely compromised.
- Protection is provided against both classical cryptanalytic attacks and future "Harvest Now, Decrypt Later" (HNDL) attacks mounted by quantum adversaries via standard NIST post-quantum primitives (FIPS 203 & FIPS 204).

---

## 2. Key Hierarchy & Cryptographic Primitives

```
                           +---------------------------+
                           |  Device Cryptographic     |
                           |  Identity Material        |
                           +-------------+-------------+
                                         |
               +-------------------------+-------------------------+
               |                                                   |
      [Identity Signing]                                  [Key Agreement Material]
      ML-DSA-87 (FIPS 204)                                         |
      (Dilithium-5 equivalent)                         +-----------+-----------+
                                                       |                       |
                                                   [Classical]          [Post-Quantum]
                                                     X25519           ML-KEM-1024 (FIPS 203)
                                                       |                       |
                                                       +-----------+-----------+
                                                                   |
                                                        [Shared Secret Derivation]
                                                    X25519_SS || ML-KEM-1024_SS
                                                                   |
                                                          HKDF-SHA3-512
                                                                   |
                                                          +--------v--------+
                                                          |  Master Secret  |
                                                          +--------+--------+
                                                                   |
                                                      HKDF(info="ychat-session")
                                                                   |
                                                          +--------v--------+
                                                          |   Session Key   | (Rekeyed every 50 msgs or 5 min)
                                                          +--------+--------+
                                                                   |
                                                    HKDF(info="ychat-conversation")
                                                                   |
                                                          +--------v--------+
                                                          | Conversation Key|
                                                          +--------+--------+
                                                                   |
                                                      HKDF(info="ychat-msg-step")
                                                                   |
                                                          +--------v--------+
                                                          |   Message Key   | (Single-use per outbound payload)
                                                          +--------+--------+
                                                                   |
                                                    ChaCha20-Poly1305 (AEAD) + CSPRNG Nonce
                                                                   |
                                                          +--------v--------+
                                                          |   Ciphertext    |
                                                          +--------+--------+
                                                                   |
                                                   ML-DSA-87 Signature of Envelope
```

### Audited Primitives Reference Table

| Role | Primitive | Specification / Standard | Library Used |
| :--- | :--- | :--- | :--- |
| **Post-Quantum Signing** | ML-DSA-87 | NIST FIPS 204 (Dilithium-5) | `@noble/post-quantum/ml-dsa` |
| **Post-Quantum KEM** | ML-KEM-1024 | NIST FIPS 203 (Kyber-1024) | `@noble/post-quantum/ml-kem` |
| **Classical Key Exchange** | X25519 | RFC 7748 / Curve25519 ECDH | `@noble/curves/ed25519` |
| **Symmetric Cipher** | ChaCha20-Poly1305 | RFC 8439 (256-bit key, 96-bit nonce, 128-bit tag) | `@noble/ciphers/chacha` |
| **Key Derivation Function** | HKDF-SHA3-512 | RFC 5869 + FIPS 202 SHA3-512 | `@noble/hashes/hkdf`, `@noble/hashes/sha3` |
| **Tamper-Evident History** | BLAKE3 Hash Chain | BLAKE3 Cryptographic Hash | `@noble/hashes/blake3` |
| **Password Hashing** | Argon2id | RFC 9106 (Memory: 64MB, Iterations: 3, Parallelism: 1) | `@noble/hashes/argon2` |

---

## 3. Device Key Generation & Registration

When a user initializes YChat on any client device (Web, Desktop, or Android):
1. **Identity Signing Keypair**: Generates an ML-DSA-87 keypair `(ik_sign_pub, ik_sign_priv)`.
2. **Identity Key Agreement Keypair**: Generates an X25519 keypair `(ik_dh_pub, ik_dh_priv)` and an ML-KEM-1024 keypair `(ik_kem_pub, ik_kem_priv)`.
3. **One-Time Prekeys (OPKs)**:
   - Generates a pool of 20 ephemeral X25519 keypairs `(opk_dh_pub_i, opk_dh_priv_i)`.
   - Generates a pool of 20 ephemeral ML-KEM-1024 keypairs `(opk_kem_pub_i, opk_kem_priv_i)`.
4. **Registration Payload**:
   - The device registers its public keys (`ik_sign_pub`, `ik_dh_pub`, `ik_kem_pub`) along with its signed prekey pool to the server via `/api/v1/devices/register`.
   - **Private keys NEVER leave client storage.**

---

## 4. Hybrid X3DH-Style Session Establishment

To initiate a secure conversation with recipient Bob, Alice's device:
1. Fetches Bob's active device prekey bundle from the server (`/api/v1/devices/:deviceId/prekeys`):
   - Bob's ML-DSA-87 identity public key: `Bob_IK_Sign`
   - Bob's X25519 identity public key: `Bob_IK_DH`
   - Bob's ML-KEM-1024 identity public key: `Bob_IK_KEM`
   - Bob's one-time X25519 prekey: `Bob_OPK_DH`
   - Bob's one-time ML-KEM prekey: `Bob_OPK_KEM`
2. Alice generates ephemeral keypair:
   - `Alice_EK_DH` (X25519)
3. Alice encapsulates a 256-bit symmetric secret using Bob's ML-KEM keys:
   - `(kem_ciphertext, kem_shared_secret) = ML_KEM_1024.encapsulate(Bob_OPK_KEM || Bob_IK_KEM)`
4. Alice computes classical ECDH shared secret:
   - `dh1 = X25519(Alice_IK_DH_priv, Bob_OPK_DH)`
   - `dh2 = X25519(Alice_EK_DH_priv, Bob_IK_DH)`
   - `dh3 = X25519(Alice_EK_DH_priv, Bob_OPK_DH)`
   - `dh_shared_secret = dh1 || dh2 || dh3`
5. **Master Secret Derivation**:
   ```
   master_secret = HKDF_Extract(
     salt = "ychat-v1-hybrid-salt",
     ikm  = dh_shared_secret || kem_shared_secret
   )
   ```
6. Handshake envelope containing `(Alice_EK_DH_pub, kem_ciphertext)` is signed by Alice with `Alice_IK_Sign` and transmitted via the server as an opaque packet.
7. Bob decapsulates the ML-KEM ciphertext using his private KEM key, computes the identical ECDH operations, derives the exact same `master_secret`, and consumes the one-time prekey.

---

## 5. Ratchet & Rekeying Specifications

To ensure forward secrecy and break-in recovery:
1. **Session Key**: Derived from `master_secret` using `HKDF-SHA3-512(master_secret, "ychat-session-v1", 32)`.
2. **Conversation Key**: Derived from `Session Key` using `HKDF-SHA3-512(session_key, "ychat-conv-v1", 32)`.
3. **Message Key**: For message index $n$, `message_key_n = HKDF-SHA3-512(conv_key, "msg-" + n, 32)`. The key is **destroyed immediately** after encrypting or decrypting that single payload.
4. **Rekey Trigger Conditions**:
   - Every **50 messages** sent or received, OR
   - Every **5 minutes** of continuous session activity.
5. **Rekeying Execution**:
   - The ratchet steps forward: a new ephemeral DH exchange is performed or an internal ratchet step is mixed into the Master Secret chain.
   - The prior Session Key is overwritten in memory with zero bytes and discarded from client state.

---

## 6. Message Encryption & Signature Envelope

Every message sent through YChat follows this strict serialization:
1. Client generates a 96-bit (12-byte) cryptographically secure random nonce via `crypto.getRandomValues`.
2. Payload is serialized to UTF-8 JSON: `{ text, timestamp, clientMessageId, conversationId, sequence }`.
3. Ciphertext and 16-byte Poly1305 authentication tag are computed:
   `ciphertext = ChaCha20_Poly1305_Encrypt(key=message_key, nonce=nonce, plaintext=payload, aad=metadata_bytes)`
4. The client signs the tuple `(conversation_id || sequence || nonce || ciphertext)` with the sender's private `ML-DSA-87` identity key:
   `signature = ML_DSA_87_Sign(sender_ik_sign_priv, envelope_hash)`
5. The complete transport envelope is sent to the backend:
   ```json
   {
     "clientMessageId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
     "conversationId": "7b6f1234-5678-4321-9876-abcdef012345",
     "senderDeviceId": "d-web-12345678",
     "recipientDeviceId": "d-android-87654321",
     "ciphertext": "base64...",
     "nonce": "base64...",
     "signature": "base64...",
     "encryptionVersion": "hybrid-x25519-mlkem1024-v1",
     "sequence": 1
   }
   ```
6. **Recipient Verification**:
   - The recipient looks up the sender's registered `ML-DSA-87` public key.
   - Verifies the signature. If verification fails, **the packet is immediately dropped and flagged as an attempted forgery**.
   - If verification succeeds, the recipient computes the matching message key and decrypts the ciphertext.

---

## 7. Local Client BLAKE3 Hash Chain

To provide local tamper-evidence against database manipulation or malicious modification of client storage:
- Each conversation maintains a running cryptographic hash:
  `H_0 = BLAKE3("ychat-chain-init:" + conversation_id)`
  `H_n = BLAKE3(H_{n-1} || message_id || sender_device_id || timestamp || ciphertext)`
- The hash chain state `H_n` is updated atomically with each decrypted message and stored in IndexedDB.
- When opening a conversation, the client verifies the integrity of the chain. If any message has been altered or deleted locally, the chain breaks and warns the user.

---

## 8. Safety Numbers (MITM Verification)

Users can verify cryptographic authenticity out-of-band to prevent active Man-in-the-Middle (MITM) attacks or unauthorized key substitutions:
- Safety numbers are calculated from sorted device identity public keys:
  `fingerprint = SHA3_512(sort(Alice_IK_Sign, Alice_IK_KEM) || sort(Bob_IK_Sign, Bob_IK_KEM))`
- Formatted into 12 blocks of 5 decimal digits (60 digits total) and a visual 2D matrix pattern.
- Users verify this code in person or through a verified secondary channel.

---

## 9. Stated Security Guarantees & Non-Guarantees

### What IS Guaranteed
1. **Confidentiality against Classical and Quantum Attackers**: Ciphertexts protected by ChaCha20-Poly1305 with keys derived from hybrid X25519 and ML-KEM-1024 cannot be decrypted by passive eavesdroppers, cloud providers, or quantum computers executing Shor's algorithm.
2. **Server Zero-Knowledge**: The backend never receives, computes, or stores private keys, session keys, or plaintexts.
3. **Cryptographic Authenticity & Integrity**: Outbound messages are signed with NIST ML-DSA-87 post-quantum signatures and sealed with Poly1305 MACs; forged messages are rejected.
4. **Forward Secrecy & Rapid Rekeying**: Session keys are rotated every 50 messages / 5 minutes; past sessions cannot be decrypted even if current device keys are later exposed.
5. **Local Tamper-Evidence**: The BLAKE3 hash chain detects any modification to local cached message history.

### What is NOT Guaranteed (Honest Limitations)
1. **Endpoint Compromise**: If malware, keyloggers, or operating system vulnerabilities compromise the user's client hardware/browser process, in-memory plaintexts can be inspected at the moment of display.
2. **Metadata Minimization Limits**: The central server necessarily knows device IDs, IP addresses of connecting sockets, message delivery timestamps, and ciphertext sizes required to route messages.
3. **Denial of Service**: An untrusted or malicious server could refuse to deliver ciphertext payloads or drop WebSocket frames.
4. **No Unqualified "WhatsApp-Level" or "Unbreakable" Claim**: While our primitives use official NIST FIPS 203/204 and RFC standards, complete system-level assurance requires independent third-party penetration testing and formal protocol verification before deploying for life-critical operations.
