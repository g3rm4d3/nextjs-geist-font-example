import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Profile'>;

const MENU_ITEMS: { label: string; screen: keyof RootStackParamList }[] = [
  { label: 'Application Status', screen: 'ApplicationStatus' },
  { label: 'Vehicle', screen: 'Vehicle' },
  { label: 'Documents', screen: 'Documents' },
  { label: 'History', screen: 'History' },
  { label: 'Earnings', screen: 'Earnings' },
  { label: 'Support', screen: 'Support' },
  { label: 'Settings', screen: 'Settings' },
];

export function ProfileScreen({ navigation }: Props) {
  const { user, logout } = useAuth();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.email}>{user?.email}</Text>
        <Text style={styles.role}>{user?.role}</Text>
      </View>

      {MENU_ITEMS.map((item) => (
        <Pressable
          key={item.screen}
          style={styles.row}
          onPress={() => navigation.navigate(item.screen as never)}
        >
          <Text style={styles.rowText}>{item.label}</Text>
        </Pressable>
      ))}

      <Pressable style={styles.logoutButton} onPress={() => void logout()} testID="logout-button">
        <Text style={styles.logoutButtonText}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1c1917', padding: 20 },
  header: { marginBottom: 24 },
  email: { color: '#fafaf9', fontSize: 18, fontWeight: '700' },
  role: { color: '#a8a29e', fontSize: 13, marginTop: 4 },
  row: {
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#44403c',
  },
  rowText: { color: '#fafaf9', fontSize: 15 },
  logoutButton: {
    marginTop: 32,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f87171',
  },
  logoutButtonText: { color: '#f87171', fontSize: 15, fontWeight: '700' },
});
