import { useEffect, useMemo, useState } from 'react';
import { subscribeToPaymentMethods } from './firebase';
import { buildPaymentInstruments } from './utils';
import { reportError } from './errorReporting';

// One merged list of everything an expense can be paid with (cash, UPI, bank
// accounts from the paymentMethods collection, plus tracked credit cards) -
// see buildPaymentInstruments. Cards come in as an argument since both
// ledger screens already subscribe to them.
export function usePaymentInstruments(creditCards) {
  const [methodDocs, setMethodDocs] = useState([{ id: 'cash', name: 'Cash' }]);

  useEffect(
    () =>
      subscribeToPaymentMethods(
        (data) => {
          if (data.rawDocs?.length) setMethodDocs(data.rawDocs);
        },
        (err) => reportError(err, 'Could not load payment methods'),
      ),
    [],
  );

  return useMemo(() => buildPaymentInstruments(methodDocs, creditCards), [methodDocs, creditCards]);
}
