# Shared edition (Splitwise-style)

A version of Splitkhata anyone can sign into with their own Google account to split expenses with other
registered people. Two tabs:

- **Personal** - what you owe or are owed, **per person, added up across every group and one-to-one tab**.
  Tap a person to see the groups behind the number, **Settle up** (records a payment) or **Add expense**
  together. "Split with someone" starts a one-to-one tab with a person by their Gmail.
- **Groups** - a flat, a trip, a dinner: create a group, add people by Gmail, then add expenses, splits and
  balances exactly as in the admin app's Household ledger.

No Travel, Cards, Payments, AI, PIN lock or recurring bills in this edition. It is the same codebase as the
current ("admin") app, switched by one build-time variable, running against a **separate Firebase project**,
so the admin app, its data and its rules are never touched.

## How the two editions differ

| | admin (default) | shared |
|---|---|---|
| Build switch | `EXPO_PUBLIC_EDITION` unset | `EXPO_PUBLIC_EDITION=shared` |
| Firebase project | `splitkhata-96cbd` (hardcoded) | your own, via `EXPO_PUBLIC_FIREBASE_*` |
| Who can sign in | the two allowlisted emails | any verified Google account |
| Data paths | top-level `expenses`, `members`, `settings`... | `groups/{groupId}/expenses`... |
| Rules file | `firestore.rules` (allowlist) | `firestore.shared.rules` (membership) |
| Screens | Payments, Household, Travel, Cards, AI | Personal, Groups |
| Site | GitHub Pages `/splitkhata` | Firebase Hosting root |

`lib/edition.js` holds the switch and the `FEATURES` flags. Unset (or anything but `shared`) is the admin
edition, byte-for-byte the previous behaviour - `app.config.js` returns `app.json` untouched, and a guard test
fails if that changes.

## Data model

- `groups/{id}` = `{ ownerUid, memberEmails: [lowercase emails], name, kind: 'group' | 'direct', createdAt }`.
  A `direct` group is the hidden two-person ledger behind "you and Raj"; its id is `direct~<emailA>~<emailB>`
  (emails sorted), which the rules enforce so nobody can squat on or duplicate someone else's.
- `groups/{id}/members/{email}` = `{ name, email }` - the person records. Entries store a member's **name**
  (so the whole balance engine is shared with the admin app); the **email** is what identifies one person
  across groups for the Personal tab.
- `groups/{id}/expenses`, `categories`, `settings`, ... - the same collections the admin app uses, under the group.
- A person can be added **before they have signed in**: adding their email gives them the group the moment they do.

## How balances add up across groups

`computePairwiseDebts` (lib/utils.js) is Splitwise's "friend balance": for each split entry every sharer owes
the payer their part (same classification as a group's own balance, so the two never disagree). The Personal
tab (`computePersonalBalances` + `usePersonalBalances`) listens to every group you are in, read-only, and sums
per person by email. **Settle up** records a `settlement` entry in your one-to-one ledger with that person;
balances add across ledgers, so it reduces the total. Everyone only ever sees groups they are a member of.

## How accounts are kept apart

1. **Data lives under the group.** Every Firestore call in `lib/firebase.js` goes through `col()` / `docAt()`.
   In the shared edition they build `groups/{groupId}/...` and *throw* if no group is open - they can never fall
   back to a top-level path. A guard test fails if a raw `collection(dbInstance, 'x')` is added.
2. **The rules enforce it** (`firestore.shared.rules`): members of a group read and write inside it; anyone can
   create a group (as its owner and a member); any member can add people; only the owner renames or removes
   others; a non-owner can leave; the owner can't be removed, ownership never moves, 20 people max, groups
   can't be deleted, a direct ledger's two people never change. Anything outside `groups/` is denied.
3. **Tested against the real emulators**: `npm run test:shared-rules` (55 checks with five fake Google accounts:
   reads, writes, batches, queries, direct-ledger squatting, adding, leaving, removal, unverified email,
   top-level paths). Run it after any change to the rules or the group code.
4. The shared build contains none of the admin app's identifiers (API key, project id, allowlist emails).

## Setting it up (needs the owner of the Google/Firebase account - not something Claude can do)

1. Create a new Firebase project (not `splitkhata-96cbd`). Enable **Authentication -> Google** and
   **Firestore** (production mode). Add a **Web app** and copy its config.
2. In Authentication -> Settings -> Authorized domains, add the Hosting domain.
3. Create a service account (roles: Firebase Admin + Service Usage Consumer), download its JSON key.
4. In the GitHub repo -> Settings -> Secrets and variables -> Actions, add the repo **variables**
   `SHARED_FIREBASE_API_KEY`, `..._AUTH_DOMAIN`, `..._PROJECT_ID`, `..._STORAGE_BUCKET`,
   `..._MESSAGING_SENDER_ID`, `..._APP_ID` and the **secret** `SHARED_FIREBASE_SERVICE_ACCOUNT` (the JSON key).
5. Actions -> "Deploy shared edition (Firebase Hosting)" -> Run workflow. It tests, builds, then deploys the
   rules, the index and the site to the shared project only. It is manual on purpose.

## Developing locally

```bash
# terminal 1 - shared emulators (own ports 8090 / 9199, so they never collide with the admin ones)
firebase emulators:start --only firestore,auth --config firebase.shared.json --project demo-shared
# terminal 2 - prove isolation
cd mobile && npm run test:shared-rules
# terminal 3 - run the app as a fake account
cd mobile && EXPO_PUBLIC_USE_FIRESTORE_EMULATOR=true EXPO_PUBLIC_FIREBASE_API_KEY=fake \
  EXPO_PUBLIC_FIREBASE_PROJECT_ID=demo-shared EXPO_PUBLIC_FIREBASE_APP_ID=1:1:web:fake \
  EXPO_PUBLIC_DEV_TEST_EMAIL=alice@example.com npm run web:shared
```

`.claude/launch.json` has `shared-alice`, `shared-bob` and `shared-carol` previews (ports 8082-8084, separate
origins) for testing several accounts side by side.

## Known limits / follow-ups

- **Not in the shared edition**: travel, cards, payments, AI Quick Add / Ask / receipt scan, PIN lock,
  recurring bills, and native (iOS/Android) builds - web only for now.
- **Leaving a group** keeps the person's name on past entries so balances still add up; they stay in the group's
  people list and payer pickers. The owner can't leave, and there is no "remove someone" button yet (the rules
  allow it).
- **Personal reads every group you are in** (entries + people, live). Fine for a handful of groups; very large
  or very old groups would want a stored summary.
- **Settle up is per person, not per group**: it records a payment in your one-to-one ledger with them.
- **Abuse / cost**: anyone with a Google account can create a group and name others in it. Consider Firebase App
  Check and a budget alert before sharing the link widely.
- **No account/group deletion** yet (rules forbid deleting a group).
- **Shared computers**: the browser's offline cache keeps a previous account's data on that device until site
  data is cleared (never visible to another account - paths and rules differ - but it is on the disk).
- The household screen still shows a "Payment method" field (Cash) and a few household-era labels inside a group.
- Person colours still special-case the names "Yash"/"Kruti" (cosmetic only).
