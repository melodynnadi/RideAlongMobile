import React from 'react';
import { router } from 'expo-router';
import DynamicLegalDocument from '@/components/DynamicLegalDocument';

export default function PrivacyScreen() {
  return (
    <DynamicLegalDocument 
      documentType="privacy" 
      onBack={() => router.push('/sign-up')}
    />
  );
}