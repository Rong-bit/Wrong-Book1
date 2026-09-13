import { isRegisteredMemberEmail } from "../data/memberEmails";

export type MemberRole = "guest" | "member";

export const GUEST_CAPTURE_LIMIT = 5;

export const STORAGE_MEMBERSHIP_KEY = "digital_notebook_membership_v1";

export interface MembershipState {
  role: MemberRole;
  email: string;
  guestCapturesUsed: number;
}

export const DEFAULT_MEMBERSHIP: MembershipState = {
  role: "guest",
  email: "",
  guestCapturesUsed: 0,
};

export function isValidEmail(value: string): boolean {
  const email = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function loadMembership(): MembershipState {
  try {
    const raw = localStorage.getItem(STORAGE_MEMBERSHIP_KEY);
    if (!raw) return { ...DEFAULT_MEMBERSHIP };
    const parsed = JSON.parse(raw) as Partial<MembershipState>;
    const role: MemberRole = parsed.role === "member" ? "member" : "guest";
    const email = typeof parsed.email === "string" ? parsed.email.trim() : "";
    const guestCapturesUsed =
      typeof parsed.guestCapturesUsed === "number" && parsed.guestCapturesUsed >= 0
        ? Math.floor(parsed.guestCapturesUsed)
        : 0;
    return { role, email, guestCapturesUsed };
  } catch {
    return { ...DEFAULT_MEMBERSHIP };
  }
}

export function saveMembership(state: MembershipState) {
  try {
    localStorage.setItem(STORAGE_MEMBERSHIP_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("Saving membership failed:", err);
  }
}

export function canCaptureAs(state: MembershipState): boolean {
  if (state.role === "member") {
    return isRegisteredMemberEmail(state.email);
  }
  return state.guestCapturesUsed < GUEST_CAPTURE_LIMIT;
}

export function captureBlockReason(state: MembershipState): string | null {
  if (canCaptureAs(state)) return null;
  if (state.role === "member") {
    return "請輸入已在 GitHub 登記的會員 Email 後才能不限題數擷取。";
  }
  return `訪客已達 ${GUEST_CAPTURE_LIMIT} 題上限。請改為會員，並輸入 GitHub 名單中的 Email。`;
}
