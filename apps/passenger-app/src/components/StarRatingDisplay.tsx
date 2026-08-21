import { StyleSheet, Text, View } from 'react-native';

/** Read-only aggregate display (section 13: "calculate aggregate
 * ratings server-side") — a single filled star glyph plus the numeric
 * average, not five individual stars: this is a summary figure, not an
 * input. `null` (no ratings yet) renders nothing rather than "0.0",
 * which would misleadingly read as a bad rating instead of no data. */
export function StarRatingDisplay({ averageRating }: { averageRating: number | null }) {
  if (averageRating === null) return null;
  return (
    <View
      style={styles.row}
      testID="star-rating-display"
      accessible
      accessibilityLabel={`${averageRating.toFixed(1)} out of 5 stars`}
    >
      <Text style={styles.star}>★</Text>
      <Text style={styles.value}>{averageRating.toFixed(1)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  star: { fontSize: 14, color: '#fbbf24' },
  value: { fontSize: 13, fontWeight: '700', color: '#f8fafc' },
});
