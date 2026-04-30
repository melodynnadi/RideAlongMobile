import React from 'react';
import { router } from 'expo-router';
import DynamicLegalDocument from '@/components/DynamicLegalDocument';

export default function TermsScreen() {
  return (
    <DynamicLegalDocument 
      documentType="terms" 
      onBack={() => router.push('/sign-up')}
    />
  );
}