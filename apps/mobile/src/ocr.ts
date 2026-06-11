import TextRecognition from '@react-native-ml-kit/text-recognition';

/**
 * On-device OCR (Google ML Kit) for Smart Sensor readings — e.g. the cable
 * ground-clearance value in SAVR/SAVT surveys. Recognizes text in a captured
 * photo and extracts the first numeric value so it can pre-fill an editable
 * reading field. Runs fully offline; the inspector can always correct it.
 */
export async function recognizeReadingFromImage(
  imageUri: string,
): Promise<string | null> {
  const result = await TextRecognition.recognize(imageUri);
  return extractFirstNumber(result?.text ?? '');
}

/**
 * Pull the reading out of OCR text (e.g. "5.27 m" -> "5.27"). Smart Sensor
 * displays are decimals, but OCR often splits the decimal with spaces
 * ("5. 27" / "5 ,27") or uses a comma — so rejoin those first, then prefer the
 * most complete decimal value (a stray "5" must not win over "5.27"). Returns
 * null when no number is present.
 */
export function extractFirstNumber(text: string): string | null {
  // Rejoin a decimal separator that OCR split with spaces, and normalise commas.
  const normalized = text.replace(/(\d)\s*[.,]\s*(\d)/g, '$1.$2');
  const matches = normalized.match(/\d+(?:\.\d+)?/g);

  if (!matches || matches.length === 0) {
    return null;
  }

  // A sensor reading is a decimal — prefer decimal matches, then the longest.
  const decimals = matches.filter((value) => value.includes('.'));
  const pool = decimals.length > 0 ? decimals : matches;

  return pool.reduce((best, value) => (value.length > best.length ? value : best));
}
