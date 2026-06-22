import React from 'react';
import { DynamicLegalDocument } from '@/components/DynamicLegalDocument';

export default function TermsScreen() {
  return <DynamicLegalDocument documentId="terms" title="Terms of Service" onError={(error) => console.error(error)} />;
}