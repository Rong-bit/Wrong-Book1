import { QuestionItem } from "../types";

// Generate clean Canvas-based or base64 SVG sample question image clippings
function createSampleImage(title: string, problem: string, diagramSvg: string = ""): string {
  if (typeof document !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 680;
      canvas.height = 280;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        // Base exam paper clipping background
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 680, 280);

        // Grid pattern
        ctx.strokeStyle = "#f1f5f9";
        ctx.lineWidth = 1;
        for (let x = 15; x < 680; x += 20) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, 280);
          ctx.stroke();
        }
        for (let y = 15; y < 280; y += 20) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(680, y);
          ctx.stroke();
        }

        // Dashed border
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(6, 6, 668, 268);
        ctx.setLineDash([]);

        // Badge
        ctx.fillStyle = title.includes("數學") ? "#0284c7" : "#0d9488";
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(20, 20, 84, 28, 5);
        } else {
          ctx.rect(20, 20, 84, 28);
        }
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 13px -apple-system, BlinkMacSystemFont, 'Noto Sans TC', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(title, 62, 34);

        // Problem text
        ctx.fillStyle = "#0f172a";
        ctx.font = "bold 15px -apple-system, BlinkMacSystemFont, 'Noto Sans TC', sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(problem, 20, 80);

        // Inner Card for diagram / options
        ctx.fillStyle = "#f8fafc";
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(20, 100, 640, 136, 6);
        } else {
          ctx.rect(20, 100, 640, 136);
        }
        ctx.fill();
        ctx.stroke();

        if (title.includes("數學")) {
          // Math choices
          ctx.font = "14px -apple-system, BlinkMacSystemFont, sans-serif";
          ctx.fillStyle = "#334155";
          ctx.fillText("(A) k > 4 或 k < -1", 40, 140);
          ctx.fillText("(B) -1 < k < 4", 40, 180);
          ctx.fillText("(C) k > 3 或 k < -2", 240, 140);
          ctx.fillText("(D) -2 < k < 3", 240, 180);

          // Focus box
          ctx.fillStyle = "#fef2f2";
          ctx.strokeStyle = "#fecaca";
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(440, 120, 200, 76, 6);
          } else {
            ctx.rect(440, 120, 200, 76);
          }
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = "#dc2626";
          ctx.font = "bold 13px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("【考點：判別式 D > 0】", 540, 150);
          ctx.font = "12px sans-serif";
          ctx.fillStyle = "#991b1b";
          ctx.fillText("b² - 4ac > 0", 540, 175);
        } else {
          // Physics
          ctx.strokeStyle = "#475569";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(40, 190);
          ctx.lineTo(260, 190);
          ctx.stroke();

          // Block
          ctx.fillStyle = "#38bdf8";
          ctx.strokeStyle = "#0284c7";
          ctx.lineWidth = 2;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(80, 145, 60, 42, 4);
          } else {
            ctx.rect(80, 145, 60, 42);
          }
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = "#0f172a";
          ctx.font = "bold 13px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("2 kg", 110, 171);

          // Force arrow
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(145, 166);
          ctx.lineTo(215, 166);
          ctx.stroke();

          ctx.fillStyle = "#ef4444";
          ctx.beginPath();
          ctx.moveTo(215, 161);
          ctx.lineTo(225, 166);
          ctx.lineTo(215, 171);
          ctx.fill();

          ctx.font = "bold 12px sans-serif";
          ctx.fillText("F = 10 N →", 185, 155);

          // Options
          ctx.textAlign = "left";
          ctx.font = "14px sans-serif";
          ctx.fillStyle = "#334155";
          ctx.fillText("(A) 100 J", 320, 145);
          ctx.fillText("(B) 200 J", 320, 180);
          ctx.fillText("(C) 400 J", 450, 145);
          ctx.fillText("(D) 800 J", 450, 180);
        }

        // Footer
        ctx.textAlign = "right";
        ctx.font = "11px monospace";
        ctx.fillStyle = "#94a3b8";
        ctx.fillText("考卷拍照截圖 (支援四點拉正校正與裁切)", 656, 258);

        return canvas.toDataURL("image/png");
      }
    } catch (e) {
      console.warn("Canvas sample question generation fallback:", e);
    }
  }

  // Fallback to UTF-8 base64 SVG
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="260" viewBox="0 0 600 260">
    <rect width="600" height="260" fill="#ffffff" rx="8"/>
    <rect x="1" y="1" width="598" height="258" fill="none" stroke="#cbd5e1" stroke-width="1.5" stroke-dasharray="4 4" rx="8"/>
    <rect x="20" y="20" width="80" height="26" rx="4" fill="#0284c7" />
    <text x="60" y="37" font-family="sans-serif" font-size="13" font-weight="bold" fill="#ffffff" text-anchor="middle">${title}</text>
    <text x="20" y="75" font-family="sans-serif" font-size="16" font-weight="600" fill="#0f172a">${problem}</text>
    ${diagramSvg}
    <text x="580" y="245" font-family="monospace" font-size="11" fill="#94a3b8" text-anchor="end">考卷截圖擷取 (Ctrl+V / 拍照)</text>
  </svg>`;
  try {
    const encoded =
      typeof window !== "undefined" && window.btoa
        ? window.btoa(
            encodeURIComponent(svg).replace(/%([0-9A-F]{2})/g, (_, p1) =>
              String.fromCharCode(parseInt(p1, 16))
            )
          )
        : Buffer.from(svg).toString("base64");
    return `data:image/svg+xml;base64,${encoded}`;
  } catch {
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }
}

export const initialSampleQuestions: QuestionItem[] = [
  {
    id: "sample-1",
    imageBase64: createSampleImage(
      "數學考題",
      "若方程式 x² - 2(k - 1)x + (k + 5) = 0 有兩相異實根，求實數 k 的範圍？",
      `<g transform="translate(20, 100)">
        <rect x="0" y="0" width="560" height="110" fill="#f8fafc" rx="6" stroke="#e2e8f0" stroke-width="1"/>
        <text x="20" y="30" font-family="sans-serif" font-size="14" fill="#334155">(A) k &gt; 4 或 k &lt; -1</text>
        <text x="20" y="55" font-family="sans-serif" font-size="14" fill="#334155">(B) -1 &lt; k &lt; 4</text>
        <text x="200" y="30" font-family="sans-serif" font-size="14" fill="#334155">(C) k &gt; 3 或 k &lt; -2</text>
        <text x="200" y="55" font-family="sans-serif" font-size="14" fill="#334155">(D) -2 &lt; k &lt; 3</text>
        <text x="380" y="45" font-family="sans-serif" font-size="13" font-weight="bold" fill="#dc2626">【考點：判別式 D &gt; 0】</text>
      </g>`
    ),
    imageSettings: {
      zoom: 100,
      rotation: 0,
      align: "center",
      includeInExport: true,
    },
    subject: "數學",
    gradeLevel: "國三上 (第5冊)",
    chapter: "第1章 一元二次方程式",
    unit: "1-3 一元二次方程式的解與判別式",
    questionText: "若關於 $x$ 的一元二次方程式 $x^2 - 2(k - 1)x + (k + 5) = 0$ 有兩相異實根，則實數 $k$ 的取值範圍為何？\n(A) $k > 4$ 或 $k < -1$\n(B) $-1 < k < 4$\n(C) $k > 3$ 或 $k < -2$\n(D) $-2 < k < 3$",
    questionType: "單選題",
    answer: "(A) $k > 4$ 或 $k < -1$",
    coreConcepts: "一元二次方程式 $ax^2 + bx + c = 0$ 擁有兩相異實數根的充要條件為判別式 $\\Delta = b^2 - 4ac > 0$。",
    commonPitfalls: "常犯錯誤：\n1. 將判別式算式中的一次項係數誤代為 $-(k-1)$ 忘記平方或漏乘 $4ac$。\n2. 解二次不等式 $(k-4)(k+1) > 0$ 時，混淆不等號方向，誤寫成介於兩根之間 $-1 < k < 4$。",
    explanation: "1. 由題意，二次項係數 $a = 1$，一次項係數 $b = -2(k - 1)$，常數項 $c = k + 5$。\n2. 方程式有兩相異實根，故判別式 $\\Delta > 0$：\n   $$\\Delta = [-2(k - 1)]^2 - 4(1)(k + 5) > 0$$\n   $$4(k^2 - 2k + 1) - 4(k + 5) > 0$$\n3. 兩邊同除以 4：\n   $$k^2 - 2k + 1 - k - 5 > 0$$\n   $$k^2 - 3k - 4 > 0$$\n4. 因式分解得：\n   $$(k - 4)(k + 1) > 0$$\n5. 解此不等式得 $k > 4$ 或 $k < -1$。\n故正確答案選 (A)。",
    tips: "化簡時善用「兩邊同除以 4」簡化計算，避免大數相乘；開口向上二次式大於零取兩外側（比大者大、比小者小）。",
    difficulty: "中等",
    myNotes: "第一次段考第 7 題粗心算錯。下次遇到有相異實根，立刻在題卷空白寫下 $\\Delta > 0$ 再動筆！",
    createdAt: Date.now() - 3600000 * 5,
    status: "ready",
  },
  {
    id: "sample-2",
    imageBase64: createSampleImage(
      "物理考題",
      "一質量 m = 2 kg 的木塊置於光滑水平面上，受水平力 F = 10 N 推動，求 4 秒末動能？",
      `<g transform="translate(20, 100)">
        <rect x="0" y="0" width="560" height="110" fill="#f8fafc" rx="6" stroke="#e2e8f0" stroke-width="1"/>
        <!-- Physics diagram -->
        <line x1="40" y1="80" x2="300" y2="80" stroke="#475569" stroke-width="3"/>
        <rect x="100" y="40" width="60" height="40" fill="#38bdf8" stroke="#0284c7" stroke-width="2" rx="4"/>
        <text x="130" y="65" font-family="sans-serif" font-size="14" font-weight="bold" fill="#0f172a" text-anchor="middle">2 kg</text>
        <line x1="160" y1="60" x2="230" y2="60" stroke="#ef4444" stroke-width="3" marker-end="url(#arrow)"/>
        <text x="195" y="50" font-family="sans-serif" font-size="13" font-weight="bold" fill="#ef4444">F = 10 N →</text>
        <text x="350" y="45" font-family="sans-serif" font-size="14" fill="#334155">(A) 100 J</text>
        <text x="350" y="70" font-family="sans-serif" font-size="14" fill="#334155">(B) 200 J</text>
        <text x="440" y="45" font-family="sans-serif" font-size="14" fill="#334155">(C) 400 J</text>
        <text x="440" y="70" font-family="sans-serif" font-size="14" fill="#334155">(D) 800 J</text>
      </g>`
    ),
    imageSettings: {
      zoom: 100,
      rotation: 0,
      align: "center",
      includeInExport: true,
    },
    subject: "物理",
    gradeLevel: "高一 (必修物理)",
    chapter: "第3章 物體的運動與受力",
    unit: "3-2 牛頓運動定律與動能定理",
    questionText: "一質量為 $m = 2\\text{ kg}$ 的木塊靜止置於光滑水平桌面上，受到一恆定水平拉力 $F = 10\\text{ N}$ 持續作用，不計空氣阻力與接觸面摩擦。試問作用 $4$ 秒末時，該木塊的動能 ($E_k$) 為多少焦耳 (J)？\n(A) 100 J\n(B) 200 J\n(C) 400 J\n(D) 800 J",
    questionType: "計算選擇題",
    answer: "(C) 400 J",
    coreConcepts: "牛頓第二運動定律 $a = \\frac{F}{m}$；等加速度運動速度公式 $v = v_0 + at$；動能公式 $E_k = \\frac{1}{2}mv^2$（或功能定理 $W = F \\cdot s = \\Delta E_k$）。",
    commonPitfalls: "1. 誤將衝量 $J = F \\cdot \\Delta t = 40\\text{ N}\\cdot\\text{s}$ 當作動能。\n2. 動能 $E_k = \\frac{1}{2}mv^2$ 忘記乘以 $\\frac{1}{2}$ 或忘記將速度平方。",
    explanation: "【解法一：牛頓定律與運動學】\n1. 由加速度公式：\n   $$a = \\frac{F}{m} = \\frac{10}{2} = 5\\text{ (m/s}^2)$$ \n2. 木塊初速 $v_0 = 0$，作用 4 秒末速度：\n   $$v = v_0 + at = 0 + 5 \\times 4 = 20\\text{ (m/s)}$$\n3. 4 秒末木塊動能：\n   $$E_k = \\frac{1}{2}mv^2 = \\frac{1}{2} \\times 2 \\times (20)^2 = 400\\text{ (J)}$$\n\n【解法二：功能定理（秒解）】\n物體在 4 秒內的位移：\n$$s = \\frac{1}{2}at^2 = \\frac{1}{2} \\times 5 \\times 4^2 = 40\\text{ (m)}$$\n外力作功：\n$$W = F \\times s = 10 \\times 40 = 400\\text{ (J)} = \\Delta E_k$$\n故正確選項為 (C)。",
    tips: "考場上建議雙解法互相驗證：$F \\cdot t$ 給出動量 $p = 40$，則 $E_k = \\frac{p^2}{2m} = \\frac{1600}{4} = 400\\text{ J}$，最快且不易出錯！",
    difficulty: "中等",
    myNotes: "熟記 $E_k = \\frac{p^2}{2m}$ 轉換公式！",
    createdAt: Date.now() - 3600000 * 2,
    status: "ready",
  },
];
