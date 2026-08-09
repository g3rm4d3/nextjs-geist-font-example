import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SAMPLE_DESTINATIONS } from '../data/sampleDestinations';
import { filterDestinations } from '../lib/filterDestinations';
import { useRideDraft } from '../context/RideDraftContext';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'DestinationSearch'>;

/**
 * No Google Places (or equivalent) API key is configured or verifiable in
 * this environment (docs/maps.md), so this searches a small curated list
 * of real dev-fixture places instead of free-form address geocoding —
 * see data/sampleDestinations.ts.
 */
export function DestinationSearchScreen({ navigation }: Props) {
  const { setDestination } = useRideDraft();
  const [query, setQuery] = useState('');

  const results = useMemo(() => filterDestinations(SAMPLE_DESTINATIONS, query), [query]);

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Search sample destinations…"
        placeholderTextColor="#64748b"
        value={query}
        onChangeText={setQuery}
        autoFocus
        testID="destination-search-input"
      />

      <FlatList
        data={results}
        keyExtractor={(item) => item.label}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.emptyText}>No sample destinations match.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => {
              setDestination(item);
              navigation.navigate('HomeMap');
            }}
          >
            <Text style={styles.rowText}>{item.label}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 16 },
  input: {
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  list: { paddingBottom: 24 },
  row: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#334155',
  },
  rowText: { color: '#f8fafc', fontSize: 16 },
  emptyText: { color: '#64748b', textAlign: 'center', marginTop: 24 },
});
