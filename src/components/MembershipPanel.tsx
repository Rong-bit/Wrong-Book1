import React, { useEffect, useState } from "react";
import { AlertCircle, Mail, User, UserCheck } from "lucide-react";
import {
  GUEST_CAPTURE_LIMIT,
  MembershipState,
  canCaptureAs,
} from "../utils/membership";
import { MEMBER_EMAILS } from "../data/memberEmails";

interface MembershipPanelProps {
  membership: MembershipState;
  onChangeRole: (role: MembershipState["role"]) => void;
  onVerifyEmail: (email: string) => boolean;
  onSignOutMember: () => void;
}

export const MembershipPanel: React.FC<MembershipPanelProps> = ({
  membership,
  onChangeRole,
  onVerifyEmail,
  onSignOutMember,
}) => {
  const [emailDraft, setEmailDraft] = useState(membership.email);
  const [emailError, setEmailError] = useState<string | null>(null);

  useEffect(() => {
    setEmailDraft(membership.email);
  }, [membership.email]);

  const remaining = Math.max(0, GUEST_CAPTURE_LIMIT - membership.guestCapturesUsed);
  const guestLocked = membership.role === "guest" && remaining === 0;
  const memberUnlocked = membership.role === "member" && canCaptureAs(membership);
  const registeredCount = MEMBER_EMAILS.filter((email) => email.trim()).length;

  const handleVerify = () => {
    const ok = onVerifyEmail(emailDraft);
    if (!ok) {
      setEmailError("此 Email 不在 GitHub 會員名單。請先到倉庫登記，或改用訪客（最多 5 題）。");
      return;
    }
    setEmailError(null);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5 mb-4 w-full">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold text-slate-900">使用身分</h2>
          <p className="text-xs text-slate-500 mt-1">
            訪客最多 {GUEST_CAPTURE_LIMIT} 題。會員必須輸入已在 GitHub 登記的 Email 才能解鎖。
          </p>
        </div>
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl shrink-0">
          <button
            type="button"
            onClick={() => onChangeRole("guest")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              membership.role === "guest"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <User className="w-3.5 h-3.5 text-slate-500" />
            訪客
          </button>
          <button
            type="button"
            onClick={() => onChangeRole("member")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              membership.role === "member"
                ? "bg-white text-sky-800 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <UserCheck className="w-3.5 h-3.5 text-sky-600" />
            會員
          </button>
        </div>
      </div>

      {membership.role === "guest" ? (
        <div
          className={`mt-3 rounded-xl border px-3 py-2.5 text-xs ${
            guestLocked
              ? "bg-amber-50 border-amber-200 text-amber-950"
              : "bg-slate-50 border-slate-200 text-slate-700"
          }`}
        >
          <div className="font-semibold">
            {guestLocked
              ? `訪客已達 ${GUEST_CAPTURE_LIMIT} 題上限`
              : `訪客剩餘 ${remaining} / ${GUEST_CAPTURE_LIMIT} 題`}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed">
            {guestLocked
              ? "請改為「會員」並輸入已登記的 Email。"
              : `已擷取 ${membership.guestCapturesUsed} 題。刪除錯題不會增加額度。`}
          </p>
        </div>
      ) : memberUnlocked ? (
        <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-950">
          <div className="font-semibold">已驗證會員：擷取不限題數</div>
          <p className="mt-1 text-[11px]">
            目前身分：<span className="font-semibold">{membership.email}</span>
          </p>
          <button
            type="button"
            onClick={onSignOutMember}
            className="mt-2 text-[11px] font-semibold text-sky-800 underline underline-offset-2"
          >
            登出改回訪客
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-slate-600 leading-relaxed">
            先在 GitHub 登記 Email（目前名單 {registeredCount} 筆），再於下方輸入同一組信箱核對。未核對前仍視為未解鎖。
          </p>
          <label className="block text-xs font-semibold text-slate-600" htmlFor="member-email">
            已登記的會員 Email
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1 min-w-0">
              <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="member-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={emailDraft}
                onChange={(e) => {
                  setEmailDraft(e.target.value);
                  setEmailError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleVerify();
                  }
                }}
                placeholder="name@school.edu.tw"
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
              />
            </div>
            <button
              type="button"
              onClick={handleVerify}
              className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 active:scale-95 transition shrink-0"
            >
              核對並解鎖
            </button>
          </div>
          {emailError && (
            <div className="flex items-center gap-1.5 text-[11px] text-rose-700">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {emailError}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
