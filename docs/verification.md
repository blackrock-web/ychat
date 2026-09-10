# YChat Cryptographic Verification Specification

## 1. Overview & Verification Architecture

YChat provides two complementary, cryptographically grounded identity verification layers to protect users against Man-in-the-Middle (MITM) attacks, rogue server key substitution, and session confusion:

1. **Static Identity Safety Numbers (Long-term Identity Binding)**
2. **Interactive Dynamic Session Verification (Fresh CSPRNG Nonce + Real ISO/IEC 18004 QR + 60-Bit Security Value)**

Both mechanisms operate completely out-of-band and client-side. The untrusted server never generates, controls, or validates safety numbers.

---

## 2. Dynamic Session Verification Protocol

When a user initiates Chat Verification, a fresh, non-reusable cryptographic challenge is generated.

```
+-----------------------------------------------------------------------------------+
|                            Dynamic Verification Flow                              |
+-----------------------------------------------------------------------------------+
  User A (Initiator)                                                User B (Peer)
       |                                                                  |
  1. Generate 128-bit CSPRNG Nonce (vNonce)                               |
  2. Bind Conversation Context:                                           |
     Input = "ychat-dynamic-verification-v2:"                             |
             || conversationId                                            |
             || sorted(IdentityA || IdentityB)                            |
             || vNonce                                                    |
  3. Digest = SHA3-512(Input)                                             |
  4. Derive 60-Bit Code + 60-Digit Code + Auth Tag                        |
  5. Generate Real ISO/IEC 18004 QR Payload:                              |
     ychat:verify?v=2&cid=<cid>&nonce=<hex>&code=<digits>&bits=<bits>&tag=<tag>
       |                                                                  |
       |  ----------------- Transmit Out-of-Band (QR Scan) ------------>  |
       |                                                                  |
                                                                    6. Extract params from QR
                                                                    7. Enforce Invariant Checks:
                                                                       - Nonce Replay Check
                                                                       - Expiry TTL Window (10 min)
                                                                       - Cross-Conversation CID Match
                                                                    8. Recompute digest using
                                                                       local session keys & vNonce
                                                                    9. Compare Tag & 60-Bit Value
                                                                   10. Invalidate Nonce (Single-Use)
```

### Mathematical Formulation
Given:
- Active Conversation ID: $CID \in \{0,1\}^{128}$
- Public Identity Bundles: $ID_A, ID_B$ (Lexicographically sorted)
- Fresh CSPRNG Nonce: $N \leftarrow \{0,1\}^{128}$
- Cryptographic Hash: $\mathcal{H} = \text{SHA3-512}$

$$K_{verify} = \mathcal{H}(\text{"ychat-dynamic-verification-v2:"} \parallel CID \parallel \text{sorted}(ID_A, ID_B) \parallel N)$$

From the 512-bit digest $K_{verify}$:
1. **60-Bit Binary Value**: The first 60 bits ($b_0 \dots b_{59}$) extracted sequentially from the high bytes. Formatted into 12 blocks of 5 bits.
2. **60-Digit Decimal Code**: Twelve 16-bit unsigned integers extracted from $K_{verify}$, mapped to 5-digit decimal blocks modulo $100{,}000$.
3. **Authentication Tag**: Hexadecimal prefix of $K_{verify}$ truncated to 128 bits (32 hex characters).

---

## 3. Threat Mitigation Matrix

| Threat | Mitigation Mechanism | Failure Outcome |
|---|---|---|
| **Replay Attack** | Each verification session utilizes a fresh 128-bit CSPRNG nonce. Consumed nonces are cached and rejected. | `SECURITY VIOLATION: Replay attack detected! Nonce already consumed.` |
| **Cross-Conversation Substitution** | The payload explicitly embeds and signs the conversation UUID ($CID$). | `SECURITY VIOLATION: Cross-conversation substitution detected! QR code belongs to a different chat.` |
| **Active MITM / Key Substitution** | The verification tag binds to both users' ML-DSA-87 and ML-KEM-1024 public identity keys. An attacker's injected key changes $K_{verify}$. | `SECURITY ALERT: Cryptographic tag mismatch! Potential MITM intervention.` |
| **QR Code Tampering** | Changing any digit, bit, or nonce invalidates the SHA3-512 tag and causes visual bit diffs. | Immediate UI warning with percentage mismatch and per-bit diff highlighting. |
| **Expired Verification** | Payloads contain timestamp parameter $ts$ with strict 10-minute maximum TTL. | `SECURITY VIOLATION: Verification QR has expired. Please generate a fresh code.` |

---

## 4. User Discovery & Secure Invite Codes

To connect contacts without exposing email addresses or database internals, YChat supports:

### 4.1 Cryptographically Secure Short Pairing Codes
- Generated via CSPRNG `crypto.randomBytes(9)`.
- Alphabet: 64 unambiguous characters (`23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz#$@!%&*-`).
- Strictly excludes visually ambiguous characters (`0`, `O`, `1`, `l`, `I`).
- Entropy: $> 54$ bits of cryptographic randomness.
- Constraints:
  - **Single-use**: Automatically consumed upon successful acceptance.
  - **Strict TTL**: 15-minute expiration timestamp.
  - **Rate Limiting**: Backend blocks brute-force resolution attempts (max 15 attempts per minute per IP/account).
  - **Privacy**: Resolving an invite returns ONLY public anonymous identifiers (`username`, `displayName`, `uuid`), never email, password hash, or private keys.

### 4.2 Single-Use Invite QR Codes
The QR code encodes:
`ychat:invite?v=1&u=<userUuid>&token=<24ByteCSPRNGHex>&code=<pairingCode>`
- Scanned directly or resolved via backend API.
- Rejects self-invitations.
- Automatically provisions isolated direct conversation upon acceptance.
