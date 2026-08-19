import type { AppNotification } from '@rideshare/types';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import {
  ApiClientError,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../lib/apiClient';

/**
 * Section 16: "Implement in-app notifications." Title/body are already
 * human-readable server-generated text (see apps/api's
 * notificationService) — this screen just lists them, most recent
 * first, and lets a driver mark one (or everything) read. No per-type
 * icon/label mapping: the 11 canonical event types (@rideshare/types's
 * NotificationType) are a stable machine-matchable key for future
 * deep-linking, not something this screen needs to branch on today.
 */
export function NotificationsScreen() {
  const { accessToken } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Bumped after mark-read/mark-all-read to re-trigger the fetch effect
  // below — same react-hooks/set-state-in-effect workaround used by this
  // app's own DocumentsScreen: the actual fetch stays inline in the
  // effect rather than calling an externally-defined function.
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string) {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const result = await getNotifications(token);
        if (!cancelled) {
          setNotifications(result.notifications);
          setUnreadCount(result.unreadCount);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof ApiClientError ? error.message : 'Could not load notifications.',
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load(accessToken);
    return () => {
      cancelled = true;
    };
  }, [accessToken, refreshCount]);

  async function handlePressNotification(notification: AppNotification) {
    if (!accessToken || notification.readAt) return;
    try {
      await markNotificationRead(accessToken, notification.id);
      setRefreshCount((count) => count + 1);
    } catch {
      // Best-effort — a transient failure just leaves it unread rather
      // than blocking the rest of the list.
    }
  }

  async function handleMarkAllRead() {
    if (!accessToken) return;
    try {
      await markAllNotificationsRead(accessToken);
      setRefreshCount((count) => count + 1);
    } catch (error) {
      setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not mark all as read.');
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.subtitle}>{unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</Text>
        {unreadCount > 0 && (
          <Pressable onPress={() => void handleMarkAllRead()} testID="mark-all-read-button">
            <Text style={styles.markAllText}>Mark all read</Text>
          </Pressable>
        )}
      </View>

      {errorMessage && (
        <Text style={styles.error} testID="notifications-error">
          {errorMessage}
        </Text>
      )}

      {isLoading && notifications.length === 0 ? (
        <ActivityIndicator color="#fbbf24" style={styles.loading} />
      ) : notifications.length === 0 ? (
        <Text style={styles.empty}>No notifications yet.</Text>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.card, !item.readAt && styles.cardUnread]}
              onPress={() => void handlePressNotification(item)}
              testID={`notification-${item.id}`}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                {!item.readAt && <View style={styles.unreadDot} />}
              </View>
              <Text style={styles.cardBody}>{item.body}</Text>
              <Text style={styles.cardMeta}>{new Date(item.createdAt).toLocaleString()}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1c1917', padding: 20 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  subtitle: { color: '#a8a29e', fontSize: 13 },
  markAllText: { color: '#fbbf24', fontSize: 13, fontWeight: '700' },
  loading: { marginTop: 24 },
  error: { color: '#f87171', fontSize: 13, marginBottom: 12, textAlign: 'center' },
  empty: { color: '#a8a29e', fontSize: 14, marginTop: 24, textAlign: 'center' },
  card: {
    backgroundColor: '#292524',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#292524',
  },
  cardUnread: { borderColor: '#fbbf24' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTitle: { color: '#fafaf9', fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fbbf24', marginTop: 4 },
  cardBody: { color: '#d6d3d1', fontSize: 13, marginTop: 6 },
  cardMeta: { color: '#78716c', fontSize: 11, marginTop: 8 },
});
