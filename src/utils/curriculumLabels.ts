import { QuestionItem } from "../types";

export interface CurriculumLabel {
  subject?: string;
  gradeLevel?: string;
  chapter?: string;
  unit?: string;
}

const CHINESE_NUM: Record<string, string> = {
  一: "1",
  二: "2",
  三: "3",
  四: "4",
  五: "5",
  六: "6",
  七: "7",
  八: "8",
  九: "9",
  十: "10",
};

/** Normalize subject so 地理 / 地科 aliases still match within the same family when needed. */
export function normalizeSubjectKey(subject?: string): string {
  if (!subject) return "";
  const raw = subject.replace(/\s/g, "").toLowerCase();
  if (!raw || raw === "未歸類" || raw === "未知") return "";
  if (raw.includes("數學") || raw.includes("math")) return "數學";
  if (raw.includes("物理") || raw.includes("physics")) return "物理";
  if (raw.includes("化學") || raw.includes("chemistry")) return "化學";
  if (raw.includes("生物") || raw.includes("biology")) return "生物";
  if (raw.includes("地理") || raw.includes("地球科學") || raw.includes("地科") || raw.includes("earth")) {
    // Keep 地理 and 地球科學 distinct for junior-high vs senior-high catalogs.
    if (raw.includes("地球") || raw.includes("地科") || raw.includes("earth")) return "地球科學";
    return "地理";
  }
  if (raw.includes("國文") || raw.includes("國語") || raw.includes("chinese")) return "國文";
  if (raw.includes("英文") || raw.includes("英語") || raw.includes("english")) return "英文";
  if (raw.includes("歷史") || raw.includes("history")) return "歷史";
  if (raw.includes("公民") || raw.includes("civics")) return "公民";
  return raw;
}

export function sameSubject(a?: string, b?: string): boolean {
  const left = normalizeSubjectKey(a);
  const right = normalizeSubjectKey(b);
  if (!left || !right) return false;
  return left === right;
}

export function normalizeGradeKey(grade?: string): string {
  if (!grade) return "";
  return grade
    .replace(/\s/g, "")
    .replace(/[（(].*$/, "")
    .replace(/七年級/g, "國一")
    .replace(/八年級/g, "國二")
    .replace(/九年級/g, "國三")
    .replace(/一年級/g, "國一")
    .replace(/國中一/g, "國一")
    .replace(/國中二/g, "國二")
    .replace(/國中三/g, "國三");
}

export function extractChapterNo(chapter?: string): string | null {
  if (!chapter) return null;
  const match = chapter.match(/第\s*([0-9一二三四五六七八九十]+)\s*章/);
  if (!match) return null;
  return CHINESE_NUM[match[1]] || match[1];
}

export function extractUnitNo(unit?: string): string | null {
  if (!unit) return null;
  const match = unit.match(/(\d+)\s*[-－–.．]\s*(\d+)/);
  return match ? `${match[1]}-${match[2]}` : null;
}

export function collectExistingLabels(questions: QuestionItem[]): CurriculumLabel[] {
  return questions
    .filter(
      (q) =>
        q.status === "ready" &&
        !q.gradeLevel?.includes("推論") &&
        !q.chapter?.includes("推論") &&
        Boolean(q.gradeLevel || q.chapter || q.unit)
    )
    .map((q) => ({
      subject: q.subject,
      gradeLevel: q.gradeLevel,
      chapter: q.chapter,
      unit: q.unit,
    }));
}

export function formatExistingLabelsForPrompt(labels: CurriculumLabel[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const label of labels) {
    const line = [label.subject, label.gradeLevel, label.chapter, label.unit]
      .filter(Boolean)
      .join(" / ");
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(`- ${line}`);
    if (lines.length >= 40) break;
  }
  return lines.join("\n");
}

function sameBook(a?: string, b?: string): boolean {
  const left = normalizeGradeKey(a);
  const right = normalizeGradeKey(b);
  if (!left || !right) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

/**
 * Prefer an existing notebook label over a near-synonym the model just invented.
 * Matching is scoped by subject + book so 地理 never inherits 數學 chapter/unit names.
 */
export function alignAnalysisLabels<
  T extends { 科目?: string; 冊別?: string; 章節?: string; 單元?: string }
>(result: T, existing: CurriculumLabel[]): T {
  const subjectPeers = existing.filter((item) => sameSubject(item.subject, result.科目));
  const book = subjectPeers.filter((item) => sameBook(item.gradeLevel, result.冊別));
  const chapterNo = extractChapterNo(result.章節);

  if (chapterNo) {
    const matchedChapter = book.find(
      (item) => extractChapterNo(item.chapter) === chapterNo && item.chapter
    );
    if (matchedChapter?.chapter) {
      result = { ...result, 章節: matchedChapter.chapter };
    }
  }

  const unitNo = extractUnitNo(result.單元);
  if (unitNo) {
    const matchedUnit =
      subjectPeers.find(
        (item) =>
          item.chapter === result.章節 &&
          extractUnitNo(item.unit) === unitNo &&
          item.unit
      ) ||
      book.find(
        (item) =>
          extractChapterNo(item.chapter) === chapterNo &&
          extractUnitNo(item.unit) === unitNo &&
          item.unit
      );
    if (matchedUnit?.unit) {
      result = { ...result, 單元: matchedUnit.unit };
    }
  }

  return result;
}

/** Keep one chapter/unit name per subject + book + section number across the notebook. */
export function alignQuestionCollection(questions: QuestionItem[]): QuestionItem[] {
  const chapterCanon = new Map<string, string>();
  const unitCanon = new Map<string, string>();
  const ready = questions
    .filter((q) => q.status === "ready")
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt);

  for (const q of ready) {
    const subjectKey = normalizeSubjectKey(q.subject);
    const gradeKey = normalizeGradeKey(q.gradeLevel);
    const chapterNo = extractChapterNo(q.chapter);
    if (subjectKey && gradeKey && chapterNo && q.chapter) {
      const key = `${subjectKey}#${gradeKey}#${chapterNo}`;
      if (!chapterCanon.has(key)) chapterCanon.set(key, q.chapter);
    }
    const unitNo = extractUnitNo(q.unit);
    if (subjectKey && gradeKey && chapterNo && unitNo && q.unit) {
      const key = `${subjectKey}#${gradeKey}#${chapterNo}#${unitNo}`;
      if (!unitCanon.has(key)) unitCanon.set(key, q.unit);
    }
  }

  let changed = false;
  const next = questions.map((q) => {
    if (q.status !== "ready") return q;
    const subjectKey = normalizeSubjectKey(q.subject);
    const gradeKey = normalizeGradeKey(q.gradeLevel);
    const chapterNo = extractChapterNo(q.chapter);
    if (!subjectKey || !gradeKey || !chapterNo) return q;

    const chapter = chapterCanon.get(`${subjectKey}#${gradeKey}#${chapterNo}`) || q.chapter;
    const unitNo = extractUnitNo(q.unit);
    const unit =
      (unitNo && unitCanon.get(`${subjectKey}#${gradeKey}#${chapterNo}#${unitNo}`)) || q.unit;

    if (chapter === q.chapter && unit === q.unit) return q;
    changed = true;
    return { ...q, chapter, unit };
  });

  return changed ? next : questions;
}
