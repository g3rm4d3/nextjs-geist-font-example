import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

/**
 * Section 16 is the first phase to introduce something worth
 * configuring here (see this screen's own previous placeholder text) —
 * a link to the in-app notification list this phase adds.
 */
export function SettingsScreen({ navigation }: Props) {
  return (
    <View style={styles.container}>
      <Pressable
        style={styles.row}
        onPress={() => navigation.navigate('Notifications')}
        testID="settings-notifications-row"
      >
        <Text style={styles.rowLabel}>Notifications</Text>
        <Text style={styles.rowChevron}>›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1c1917', padding: 20 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#292524',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  rowLabel: { color: '#fafaf9', fontSize: 15, fontWeight: '600' },
  rowChevron: { color: '#78716c', fontSize: 18 },
});
