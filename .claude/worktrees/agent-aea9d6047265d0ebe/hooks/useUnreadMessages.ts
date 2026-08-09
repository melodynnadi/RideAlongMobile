// Hook to track total unread message count
import { useState, useEffect } from 'react';
import { firestore, firebaseAuth } from '@/constants/services';
import { collection, query, where, onSnapshot } from 'firebase/firestore';

export function useUnreadMessages() {
  const [totalUnread, setTotalUnread] = useState(0);
  const currentUser = firebaseAuth.currentUser;

  useEffect(() => {
    if (!currentUser) {
      setTotalUnread(0);
      return;
    }

    const chatsQuery = query(
      collection(firestore, 'chats'),
      where('participants', 'array-contains', currentUser.uid)
    );

    const unsubscribe = onSnapshot(chatsQuery, (snapshot) => {
      let total = 0;
      snapshot.forEach((doc) => {
        const chatData = doc.data();
        const unreadField = `unreadCount_${currentUser.uid}`;
        const unreadCount = chatData[unreadField] || 0;
        total += unreadCount;
      });
      setTotalUnread(total);
    });

    return () => unsubscribe();
  }, [currentUser]);

  return totalUnread;
}
