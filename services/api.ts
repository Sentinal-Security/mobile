export const API_BASE_URL = "https://backend-pi68.onrender.com";

export interface MfaSetupResponse {
  success: boolean;
  message: string;
  secretKey?: string;
  otpAuthUri?: string;
  accountEmail?: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  userId?: number;
  email?: string;
  fullName?: string;
  mfaEnabled?: boolean;
  mfaRequired?: boolean;
}

export async function setupMfa(userId: number): Promise<MfaSetupResponse> {
  const res = await fetch(`${API_BASE_URL}/api/mfa/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  return res.json();
}

export async function verifyMfaSetup(userId: number, code: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}/api/mfa/verify-setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, code }),
  });
  return res.json();
}

export async function verifyMfaLogin(params: { userId?: number; email?: string; code: string }): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}/api/mfa/verify-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function disableMfa(userId: number): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}/api/mfa/disable`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  return res.json();
}
