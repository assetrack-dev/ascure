import { StyleSheet, View } from 'react-native';

/**
 * A fixed center crosshair overlay for map pickers. The map pans underneath it
 * and the chosen location is the map's center — so the target point isn't hidden
 * under the user's finger like a draggable pin (the "pin sits above the finger"
 * problem). pointerEvents="none" so it never intercepts map gestures.
 */
export function MapCrosshair({ color = '#ef4444' }: { color?: string }) {
  return (
    <View pointerEvents="none" style={styles.overlay}>
      <View style={[styles.line, styles.horizontal, { backgroundColor: color }]} />
      <View style={[styles.line, styles.vertical, { backgroundColor: color }]} />
      <View style={[styles.dot, { borderColor: color }]} />
    </View>
  );
}

const CROSSHAIR_SIZE = 30;

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: {
    position: 'absolute',
    borderRadius: 1,
  },
  horizontal: {
    width: CROSSHAIR_SIZE,
    height: 2,
  },
  vertical: {
    width: 2,
    height: CROSSHAIR_SIZE,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
});
