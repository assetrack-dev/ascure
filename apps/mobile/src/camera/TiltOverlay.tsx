import { StyleSheet, Text, View } from 'react-native';

// Shared tilt overlay: a STATIC vertical reference axis + a measurement line the
// user swings about the centre pivot onto the pole, plus the angle between them.
// Rendered identically on the live camera (phone held level) and burned into the
// saved photo — so the photo stays vertically straight and still documents the lean.
// Self-scaling (absoluteFill + percentages) so the live frame and the burn canvas
// (same 4:3 aspect) match.

export type TiltOverlayProps = {
  angleDeg: number; // measurement line tilt from vertical, signed degrees
  showHint?: boolean; // live mode shows the "drag to swing" hint
};

export function TiltOverlay({ angleDeg, showHint }: TiltOverlayProps) {
  const lean = Math.abs(angleDeg);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* Static vertical reference axis */}
      <View style={styles.vertical} />
      {/* Measurement line — pivots about centre, rotated to the aimed angle */}
      <View style={[styles.measure, { transform: [{ rotate: `${angleDeg}deg` }] }]} />
      <View style={styles.pivotDot} />
      <View style={styles.angleWrap}>
        <Text style={styles.angleText}>{lean.toFixed(1)}°</Text>
        <Text style={styles.angleSub}>from vertical</Text>
        {showHint ? (
          <Text style={styles.hint}>Drag to swing the line onto the pole</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  vertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: 2,
    marginLeft: -1,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  measure: {
    position: 'absolute',
    top: '-50%',
    bottom: '-50%',
    left: '50%',
    width: 3,
    marginLeft: -1.5,
    backgroundColor: '#38BDF8',
  },
  pivotDot: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 12,
    height: 12,
    marginLeft: -6,
    marginTop: -6,
    borderRadius: 6,
    backgroundColor: '#38BDF8',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  angleWrap: {
    position: 'absolute',
    top: '9%',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  angleText: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '800',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 14,
    paddingVertical: 3,
    borderRadius: 12,
    overflow: 'hidden',
  },
  angleSub: { color: '#E2E8F0', fontSize: 11, fontWeight: '600', marginTop: 3 },
  hint: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
});
