import { Platform, Share } from 'react-native';
import { holdingsToCsv } from './portfolio';
import { todayISO } from './utils';

// Hands the holdings table over as a CSV: a file download on the website, the share sheet on a phone.
export async function exportHoldingsCsv(rows) {
  const csv = holdingsToCsv(rows);
  const name = `portfolio-${todayISO()}.csv`;
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    await Share.share({ title: name, message: csv });
  }
}
