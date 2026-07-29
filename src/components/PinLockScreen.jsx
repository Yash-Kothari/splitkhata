import { useState, useEffect, useCallback } from 'react';

export default function PinLockScreen({ onUnlock, correctPin }) {
  const [pinDigits, setPinDigits] = useState('');
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleKeyPress = useCallback(
    (digit) => {
      if (pinDigits.length >= 4) return;
      setError(false);
      setErrorMessage('');
      const newDigits = pinDigits + digit;
      setPinDigits(newDigits);

      if (newDigits.length === 4) {
        if (newDigits === correctPin) {
          onUnlock();
        } else {
          setError(true);
          setErrorMessage('Incorrect PIN. Please try again.');
          setTimeout(() => {
            setPinDigits('');
            setError(false);
          }, 600);
        }
      }
    },
    [pinDigits, correctPin, onUnlock]
  );

  const handleBackspace = useCallback(() => {
    setError(false);
    setErrorMessage('');
    setPinDigits((prev) => prev.slice(0, -1));
  }, []);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key >= '0' && e.key <= '9') {
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyPress, handleBackspace]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-paper px-4 select-none">
      <div className="w-full max-w-xs text-center flex flex-col items-center">
        {/* Header Icon & Title */}
        <div className="w-16 h-16 rounded-2xl bg-ledger-green/10 border border-ledger-green/30 flex items-center justify-center text-ledger-green mb-4 shadow-sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-8 h-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>

        <h1 className="font-display text-2xl font-bold text-ink mb-1">
          Splitkhata
        </h1>
        <p className="text-xs text-muted-text font-medium mb-6">
          Enter your 4-digit Security PIN
        </p>

        {/* PIN Indicators */}
        <div
          className={`flex items-center justify-center gap-4 mb-8 transition-transform ${
            error ? 'animate-bounce text-stamp-red' : ''
          }`}
        >
          {[0, 1, 2, 3].map((index) => {
            const isFilled = pinDigits.length > index;
            return (
              <div
                key={index}
                className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
                  error
                    ? 'border-stamp-red bg-stamp-red'
                    : isFilled
                    ? 'border-ledger-green bg-ledger-green scale-110 shadow-xs'
                    : 'border-ink/25 bg-transparent'
                }`}
              />
            );
          })}
        </div>

        {/* Error message */}
        <div className="h-6 mb-4 flex items-center justify-center">
          {errorMessage ? (
            <p className="text-xs font-semibold text-stamp-red animate-pulse">
              {errorMessage}
            </p>
          ) : (
            <p className="text-[11px] text-muted-text/70">
              Protected by local device PIN
            </p>
          )}
        </div>

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-[240px]">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => handleKeyPress(num)}
              className="w-16 h-16 rounded-full border border-ink/15 bg-paper-card text-ink font-display text-2xl font-semibold hover:bg-ledger-green/10 hover:border-ledger-green hover:text-ledger-green active:scale-95 transition-all shadow-2xs mx-auto flex items-center justify-center"
            >
              {num}
            </button>
          ))}

          <div />

          <button
            type="button"
            onClick={() => handleKeyPress('0')}
            className="w-16 h-16 rounded-full border border-ink/15 bg-paper-card text-ink font-display text-2xl font-semibold hover:bg-ledger-green/10 hover:border-ledger-green hover:text-ledger-green active:scale-95 transition-all shadow-2xs mx-auto flex items-center justify-center"
          >
            0
          </button>

          <button
            type="button"
            onClick={handleBackspace}
            className="w-16 h-16 rounded-full border border-ink/10 bg-paper/50 text-muted-text font-semibold hover:text-ink hover:bg-paper-card active:scale-95 transition-all shadow-2xs mx-auto flex items-center justify-center text-sm"
            aria-label="Backspace"
          >
            ⌫
          </button>
        </div>
      </div>
    </div>
  );
}
