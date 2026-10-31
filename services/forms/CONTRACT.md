# The contract of the comments service

What the comments service does, as the widget, the moderation CLI and the data files see it, so that its Go replacement
(`services/forms/`) is a drop-in replacement: they keep working unchanged, and switching back stays possible. It says
what the service does, not how it is built or why. The code is the authority; where this text and the code disagree,
the code wins and this text is corrected.

Code locations name these sources:

- `server/…`: the first production service (Bun, Hono 4.13.7, altcha-lib 2.5.0), which is not part of this repository.
- `cli/…`: the moderation CLI, `packages/hadley/addons/forms/` in this repository.
- `lib/…`: hadley's own code, `packages/hadley/lib/` in this repository.
- `widget/…`: the browser widget in the theme of teblo.de: `theme/assets/js/comments.ts`, `comments-worker.ts` and
  `theme/templates/partials/comments-form.sort`.
- `lib/…`: hadley, for what `hadley dev` and a local build do with the service.

`tests/contract.test.ts` checks this contract from outside, against the service `FORMS_SERVICE` names, started with
test values in a data directory of its own: the path of the Go binary.

Codex wrote C1 to C12 and the findings from the code on 2026-10-23; Claude checked them against the code on 2026-10-27
and rewrote C10, C11 and the findings for the state of that day. A statement marked **unverified** could not be
confirmed from the code. Examples are synthetic.

**C1. Scope and HTTP conventions**

The service registers four explicit handlers: the token endpoint, submission endpoint, admin download endpoint, and
admin deletion endpoint. Global CORS middleware runs before them. `server/index.ts:50`

There is no application-level health endpoint, public comment-reading endpoint, email-sending endpoint, or static-file
handler. Published comments come from the moderation workflow described in C10. `server/index.ts:61`

Query parameters are not read by any handler. Request cookies are not used, and the service sets no cookies.
`server/index.ts:61`

Application JSON responses use compact JSON without an appended newline and `Content-Type: application/json`. Errors
described as a message below have the body `{"error":"MESSAGE"}`. This follows the handlers’ `c.json` calls and [Hono’s
JSON response implementation](https://raw.githubusercontent.com/honojs/hono/v4.13.7/src/context.ts).

The application sets no cache policy, retry interval, rate-limit response headers, authentication challenge header, or
security-header bundle. CORS headers are specified separately in C2. `server/index.ts:52`

**Dependency boundary.** The manifest permits `altcha-lib ^2.5.0` and `hono ^4.13.7`; it does not pin an exact version.
The supplied snapshot contains neither a lockfile nor installed dependencies. `server/package.json:11`

Framework details below were checked against Hono v4.13.7; ALTCHA internals were checked against altcha-lib v2.5.0.
Whether production has those exact implementations is **unverified** because its resolved packages were not supplied.

Under that Hono baseline, paths are case-sensitive and trailing slashes are significant; unmatched paths and unsupported
methods return `404`, with plain-text body `404 Not Found`, rather than `405`. Query strings do not form part of route
matching. [Hono routing and defaults](https://raw.githubusercontent.com/honojs/hono/v4.13.7/src/hono-base.ts)

Hono also services `HEAD` through the corresponding `GET` handler and removes the response body afterward. Consequently,
a token `HEAD` affects rate limiting, and an authenticated admin `HEAD` can perform the download operation. [Hono HEAD
dispatch](https://raw.githubusercontent.com/honojs/hono/v4.13.7/src/hono-base.ts)

Uncaught handler errors become `500` with plain-text body `Internal Server Error` and are logged to stderr through
`console.error`. Ordinary framework text responses use `Content-Type: text/plain; charset=UTF-8`. [Hono error
handling](https://raw.githubusercontent.com/honojs/hono/v4.13.7/src/hono-base.ts), [response
implementation](https://raw.githubusercontent.com/honojs/hono/v4.13.7/src/context.ts)

Transport-generated headers, malformed-HTTP responses, connection limits, and errors generated before Hono receives a
request are **unverified**; the deployed Bun and reverse-proxy versions and configuration are absent.

**C2. CORS**

Allowed origins are the concatenation, in this order, of `CORS_ORIGINS`, `SITE_ORIGINS`, and `DEV_ORIGIN`. Each value is
split on commas; entries are trimmed and empty entries removed. Duplicates remain. `server/env.ts:21`

Matching compares the complete origin string exactly. There is no URL normalization, wildcard interpretation, case
folding, suffix matching, or automatic addition of the service’s own origin. `server/index.ts:52`

For an allowed request origin, the response includes `Access-Control-Allow-Origin` with that origin. For an absent or
unlisted origin, the header is omitted; the request still reaches its handler. CORS does not authorize or reject
submissions. `server/index.ts:53`

For the Hono baseline, every response passing through this middleware varies on `Origin`. No
`Access-Control-Allow-Credentials`, `Access-Control-Expose-Headers`, or `Access-Control-Max-Age` is configured. [CORS
implementation](https://raw.githubusercontent.com/honojs/hono/v4.13.7/src/middleware/cors/index.ts)

An `OPTIONS` request to any path returns `204` with no body before authentication, submission validation, or rate
limiting. This applies even without preflight request headers and even to nonexistent paths. [CORS
implementation](https://raw.githubusercontent.com/honojs/hono/v4.13.7/src/middleware/cors/index.ts)

That response advertises `Access-Control-Allow-Methods: GET,POST,DELETE` and `Access-Control-Allow-Headers:
Content-Type,Authorization`; it also varies on `Access-Control-Request-Headers`. Its content-type and content-length
headers are removed. An unlisted origin still receives the preflight response but lacks the allow-origin header. [CORS
implementation](https://raw.githubusercontent.com/honojs/hono/v4.13.7/src/middleware/cors/index.ts)

**C3. Configuration**

Configuration is read once during module initialization. Changing environment values afterward does not update the
exported settings. `server/env.ts:27`

The following table contains every environment variable explicitly read by the service.

| Variable                | Type and default                            | Validation and effect                                                  |
| ----------------------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| `DATA_DIR`              | Required string; no default                 | Directory containing the files in C9; missing or empty is fatal.       |
| `ADMIN_TOKEN`           | Required string; no default                 | Admin authentication value; missing or empty is fatal.                 |
| `HMAC_SECRET`           | Required string; no default                 | Challenge signing and verification secret; missing or empty is fatal.  |
| `CORS_ORIGINS`          | Optional comma-separated string; empty list | First origin source in C2.                                             |
| `SITE_ORIGINS`          | Optional comma-separated string; empty list | Second origin source in C2.                                            |
| `DEV_ORIGIN`            | Optional comma-separated string; empty list | Third origin source in C2.                                             |
| `PBKDF2_COST`           | Number; `50000`                             | Challenge work factor.                                                 |
| `PBKDF2_KEY_PREFIX`     | String; `"00"`                              | Required derived-key prefix; only an absent variable uses the default. |
| `PORT`                  | Number; `9001`                              | Listener port.                                                         |
| `RATE_LIMIT_MAX`        | Number; `10`                                | Maximum challenge requests within a live bucket.                       |
| `RATE_LIMIT_WINDOW_SEC` | Number; `900`                               | Bucket duration, converted to milliseconds.                            |
| `TOKEN_TTL_SEC`         | Number; `900`                               | Challenge expiry offset and replay-expiry fallback.                    |
| `MAX_QUEUE_ENTRIES`     | Number; `1000`                              | Active-queue line-count threshold.                                     |
| `MAX_QUEUE_BYTES`       | Number; `10485760`                          | Active-queue byte threshold.                                           |
| `NTFY_URL`              | Optional string; absent                     | Notification destination.                                              |
| `NTFY_TOKEN`            | Optional string; absent                     | Notification bearer value.                                             |

The table is implemented at `server/env.ts:34`.

Required strings are tested only for truthiness. They are not trimmed, checked for minimum length, validated as paths,
or checked for entropy. Whitespace-only strings pass. `server/env.ts:3`

Numeric variables use their default when absent or empty. Otherwise they undergo JavaScript `Number` conversion and must
be finite. Whitespace can therefore become zero, and exponent or hexadecimal notation can be accepted. `server/env.ts:9`

There are no positivity, integrality, range, or cross-setting checks. Negative, fractional, and zero numeric values can
pass configuration loading; downstream behavior depends on their use. `server/env.ts:13`

The prefix is not checked for valid hexadecimal syntax, length, case, or feasibility. An explicitly empty prefix is
retained. `server/env.ts:40`

Notification settings are not checked for URL syntax, protocol, destination ownership, or token presence as a pair.
Their activation rule is in C12. `server/env.ts:47`

An empty combined origin list throws `No CORS origins configured (set CORS_ORIGINS, SITE_ORIGINS, or DEV_ORIGIN)`. This
check precedes the required-string and numeric checks. `server/env.ts:32`

After that check, evaluation follows the table’s object order. Missing required values throw `Missing required env
variable: KEY`; invalid numbers throw `Env variable KEY must be a number, got: VALUE`. Initialization stops at the first
exception. `server/env.ts:5`

The service itself contains no dotenv parser or explicit environment-file read. Environment-file loading is delegated to
its launch environment; the supplied launchers are described in C11 and C12. `server/env.ts:4`

**C4. Client address and rate limiting**

The client address is the trimmed first comma-separated element of `X-Forwarded-For`, otherwise the complete
`CF-Connecting-IP` header, otherwise the literal string `unknown`. `server/index.ts:42`

Fallback uses nullish checks: an existing empty `X-Forwarded-For` value becomes the empty key rather than falling back.
`CF-Connecting-IP` is not explicitly trimmed by this function. `server/index.ts:43`

The service never reads the TCP peer address, validates these headers, or checks whether the sender is a trusted proxy.
The actual production proxy’s header replacement policy is **unverified** because its active configuration is absent.

Rate limiting runs only when issuing challenges. Neither submission nor admin handlers have a rate-limit check.
`server/index.ts:63`

For a string without a colon, the bucket key is its first three dot-separated components joined with dots. For example,
`192.0.2.42` becomes `192.0.2`. `server/rate-limit.ts:27`

For a string containing a colon, one `::` expansion inserts enough literal `0` groups to make eight groups; the first
three groups are then joined with colons. For example, `2001:db8::1` becomes `2001:db8:0`. `server/rate-limit.ts:18`

The operation is textual: it does not lowercase hexadecimal groups, remove leading zeroes, parse IPv4-mapped addresses
specially, strip zone identifiers, or validate an IP address. Numerically equivalent IPv6 spellings can therefore
produce different keys. `server/rate-limit.ts:27`

A bucket stores a count and an absolute reset time in milliseconds. A missing bucket, or one whose reset time is at or
before the current time, is replaced with count one and a reset time one configured window ahead; that request succeeds.
`server/rate-limit.ts:36`

Within a live bucket, a count already at or above the configured maximum rejects the request. Otherwise the count
increases and the request succeeds. Rejected requests do not extend the window or increase the count.
`server/rate-limit.ts:48`

The first request succeeds even when the maximum is zero or negative. A nonpositive window makes buckets immediately
replaceable. These are consequences of the preceding branch order. `server/rate-limit.ts:41`

The store is process-local memory and disappears on restart. A timer clears the entire map every six hours after module
initialization, including any still-live buckets. `server/rate-limit.ts:10`

At 10,000 stored keys, creation or replacement of a bucket logs `[rate-limit] SIZE_CAP (10000) erreicht — ungewöhnlicher
Traffic`. This is a warning threshold, not a storage cap. `server/rate-limit.ts:42`

**C5. Proof of work**

The service uses the ALTCHA v2 API with the PBKDF2/SHA-256 derivation function. It does not use the v1 salted-hash
payload or a base64-wrapped widget payload. `server/index.ts:9`

Challenge generation receives the configured cost, prefix and TTL, together with the HMAC secret. It supplies no
predetermined counter, metadata, memory cost, parallelism, or separate derived-key signing secret. `server/index.ts:67`

In the tagged baseline, nonce and salt are independently generated 16-byte random values encoded as lowercase
hexadecimal; derived-key length defaults to 32 bytes. Expiry is the supplied date rounded down to Unix seconds. Returned
parameter keys are sorted. [Challenge
generation](https://raw.githubusercontent.com/altcha-org/altcha-lib/v2.5.0/src/v2/pow.ts)

The challenge’s exact ordinary shape is illustrated here:

```json
{
  "parameters": {
    "algorithm": "PBKDF2/SHA-256",
    "cost": 50000,
    "expiresAt": 1792757700,
    "keyLength": 32,
    "keyPrefix": "00",
    "nonce": "8a5709f631c545deb2c93a7e0f4812bd",
    "salt": "b92e7d1645fa030c68b1d9a54e8c720f"
  },
  "signature": "55ae59c5ec84d907ffb21f1a7631dd3a90935fb15d7ce13e498d680b75dc02b8"
}
```

This synthetic signature was generated with a discarded random example key; it is not a production token.

The signature is lowercase hexadecimal HMAC-SHA-256. Its key is the UTF-8 encoding of the secret string, without
interpreting that string as hexadecimal or base64. Its message is the UTF-8 encoding of compact, sorted-key JSON of
`parameters`. [Signing helpers](https://raw.githubusercontent.com/altcha-org/altcha-lib/v2.5.0/src/v2/helpers.ts)

Canonicalization recursively sorts object properties, omits undefined properties, and leaves arrays untransformed. It
uses JavaScript JSON serialization, including its string escaping and number representation. Unknown parameter
properties participate in signing. [Canonicalization
helpers](https://raw.githubusercontent.com/altcha-org/altcha-lib/v2.5.0/src/v2/helpers.ts)

A solution contains a numeric `counter` and lowercase hexadecimal `derivedKey`; it is sent beside the complete
challenge. Optional library timing information is unnecessary. [Payload
types](https://raw.githubusercontent.com/altcha-org/altcha-lib/v2.5.0/src/v2/types.ts)

For the example parameters, a matching solution is:

```json
{
  "counter": 1124,
  "derivedKey": "008dcf9e1b33a8b170611382b7d5c2bee6ff8a3b087100ef551a79066843305d"
}
```

Derivation uses the decoded nonce followed by a four-byte big-endian counter as the PBKDF2 password, the decoded salt,
the challenge cost as iterations, and the challenge key length as output bytes. The browser implements this directly.
`widget/comments-worker.ts:20`

The baseline verifier checks expiry, signature presence, HMAC integrity, then re-derives one key and requires both
equality with the submitted key and satisfaction of the signed prefix. Expiry rejects when its truthy value is less than
current fractional Unix seconds.
[Verification](https://raw.githubusercontent.com/altcha-org/altcha-lib/v2.5.0/src/v2/pow.ts)

Even-length prefixes match decoded bytes; odd-length prefixes match the beginning of the lowercase key string. Counters
use JavaScript unsigned-32-bit conversion rather than an explicit range check. [Verification and counter
encoding](https://raw.githubusercontent.com/altcha-org/altcha-lib/v2.5.0/src/v2/pow.ts)

The PBKDF2 adapter selects SHA-384 or SHA-512 for those named variants and otherwise falls back to SHA-256. The server
does not add an independent algorithm allowlist. [PBKDF2
adapter](https://raw.githubusercontent.com/altcha-org/altcha-lib/v2.5.0/src/v2/algorithms/pbkdf2.ts)

Malformed library inputs may throw rather than return a negative verification result. In particular, the baseline hex
decoder rejects odd lengths but otherwise uses permissive `parseInt` conversion. Exact behavior under another permitted
installed version is **unverified**. [Hex
decoder](https://raw.githubusercontent.com/altcha-org/altcha-lib/v2.5.0/src/v2/helpers.ts)

No challenge is stored when issued, and no challenge is bound to an address, origin, article, language, or comment
contents. Replay state records only subsequently consumed nonces. `server/index.ts:67`

**C6. Token route**

`GET /api/comment/token` requires no authorization, body, content type, or origin. It first derives the client key and
applies C4, then creates the challenge described in C5. `server/index.ts:61`

A rate-limit rejection returns `429` with error message `Rate limit exceeded`. Success returns `200` with the challenge
object. Challenge-creation exceptions follow C1’s uncaught-error behavior. `server/index.ts:64`

There is no queue-capacity check here, so challenges can still be issued while submissions would encounter a full queue.
`server/index.ts:67`

**C7. Submission route**

`POST /api/comment/submit` accepts a JSON request body. It does not require an authorization header or inspect
`Content-Type`; form-encoded and multipart submissions are not decoded as form fields. `server/index.ts:81`

The ordinary request shape is:

```text
{
  "altcha": {
    "challenge": CHALLENGE_FROM_C5,
    "solution": SOLUTION_FROM_C5
  },
  "article_id": "first-light",
  "language_version": "en",
  "parent_comment_id": null,
  "name": "Nora Example",
  "email": "nora@example.net",
  "text": "Thank you for the clear explanation.",
  "notify": true
}
```

Unknown top-level fields are ignored. Caller-supplied IDs, timestamps, moderation decisions, and `author_reply` values
do not enter the stored record. `server/index.ts:86`

Checks run in the following order and return at the first failure. Error bodies use C1’s JSON wrapper unless explicitly
stated otherwise.

| Order | Check or operation                                                                                              | Failure                                               |
| ----- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1     | Apply the 16,384-byte body middleware.                                                                          | `413`, body `Payload Too Large` (see below).          |
| 2     | Parse JSON.                                                                                                     | `400`, `Invalid JSON`.                                |
| 3     | Destructure the parsed value.                                                                                   | JSON `null` throws and follows C1’s `500` behavior.   |
| 4     | Require present `altcha`; nonempty string article and language; nullish or string parent; string name and text. | `400`, `Missing or invalid fields`.                   |
| 5     | Match article against `/^[a-z0-9_-]+$/i`.                                                                       | `400`, `Invalid article_id`.                          |
| 6     | Match language against `/^[a-z]{2}(-[a-z0-9_-]+)?$/i`.                                                          | `400`, `Invalid language_version`.                    |
| 7     | Convert absent/null parent to null; otherwise validate its UUID shape.                                          | `400`, `Invalid parent_comment_id`.                   |
| 8     | Sanitize name and text as defined below.                                                                        | No explicit error response.                           |
| 9     | Require nonempty sanitized name.                                                                                | `400`, `Missing or invalid fields`.                   |
| 10    | Limit sanitized name to 100 UTF-16 code units.                                                                  | `400`, `name too long`.                               |
| 11    | Require nonempty sanitized text.                                                                                | `400`, `Missing or invalid fields`.                   |
| 12    | Limit sanitized text to 10,000 UTF-16 code units.                                                               | `400`, `text too long`.                               |
| 13    | Clean email as defined below; require it when `notify === true`.                                                | `400`, `email required when notify is true`.          |
| 14    | For nonempty email, limit it to 254 UTF-16 code units.                                                          | `400`, `email too long`.                              |
| 15    | For nonempty email, apply the email pattern below.                                                              | `400`, `Invalid email`.                               |
| 16    | Extract truthy `altcha.challenge` and `altcha.solution`.                                                        | `422`, `Invalid altcha payload`.                      |
| 17    | Require a nonempty string `challenge.parameters.nonce`.                                                         | `422`, `Invalid challenge`.                           |
| 18    | Look up that nonce under C9’s replay rules.                                                                     | `422`, `Challenge already used`.                      |
| 19    | Await C5’s verifier.                                                                                            | A thrown exception gives `422`, `Verification error`. |
| 20    | Require a truthy verifier `verified` result.                                                                    | `422`, `Invalid solution`.                            |
| 21    | Record the nonce as consumed.                                                                                   | Storage exceptions follow C1.                         |
| 22    | If active queue exists, compare its current byte size with its configured threshold.                            | At or above threshold: `503`, `Queue full`.           |
| 23    | Read that queue and count nonblank lines; compare with its entry threshold.                                     | At or above threshold: `503`, `Queue full`.           |
| 24    | Generate and append the record described in C9.                                                                 | Filesystem exceptions follow C1.                      |
| 25    | Initiate the optional notification described in C12.                                                            | Asynchronous notification failures are swallowed.     |
| 26    | Return success.                                                                                                 | `201` with body `{}`.                                 |

The application stages above are at `server/index.ts:81` through `server/index.ts:209`.

In the Hono baseline, body size is rejected only when it exceeds the limit. A present `Content-Length` without
`Transfer-Encoding` is trusted; otherwise the middleware reads and counts body bytes before invoking the handler. The
`413` carries the CORS headers of C2 and, as the running service sends it, `Content-Type: application/octet-stream`
(observed 2026-10-27; the Hono source suggested `text/plain`). [Body
middleware](https://raw.githubusercontent.com/honojs/hono/v4.13.7/src/middleware/body-limit/index.ts)

Empty bodies fail JSON parsing. JSON primitives other than null, and arrays, normally reach the missing-fields check.
There is no separate object-shape check. Duplicate JSON property names follow JavaScript parsing: the last value wins.
`server/index.ts:83`

The presence check rejects only undefined `altcha`; null proceeds until its extraction fails. Email and notify are
deliberately absent from the initial type check. `server/index.ts:90`

Article and language values retain their original case. There is no article-existence, language-support,
parent-existence, or parent/article relationship check, and no separate length limit on these identifiers beyond the
request-body limit. `server/index.ts:99`

The parent pattern is case-insensitive `8-4-4-4-12` groups of hexadecimal digits. It does not enforce a UUID version or
variant, and an empty parent string fails. `server/index.ts:21`

Name and text sanitation first applies Unicode NFC, removes the following code points, and then trims ECMAScript
whitespace. `server/index.ts:25`

```text
U+0000–U+001F
U+007F
U+200B–U+200D
U+202A–U+202E
U+2060–U+2064
U+FEFF
```

Thus embedded CR, LF and tab characters are removed rather than converted to spaces. C1 controls, U+200E/U+200F and
interior U+2028/U+2029 are not stripped by this expression. `server/index.ts:28`

ECMAScript trimming removes leading/trailing U+0009–U+000D, U+0020, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029,
U+202F, U+205F, U+3000 and U+FEFF. Length checks use JavaScript string length, so supplementary characters count as two
units. `server/index.ts:29`

Email becomes empty for any non-string input. String input has U+0000–U+001F and U+007F removed, is trimmed, then
lowercased using JavaScript’s locale-independent Unicode lowercase conversion. It receives no NFC or additional
formatting-character sanitation. `server/index.ts:121`

The email pattern is `/^[^@\s]{1,64}@[^@\s]{1,255}$/`, with ECMAScript whitespace semantics for `\s`. A dot in the
domain, ASCII-only characters, and deliverability are not required. `server/index.ts:22`

Only literal boolean `true` enables notify; every other value is stored as false. A malformed nonempty string email is
nevertheless rejected even when notify is false. `server/index.ts:124`

The replay expiry written at stage 21 is `challenge.parameters.expiresAt` when non-nullish; otherwise it is current
whole Unix seconds plus the configured TTL. It is not recomputed from issuance or capped independently.
`server/index.ts:163`

A consumed nonce remains consumed when later capacity checks or append operations fail. No compensating removal occurs.
`server/index.ts:164`

**C8. Admin routes**

Both admin handlers require the complete authorization value to equal `Bearer ` followed by the configured admin token.
The comparison is case-sensitive ordinary string inequality; it performs no bearer parsing or timing-safe comparison.
`server/index.ts:214`

Missing or unequal authorization returns `401` with error message `Unauthorized` before file inspection. There is no
authentication attempt limit. `server/index.ts:216`

`GET /admin/comments` accepts no required body or query parameter. After authentication, it performs the following
sequence. `server/index.ts:222`

| Order | Filesystem state                       | Response or operation                                                                                            |
| ----- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1     | Frozen output file exists.             | Read it and return `200`, `{"resumed":true,"comments":[...]}`.                                                   |
| 2     | Otherwise active queue does not exist. | Return `200`, `{"resumed":false,"comments":[]}`.                                                                 |
| 3     | Otherwise active queue exists.         | Rename it to the frozen output path, then read that path and return `200`, `{"resumed":false,"comments":[...]}`. |

These branches are at `server/index.ts:226`.

Parsing splits the selected file on LF, drops lines whose trimmed contents are empty, and JSON-parses every remaining
line in order. There is no schema validation, filtering, pagination, or response-size limit. `server/index.ts:228`

The resulting array can therefore contain any JSON values already present in the file. Read, rename, or JSON parse
failures follow C1; the rename is not undone after a subsequent failure. `server/index.ts:238`

An existing frozen file takes precedence even when it is empty, so it can hold back a populated active queue until
deletion. `server/index.ts:227`

`DELETE /admin/comments` accepts no required body or query parameter. After authentication, it unlinks only the frozen
output path and returns `204` with no body or application content type. `server/index.ts:246`

All unlink exceptions are swallowed, including permission and I/O failures as well as absence. The active queue and
replay database are not deleted. `server/index.ts:248`

Neither admin operation has a batch identifier, lease, ownership marker, conditional request, or lock spanning its
asynchronous filesystem operations. `server/index.ts:222`

**C9. Server persistence and rollback format**

All service data paths are formed by joining `DATA_DIR` with fixed filenames. Relative directories resolve against the
process working directory; the service never creates the directory. `server/replay-store.ts:9`

The active queue is `DATA_DIR/comments.json`. Despite its extension, it is UTF-8 newline-delimited JSON, not a JSON
array. `server/index.ts:167`

A generated record has this format and property order:

```json
{
  "id": "9c25c27e-14bd-4e93-81bd-33d751bc6017",
  "submitted_at": "2026-10-23T12:00:00Z",
  "article_id": "first-light",
  "language_version": "en",
  "parent_comment_id": null,
  "name": "Nora Example",
  "email": "nora@example.net",
  "text": "Thank you for the clear explanation.",
  "notify": true
}
```

The ID is a newly generated random UUID. The timestamp is server acceptance time in UTC ISO format with milliseconds
removed; it is not a client timestamp. Stored field values are those produced by C7. `server/index.ts:177`

Each accepted record is serialized once and appended with one LF using synchronous append mode. A missing queue file is
created. There is no whole-file rewrite, temporary-file replacement, explicit permission mode, file lock, or explicit
`fsync`. `server/index.ts:193`

The append prevents the ordinary read-modify-write lost-update pattern, but does not make capacity checking, replay
consumption and queue storage one atomic transaction. Power-loss durability and guarantees under multiple writers are
**unverified** because the runtime/filesystem setup is absent.

Queue limits apply only to the existing active file. The next record’s size is not included in the byte comparison; a
missing queue bypasses both capacity checks. Nonblank malformed lines still count toward the entry limit.
`server/index.ts:169`

The frozen batch is `DATA_DIR/comments_out.json`. It uses exactly the active queue’s format and is created by the rename
operation in C8. New submissions subsequently create or append to the active filename. `server/index.ts:224`

There is no queue age expiry, scheduled queue deletion, frozen-batch size check, or combined active/frozen storage
limit. Cleanup applies only to replay records. `server/cleanup.ts:3`

The replay database is `DATA_DIR/challenges.db`, opened at module initialization using SQLite. WAL journaling is
requested, and the following objects are created if absent. `server/replay-store.ts:9`

```sql
CREATE TABLE IF NOT EXISTS used_nonces (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expires
ON used_nonces(expires_at);
```

A realistic logical row corresponding to the example challenge is:

```text
nonce = 8a5709f631c545deb2c93a7e0f4812bd
expires_at = 1792757700
```

Lookup finds a nonce only when its stored expiry is strictly greater than SQLite `unixepoch()`. Consumption uses `INSERT
OR REPLACE`; each call executes as its own database statement. `server/replay-store.ts:20`

Purge deletes rows whose expiry is at or before SQLite `unixepoch()`. There is no database size cap, vacuum operation,
or application-controlled WAL checkpoint policy. `server/replay-store.ts:28`

SQLite can maintain `challenges.db-wal` and `challenges.db-shm` alongside the main database. These are engine-managed
files; their exact lifetime and checkpoint behavior are **unverified** for the deployed Bun/SQLite build.

Database open, schema setup and initial purge errors are uncaught initialization failures. The source has no
database-close or recovery handler. `server/replay-store.ts:9`

Switching implementations while preserving existing state requires continued understanding of both queue filenames and
the replay database schema. The CLI consumes the admin API’s JSON array, not the server’s raw NDJSON file.
`cli/index.ts:237`

**C10. Moderation CLI and its files**

The CLI runs as `hadley comments` against the production service, at `comments.url` of the site's `config.lima`, or as
`hadley dev comments` against the service a dev server started, at `http://127.0.0.1:` and the site's port plus one
(C11). A missing URL is fatal. `cli/index.ts:163`

`config.lima` also gives `comments.authorName` (default: the name of the site's directory) and `site.default.language`
(default `de`). The CLI does not require `comments.enabled`. `cli/index.ts:166`

The admin token is `HADLEY_COMMENTS_TOKEN` when it is set and not empty. Otherwise `hadley dev comments` takes
`adminToken` from `<site>/.hadley/forms/dev-secrets.json`, which the local service made on its first start (C11), and
`hadley comments` the file `<user configuration>/comments/<host of site.origin>.token`, trimmed, which must be readable
by its owner only (mode 600). Without a token it stops. `cli/index.ts`, `adminTokenFor`

Every admin request sends the authorization value required by C8. Download uses GET; final acknowledgement uses
DELETE. The CLI sends no origin, site selector, batch ID or request body.

It expects `resumed` to be a boolean and `comments` to be an array with C9's record fields, and trusts them without
checking. A GET that does not succeed stops with its HTTP status and status text.

Its files, with `<site>` the site's directory and `<repo>` this repository's:

| Path                                                                                                                                                     | Format and use                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<site>/.hadley/comments/comments-<timestamp>.json`                                                                                                      | Work queue: pretty-printed JSON array of downloaded records, followed by LF.                                                                                         |
| `comments.archive` of `config.lima` (relative to `<site>`), for `hadley dev comments` `<site>/.hadley/forms/archive/`; in it `comments-<timestamp>.json` | Archive: the same records extended with moderation fields, pretty-printed array plus LF; created with mode 700. Without `comments.archive`, `hadley comments` stops. |
| `<site>/content/articles/[<article_id>]/comments.json`                                                                                                   | Public tree for the default language.                                                                                                                                |
| `<site>/content/articles/[<article_id>]/<language>/comments.json`                                                                                        | Public tree for other languages.                                                                                                                                     |
| `_comments.html` in the same directory                                                                                                                   | The published comments as HTML, for the build (`html.comments`).                                                                                                     |
| `<site>/.hadley/mail/notify-<id>.eml`                                                                                                                    | Notification draft, sent by hand.                                                                                                                                    |
| `<site>/.hadley/dev/sitelinks.json`                                                                                                                      | Optional title lookup: a `pages` array with `id`, `lang` and `title`.                                                                                                |
| `<site>/theme/templates/comments.sort`, else `<site>/theme/templates/partials/comments.sort`                                                             | The template that renders `_comments.html`; without either, rendering an article stops.                                                                              |
| `hadley-comment-<milliseconds>.txt` in the temporary directory                                                                                           | Editor input and output, removed after editing.                                                                                                                      |

An article's directory is its bundle, `[<article_id>]/` wherever it lies under `content/` (in any content root and
series directory, as the build finds bundles), and for a language other than the site's default that language's
folder in it; the build reads `_comments.html` from the same directory. Approving a comment whose `article_id` no
bundle has stops with a message and leaves the comment in the work queue. `cli/index.ts:157`

The filename timestamp is UTC to whole seconds, shaped like `2026-10-23_12-00-00`. Fresh downloads write the work file
first, then the archive file.

Each archived record adds `decision`, `moderator_remark`, `author_reply_draft`, and `decided_at`, initially null, plus
`mail_sent`, initially false. Decisions later become `approved` or `rejected`.

At startup, the CLI sorts matching work filenames and selects the newest. A nonempty selected work file resumes locally
without an admin GET; an empty one is deleted and normal downloading proceeds. Older work files are not processed at
that point.

If present, the archive with the same filename supplies saved moderation information. A missing archive is not
reconstructed.

A downloaded empty batch causes an immediate exit without DELETE. A server `resumed:true` value produces a warning but
does not stop processing.

Approval merges the first work entry into its article’s public tree, optionally adds the saved author reply with a new
UUID and current timestamp, updates the archive, then removes the work entry.

Editing changes only the work entry’s text. Notes and reply drafts change only archive fields. Rejection records its
decision and removes the work entry without publication. Quit leaves remaining work for recovery.

The public tree contains only this record shape:

```json
[
  {
    "id": "9c25c27e-14bd-4e93-81bd-33d751bc6017",
    "parent_comment_id": null,
    "name": "Nora Example",
    "submitted_at": "2026-10-23T12:00:00Z",
    "text": "Thank you for the clear explanation.",
    "author_reply": false,
    "comments": []
  }
]
```

Merge recursively locates parents. Ordinary siblings and roots are inserted before the first later timestamp; equal
timestamps retain insertion order. An absent parent changes the new record to top-level with null parent and appends it
without chronological insertion.

Merge does not deduplicate IDs. It creates parent directories, reads the existing array when present, and rewrites the
complete public file as two-space-indented JSON plus LF.

CLI work/archive/public writes use ordinary whole-file writes without temporary replacement or a transaction across
files. The supplied CLI has no file-size cap or archive/mail retention cleanup.

After the moderation loop, including a normal quit, the CLI renders each article changed during that invocation.
Rendering errors are logged and do not prevent later session completion.

Rendering gives the template `comments`, the public tree with each comment's text also as `paragraphs` (split on two
or more LFs, each paragraph a list of its lines), `language`, and `t`, the theme's texts in that language
(`theme/i18n/<language>.lima`, which must exist). The template writes every value escaped and sets `<p>` and `<br>`
itself; no HTML leaves the CLI. It renders through `@mkorun/galley`, then rewrites `_comments.html`. `cli/render.ts:9`

When work becomes empty, the CLI deletes the work file before making DELETE. Any successful HTTP status counts as
acknowledgement; unsuccessful responses are logged without restoring work. Nonempty remaining work causes no DELETE.

Mail generation is available for notify-enabled entries and writes an `.eml` draft; it does not send mail or approve the
comment. Generating the draft immediately sets `mail_sent:true`.

The draft uses UTF-8 plain text, 8-bit transfer encoding, a current Date header, recipient, localized subject and
`X-Comment-ID`. Exact `en` selects English; every other language selects German. Recipient/name CR and LF are replaced
with spaces.

Editor selection is nonempty `EDITOR`, otherwise `VISUAL`, otherwise `nano`; the value is treated as one executable
argument rather than shell-split command text.

**C11. Browser widget and local integration**

The form template renders only when `site.comments` is truthy. Its dialog carries article ID from `meta.id`, language
from `meta.lang`, service URL from `site.comments.url`, and localized messages in data attributes.
`widget/comments-form.sort:1`

The browser reads that service URL verbatim, defaulting to empty for same-origin requests. Missing language defaults to
`de`; missing article ID defaults to empty. `widget/comments.ts:64`

Opening the dialog resets the form and fetches C6 immediately. After a successful token response it starts a module
worker at the URL the script tag names in `data-worker` (in a publish build, the worker's name carries the hash of its
content); without that attribute it shows the network error. `widget/comments.ts:101`, `widget/comments.ts:137`

Token responses `429` and `503` select dedicated localized messages. Other failures use the network message; token-fetch
failures also log browser diagnostics. `widget/comments.ts:124`

The worker receives only nonce, salt, cost, key length and prefix. It uses SubtleCrypto PBKDF2/SHA-256, starts its
counter at zero, increments until the decoded prefix matches, and yields after every ten unsuccessful candidates.
`widget/comments-worker.ts:17`

The worker has no search deadline, expiry check, maximum counter, or abort-message handler. Explicit dialog closing
terminates it. `widget/comments-worker.ts:30`, `widget/comments.ts:111`

Submission uses `Content-Type: application/json` and C7’s nested ALTCHA structure. The widget applies the same name/text
sanitizer, trims and lowercases email, sends checkbox state as boolean, and always sends a null parent.
`widget/comments.ts:176`

Before sending, it checks only that notify-enabled submissions have a nonempty email. The form has `novalidate` and no
maxlength attributes, so server-side validation remains observable. `widget/comments-form.sort:23`

If no solution is available, submission polls every 100 milliseconds until one appears. The button’s waiting state
changes `aria-disabled`, not its native `disabled` property. `widget/comments.ts:238`

A `201` closes the dialog and displays the localized success message without reading the response body or inserting a
published comment. `widget/comments.ts:208`

Any initial submission `422` triggers one fresh challenge, a new solve, and one retry using the original comment fields.
Other statuses, and unsuccessful retries, map by status to a localized message or the generic network message; error
JSON is not read. `widget/comments.ts:210`

`site.comments` is `comments` of `config.lima` when `comments.enabled` is true. In a production build its `url` is
`comments.url`; a local build (`hadley dev`, the preview of `hadley deploy`) sets it to the empty string, so the widget
sends to the page's own origin, and the dev server passes the request to the service. A `comments.devUrl` stops the
build. `lib/site-config.ts:122`

`hadley dev`, and the preview of `hadley deploy`, start the Go service (`hadley-forms`, see "The Go service") when
`comments.enabled` is true: the program `dev.forms` of the user configuration names, else the first `hadley-forms` on
the `PATH`. Without one, comments are off and the dev server says so. `lib/dev-server.ts:80`, `lib/forms-service.ts`

Before anything starts, the dev server checks its port and, with the service, the next one; a port something already
answers on stops it with a message. `lib/dev-server.ts:85`

The service runs as `hadley-forms -dev` in the site's directory, with stdin ignored and each line of its output
prefixed `[forms]`. It inherits hadley's environment without `ADMIN_TOKEN` and `HMAC_SECRET`, and four variables are
set: `DATA_DIR`, the site's `.hadley/forms/`; `PORT`, the dev server's port plus one; `SITE_ORIGINS`, `site.origin` of
`config.lima` when it is set; and `DEV_ORIGIN`, the dev server's origin and, with `--host`, its network addresses,
separated by commas. `lib/dev-server.ts:100`

Readiness is a GET of the token route at `127.0.0.1` on that port, every 300 milliseconds, at most thirty times; any
HTTP response counts. When the service exits before it is ready, the dev server stops; a later exit is reported and
not restarted. `lib/dev-server.ts:126`

The dev server passes every request whose path begins with `/api/comment/` or `/admin/` to `http://127.0.0.1:` and
that port, after its own guard (`lib/dev-guard.ts`) has accepted it. `lib/dev-server.ts:185`

The watcher ignores files ending in `comments.json`; a changed `_comments.html` rebuilds the site. On shutdown the dev
server sends the service the default termination signal. `lib/dev-server.ts:373`

**C12. Operation, logging and notifications**

Importing the service initializes configuration and the replay database, starts the rate-map timer, and starts replay
cleanup. A listener is created only when `index.ts` is the program’s main module. `server/index.ts:259`

The listener passes only configured port and the application fetch handler to `Bun.serve`. It configures neither
hostname nor TLS. `server/index.ts:263`

Bun’s documented default hostname is `0.0.0.0`, so this configuration listens on all IPv4 interfaces. Actual production
reachability through firewall or container rules is **unverified**. [Bun listener
defaults](https://bun.sh/docs/runtime/http/server#changing-the-port-and-hostname)

Successful listener startup logs `Hadley Forms Service — http://localhost:<actual port>`. Port zero is delegated to
Bun’s available-port selection. `server/index.ts:268`, [Bun port
selection](https://bun.sh/docs/runtime/http/server#changing-the-port-and-hostname)

Replay purge runs immediately at startup and every 60,000 milliseconds thereafter. Its timer, like the rate-map timer in
C4, is unreferenced and does not keep the process alive by itself. `server/cleanup.ts:5`

When rows are deleted, purge logs `[replay-store] N abgelaufene Nonce(s) gelöscht`. A purge that deletes nothing emits
no message. There is no exception handler around periodic purge. `server/replay-store.ts:40`

There is no application request log, successful-submission log, admin audit log, notification-failure log, or custom
signal/shutdown handler. The service does not explicitly drain requests or await pending notifications before exiting.
`server/index.ts:193`

The package commands are `bun index.ts` for start, `bun --watch index.ts` for development, and `bun test` for tests.
`server/package.json:6`

The supplied systemd unit runs as `www-data`, uses working directory `/opt/hadley-forms`, loads
`/opt/hadley-forms/.env`, and executes `/usr/local/bin/bun run /opt/hadley-forms/server/index.ts`.
`server/systemd/hadley-forms.service:5`

Systemd restarts failures after five seconds and routes stdout/stderr to the journal. The unit contains no
service-specific hardening or shutdown overrides. `server/systemd/hadley-forms.service:11`

Notifications activate only when both notification settings are truthy, independently of the submission’s notify flag.
They are initiated after queue append and are not awaited. `server/index.ts:195`

The outbound request is POST to the configured URL with these headers:

```text
Authorization: Bearer <configured notification token>
X-Title: Neuer Kommentar
X-Tags: speech_balloon
Content-Type: text/plain
```

Its body is sanitized name, `→`, article ID, LF, and a text preview. Text longer than 120 UTF-16 code units is sliced
to that length and given a trailing `…`; shorter text is unchanged. `server/index.ts:196`

The service supplies no request timeout, retry, delivery queue, or response-status check. Fetch promise rejection is
ignored; non-success HTTP responses are also ignored. `server/index.ts:197`

## The Go service

`hadley-forms` (`services/forms/`, `cmd/hadley-forms`) does what C1 to C12 say, with these differences; its tests
(`*_test.go`) check them, the contract tests the rest.

- **Listener:** `127.0.0.1` on `PORT`, or the address `HOST` names. A client address from `X-Forwarded-For` or
  `CF-Connecting-IP` (C4) counts only from a peer on a loopback address, the reverse proxy on this machine; any other
  peer is counted by its own address. Only an IP address counts: anything else in those headers counts as no header,
  so that a sender cannot choose the key. A connection gets 10 seconds for its headers (at most 64 KiB) and 30 for the
  whole request, and is closed after 2 minutes idle; the answer has no deadline, so that a submission taken is answered.
- **One process per data directory:** a second service on the same `DATA_DIR` does not start
  (`DATA_DIR/hadley-forms.lock`, an exclusive `flock`; Linux and macOS).
- **Replay store:** `DATA_DIR/used-nonces.txt`, a line `<nonce> <expiry in Unix seconds>` per used nonce, appended and
  synced, rewritten without expired ones at startup and when a purge removes some; `challenges.db` is not read. A nonce
  whose line cannot be written counts as used all the same, and the submission gets `500`. A switch between the two
  services, either way, leaves at least `TOKEN_TTL_SEC` between stopping one and starting the other, so that no
  challenge of the first can be solved twice.
- **A challenge is taken before its key is derived:** once its signature and expiry are checked (C7, stage 19, the cheap
  part), it is recorded as used together with the check that it is not, then the key is derived. So each signed
  challenge costs one derivation however often it is sent; a wrong solution uses it up (`422` `Invalid solution`, and
  `Challenge already used` for any later one; the widget fetches a new challenge on `422`); of two submissions of the
  same solution at the same time, one is taken. Whether a challenge has expired, is used or is taken now is decided at
  one moment under one lock, so that a solution sent again around its expiry is not taken twice either.
- **Queue:** the file is readable by the service alone (mode 600), as it holds the visitors' email addresses. The
  capacity check and the append, and the freeze of an admin download, happen one at a time, so the limits hold under
  concurrent submissions and a frozen batch is not lost. An appended record is synced; when only
  the sync or close fails, the record counts as stored and the failure is logged.
- **Configuration:** besides C3's checks, `PBKDF2_COST` must be a whole number from 1, `PORT` one from 0 to 65535 and
  `PBKDF2_KEY_PREFIX` hexadecimal digits; otherwise the service does not start.
- **Admin token:** compared in constant time.
- **Notification:** a request to ntfy gives up after ten seconds. With `SITE_META`, the path of the site's `meta.json`
  (written by hadley next to a publish build; the deploy puts it beside the releases), it names the article: title
  `Neuer Kommentar: <title>` for a site in German (`language` of `meta.json`), else `New comment: <title>`, RFC 2047
  encoded; body `<name>: <preview>`; `X-Click` the article's URL, `origin` and `path` of `meta.json`. The file is read
  for each notification. Without `SITE_META`, or when the file cannot be read or has no article of that id and
  language, the notification is C12's.
- **Text:** a lone UTF-16 surrogate in a submitted string (`"\ud800"`) becomes U+FFFD; lower case of an email is
  Unicode's simple mapping plus `İ` → `i̇`, without JavaScript's rule for a final `Σ`.
- **Operation:** one instance per site with comments, from `systemd/hadley-forms@.service`
  (`hadley-forms@<site>`, environment in `/etc/hadley-forms/<site>.env`), as the user `www-data` with the system
  read-only, instead of C12's unit for the TypeScript service.
- **Version:** `hadley-forms -version` prints `hadley-forms <version>` and exits: the version of hadley a release was
  built for (`scripts/build-forms.ts`), `devel` for any other build.
- **Shutdown:** on SIGTERM or SIGINT it stops accepting requests and finishes those running, for at most five seconds.
- **`-dev`:** creates `DATA_DIR`, and where `ADMIN_TOKEN` or `HMAC_SECRET` is not set takes it from
  `DATA_DIR/dev-secrets.json` (`{"adminToken":…,"hmacSecret":…}`), which it creates on the first start with random
  values and mode 0600; a file others can read stops it.

## Findings

Defects and risks of the current service and its users, ranked by the impact the code suggests; exploitability in the
deployment is **unverified** where network or timing matter. The Go service may fix one; each fix is named where it is
made, because it changes what this text describes.

| Priority | Finding                                                                                                                                                                                                                                                                                                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **p1**   | **Proxy trust boundary is unenforced.** C12’s listener exposure combined with C4’s caller-controlled address headers permits direct clients to choose rate buckets if the service port is reachable. `server/index.ts:42`, `server/index.ts:264`                                                                                                                                                   |
| **p1**   | **Concurrent replay acceptance.** Two requests can both pass nonce lookup before either awaited verifier finishes; later replacement inserts do not reject the second consumption. Repeated acceptance is possible within one process. `server/index.ts:145`, `server/index.ts:150`, `server/replay-store.ts:25`                                                                                   |
| **p1**   | **Concurrent admin downloads can lose a frozen batch.** Separate existence checks and rename are unlocked. If another submission recreates the active file between competing renames, a later rename can replace the first frozen batch on the supplied deployment’s usual POSIX filesystem. The precise interleaving is **unverified** by execution. `server/index.ts:227`, `server/index.ts:238` |
| **p2**   | **Queue thresholds are approximate.** Concurrent checks can observe the same capacity, and the byte check excludes the incoming record. `server/index.ts:169`                                                                                                                                                                                                                                      |
| **p2**   | **Replay consumption and comment storage can diverge.** C7’s ordering makes a storage/capacity failure require another proof, while an acknowledged append has no explicit durability synchronization. `server/index.ts:164`, `server/index.ts:193`                                                                                                                                                |
| **p2**   | **Deletion can falsely report success.** Operational unlink failures are indistinguishable from completed deletion, undermining cleanup acknowledgement. `server/index.ts:251`                                                                                                                                                                                                                     |
| **p2**   | **CLI crashes can duplicate publication.** A crash after public merge but before work removal repeats a merge on recovery; the merge has no ID check. Work deletion before failed server acknowledgement can also cause the whole frozen batch to be downloaded again. `cli/index.ts`, `cli/merge.ts`                                                                                              |
| **p2**   | **CLI files can be partially rewritten.** Work, archive and public files have neither atomic replacement nor a shared transaction. Missing archives during recovery can later cause moderation operations to fail. `cli/index.ts`, `cli/merge.ts`                                                                                                                                                  |
| **p2**   | **The widget can wait indefinitely or submit concurrently.** Failed solving leaves its polling unresolved; waiting state does not prevent another submit event. `widget/comments.ts:238`, `widget/comments.ts:247`                                                                                                                                                                                 |
| **p2**   | **One malformed queue record blocks batch download.** There is no per-line recovery or quarantine around parsing. `server/index.ts:228`                                                                                                                                                                                                                                                            |
| **p2**   | **A shared service is not site-isolated.** The global queue lacks site identity, while the CLI publishes every downloaded record beneath the selected site. Distinct sites sharing one data directory can be mixed. `server/index.ts:177`, `cli/index.ts`                                                                                                                                          |
| **p3**   | **IPv6 rate buckets can split equivalent addresses.** Textual spelling differences undermine the intended subnet grouping. `server/rate-limit.ts:27`                                                                                                                                                                                                                                               |
| **p3**   | **Configuration accepts unusable values.** C3’s limited validation can produce ineffective limits, impossible browser work or downstream startup/request failures. `server/env.ts:9`                                                                                                                                                                                                               |
| **p3**   | **Moderation/display sanitation is incomplete.** Remaining format/control characters can mislead terminal or notification display; newline removal also loses author formatting. `server/index.ts:28`                                                                                                                                                                                              |
| **p3**   | **Admin comparison is not timing-safe, and secret strength is unchecked.** `server/index.ts:216`, `server/env.ts:3`                                                                                                                                                                                                                                                                                |
| **p3**   | **Notification delivery is unobservable, and `mail_sent` overstates CLI behavior.** Neither notification delivery nor mail-draft generation establishes successful recipient delivery. `server/index.ts:206`, `cli/index.ts`                                                                                                                                                                       |

## Not verified

The deployed package versions, Bun and SQLite builds, environment values, active systemd unit, the proxy's header
policy, firewall exposure, file permissions, filesystem durability and the notification service's behaviour: none of
them is in the code. Byte-for-byte parity for pathological inputs across the permitted dependency ranges, and
transport failures before the application, are not established either. The service's tests cover the ordinary flow,
sequential replay, selected validation errors, the admin swap and deletion, subnet grouping and the tree merge; they do
not cover concurrent replay, restart compatibility, CORS parity or crash durability.
