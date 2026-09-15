import {
  isConnected,
  requestAccess,
  getAddress,
  signTransaction as freighterSignTx
} from '@stellar/freighter-api';

export const checkFreighterInstalled = async (): Promise<boolean> => {
  if (typeof window === 'undefined') return false;
  try {
    const result = await isConnected();
    return Boolean(result.isConnected);
  } catch (err) {
    console.warn('[Freighter] Error checking installation:', err);
    return false;
  }
};

export const getFreighterPublicKey = async (): Promise<string | null> => {
  if (typeof window === 'undefined') return null;
  try {
    const installed = await checkFreighterInstalled();
    if (!installed) {
      alert('Freighter wallet extension is not installed. Please install it from freighter.app');
      return null;
    }

    // requestAccess prompts the user to connect their account if not yet connected
    const accessResult = await requestAccess();
    if (accessResult.error || !accessResult.address) {
      // Fallback to getAddress if already authorized
      const addrResult = await getAddress();
      if (addrResult.address) return addrResult.address;
      console.warn('[Freighter] Access denied or address unavailable:', accessResult.error);
      return null;
    }

    return accessResult.address;
  } catch (err) {
    console.error('[Freighter] Failed to connect wallet:', err);
    return null;
  }
};

export const signTransaction = async (
  xdr: string,
  networkPassphrase = 'Test SDF Network ; September 2015'
): Promise<string | null> => {
  if (typeof window === 'undefined') return null;
  try {
    const result = await freighterSignTx(xdr, { networkPassphrase });
    if (result.error || !result.signedTxXdr) {
      console.error('[Freighter] Transaction signing error:', result.error);
      return null;
    }
    return result.signedTxXdr;
  } catch (err) {
    console.error('[Freighter] Error signing transaction:', err);
    return null;
  }
};

export const truncateAddress = (addr: string): string => {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
};
