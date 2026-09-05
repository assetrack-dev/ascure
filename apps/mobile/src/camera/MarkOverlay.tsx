import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { DefectMark, MarkCategory, MarkSize } from './captureWithCamera';

// Shared defect-marking circle. Rendered identically on the live camera (aim
// mode: circle fixed at frame centre), the post-capture review (draggable), and
// the burn canvas — the mark's normalized centre + width-relative diameter make
// it scale-invariant across the three surfaces (all share the photo's aspect).
//
// Colors follow the client's report convention: KATEGORI A = red, B = yellow,
// C = green (same palette as the circles drawn on their sample reports).

export const MARK_CATEGORY_COLORS: Record<MarkCategory, string> = {
  A: '#EF4444',
  B: '#FACC15',
  C: '#22C55E',
};

// Circle diameter as a fraction of the frame WIDTH per size preset.
export const MARK_DIAMETER_FRACTION: Record<MarkSize, number> = {
  s: 0.3,
  m: 0.52,
  l: 0.78,
};

export function MarkOverlay({ mark }: { mark: DefectMark }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const diameter = MARK_DIAMETER_FRACTION[mark.size] * box.w;
  const color = MARK_CATEGORY_COLORS[mark.category];

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) =>
        setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }
    >
      {box.w > 0 ? (
        <>
          {/* Thin white halo so the ring stays visible on any background */}
          <View
            style={[
              styles.ring,
              {
                left: mark.x * box.w - diameter / 2 - 3,
                top: mark.y * box.h - diameter / 2 - 3,
                width: diameter + 6,
                height: diameter + 6,
                borderRadius: (diameter + 6) / 2,
                borderWidth: 1.5,
                borderColor: 'rgba(255,255,255,0.85)',
              },
            ]}
          />
          <View
            style={[
              styles.ring,
              {
                left: mark.x * box.w - diameter / 2,
                top: mark.y * box.h - diameter / 2,
                width: diameter,
                height: diameter,
                borderRadius: diameter / 2,
                borderWidth: 4,
                borderColor: color,
              },
            ]}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { position: 'absolute' },
});
