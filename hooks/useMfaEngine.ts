import { useState } from "react";
import { setupMfa, verifyMfaSetup, verifyMfaLogin, disableMfa, MfaSetupResponse, AuthResponse } from "../services/api";

export function useMfaEngine() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initiateSetup = async (userId: number): Promise<MfaSetupResponse> => {
    setLoading(true);
    setError(null);
    try {
      const res = await setupMfa(userId);
      if (!res.success) {
        setError(res.message);
      }
      return res;
    } catch (err: any) {
      const msg = err.message || "Failed to initiate MFA setup.";
      setError(msg);
      return { success: false, message: msg };
    } finally {
      setLoading(false);
    }
  };

  const confirmSetup = async (userId: number, code: string): Promise<AuthResponse> => {
    setLoading(true);
    setError(null);
    try {
      const res = await verifyMfaSetup(userId, code);
      if (!res.success) {
        setError(res.message);
      }
      return res;
    } catch (err: any) {
      const msg = err.message || "Failed to confirm MFA setup.";
      setError(msg);
      return { success: false, message: msg };
    } finally {
      setLoading(false);
    }
  };

  const approveLogin = async (params: { userId?: number; email?: string; code: string }): Promise<AuthResponse> => {
    setLoading(true);
    setError(null);
    try {
      const res = await verifyMfaLogin(params);
      if (!res.success) {
        setError(res.message);
      }
      return res;
    } catch (err: any) {
      const msg = err.message || "Failed to approve login request.";
      setError(msg);
      return { success: false, message: msg };
    } finally {
      setLoading(false);
    }
  };

  const deactivateMfa = async (userId: number): Promise<AuthResponse> => {
    setLoading(true);
    setError(null);
    try {
      const res = await disableMfa(userId);
      if (!res.success) {
        setError(res.message);
      }
      return res;
    } catch (err: any) {
      const msg = err.message || "Failed to deactivate MFA.";
      setError(msg);
      return { success: false, message: msg };
    } finally {
      setLoading(false);
    }
  };

  return {
    initiateSetup,
    confirmSetup,
    approveLogin,
    deactivateMfa,
    loading,
    error,
    setError,
  };
}
