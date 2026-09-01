import { useEffect, useState } from 'react';

import { getScan, mapScanRowToScanResult } from '../services/scanService';
import { mockScanResult } from '../services/mockData';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { ScanResult } from '../types';

/** Real scan when `scanId` + Supabase are available; mock otherwise. */
export function useScanResult(scanId?: string) {
  const [result, setResult] = useState<ScanResult | null>(
    scanId && isSupabaseConfigured ? null : mockScanResult,
  );
  const [loading, setLoading] = useState(Boolean(scanId && isSupabaseConfigured));

  useEffect(() => {
    if (!scanId || !isSupabaseConfigured) return;
    let mounted = true;
    getScan(scanId).then((row) => {
      if (!mounted) return;
      setResult(row ? mapScanRowToScanResult(row) : mockScanResult);
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [scanId]);

  return { result, loading };
}
