import React from 'react';
import { DynamicLegalDocument } from '@/components/DynamicLegalDocument';

export default function PrivacyScreen() {
  return <DynamicLegalDocument documentId="privacy" title="Privacy Policy" onError={(error) => console.error(error)} />;
}