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
    const line = [label.gradeLevel, label.chapter, label.unit].filter(Boolean).join(" / ");
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

/** Prefer an existing notebook label over a near-synonym the model just invented. */
export function alignAnalysisLabels<T extends { 冊別?: string; 章節?: string; 單元?: string }>(
  result: T,
  existing: CurriculumLabel[]
): T {
  const book = existing.filter((item) => sameBook(item.gradeLevel, result.冊別));
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
      existing.find(
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

/** Keep one chapter/unit name per book + section number across the notebook. */
export function alignQuestionCollection(questions: QuestionItem[]): QuestionItem[] {
  const chapterCanon = new Map<string, string>();
  const unitCanon = new Map<string, string>();
  const ready = questions
    .filter((q) => q.status === "ready")
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt);

  for (const q of ready) {
    const gradeKey = normalizeGradeKey(q.gradeLevel);
    const chapterNo = extractChapterNo(q.chapter);
    if (gradeKey && chapterNo && q.chapter) {
      const key = `${gradeKey}#${chapterNo}`;
      if (!chapterCanon.has(key)) chapterCanon.set(key, q.chapter);
    }
    const unitNo = extractUnitNo(q.unit);
    if (gradeKey && chapterNo && unitNo && q.unit) {
      const key = `${gradeKey}#${chapterNo}#${unitNo}`;
      if (!unitCanon.has(key)) unitCanon.set(key, q.unit);
    }
  }

  let changed = false;
  const next = questions.map((q) => {
    if (q.status !== "ready") return q;
    const gradeKey = normalizeGradeKey(q.gradeLevel);
    const chapterNo = extractChapterNo(q.chapter);
    if (!gradeKey || !chapterNo) return q;

    const chapter = chapterCanon.get(`${gradeKey}#${chapterNo}`) || q.chapter;
    const unitNo = extractUnitNo(q.unit);
    const unit =
      (unitNo && unitCanon.get(`${gradeKey}#${chapterNo}#${unitNo}`)) || q.unit;

    if (chapter === q.chapter && unit === q.unit) return q;
    changed = true;
    return { ...q, chapter, unit };
  });

  return changed ? next : questions;
}
