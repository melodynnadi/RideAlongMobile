/**
 * useNotifications.js
 * 
 * React hook for accessing notification functionality in the Rider app.
 * Provides notification data, unread count, and action handlers.
 */

import { useState, useEffect, useCallback } from 'react';
import NotificationManager from '../services/NotificationManager';

export const useNotifications = () => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Initialize notification manager and set up listeners
  useEffect(() => {
    let unsubscribe = null;

    const initializeNotifications = async () => {
      try {
        setLoading(true);
        setError(null);

        // Initialize the notification manager
        await NotificationManager.initialize();

        // Register callback for notification events
        unsubscribe = NotificationManager.onNotificationEvent((event) => {
          console.log('[useNotifications] Event received:', event.type);

          switch (event.type) {
            case 'firestoreUpdate':
              setNotifications(event.notifications);
              setUnreadCount(event.unreadCount);
              break;

            case 'received':
              // Notification received while app is open
              // Firestore listener will handle the update
              break;

            case 'tapped':
              // Notification was tapped - navigation handled by manager
              break;

            case 'allRead':
              setUnreadCount(event.unreadCount);
              break;
          }
        });

        // Get initial unread count
        setUnreadCount(NotificationManager.getUnreadCount());
        setLoading(false);
      } catch (err) {
        console.error('[useNotifications] Initialization error:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    initializeNotifications();

    // Cleanup on unmount
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  // Mark a notification as read
  const markAsRead = useCallback(async (notificationId) => {
    try {
      await NotificationManager.markAsRead(notificationId);
    } catch (err) {
      console.error('[useNotifications] Error marking as read:', err);
      setError(err.message);
    }
  }, []);

  // Mark all notifications as read
  const markAllAsRead = useCallback(async () => {
    try {
      await NotificationManager.markAllAsRead();
    } catch (err) {
      console.error('[useNotifications] Error marking all as read:', err);
      setError(err.message);
    }
  }, []);

  // Send a local notification (for testing)
  const sendLocalNotification = useCallback(async (title, body, data = {}) => {
    try {
      await NotificationManager.sendLocalNotification(title, body, data);
    } catch (err) {
      console.error('[useNotifications] Error sending local notification:', err);
      setError(err.message);
    }
  }, []);

  // Schedule a notification for later
  const scheduleNotification = useCallback(async (title, body, triggerDate, data = {}) => {
    try {
      return await NotificationManager.scheduleNotification(title, body, triggerDate, data);
    } catch (err) {
      console.error('[useNotifications] Error scheduling notification:', err);
      setError(err.message);
      return null;
    }
  }, []);

  // Cancel a scheduled notification
  const cancelNotification = useCallback(async (identifier) => {
    try {
      await NotificationManager.cancelScheduledNotification(identifier);
    } catch (err) {
      console.error('[useNotifications] Error canceling notification:', err);
      setError(err.message);
    }
  }, []);

  return {
    notifications,
    unreadCount,
    loading,
    error,
    markAsRead,
    markAllAsRead,
    sendLocalNotification,
    scheduleNotification,
    cancelNotification,
  };
};

export default useNotifications;
