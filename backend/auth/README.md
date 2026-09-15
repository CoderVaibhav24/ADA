# ada-auth

Phone plus one-time code, as a first factor. One of ADA's three sign-in
mechanisms, and the only one that needs a service.

| Mechanism | Where it lives |
| --- | --- |
| username or email + password | Keycloak's login page — no code |
| TOTP (authenticator app) | Keycloak, a required action on every account |
| phone + one-time code | here |

That asymmetry is the design. Anything Keycloak can already do is left to
Keycloak; this exists only because Keycloak has no built-in grant for "this
person proved possession of a phone by a means outside your knowledge".

## Endpoints

```
POST /v1/auth/request-otp   { "phone": "919990001234" }
POST /v1/auth/verify-otp    { "phone": "919990001234", "code": "123456" }
POST /v1/auth/refresh       { "refresh_token": "..." }
POST /v1/auth/logout        { "refresh_token": "..." }
```

`/verify-otp` returns ordinary Keycloak access and refresh tokens for the
person's real account, signed by the realm's RS256 key. Any ADA SDK verifies
them against the JWKS with no call back here, and nothing about such a token says
it came from a code rather than from a password.

## Try it

With the stack up and `ADA_ENV=local`:

```bash
make set-phone USER=someone@pcsmcpl.net PHONE=919990001234
make otp-test PHONE=919990001234
```

`make auth-test` runs the unit suite and needs no stack. `make auth-logs` follows
the service log, which is where the console SMS provider writes the code.

## How the token is minted, and what it costs

A one-time code proves possession of a phone. It does not produce a Keycloak
session, so something has to bridge the two. Three ways exist:

1. **A custom Authenticator SPI.** The correct answer, and it is Java. `README.md`
   at the repository root rules it out before Phase 2, and it would put a JVM
   build in the path of every fork.
2. **Write a credential we control onto the account, then use it.** HRMS, which
   this service is ported from, sets the user's Keycloak password to a
   server-side nonce over the admin API and then performs a direct grant with it.
   **ADA must not do this.** The same person's primary mechanism is password
   plus TOTP, and their password would be silently destroyed on every OTP login.
3. **Token exchange with `requested_subject`.** Mints a token for a subject with
   no credential of theirs involved. This is what happens.

The costs of (3) are real and a fork inherits them:

- `token-exchange:v1` is a **preview** feature in Keycloak 26.7.2. Standard token
  exchange (`token-exchange-standard:v2`) is the supported one and refuses
  `requested_subject` outright — *"Parameter 'requested_subject' is not supported
  for standard token exchange"* — so the preview feature is the only one that
  performs impersonation. A Keycloak upgrade must re-verify this path.
- The `ada-auth` service account holds realm-management **`impersonation`**,
  which mints a user token for any subject in the realm. That is why its client
  is confidential, has no browser flow and no direct grant, and is used by this
  service alone. Do not reuse it.
- **This is one factor.** TOTP is not evaluated here — there is no browser flow in
  which to prompt for it. An application that requires two factors sends people
  through Keycloak's standard login instead.

## What it holds

Nothing durable. No database, no migration, no volume. A pending code lives in
Redis under a five-minute TTL as `HMAC-SHA256(ADA_OTP_HMAC_KEY, "phone:code")`
— the code itself is never written down — alongside the Keycloak user id it was
issued against. That id is not a cache: spending the stored subject rather than
re-resolving the phone number is what stops the number on `/verify-otp` selecting
a different account.

`tests/test_import_graph.py` fails the build if a database driver is ever
imported here.

## The throttling ladder

Four stages, each catching what the one before it lets through.

| Stage | Default | What it stops |
| --- | --- | --- |
| cooldown | 1 code per number per 60s | the Resend button held down |
| window | 10 codes per number per hour | a patient loop respecting the cooldown |
| soft lock | 15 min after 5 wrong codes in an hour | guessing a six-digit code |
| hard lock | 24 h after 3 soft locks | running up the SMS bill |

The cooldown is **flat, not exponential**. HRMS doubled it and removed it again:
the login screen shows a single 60-second countdown, so from the second Resend
onward the button was always refused after the timer had already reached zero,
which reads as broken. Spam stays bounded by the hourly window.

Per-IP limits are **off by default**. Every request arrives from the reverse
proxy, so one address covers the whole estate and an IP counter locks out every
user at once. HRMS shipped them, hit exactly that, and commented them out in
place. Turn them on with `ADA_OTP_IP_LIMITS_ENABLED=true` only where the real
client address survives to this hop.

A successful login clears the failure counters but **not** the request cooldown —
otherwise every login grants one free code outside it.

## Enumeration

By default `/request-otp` answers `202` with an identical body whether or not the
number belongs to an account. HRMS chose the opposite so its login screen could
show "this number is not registered" immediately; the price is that anyone can
enumerate which numbers have accounts. ADA is shared by every application, so
the private answer is the default. `ADA_OTP_REVEAL_UNKNOWN_PHONE=true` gives
you the friendlier `404`, deliberately.

Every `/verify-otp` failure is one `401` with one message. Separating "expired"
from "wrong" tells an attacker whether a code is still live.

## Phone numbers

Digits only, 10 to 15 of them. No `+`, no spaces, no punctuation — the value has
to match what is stored on the account character for character, and the realm's
user profile enforces the same rule. A number stored as `"+91 99900 01234"` is a
number no lookup will find, and the symptom is "not registered" for an account
that plainly exists.

The lookup tries the `phoneNumber` attribute first, then an exact username match
— which is what an account migrated from HRMS looks like.

**Keycloak 26 discards attributes its user profile does not declare, and answers
`204` while doing it.** So `phoneNumber` is declared in
`keycloak/realm-pcsmcpl.json`, admin-editable and not user-editable: it is an
authentication factor, and a user who could edit it could point OTP login for
their account at any phone they hold.

Two accounts sharing one number is refused rather than resolved — the code would
otherwise authenticate whichever the search returned first.

## SMS providers

| `ADA_SMS_PROVIDER` | Behaviour |
| --- | --- |
| `console` | writes the code to this service's log, sends nothing. The default, and it refuses to run when `ADA_ENV=production` |
| `stub` | accepts and drops. Tests |
| `twofactor` | 2factor.in, the provider HRMS uses. Needs `ADA_TWOFACTOR_API_KEY` |

`console` is what makes `make up` produce a working OTP login with no provider
account and no spend. It also means anything that can read logs can sign in as
anyone whose number it knows, which is why it is barred from production in code
rather than by convention.

2factor.in mints and verifies the code itself, so on that provider no hash is
stored here — the session id takes its place. It also answers `200` with
`{"Status": "Error"}` on a rejected send, so checking the HTTP status alone
reports every failed send as a success.

## Development bypass

Secure by default in the strong sense: **production cannot enable it**, with or
without the flag, so a misconfigured `ADA_ENV` can never turn OTP verification
into a no-op.

| `ADA_ENV` | Bypass |
| --- | --- |
| `local` | always on. The issued code is `ADA_DEV_OTP` |
| `staging` | only with `ADA_ALLOW_OTP_DEV_BYPASS=true` |
| `production` | impossible |

Even under the bypass a code must have been *issued* — the subject binding still
has to be there — so it bypasses the code, not the flow.

## Settings

All prefixed `ADA_`. See `.env.example` for the annotated list. The two with
no safe default:

- `ADA_AUTH_CLIENT_SECRET` — as sensitive as an admin password, because the
  client it authenticates can impersonate anyone.
- `ADA_OTP_HMAC_KEY` — the service refuses to start without it outside
  `ADA_ENV=local`, rather than storing reversible codes.
