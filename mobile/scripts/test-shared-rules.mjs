// Proves the shared edition's data isolation against the real Firestore + Auth emulators running
// firestore.shared.rules (repo root):
//
//   firebase emulators:start --only firestore,auth --config firebase.shared.json --project demo-shared
//   node scripts/test-shared-rules.mjs
//
// It signs in as several fake Google accounts and checks that one group's data can never be read or
// changed by someone who is not in it, and that membership changes follow the rules. Exits non-zero
// if any check fails.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCredential, GoogleAuthProvider } from 'firebase/auth';
import {
  getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  collection, query, where, writeBatch,
} from 'firebase/firestore';

const FS_PORT = 8090;
const AUTH_PORT = 9199;
let failures = 0;
let checks = 0;

async function login(name, email, { verified = true } = {}) {
  const app = initializeApp({ apiKey: 'fake', projectId: 'demo-shared' }, `${name}-${Math.random()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://127.0.0.1:${AUTH_PORT}`, { disableWarnings: true });
  const idToken = JSON.stringify({ sub: `uid-${name}`, email, email_verified: verified, name });
  const { user } = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', FS_PORT);
  return { db, uid: user.uid, email };
}

async function allowed(label, fn) {
  checks += 1;
  try { await fn(); console.log(`  ok    ${label}`); } catch (err) { failures += 1; console.log(`  FAIL  ${label} - should have worked: ${err.code || err.message}`); }
}
async function denied(label, fn) {
  checks += 1;
  try { await fn(); failures += 1; console.log(`  FAIL  ${label} - should have been denied`); } catch (err) {
    if (err.code === 'permission-denied') console.log(`  ok    ${label}`);
    else { failures += 1; console.log(`  FAIL  ${label} - wrong error: ${err.code || err.message}`); }
  }
}

const group = (owner, name, emails, kind = 'group') => ({ ownerUid: owner.uid, memberEmails: emails, name, kind, createdAt: new Date() });
const directId = (a, b) => { const [x, y] = [a, b].sort(); return `direct~${x}~${y}`; };

const A = await login('alice', 'alice@example.com');
const B = await login('bob', 'bob@example.com');
const C = await login('carol', 'carol@example.com');
const D = await login('dave', 'dave@example.com');
const U = await login('unverified', 'eve@example.com', { verified: false });

console.log('Creating groups');
await allowed('alice creates a group', () => setDoc(doc(A.db, 'groups', 'flat'), group(A, 'Flat', [A.email])));
await allowed('alice creates a group already naming bob', () => setDoc(doc(A.db, 'groups', 'trip'), group(A, 'Goa trip', [A.email, B.email])));
await allowed('bob creates his own group', () => setDoc(doc(B.db, 'groups', 'bobs'), group(B, 'Bob solo', [B.email])));
await denied('a group must list its creator as a member', () => setDoc(doc(C.db, 'groups', 'sneaky'), group(C, 'Sneaky', [A.email])));
await denied('a group cannot name someone else as its owner', () => setDoc(doc(C.db, 'groups', 'sneaky2'), { ...group(C, 'X', [C.email]), ownerUid: A.uid }));
await denied('a group cannot have extra fields', () => setDoc(doc(C.db, 'groups', 'extra'), { ...group(C, 'X', [C.email]), admin: true }));
await denied('a group needs a name', () => setDoc(doc(C.db, 'groups', 'noname'), group(C, '', [C.email])));
await denied('a group cannot start with more than 20 people', () => setDoc(doc(C.db, 'groups', 'big'), group(C, 'Big', [C.email, ...Array.from({ length: 20 }, (_, i) => `p${i}@example.com`)])));
await denied('an unverified email cannot create a group', () => setDoc(doc(U.db, 'groups', 'unv'), group(U, 'Unv', [U.email])));

console.log('Direct (1:1) ledgers');
await allowed('alice starts a direct ledger with carol', () => setDoc(doc(A.db, 'groups', directId(A.email, C.email)), group(A, 'Alice & Carol', [A.email, C.email], 'direct')));
await denied('a direct ledger id must match its two emails', () => setDoc(doc(A.db, 'groups', 'direct~wrong~id'), group(A, 'x', [A.email, D.email], 'direct')));
await denied('dave cannot squat on alice & carol\'s direct id', () => setDoc(doc(D.db, 'groups', directId(A.email, C.email)), group(D, 'x', [D.email, C.email], 'direct')));
await denied('a direct ledger has exactly two people', () => setDoc(doc(A.db, 'groups', directId(A.email, D.email)), group(A, 'x', [A.email, D.email, B.email], 'direct')));
await denied('nobody can overwrite an existing direct ledger', () => setDoc(doc(A.db, 'groups', directId(A.email, C.email)), group(A, 'Alice & Carol again', [A.email, C.email], 'direct')));
await allowed('carol reads the direct ledger alice started', () => getDoc(doc(C.db, 'groups', directId(A.email, C.email))));
await allowed('carol writes an expense in it', () => setDoc(doc(C.db, 'groups', directId(A.email, C.email), 'expenses', 'x1'), { amount: 50 }));
await denied('dave cannot read the direct ledger', () => getDoc(doc(D.db, 'groups', directId(A.email, C.email))));
await denied('dave cannot read its expenses', () => getDoc(doc(D.db, 'groups', directId(A.email, C.email), 'expenses', 'x1')));
await denied('carol cannot add a third person to a direct ledger', () => updateDoc(doc(C.db, 'groups', directId(A.email, C.email)), { memberEmails: [A.email, C.email, D.email] }));

console.log('Isolation between groups');
await allowed('alice writes an expense in the flat', () => setDoc(doc(A.db, 'groups', 'flat', 'expenses', 'e1'), { amount: 100, note: 'alice private' }));
await allowed('alice writes settings in the flat', () => setDoc(doc(A.db, 'groups', 'flat', 'settings', 'seed_state'), { categories: true }));
await allowed('alice reads her expense', () => getDoc(doc(A.db, 'groups', 'flat', 'expenses', 'e1')));
await denied('bob cannot read the flat\'s expense', () => getDoc(doc(B.db, 'groups', 'flat', 'expenses', 'e1')));
await denied('bob cannot list the flat\'s expenses', () => getDocs(collection(B.db, 'groups', 'flat', 'expenses')));
await denied('bob cannot write into the flat', () => setDoc(doc(B.db, 'groups', 'flat', 'expenses', 'evil'), { amount: 1 }));
await denied('bob cannot delete the flat\'s expense', () => deleteDoc(doc(B.db, 'groups', 'flat', 'expenses', 'e1')));
await denied('bob cannot batch-write into the flat', async () => { const b = writeBatch(B.db); b.set(doc(B.db, 'groups', 'flat', 'members', 'm'), { name: 'x' }); await b.commit(); });
await denied('bob cannot read the flat\'s group document', () => getDoc(doc(B.db, 'groups', 'flat')));
await denied('bob cannot add himself to the flat', () => updateDoc(doc(B.db, 'groups', 'flat'), { memberEmails: [A.email, B.email] }));
await denied('carol (not in the flat) cannot read its expense', () => getDoc(doc(C.db, 'groups', 'flat', 'expenses', 'e1')));
await denied('an unverified email cannot read the flat\'s expense', () => getDoc(doc(U.db, 'groups', 'flat', 'expenses', 'e1')));
await allowed('bob (named at creation) reads the goa trip', () => getDoc(doc(B.db, 'groups', 'trip', 'settings', 'x')).catch((e) => { if (e.code === 'permission-denied') throw e; }));

console.log('Finding your own groups');
await allowed('bob finds exactly his groups by his email', async () => {
  const snap = await getDocs(query(collection(B.db, 'groups'), where('memberEmails', 'array-contains', B.email)));
  const ids = snap.docs.map((d) => d.id).sort().join(',');
  if (ids !== 'bobs,trip') throw new Error(`expected bobs,trip got ${ids}`);
});
await denied('bob cannot search for groups that contain alice', () => getDocs(query(collection(B.db, 'groups'), where('memberEmails', 'array-contains', A.email))));
await denied('bob cannot list every group', () => getDocs(collection(B.db, 'groups')));

console.log('Nothing outside groups');
await denied('alice cannot write a top-level expenses doc', () => setDoc(doc(A.db, 'expenses', 'x'), { amount: 1 }));
await denied('alice cannot read a top-level settings doc', () => getDoc(doc(A.db, 'settings', 'pin_config')));
await denied('alice cannot write a users doc', () => setDoc(doc(A.db, 'users', A.uid), { email: A.email }));

console.log('Adding people');
await allowed('a member (bob) adds carol to the goa trip', () => updateDoc(doc(B.db, 'groups', 'trip'), { memberEmails: [A.email, B.email, C.email] }));
await allowed('carol can now read the goa trip', () => getDoc(doc(C.db, 'groups', 'trip')));
await denied('a member cannot remove another member', () => updateDoc(doc(B.db, 'groups', 'trip'), { memberEmails: [A.email, B.email] }));
await denied('a member cannot add and remove in one go', () => updateDoc(doc(B.db, 'groups', 'trip'), { memberEmails: [A.email, B.email, D.email] }));
await denied('a member cannot rename the group', () => updateDoc(doc(B.db, 'groups', 'trip'), { name: 'Hijacked' }));
await denied('a member cannot take ownership', () => updateDoc(doc(B.db, 'groups', 'trip'), { ownerUid: B.uid }));
await denied('nobody can change a group\'s kind', () => updateDoc(doc(A.db, 'groups', 'trip'), { kind: 'direct' }));
await denied('a group cannot grow past 20 people', () => updateDoc(doc(A.db, 'groups', 'trip'), { memberEmails: [A.email, B.email, C.email, ...Array.from({ length: 18 }, (_, i) => `q${i}@example.com`)] }));
await allowed('the owner renames the group', () => updateDoc(doc(A.db, 'groups', 'trip'), { name: 'Goa 2026' }));
await denied('the owner cannot remove herself', () => updateDoc(doc(A.db, 'groups', 'trip'), { memberEmails: [B.email, C.email] }));
await denied('nobody can delete a group document', () => deleteDoc(doc(A.db, 'groups', 'trip')));

console.log('Leaving and removing');
await allowed('carol leaves the goa trip', () => updateDoc(doc(C.db, 'groups', 'trip'), { memberEmails: [A.email, B.email] }));
await denied('carol is locked out of the goa trip', () => getDoc(doc(C.db, 'groups', 'trip')));
await denied('the owner cannot leave her own group', () => updateDoc(doc(A.db, 'groups', 'trip'), { memberEmails: [B.email] }));
await allowed('the owner removes bob', () => updateDoc(doc(A.db, 'groups', 'trip'), { memberEmails: [A.email] }));
await denied('bob is locked out after removal', () => getDoc(doc(B.db, 'groups', 'trip')));
await allowed('bob still reads his own group', () => getDoc(doc(B.db, 'groups', 'bobs')));

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
