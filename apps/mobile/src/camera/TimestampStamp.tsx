import { StyleSheet, Text, View } from 'react-native';

// Shared, compact timestamp + GPS stamp — rendered identically on the live camera
// (bottom-right) and burned into the saved photo (WYSIWYG). Coordinates only
// (no reverse-geocode) so it works fully offline. (Pole-tilt is drawn separately
// by <TiltOverlay>, not here.)

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function hasCoords(lat: number | null, lng: number | null): boolean {
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    typeof lng === 'number' &&
    Number.isFinite(lng)
  );
}

export type TimestampStampProps = {
  date: Date;
  latitude: number | null;
  longitude: number | null;
  accuracy?: number | null;
};

export function TimestampStamp({
  date,
  latitude,
  longitude,
  accuracy,
}: TimestampStampProps) {
  const hours24 = date.getHours();
  const meridiem = hours24 < 12 ? 'am' : 'pm';
  const hours12 = hours24 % 12 || 12;
  const time = `${pad(hours12)}:${pad(date.getMinutes())}`;
  const dateLabel = `${MONTHS[date.getMonth()]} ${pad(date.getDate())}, ${date.getFullYear()}`;
  const dayLabel = DAYS[date.getDay()];

  let coordsLine: string;
  if (hasCoords(latitude, longitude)) {
    const acc =
      typeof accuracy === 'number' && Number.isFinite(accuracy)
        ? `  ±${Math.round(accuracy)}m`
        : '';
    coordsLine = `${(latitude as number).toFixed(5)}°, ${(longitude as number).toFixed(5)}°${acc}`;
  } else {
    coordsLine = 'GPS: locating…';
  }

  return (
    <View style={styles.panel}>
      <View style={styles.row}>
        <Text style={styles.time}>{time}</Text>
        <Text style={styles.meridiem}>{meridiem}</Text>
        <View style={styles.bar} />
        <View>
          <Text style={styles.date}>{dateLabel}</Text>
          <Text style={styles.day}>{dayLabel}</Text>
        </View>
      </View>
      <Text style={styles.coords}>{coordsLine}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 3,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  time: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 26,
  },
  meridiem: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    marginLeft: 3,
    marginTop: 2,
    alignSelf: 'flex-start',
  },
  bar: {
    width: 2,
    alignSelf: 'stretch',
    minHeight: 24,
    marginHorizontal: 8,
    borderRadius: 1,
    backgroundColor: '#F5C518',
  },
  date: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  day: { color: '#E2E8F0', fontSize: 10, fontWeight: '500', marginTop: 1 },
  coords: { color: '#ffffff', fontSize: 10, fontWeight: '600' },
});
