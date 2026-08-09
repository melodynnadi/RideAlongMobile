import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bell, Car, CreditCard, Trash2, Users } from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { useTheme } from '@/hooks/useTheme';
import { firebaseAuth, firestore } from '@/constants/services';
import {
	Timestamp,
	arrayUnion,
	collection,
	deleteDoc,
	doc,
	onSnapshot,
	query,
	updateDoc,
	where,
	writeBatch,
} from 'firebase/firestore';
import { Swipeable } from 'react-native-gesture-handler';

interface Notification {
	id: string;
	type: 'ride' | 'payment' | 'driver' | 'system';
	title: string;
	message: string;
	time: string;
	read: boolean;
	icon: any;
	iconColor: string;
	iconBg: string;
}

export default function NotificationsScreen() {
	const theme = useTheme();
	const [notifications, setNotifications] = useState<Notification[]>([]);
	const [loading, setLoading] = useState<boolean>(true);
	const unsubsRef = useRef<Array<() => void>>([]);
	const pendingMapRef = useRef<Map<string, any>>(new Map());
	const flushScheduledRef = useRef<boolean>(false);
	const flushTimerRef = useRef<any>(null);

	const [filter, setFilter] = useState<'all' | 'unread'>('all');

	const getIconForType = (
		type: string
	): { icon: any; iconColor: string; iconBg: string } => {
		switch (type) {
			case 'ride':
				return { icon: Car, iconColor: '#10B981', iconBg: '#DCFCE7' };
			case 'driver':
				return { icon: Users, iconColor: '#3B82F6', iconBg: '#DBEAFE' };
			case 'payment':
				return { icon: CreditCard, iconColor: '#10B981', iconBg: '#DCFCE7' };
			case 'system':
			default:
				return { icon: Bell, iconColor: '#8B5CF6', iconBg: '#EDE9FE' };
		}
	};

	const timeAgo = (date?: Date): string => {
		if (!date) return '';
		const now = new Date();
		const diff = Math.max(0, now.getTime() - date.getTime());
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
		const days = Math.floor(hours / 24);
		if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
		const weeks = Math.floor(days / 7);
		return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
	};

	const toDate = (v: any): Date | undefined => {
		if (!v) return undefined;
		if (v instanceof Date) return v;
		if (v instanceof Timestamp) return v.toDate();
		if (typeof v === 'number') return new Date(v);
		if (typeof v === 'string') {
			const d = new Date(v);
			return isNaN(d.getTime()) ? undefined : d;
		}
		return undefined;
	};

	useEffect(() => {
		const user = firebaseAuth.currentUser;
		if (!user) {
			setLoading(false);
			return;
		}

		unsubsRef.current.forEach((u) => u());
		unsubsRef.current = [];

		const base = collection(firestore, 'notifications');
		const qUserId = query(base, where('userId', '==', user.uid));
		const qRecipientId = query(base, where('recipientId', '==', user.uid));
		const qEmail = user.email
			? query(base, where('userEmail', '==', user.email))
			: null;
		const qRecipients = query(base, where('recipients', 'array-contains', user.uid));

		const scheduleFlush = () => {
			if (flushScheduledRef.current) return;
			flushScheduledRef.current = true;
			flushTimerRef.current = setTimeout(() => {
				flushScheduledRef.current = false;
				flushTimerRef.current = null;
				setNotifications(() => {
					const arr: any[] = Array.from(pendingMapRef.current.values());
					const final: Notification[] = arr.map((n) => {
						const { icon, iconBg, iconColor } = getIconForType(n.type);
						return {
							id: n.id,
							type: n.type,
							title: n.title,
							message: n.message,
							time: timeAgo(n.createdAt),
							read: n.read,
							icon,
							iconColor,
							iconBg,
						} as Notification;
					});
					final.sort((a: any, b: any) => {
						const ta = (pendingMapRef.current.get(a.id)?.createdAt?.getTime?.()) || 0;
						const tb = (pendingMapRef.current.get(b.id)?.createdAt?.getTime?.()) || 0;
						return tb - ta;
					});
					return final;
				});
				setLoading(false);
			}, 0);
		};

		const handleSnap = (snapshot: any) => {
			snapshot.docChanges().forEach((change: any) => {
				const d = change.doc;
				if (change.type === 'removed') {
					pendingMapRef.current.delete(d.id);
					return;
				}
				const data = d.data() || {};
				const rawType: string = (data.type || data.category || data.actionType || 'system').toString().toLowerCase();
				let mappedType: Notification['type'] = 'system';
				if (rawType.includes('ride') || rawType.includes('offer')) mappedType = 'ride';
				else if (rawType.includes('driver')) mappedType = 'driver';
				else if (rawType.includes('pay')) mappedType = 'payment';
				const createdAt = toDate(data.timestamp || data.createdAt || data.time);
				const readBy: string[] = Array.isArray(data.readBy) ? data.readBy : [];
				const readFromFlags = data.read === true || data.unread === false;
				const read: boolean = readFromFlags || readBy.includes(user.uid);
				const title: string = data.title || data.heading || 'Notification';
				const message: string = data.message || data.body || data.text || '';
				pendingMapRef.current.set(d.id, {
					id: d.id,
					type: mappedType,
					title,
					message,
					createdAt,
					read,
					path: `notifications/${d.id}`,
					userId: data.userId ?? null,
					recipientId: data.recipientId ?? null,
					recipients: Array.isArray(data.recipients) ? data.recipients : [],
				});
			});
			scheduleFlush();
		};

		const u1 = onSnapshot(qUserId, handleSnap, (e) => console.warn('notifications userId listener error', e));
		unsubsRef.current.push(u1);
		const u1b = onSnapshot(qRecipientId, handleSnap, (e) => console.warn('notifications recipientId listener error', e));
		unsubsRef.current.push(u1b);
		if (qEmail) {
			const u2 = onSnapshot(qEmail, handleSnap, (e) => console.warn('notifications userEmail listener error', e));
			unsubsRef.current.push(u2);
		}
		const u3 = onSnapshot(qRecipients, handleSnap, (e) => console.warn('notifications recipients listener error', e));
		unsubsRef.current.push(u3);

		return () => {
			unsubsRef.current.forEach((u) => u());
			unsubsRef.current = [];
			pendingMapRef.current.clear();
			if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
			flushScheduledRef.current = false;
		};
	}, []);

	const markAsRead = async (id: string) => {
		const user = firebaseAuth.currentUser;
		setNotifications((prevNotifications) =>
			prevNotifications.map((notification) =>
				notification.id === id ? { ...notification, read: true } : notification
			)
		);
		if (pendingMapRef.current.has(id)) {
			const v = pendingMapRef.current.get(id);
			pendingMapRef.current.set(id, { ...v, read: true });
		}

		try {
			if (!user) return;
			const raw = pendingMapRef.current.get(id);
			if (!raw?.path) return;
			const docRef = doc(firestore, raw.path);
			await updateDoc(docRef, {
				read: true,
				unread: false,
				readBy: arrayUnion(user.uid),
			});
		} catch (e) {
			console.warn('Failed to mark notification read', e);
		}
	};

	const belongsToCurrentUser = (rawNotification: any): boolean => {
		const user = firebaseAuth.currentUser;
		if (!user) return false;
		return (
			rawNotification.userId === user.uid ||
			rawNotification.recipientId === user.uid ||
			(Array.isArray(rawNotification.recipients) && rawNotification.recipients.includes(user.uid))
		);
	};

	const deleteNotification = async (id: string) => {
		const user = firebaseAuth.currentUser;
		if (!user) return;

		const raw = pendingMapRef.current.get(id);
		if (!raw || !belongsToCurrentUser(raw)) {
			console.error('[deleteNotification] Ownership check failed — skipping delete for', id);
			return;
		}
		const previousNotification = notifications.find((n) => n.id === id);
		if (!previousNotification) return;

		setNotifications((prev) => prev.filter((n) => n.id !== id));
		pendingMapRef.current.delete(id);

		try {
			await deleteDoc(doc(firestore, 'notifications', id));
		} catch (e) {
			console.warn('Failed to delete notification', e);
			pendingMapRef.current.set(id, raw);
			setNotifications((prev) => {
				const exists = prev.some((n) => n.id === previousNotification.id);
				if (exists) return prev;
				return [...prev, previousNotification];
			});
		}
	};

	const clearAllNotifications = async () => {
		const user = firebaseAuth.currentUser;
		if (!user) return;

		const toDelete = notifications.filter((n) => {
			const raw = pendingMapRef.current.get(n.id);
			if (!raw || !belongsToCurrentUser(raw)) {
				console.error('[clearAllNotifications] Skipping notification not owned by user:', n.id);
				return false;
			}
			return true;
		});

		if (toDelete.length === 0) return;

		const rawBackup = new Map<string, any>();
		toDelete.forEach((n) => {
			const raw = pendingMapRef.current.get(n.id);
			if (raw) rawBackup.set(n.id, raw);
		});

		setNotifications((prev) => prev.filter((n) => !toDelete.some((d) => d.id === n.id)));
		toDelete.forEach((n) => pendingMapRef.current.delete(n.id));

		try {
			const batch = writeBatch(firestore);
			toDelete.forEach((n) => {
				batch.delete(doc(firestore, 'notifications', n.id));
			});
			await batch.commit();
		} catch (e) {
			console.warn('Failed to clear all notifications', e);
			rawBackup.forEach((raw, id) => {
				pendingMapRef.current.set(id, raw);
			});
			setNotifications((prev) => {
				const prevIds = new Set(prev.map((n) => n.id));
				const restored = toDelete.filter((n) => !prevIds.has(n.id));
				return [...prev, ...restored];
			});
		}
	};

	const filteredNotifications = useMemo(
		() => (filter === 'unread' ? notifications.filter((n) => !n.read) : notifications),
		[filter, notifications]
	);

	const unreadCount = notifications.filter(n => !n.read).length;

	return (
		<SafeAreaView style={[styles.container, { backgroundColor: '#F8FAFC' }]} edges={['top']}>
			<View style={[styles.header, { backgroundColor: '#F8FAFC' }]}>
				<View style={styles.headerRow}>
					<View>
						<Text style={[styles.headerTitle, { color: theme.colors.secondary }]}>
							Notifications
						</Text>
						<Text style={styles.headerSubtitle}>
							Stay updated with your ride activity
						</Text>
					</View>
					{notifications.length > 0 && (
						<TouchableOpacity onPress={clearAllNotifications} style={styles.clearAllButton}>
							<Text style={[styles.clearAllText, { color: theme.colors.primary }]}>
								Clear All
							</Text>
						</TouchableOpacity>
					)}
				</View>
			</View>

			{loading ? (
				<View style={styles.loadingContainer}>
					<ActivityIndicator size="large" color={theme.colors.primary} />
					<Text style={styles.loadingText}>Loading notifications...</Text>
				</View>
			) : (
				<>
					{/* Filter Tabs */}
					<View style={styles.filterContainer}>
						<TouchableOpacity
							style={[
								styles.filterTab,
								filter === 'all' && { backgroundColor: theme.colors.primary }
							]}
							onPress={() => setFilter('all')}
						>
							<Text style={[
								styles.filterTabText,
								{ color: filter === 'all' ? 'white' : theme.colors.secondary }
							]}>
								All
							</Text>
						</TouchableOpacity>

						<TouchableOpacity
							style={[
								styles.filterTab,
								filter === 'unread' && { backgroundColor: theme.colors.primary }
							]}
							onPress={() => setFilter('unread')}
						>
							<Text style={[
								styles.filterTabText,
								{ color: filter === 'unread' ? 'white' : theme.colors.secondary }
							]}>
								Unread ({unreadCount})
							</Text>
						</TouchableOpacity>
					</View>

					{/* Notifications List */}
					{filteredNotifications.length > 0 ? (
						<ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
							{filteredNotifications.map((notification) => {
								const IconComponent = notification.icon;
								return (
									<Swipeable
										key={notification.id}
										renderRightActions={() => (
											<TouchableOpacity
												style={styles.deleteAction}
												onPress={() => deleteNotification(notification.id)}
											>
												<Trash2 size={20} color="white" />
												<Text style={styles.deleteActionText}>Delete</Text>
											</TouchableOpacity>
										)}
									>
										<TouchableOpacity
											onPress={() => markAsRead(notification.id)}
											activeOpacity={0.7}
										>
											<Card style={[
												styles.notificationCard,
												!notification.read && styles.unreadCard
											]}>
												<View style={styles.notificationContent}>
													<View style={[
														styles.iconContainer,
														{ backgroundColor: notification.iconBg }
													]}>
														<IconComponent size={20} color={notification.iconColor} />
													</View>

													<View style={styles.textContent}>
														<View style={styles.titleRow}>
															<Text style={[
																styles.notificationTitle,
																{ color: theme.colors.secondary }
															]}>
																{notification.title}
															</Text>
															{!notification.read && (
																<View style={[styles.unreadDot, { backgroundColor: theme.colors.primary }]} />
															)}
														</View>

														<Text style={styles.notificationMessage}>
															{notification.message}
														</Text>

														<Text style={styles.notificationTime}>
															{notification.time}
														</Text>
													</View>
												</View>
											</Card>
										</TouchableOpacity>
									</Swipeable>
								);
							})}
						</ScrollView>
					) : (
						<View style={styles.emptyContainer}>
							<Bell size={80} color="#9CA3AF" />
							<Text style={[styles.emptyTitle, { color: theme.colors.secondary }]}>
								No notifications
							</Text>
							<Text style={styles.emptyMessage}>
								{filter === 'unread'
									? "You're all caught up! No unread notifications."
									: "You don't have any notifications yet."
								}
							</Text>
						</View>
					)}
				</>
			)}
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	header: {
		padding: 16,
		paddingBottom: 0,
	},
	headerTitle: {
		fontSize: 28,
		fontWeight: 'bold',
		marginBottom: 4,
	},
	headerSubtitle: {
		fontSize: 16,
		color: '#64748B',
	},
	filterContainer: {
		flexDirection: 'row',
		paddingHorizontal: 16,
		paddingVertical: 12,
		gap: 12,
	},
	filterTab: {
		paddingVertical: 8,
		paddingHorizontal: 16,
		borderRadius: 20,
		backgroundColor: '#E2E8F0',
	},
	filterTabText: {
		fontSize: 14,
		fontWeight: '600',
	},
	content: {
		flex: 1,
		padding: 16,
	},
	notificationCard: {
		backgroundColor: 'white',
		marginBottom: 12,
		padding: 16,
	},
	unreadCard: {
		borderLeftWidth: 3,
		borderLeftColor: '#3B82F6',
	},
	notificationContent: {
		flexDirection: 'row',
		alignItems: 'flex-start',
	},
	iconContainer: {
		width: 40,
		height: 40,
		borderRadius: 20,
		justifyContent: 'center',
		alignItems: 'center',
		marginRight: 12,
	},
	textContent: {
		flex: 1,
	},
	titleRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		marginBottom: 4,
	},
	notificationTitle: {
		fontSize: 16,
		fontWeight: '600',
		flex: 1,
	},
	unreadDot: {
		width: 8,
		height: 8,
		borderRadius: 4,
		marginLeft: 8,
	},
	notificationMessage: {
		fontSize: 14,
		color: '#64748B',
		lineHeight: 20,
		marginBottom: 8,
	},
	notificationTime: {
		fontSize: 12,
		color: '#9CA3AF',
	},
	emptyContainer: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
		padding: 40,
	},
	emptyTitle: {
		fontSize: 18,
		fontWeight: '600',
		marginTop: 16,
		marginBottom: 8,
	},
	emptyMessage: {
		fontSize: 14,
		color: '#64748B',
		textAlign: 'center',
		lineHeight: 20,
	},
	loadingContainer: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
		paddingVertical: 80,
	},
	loadingText: {
		marginTop: 16,
		fontSize: 16,
		color: '#64748B',
	},
	headerRow: {
		flexDirection: 'row',
		alignItems: 'flex-start',
		justifyContent: 'space-between',
	},
	clearAllButton: {
		paddingVertical: 4,
		paddingHorizontal: 8,
		marginTop: 6,
	},
	clearAllText: {
		fontSize: 14,
		fontWeight: '600',
	},
	deleteAction: {
		backgroundColor: '#EF4444',
		justifyContent: 'center',
		alignItems: 'center',
		width: 80,
		marginBottom: 12,
		borderRadius: 8,
	},
	deleteActionText: {
		color: 'white',
		fontSize: 12,
		fontWeight: '600',
		marginTop: 4,
	},
});
