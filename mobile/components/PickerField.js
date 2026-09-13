import { useRef, useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, Dimensions } from 'react-native';

// Matches iOS Safari's actual <select> rendering on modern iOS: a compact
// menu popover anchored right at the tapped control (checkmark next to the
// selected option), not the old full-screen UIPickerView wheel and not a
// full-height bottom sheet. Positioned via measureInWindow so it opens
// right under the row that was tapped, like a native context menu.
// options may be plain strings (value === label) or {value, label} pairs -
// e.g. Split Type stores 'shared' but web displays "Split", matching
// web's <option value="shared">Split</option> pattern exactly.
function normalizeOptions(options) {
  return options.map((o) => (typeof o === 'object' && o !== null ? o : { value: o, label: String(o) }));
}

export default function PickerField({ label, value, options, onChange, labelExtra }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const rowRef = useRef(null);
  const normalized = normalizeOptions(options);
  const selected = normalized.find((o) => o.value === value);

  function handleOpen() {
    rowRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setOpen(true);
    });
  }

  function handleSelect(option) {
    onChange(option);
    setOpen(false);
  }

  const screen = Dimensions.get('window');
  const menuWidth = anchor ? Math.max(anchor.width, 200) : 200;
  const maxMenuHeight = 280;
  const spaceBelow = anchor ? screen.height - (anchor.y + anchor.height) : 0;
  const opensUpward = anchor && spaceBelow < maxMenuHeight + 20 && anchor.y > maxMenuHeight + 20;
  const menuTop = anchor
    ? opensUpward
      ? Math.max(8, anchor.y - maxMenuHeight - 6)
      : anchor.y + anchor.height + 6
    : 0;
  const menuLeft = anchor ? Math.min(Math.max(8, anchor.x), screen.width - menuWidth - 8) : 0;

  return (
    <View>
      <View className="flex-row items-center justify-between mb-1">
        <Text className="font-body-semibold text-2xs uppercase tracking-wider text-muted-text">{label}</Text>
        {labelExtra}
      </View>
      <Pressable
        ref={rowRef}
        onPress={handleOpen}
        className="flex-row items-center justify-between border border-ink/15 rounded-xl px-3 py-2.5 bg-paper shadow-2xs"
      >
        <Text className="font-body-medium text-sm text-ink">{selected ? selected.label : value}</Text>
        <Text className="text-muted-text text-xs">▾</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1" onPress={() => setOpen(false)}>
          {anchor && (
            <View
              style={{ position: 'absolute', top: menuTop, left: menuLeft, width: menuWidth, maxHeight: maxMenuHeight }}
              className="bg-paper-card rounded-xl border border-ink/10 shadow-lg overflow-hidden"
            >
              <ScrollView bounces={false}>
                {normalized.map((o) => (
                  <Pressable
                    key={o.value}
                    onPress={() => handleSelect(o.value)}
                    className={`flex-row items-center justify-between px-3.5 py-2.5 ${o.value === value ? 'bg-ledger-green/10' : ''}`}
                  >
                    <Text className={`font-body-medium text-sm ${o.value === value ? 'text-ledger-green' : 'text-ink'}`}>
                      {o.label}
                    </Text>
                    {o.value === value && <Text className="text-ledger-green text-sm">✓</Text>}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}
