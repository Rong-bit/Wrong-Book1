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
  if (state.role === "member") return true;
  return state.guestCapturesUsed < GUEST_CAPTURE_LIMIT;
}

export function captureBlockReason(state: MembershipState): string | null {
  if (canCaptureAs(state)) return null;
  return `訪客已達 ${GUEST_CAPTURE_LIMIT} 題上限，請在首頁改為「會員」。會員 Email 請在 GitHub 的 src/data/memberEmails.ts 登記。`;
}
