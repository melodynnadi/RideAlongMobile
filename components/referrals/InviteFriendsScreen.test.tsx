import React from 'react';
import { Share } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/hooks/ThemeContext', () => ({ useAppTheme: () => ({ colors: { ...require('@/constants/theme').lightColors, statusBar: 'dark-content' } }) }));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn(), push: jest.fn() }, useLocalSearchParams: () => ({}) }));
jest.mock('react-native-svg', () => ({ SvgXml: () => null }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const mockTerms = { rewardCents: 500, minQualifyingFareCents: 6000, qualifyDays: 60, rewardExpiryDays: 60, holdHours: 72, monthlyReferrerCap: 5 };
const mockSummary = {
  open: true,
  invites: [
    { program: 'rider', code: 'K7QX4M', url: 'https://ridealongapp.com/r/K7QX4M', terms: { program: 'rider', ...mockTerms } },
    { program: 'driver', code: 'DR8N2P', url: 'https://ridealongapp.com/r/DR8N2P', terms: { program: 'driver', ...mockTerms } },
  ],
  myReferral: null,
  rewards: [{ id: 'rw_1', side: 'referrer', program: 'rider', kind: 'rider_discount', amountCents: 500, status: 'ready', label: 'Ready to use', detail: '$5 off one ride of $60 or more, applied at checkout. Use by Jan 7.', expiresAt: null, createdAt: null, paidAt: null }],
  friends: {
    items: [{ key: 'rw_1', friend: { name: 'Bob K.', program: 'rider', joinedAt: null, status: 'earned', label: 'Reward earned', detail: 'Completed a qualifying ride.' }, myReward: null }],
    nextCursor: null,
  },
};
jest.mock('@/services/referrals', () => {
  const actual = jest.requireActual('@/services/referrals');
  return { ...actual, fetchReferralSummary: jest.fn(async () => mockSummary), fetchInviteQr: jest.fn(async () => '<svg/>'), fetchMoreFriends: jest.fn() };
});
jest.mock('@/constants/services', () => ({ firebaseAuth: { currentUser: null }, getApiBaseUrl: () => 'https://api.test' }));

import { InviteFriendsScreen } from './InviteFriendsScreen';

jest.setTimeout(30000); // the first render transforms the whole screen tree

describe('InviteFriendsScreen', () => {
  it('shows the real terms, the code, rewards and friends — and switches programs for dual-role users', async () => {
    const screen = render(<InviteFriendsScreen role="rider" />);
    await waitFor(() => expect(screen.getByText('K7QX4M')).toBeTruthy());
    expect(screen.getByText('Give $5, get $5')).toBeTruthy();
    expect(screen.getByText(/get \$5 off a ride of \$60 or more once their student status is approved/)).toBeTruthy();
    expect(screen.getByText(/Up to 5 rewards a month/)).toBeTruthy();
    expect(screen.getByText('Bob K.')).toBeTruthy();
    expect(screen.getByText('Ready to use')).toBeTruthy();
    expect(screen.queryByText(/@/)).toBeNull(); // no emails anywhere

    fireEvent.press(screen.getByText('Invite drivers'));
    expect(screen.getByText('DR8N2P')).toBeTruthy();
    expect(screen.getByText('Earn $5 for each driver you bring')).toBeTruthy();
    expect(screen.getByText(/once both of you are approved and student-verified/)).toBeTruthy();
  });

  it('shares the invite with the real terms and copies the code', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
    const screen = render(<InviteFriendsScreen role="rider" />);
    await waitFor(() => screen.getByText('Share invite'));
    fireEvent.press(screen.getByText('Share invite'));
    expect(share).toHaveBeenCalledWith({
      message: 'Join me on RideAlong for rides with verified students. Sign up with my code K7QX4M to get $5 off a ride of $60 or more once your student status is approved. https://ridealongapp.com/r/K7QX4M',
      url: 'https://ridealongapp.com/r/K7QX4M',
    });
    fireEvent.press(screen.getByText('Copy code'));
    await waitFor(() => expect(require('expo-clipboard').setStringAsync).toHaveBeenCalledWith('K7QX4M'));
  });
});
