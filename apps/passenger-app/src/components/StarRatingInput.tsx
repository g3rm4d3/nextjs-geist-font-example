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
    <View
      style={styles.row}
      testID="star-rating-input"
      accessibilityRole={disabled ? undefined : 'adjustable'}
      accessibilityLabel="Star rating"
      accessibilityValue={{ min: 1, max: 5, now: value, text: `${value} of 5 stars` }}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <Pressable
          key={star}
          onPress={() => onChange(star)}
          disabled={disabled}
          hitSlop={6}
          style={styles.starButton}
          testID={`star-${star}`}
          accessibilityRole="button"
          accessibilityLabel={`${star} star${star === 1 ? '' : 's'}`}
          accessibilityState={{ selected: star <= value, disabled }}
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
  starButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  star: { fontSize: 32, color: '#475569' },
  starFilled: { color: '#fbbf24' },
});
