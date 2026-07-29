import { useState } from 'react';
import { getPinConfig } from '../utils';
import {
  addCategoryToDb,
  deleteCategoryFromDb,
  addCurrencyToDb,
  deleteCurrencyFromDb,
  addMemberToDb,
  deleteMemberFromDb,
  isFirebaseConfigured,
  savePinConfigToDb,
} from '../firebase';

export default function SettingsModal({
  onClose,
  deviceName,
  onChangeDeviceName,
  dbCategories,
  rawCategoryDocs,
  dbCurrencies = [],
  rawCurrencyDocs = [],
  dbMembers = [],
  rawMemberDocs = [],
  activeLedger = 'household',
}) {
  const [activeTab, setActiveTab] = useState('categories');
  const [categoryLedger, setCategoryLedger] = useState(activeLedger);
  const [newCatName, setNewCatName] = useState('');
  const [addingCat, setAddingCat] = useState(false);

  const [newCurrencyName, setNewCurrencyName] = useState('');
  const [addingCurr, setAddingCurr] = useState(false);

  const [newMemberName, setNewMemberName] = useState('');
  const [addingMember, setAddingMember] = useState(false);

  const [pinConfig, setPinConfigState] = useState(() => getPinConfig());
  const [newPin, setNewPin] = useState(pinConfig.pin || '');
  const [pinMessage, setPinMessage] = useState('');

  async function handleSavePinConfig(enabledOverride = null) {
    const enabled = enabledOverride !== null ? enabledOverride : pinConfig.enabled;
    const cleanPin = newPin.trim();

    if (enabled && cleanPin.length !== 4) {
      setPinMessage('PIN must be exactly 4 digits.');
      return;
    }

    const updated = { pin: cleanPin, enabled };
    await savePinConfigToDb(updated);
    setPinConfigState(updated);
    setPinMessage(enabled ? 'Security PIN saved & synced to cloud!' : 'Security PIN disabled.');
  }

  const categoriesList =
    categoryLedger === 'travel'
      ? dbCategories?.travel || []
      : dbCategories?.household || [];

  async function handleAddCategory(e) {
    e.preventDefault();
    const trimmed = newCatName.trim();
    if (!trimmed) return;

    setAddingCat(true);
    try {
      await addCategoryToDb(categoryLedger, trimmed, rawCategoryDocs);
      setNewCatName('');
    } catch (err) {
      console.error('Failed to add category to database:', err);
    } finally {
      setAddingCat(false);
    }
  }

  async function handleDeleteCategory(categoryName) {
    try {
      await deleteCategoryFromDb(categoryLedger, categoryName, rawCategoryDocs);
    } catch (err) {
      console.error('Failed to delete category from database:', err);
    }
  }

  async function handleAddCurrency(e) {
    e.preventDefault();
    const trimmed = newCurrencyName.trim();
    if (!trimmed) return;

    setAddingCurr(true);
    try {
      await addCurrencyToDb(trimmed, rawCurrencyDocs);
      setNewCurrencyName('');
    } catch (err) {
      console.error('Failed to add currency to database:', err);
    } finally {
      setAddingCurr(false);
    }
  }

  async function handleDeleteCurrency(currencyName) {
    try {
      await deleteCurrencyFromDb(currencyName, rawCurrencyDocs);
    } catch (err) {
      console.error('Failed to delete currency from database:', err);
    }
  }

  async function handleAddMember(e) {
    e.preventDefault();
    const trimmed = newMemberName.trim();
    if (!trimmed) return;

    setAddingMember(true);
    try {
      await addMemberToDb(trimmed, rawMemberDocs);
      setNewMemberName('');
    } catch (err) {
      console.error('Failed to add member to database:', err);
    } finally {
      setAddingMember(false);
    }
  }

  async function handleDeleteMember(memberName) {
    if (dbMembers.length <= 1) {
      alert('At least one member is required.');
      return;
    }
    if (!window.confirm(`Delete member "${memberName}" from database?`)) return;
    try {
      await deleteMemberFromDb(memberName, rawMemberDocs);
    } catch (err) {
      console.error('Failed to delete member from database:', err);
    }
  }

  const hasFirebase = isFirebaseConfigured();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-2.5 sm:px-4 backdrop-blur-xs">
      <div className="w-full max-w-xl rounded-2xl bg-paper-card border border-ink/15 shadow-2xl overflow-hidden flex flex-col max-h-[92dvh]">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-ink/10 flex items-center justify-between bg-paper/60">
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <h2 className="font-display text-base sm:text-xl font-bold text-ink truncate">
              Settings & Configuration
            </h2>
            <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-ledger-green/15 text-ledger-green font-semibold shrink-0">
              Sync Active
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full border border-ink/15 bg-paper flex items-center justify-center text-ink hover:bg-paper-card font-bold transition-colors shrink-0"
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-ink/10 bg-paper/30 px-3 sm:px-6 gap-1 pt-2 overflow-x-auto scrollbar-none shrink-0 flex-nowrap">
          <button
            type="button"
            onClick={() => setActiveTab('categories')}
            className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap flex items-center min-h-[38px] ${
              activeTab === 'categories'
                ? 'border-ledger-green text-ledger-green'
                : 'border-transparent text-muted-text hover:text-ink'
            }`}
          >
            Categories
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('currencies')}
            className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap flex items-center min-h-[38px] ${
              activeTab === 'currencies'
                ? 'border-ledger-green text-ledger-green'
                : 'border-transparent text-muted-text hover:text-ink'
            }`}
          >
            Currencies
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('members')}
            className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap flex items-center min-h-[38px] ${
              activeTab === 'members'
                ? 'border-ledger-green text-ledger-green'
                : 'border-transparent text-muted-text hover:text-ink'
            }`}
          >
            Members
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('user')}
            className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap flex items-center min-h-[38px] ${
              activeTab === 'user'
                ? 'border-ledger-green text-ledger-green'
                : 'border-transparent text-muted-text hover:text-ink'
            }`}
          >
            Device User
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('database')}
            className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap flex items-center min-h-[38px] ${
              activeTab === 'database'
                ? 'border-ledger-green text-ledger-green'
                : 'border-transparent text-muted-text hover:text-ink'
            }`}
          >
            Cloud Status
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('security')}
            className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap flex items-center min-h-[38px] ${
              activeTab === 'security'
                ? 'border-ledger-green text-ledger-green'
                : 'border-transparent text-muted-text hover:text-ink'
            }`}
          >
            🔒 Security PIN
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 sm:space-y-6 flex-1">
          {activeTab === 'categories' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-ink mb-0.5">
                  Manage Categories Database
                </h3>
                <p className="text-xs text-muted-text">
                  Categories stored here are synchronized in real-time across devices.
                </p>
              </div>

              {/* Add Category Form */}
              <form onSubmit={handleAddCategory} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder={`New ${categoryLedger} category name...`}
                  className="flex-1 min-h-11 px-3.5 py-2 rounded-xl border border-ink/15 bg-paper text-ink text-sm focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
                />
                <button
                  type="submit"
                  disabled={addingCat || !newCatName.trim()}
                  className="min-h-11 px-4 py-2 rounded-xl bg-ledger-green text-white font-semibold text-sm hover:bg-ledger-green/90 disabled:opacity-50 transition-colors w-full sm:w-auto shrink-0"
                >
                  {addingCat ? 'Saving...' : 'Add Category'}
                </button>
              </form>

              {/* Category List */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-text">
                  Active Database Categories ({categoriesList.length})
                </p>
                <div className="flex flex-wrap gap-1.5 sm:gap-2 max-h-48 sm:max-h-60 overflow-y-auto p-1">
                  {categoriesList.map((cat) => (
                    <div
                      key={cat}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-ink/15 bg-paper text-xs sm:text-sm text-ink font-medium shadow-2xs"
                    >
                      <span>{cat}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteCategory(cat)}
                        className="text-muted-text hover:text-stamp-red text-xs font-bold px-1.5 py-0.5 rounded-md hover:bg-stamp-red/10 transition-colors ml-1"
                        title="Remove category"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'currencies' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-ink mb-0.5">
                  Manage Currencies Database
                </h3>
                <p className="text-xs text-muted-text">
                  Currencies stored in the database are selectable for entries and trips.
                </p>
              </div>

              {/* Add Currency Form */}
              <form onSubmit={handleAddCurrency} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={newCurrencyName}
                  onChange={(e) => setNewCurrencyName(e.target.value)}
                  placeholder="New Currency Code (e.g. CAD, AUD, CHF)..."
                  className="flex-1 min-h-11 px-3.5 py-2 rounded-xl border border-ink/15 bg-paper text-ink text-sm uppercase focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
                />
                <button
                  type="submit"
                  disabled={addingCurr || !newCurrencyName.trim()}
                  className="min-h-11 px-4 py-2 rounded-xl bg-ledger-green text-white font-semibold text-sm hover:bg-ledger-green/90 disabled:opacity-50 transition-colors w-full sm:w-auto shrink-0"
                >
                  {addingCurr ? 'Saving...' : 'Add Currency'}
                </button>
              </form>

              {/* Currencies List */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-text">
                  Active Database Currencies ({dbCurrencies.length})
                </p>
                <div className="flex flex-wrap gap-1.5 sm:gap-2 max-h-48 sm:max-h-60 overflow-y-auto p-1">
                  {dbCurrencies.map((curr) => (
                    <div
                      key={curr}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-ink/15 bg-paper text-xs sm:text-sm text-ink font-bold shadow-2xs"
                    >
                      <span>{curr}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteCurrency(curr)}
                        className="text-muted-text hover:text-stamp-red text-xs font-bold px-1.5 py-0.5 rounded-md hover:bg-stamp-red/10 transition-colors ml-1"
                        title="Remove currency"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'members' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-ink mb-0.5">
                  Manage Members Database
                </h3>
                <p className="text-xs text-muted-text">
                  Persons/Partners in your household ledger. Stored dynamically in database.
                </p>
              </div>

              {/* Add Member Form */}
              <form onSubmit={handleAddMember} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  placeholder="New Member Name..."
                  className="flex-1 min-h-11 px-3.5 py-2 rounded-xl border border-ink/15 bg-paper text-ink text-sm focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
                />
                <button
                  type="submit"
                  disabled={addingMember || !newMemberName.trim()}
                  className="min-h-11 px-4 py-2 rounded-xl bg-ledger-green text-white font-semibold text-sm hover:bg-ledger-green/90 disabled:opacity-50 transition-colors w-full sm:w-auto shrink-0"
                >
                  {addingMember ? 'Saving...' : 'Add Member'}
                </button>
              </form>

              {/* Members List */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-text">
                  Active Database Members ({dbMembers.length})
                </p>
                <div className="flex flex-wrap gap-1.5 sm:gap-2 max-h-48 sm:max-h-60 overflow-y-auto p-1">
                  {dbMembers.map((member) => (
                    <div
                      key={member}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-ink/15 bg-paper text-xs sm:text-sm text-ink font-semibold shadow-2xs"
                    >
                      <span>{member}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteMember(member)}
                        className="text-muted-text hover:text-stamp-red text-xs font-bold px-1.5 py-0.5 rounded-md hover:bg-stamp-red/10 transition-colors ml-1"
                        title="Remove member"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'user' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-ink mb-0.5">
                  Device User Identity
                </h3>
                <p className="text-xs text-muted-text">
                  Select which member is currently using this device.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {dbMembers.map((person) => (
                  <button
                    key={person}
                    type="button"
                    onClick={() => {
                      onChangeDeviceName(person);
                    }}
                    className={`p-3.5 sm:p-4 rounded-xl border text-left transition-all ${
                      deviceName === person
                        ? 'border-ledger-green bg-ledger-green/10 ring-2 ring-ledger-green/40'
                        : 'border-ink/15 bg-paper hover:bg-paper-card'
                    }`}
                  >
                    <p className="font-bold text-ink text-sm sm:text-base">{person}</p>
                    <p className="text-xs text-muted-text mt-0.5">
                      {deviceName === person ? 'Active on this device' : 'Tap to switch to this user'}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'database' && (
            <div className="space-y-4">
              <div className="p-3.5 sm:p-4 rounded-xl border border-ink/15 bg-paper space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                  <span className="font-bold text-ink text-sm sm:text-base">Database Engine Status</span>
                  <span
                    className={`px-2.5 py-0.5 text-xs font-semibold rounded-full border w-fit ${
                      hasFirebase
                        ? 'bg-ledger-green/15 text-ledger-green border-ledger-green/30'
                        : 'bg-mustard/20 text-mustard border-mustard/40'
                    }`}
                  >
                    {hasFirebase ? 'Cloud Firestore Active' : 'Persistent Local DB Mode'}
                  </span>
                </div>
                <p className="text-xs text-muted-text leading-relaxed">
                  {hasFirebase
                    ? 'Your expense entries, categories, currencies, and members are synchronized live across all active devices via Google Firebase Firestore.'
                    : 'Your entries, categories, currencies, and members are saved securely in your browser database. Configure VITE_FIREBASE_* environment variables in .env for multi-device cloud sync.'}
                </p>
              </div>

              {/* Database Status */}

              {!hasFirebase && (
                <div className="p-3.5 sm:p-4 rounded-xl border border-ink/10 bg-paper/60 space-y-2 text-xs">
                  <p className="font-bold text-ink text-sm">Required Cloud Variables:</p>
                  <ul className="font-mono text-muted-text space-y-1 list-disc list-inside">
                    <li>VITE_FIREBASE_API_KEY</li>
                    <li>VITE_FIREBASE_PROJECT_ID</li>
                    <li>VITE_FIREBASE_AUTH_DOMAIN</li>
                  </ul>
                </div>
              )}
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-ink mb-0.5">
                  App Passcode & Security PIN
                </h3>
                <p className="text-xs text-muted-text">
                  Set a 4-digit security PIN to restrict access to your expense entries on this device.
                </p>
              </div>

              {pinMessage && (
                <div className="p-3 rounded-xl bg-ledger-green/10 border border-ledger-green/30 text-ledger-green text-xs font-semibold">
                  {pinMessage}
                </div>
              )}

              <div className="p-3.5 sm:p-4 rounded-xl border border-ink/15 bg-paper space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-ink text-sm">Require PIN Protection</p>
                    <p className="text-xs text-muted-text">Prompt for 4-digit PIN upon entering Splitkhata</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={pinConfig.enabled}
                      onChange={(e) => {
                        handleSavePinConfig(e.target.checked);
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-ink/20 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-ledger-green"></div>
                  </label>
                </div>

                <div className="pt-3 border-t border-ink/10 space-y-3">
                  <label className="block text-xs font-bold text-ink">
                    Set / Change 4-Digit Security PIN
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="password"
                      maxLength={4}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={newPin}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                        setNewPin(val);
                      }}
                      placeholder="e.g. 1234"
                      className="flex-1 min-h-11 px-3.5 py-2 rounded-xl border border-ink/15 bg-paper text-ink text-base font-mono font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-ledger-green/40"
                    />
                    <button
                      type="button"
                      onClick={() => handleSavePinConfig()}
                      disabled={newPin.length !== 4}
                      className="min-h-11 px-5 py-2 rounded-xl bg-ledger-green text-white font-semibold text-sm hover:bg-ledger-green/90 disabled:opacity-50 transition-colors w-full sm:w-auto shrink-0"
                    >
                      Save PIN
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-ink/10 bg-paper/80 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto min-h-11 px-6 py-2 rounded-xl bg-ledger-green text-white font-semibold text-sm hover:bg-ledger-green/90 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

