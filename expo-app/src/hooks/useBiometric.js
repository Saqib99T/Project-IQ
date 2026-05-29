/**
 * Biometric re-authentication hook.
 * On app resume, if the user has an IAM token stored in SecureStore,
 * prompt Face ID / fingerprint instead of a full Keycloak redirect.
 *
 * Returns { authenticateWithBiometric }
 */
import { useCallback } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'iam_access_token';

export function useBiometric() {
    /**
     * Call on app foreground if the user was previously authenticated.
     * Resolves true if biometric succeeds or hardware is unavailable.
     * Resolves false if user fails / cancels biometric.
     */
    const authenticateWithBiometric = useCallback(async () => {
        try {
            const hasHardware = await LocalAuthentication.hasHardwareAsync();
            const isEnrolled  = await LocalAuthentication.isEnrolledAsync();
            if (!hasHardware || !isEnrolled) return true; // no biometric — allow through

            const token = await SecureStore.getItemAsync(TOKEN_KEY);
            if (!token) return true; // no stored session — IAM login handles it

            const result = await LocalAuthentication.authenticateAsync({
                promptMessage:    'Authenticate to continue',
                fallbackLabel:    'Use passcode',
                cancelLabel:      'Cancel',
                disableDeviceFallback: false,
            });

            return result.success;
        } catch {
            return true; // fail open on error
        }
    }, []);

    return { authenticateWithBiometric };
}
