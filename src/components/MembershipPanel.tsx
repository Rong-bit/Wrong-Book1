import React from "react";
import { User, UserCheck } from "lucide-react";
import { GUEST_CAPTURE_LIMIT, MembershipState } from "../utils/membership";
import { MEMBER_EMAILS } from "../data/memberEmails";

const GITHUB_EMAILS_EDIT_URL =
  "https://github.com/Rong-bit/Wrong-Book1/edit/main/src/data/memberEmails.ts";

interface MembershipPanelProps {
  membership: MembershipState;
  onChangeRole: (role: MembershipState["role"]) => void;
}

export const MembershipPanel: React.FC<MembershipPanelProps> = ({
  membership,
  onChangeRole,
}) => {
  const remaining = Math.max(0, GUEST_CAPTURE_LIMIT - membership.guestCapturesUsed);
  const guestLocked = membership.role === "guest" && remaining === 0;
  const registeredCount = MEMBER_EMAILS.filter((email) => email.trim()).length;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5 mb-4 w-full">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold text-slate-900">使用身分</h2>
          <p className="text-xs text-slate-500 mt-1">
            訪客最多擷取 {GUEST_CAPTURE_LIMIT} 題。會員 Email 請直接在 GitHub 檔案登記。
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
              ? "請改為「會員」後繼續擷取。會員 Email 請到 GitHub 登記。"
              : `已擷取 ${membership.guestCapturesUsed} 題。刪除錯題不會增加額度。`}
          </p>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-950">
          <div className="font-semibold">會員模式：擷取不限題數</div>
          <p className="mt-1 text-[11px] leading-relaxed">
            目前 GitHub 已登記 {registeredCount} 個會員 Email。請到倉庫檔案新增或修改：
          </p>
          <a
            href={GITHUB_EMAILS_EDIT_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 inline-flex font-semibold text-sky-800 underline underline-offset-2"
          >
            src/data/memberEmails.ts
          </a>
        </div>
      )}
    </div>
  );
};
