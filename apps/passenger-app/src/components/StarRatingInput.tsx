import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Section 13: "1-5 stars." Plain Unicode glyphs, not an icon library
 * dependency — matches this codebase's "no extra dep unless the
 * spec actually needs it" bias (e.g. formatCents over a currency
 * library). Five equally-sized tap targets, each setting `value` to its
 * own 1-5 position.
 */
export function StarRatingInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (stars: number) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.row} testID="star-rating-input">
      {[1, 2, 3, 4, 5].map((star) => (
        <Pressable
          key={star}
          onPress={() => onChange(star)}
          disabled={disabled}
          hitSlop={6}
          testID={`star-${star}`}
        >
          <Text style={[styles.star, star <= value && styles.starFilled]}>
            {star <= value ? '★' : '☆'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  star: { fontSize: 32, color: '#475569' },
  starFilled: { color: '#fbbf24' },
});
