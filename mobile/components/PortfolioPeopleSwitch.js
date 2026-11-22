import PortfolioPills from './PortfolioPills';

// Whose holdings the Portfolio tab shows: everyone together, or one person. Not drawn when only one person holds anything.
export default function PortfolioPeopleSwitch({ owners, view, onChange }) {
  if (owners.length < 2) return null;
  return (
    <PortfolioPills
      options={[['all', 'Combined'], ...owners.map((o) => [o, o])]}
      value={view || 'all'}
      onChange={(k) => onChange(k === 'all' ? null : k)}
    />
  );
}
