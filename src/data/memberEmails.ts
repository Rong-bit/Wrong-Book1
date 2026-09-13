/**
 * 會員 Email 請直接在 GitHub 這個檔案新增，每行一個字串。
 * 編輯位置：https://github.com/Rong-bit/Wrong-Book1/edit/main/src/data/memberEmails.ts
 *
 * 範例：
 *   "name@school.edu.tw",
 */
export const MEMBER_EMAILS: string[] = [
  "hjr640511@gmail.com"
];

export function normalizeMemberEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isRegisteredMemberEmail(email: string): boolean {
  const target = normalizeMemberEmail(email);
  if (!target) return false;
  return MEMBER_EMAILS.some((item) => normalizeMemberEmail(item) === target);
}
