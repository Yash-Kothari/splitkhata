// Which build of Splitkhata this is.
//
//  - 'admin'  (default, EXPO_PUBLIC_EDITION unset): the original two-person app. One fixed
//             Firebase project, an email allowlist in firestore.rules, top-level collections,
//             every feature on. Nothing about it changes when the variable is absent.
//  - 'shared': the Splitwise-style version anyone can sign into with their own Google account. A
//             SEPARATE Firebase project (EXPO_PUBLIC_FIREBASE_*). Two tabs: Personal (what you owe /
//             are owed per person, across everything) and Groups (shared expenses with other
//             registered people). Data lives under groups/{groupId}/... and firestore.shared.rules
//             only lets a group's members into it. No travel, cards, AI, PIN or recurring bills.
//
// EXPO_PUBLIC_* values are inlined at build time, so each edition is a separate build and the
// admin bundle never contains shared-edition behaviour that could switch on at runtime.
export const EDITION = process.env.EXPO_PUBLIC_EDITION === 'shared' ? 'shared' : 'admin';
export const IS_SHARED_EDITION = EDITION === 'shared';

export const FEATURES = {
  travel: !IS_SHARED_EDITION,
  cards: !IS_SHARED_EDITION,
  payments: !IS_SHARED_EDITION,
  ai: !IS_SHARED_EDITION,
  pin: !IS_SHARED_EDITION,
  recurring: !IS_SHARED_EDITION,
  household: !IS_SHARED_EDITION, // the admin app's single Household tab
  portfolio: !IS_SHARED_EDITION, // mutual-fund portfolio tab (Firestore `portfolio` collection, admin project only)
  groups: IS_SHARED_EDITION, // the shared edition's Personal + Groups tabs
};
