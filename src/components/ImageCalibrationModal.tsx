import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  X,
  Check,
  RotateCw,
  RotateCcw,
  Undo2,
  Maximize2,
  Crop,
  Grid,
  Eye,
  SlidersHorizontal,
  Sparkles,
  Move,
  CheckCircle2,
  RefreshCw,
  Info,
  ZoomIn,
  ZoomOut,
  AlertCircle,
  Upload,
  ArrowRight,
  ChevronRight,
  CornerDownLeft,
  Wand2,
  ChevronDown,
  SunMedium,
} from "lucide-react";
import {
  Point,
  applyPerspectiveCorrection,
  applyCrop,
  rotateImage,
  normalizeImageSrc,
  compressImage,
  removeShadowsAndBinarize,
  ShadowRemovalMode,
  detectNearWhitePaperCorners,
  FALLBACK_PERSPECTIVE_CORNERS,
} from "../utils/imageUtils";

interface ImageCalibrationModalProps {
  isOpen: boolean;
  imageSrc: string;
  onClose: () => void;
  onConfirm: (processedBase64: string) => void;
  onSkip?: (originalBase64: string) => void;
  title?: string;
  isExistingQuestion?: boolean;
  initialMode?: CalibrationMode;
  onReplaceTargetImage?: (newBase64: string) => void;
}

type CalibrationMode = "perspective" | "crop";
type AspectRatioMode = "free" | "4:3" | "16:9" | "1:1" | "paper";

export const ImageCalibrationModal: React.FC<ImageCalibrationModalProps> = ({
  isOpen,
  imageSrc,
  onClose,
  onConfirm,
  onSkip,
  title = "考卷校正",
  isExistingQuestion = false,
  initialMode = "perspective",
  onReplaceTargetImage,
}) => {
  // Working image state and history
  const [currentImage, setCurrentImage] = useState<string>(normalizeImageSrc(imageSrc));
  const [history, setHistory] = useState<string[]>([]);
  const [mode, setMode] = useState<CalibrationMode>(initialMode || "perspective");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingText, setProcessingText] = useState<string>("正在處理影像...");
  const [naturalDimensions, setNaturalDimensions] = useState<{ width: number; height: number }>({ width: 800, height: 600 });
  const [aspectRatioMode, setAspectRatioMode] = useState<AspectRatioMode>("free");
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({ width: 880, height: 480 });
  const [zoomScale, setZoomScale] = useState<number>(1); // 1 = Fit Viewport
  const [imageLoadError, setImageLoadError] = useState<boolean>(false);
  const [isImageReady, setIsImageReady] = useState<boolean>(false);

  // Track container dimensions to dynamically scale image to fit viewport
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          setContainerSize({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isOpen]);

  // Compute responsive display dimensions so the image always comfortably fills the workspace
  const displayDimensions = useMemo(() => {
    const padX = 4;
    const padY = 4;
    const maxW = Math.max(80, (containerSize.width || 880) - padX);
    const maxH = Math.max(80, (containerSize.height || 420) - padY);

    const natW = naturalDimensions.width || 800;
    const natH = naturalDimensions.height || 600;

    const imgAspect = natW / natH;
    const containerAspect = maxW / maxH;

    let w: number;
    let h: number;

    if (imgAspect > containerAspect) {
      // Wider image: fit width
      w = maxW;
      h = maxW / imgAspect;
    } else {
      // Taller image: fit height
      h = maxH;
      w = maxH * imgAspect;
    }

    w *= zoomScale;
    h *= zoomScale;

    // Keep the box on the image aspect ratio. Independent min-width/min-height
    // (e.g. forcing 120px tall on a wide strip) adds letterbox, and the crop
    // overlay then no longer maps 1:1 onto pixels.
    const minSide = 64;
    const shortest = Math.min(w, h);
    if (shortest > 0 && shortest < minSide) {
      const bump = minSide / shortest;
      w *= bump;
      h *= bump;
    }

    return {
      width: Math.max(1, Math.round(w)),
      height: Math.max(1, Math.round(h)),
    };
  }, [containerSize, naturalDimensions, zoomScale]);

  // Normalized 4 corners for perspective: [TL, TR, BR, BL], values in [0, 1]
  const [corners, setCorners] = useState<[Point, Point, Point, Point]>(
    FALLBACK_PERSPECTIVE_CORNERS
  );

  // Normalized crop rectangle: { x, y, width, height }, values in [0, 1]
  const [cropBox, setCropBox] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 0.08,
    y: 0.08,
    w: 0.84,
    h: 0.84,
  });

  // Dragging states
  const [activeDragCorner, setActiveDragCorner] = useState<number | null>(null);
  const [activeCropHandle, setActiveCropHandle] = useState<string | null>(null);
  const [cropDragStart, setCropDragStart] = useState<{ x: number; y: number; box: typeof cropBox } | null>(null);

  // Loupe magnifier position
  const [loupeInfo, setLoupeInfo] = useState<{ visible: boolean; x: number; y: number; srcX: number; srcY: number } | null>(null);

  // References
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);

  // Initialize or reset when imageSrc or modal opens
  useEffect(() => {
    if (isOpen && imageSrc) {
      const normalized = normalizeImageSrc(imageSrc);
      setCurrentImage(normalized);
      setImageLoadError(false);
      setIsImageReady(false);
      setHistory([]);
      setMode(initialMode || "perspective");
      setZoomScale(1);
      setCorners(FALLBACK_PERSPECTIVE_CORNERS);
      setCropBox({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });

      // Immediate pre-decode test
      const img = new Image();
      if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
        img.crossOrigin = "anonymous";
      }
      img.onload = () => {
        if (img.naturalWidth > 1 && img.naturalHeight > 1) {
          setNaturalDimensions({
            width: img.naturalWidth,
            height: img.naturalHeight,
          });
          setIsImageReady(true);
          setImageLoadError(false);
          try {
            setCorners(detectNearWhitePaperCorners(img));
          } catch {
            setCorners(FALLBACK_PERSPECTIVE_CORNERS);
          }
        }
      };
      img.onerror = () => {
        // Defer to DOM img tag
      };
      img.src = normalized;
    }
  }, [isOpen, imageSrc, initialMode]);

  const applyDetectedPaperCorners = (img: HTMLImageElement | null) => {
    if (!img || !(img.naturalWidth || img.width)) {
      setCorners(FALLBACK_PERSPECTIVE_CORNERS);
      return;
    }
    try {
      setCorners(detectNearWhitePaperCorners(img));
    } catch {
      setCorners(FALLBACK_PERSPECTIVE_CORNERS);
    }
  };

  // Read natural image dimensions on load
  const handleImageLoaded = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth > 1 && img.naturalHeight > 1) {
      setNaturalDimensions({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
      setIsImageReady(true);
      setImageLoadError(false);
      if (mode === "perspective") {
        applyDetectedPaperCorners(img);
      }
    }
  };

  // Push to undo history stack
  const pushHistory = (newImg: string) => {
    setHistory((prev) => [...prev, currentImage]);
    setCurrentImage(newImg);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setCurrentImage(prev);
  };

  const handleResetToOriginal = () => {
    setHistory([]);
    setCurrentImage(imageSrc);
    setCropBox({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
  };

  // Rotate image by +/- 90 degrees
  const handleRotate = async (deg: number) => {
    setIsProcessing(true);
    try {
      const rotated = await rotateImage(currentImage, deg);
      pushHistory(rotated);
      setCropBox({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
      const probe = new Image();
      probe.onload = () => applyDetectedPaperCorners(probe);
      probe.src = rotated;
    } finally {
      setIsProcessing(false);
    }
  };

  // Execute 4-point perspective warp
  const handleApplyPerspective = async () => {
    if (isProcessing || !imgRef.current) return;
    setIsProcessing(true);
    try {
      const natW = imgRef.current.naturalWidth || naturalDimensions.width;
      const natH = imgRef.current.naturalHeight || naturalDimensions.height;
      const realCorners: [Point, Point, Point, Point] = [
        { x: corners[0].x * natW, y: corners[0].y * natH },
        { x: corners[1].x * natW, y: corners[1].y * natH },
        { x: corners[2].x * natW, y: corners[2].y * natH },
        { x: corners[3].x * natW, y: corners[3].y * natH },
      ];

      const corrected = await applyPerspectiveCorrection(currentImage, realCorners);
      pushHistory(corrected);

      // After straightening, default next step to free crop so user can immediately frame the exact question
      setMode("crop");
      setCropBox({ x: 0.04, y: 0.04, w: 0.92, h: 0.92 });
      setCorners([
        { x: 0.05, y: 0.05 },
        { x: 0.95, y: 0.05 },
        { x: 0.95, y: 0.95 },
        { x: 0.05, y: 0.95 },
      ]);
    } catch (err) {
      console.error("Apply perspective failed:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Execute Crop
  const handleApplyCrop = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const cropped = await applyCrop(
        currentImage,
        {
          x: cropBox.x,
          y: cropBox.y,
          width: cropBox.w,
          height: cropBox.h,
        },
        0.92,
        imgRef.current
      );
      pushHistory(cropped);
      setCropBox({ x: 0, y: 0, w: 1, h: 1 });
    } catch (err) {
      console.error("Apply crop failed:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Remove shadows and binarize: pure white background and crisp black text
  const handleRemoveShadows = async (shadowMode: ShadowRemovalMode = "pure_bw") => {
    if (isProcessing) return;
    setIsProcessing(true);
    setProcessingText(
      shadowMode === "pure_bw"
        ? "正在去除陰影，轉為純白底黑字..."
        : shadowMode === "clean_gray"
        ? "正在平整光線，轉換為清爽灰階..."
        : "正在去除陰影並保留彩色筆跡..."
    );
    try {
      const enhanced = await removeShadowsAndBinarize(currentImage, {
        mode: shadowMode,
        contrast: 1.25,
        whiteLevel: 0.88,
        blackLevel: 0.46,
      });
      pushHistory(enhanced);
    } catch (err) {
      console.error("Remove shadows failed:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Render loupe magnifier
  useEffect(() => {
    if (!loupeInfo || !loupeInfo.visible || !loupeCanvasRef.current || !imgRef.current) return;
    const canvas = loupeCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = canvas.width; // 120px
    const zoom = 2.5;
    const radius = size / 2;

    ctx.clearRect(0, 0, size, size);

    // Circular clip
    ctx.save();
    ctx.beginPath();
    ctx.arc(radius, radius, radius - 2, 0, Math.PI * 2);
    ctx.clip();

    // Source image draw zoomed
    const img = imgRef.current;
    const srcX = loupeInfo.srcX * naturalDimensions.width;
    const srcY = loupeInfo.srcY * naturalDimensions.height;

    const sWidth = (size / zoom) * (naturalDimensions.width / img.clientWidth);
    const sHeight = (size / zoom) * (naturalDimensions.height / img.clientHeight);

    ctx.drawImage(
      img,
      srcX - sWidth / 2,
      srcY - sHeight / 2,
      sWidth,
      sHeight,
      0,
      0,
      size,
      size
    );

    // Crosshair lines
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(radius - 12, radius);
    ctx.lineTo(radius + 12, radius);
    ctx.moveTo(radius, radius - 12);
    ctx.lineTo(radius, radius + 12);
    ctx.stroke();

    // Center target dot
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(radius, radius, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Outer border
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(radius, radius, radius - 2, 0, Math.PI * 2);
    ctx.stroke();
  }, [loupeInfo, naturalDimensions]);

  // Pointer position relative to displayed image
  const getNormalizedPos = useCallback((clientX: number, clientY: number) => {
    if (!imgRef.current) return { x: 0.5, y: 0.5 };
    const rect = imgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return { x, y };
  }, []);

  // Corner pointer events for 4-point perspective
  const handleCornerDown = (index: number, e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveDragCorner(index);
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const pos = getNormalizedPos(clientX, clientY);

    setLoupeInfo({
      visible: true,
      x: clientX,
      y: clientY - 80,
      srcX: pos.x,
      srcY: pos.y,
    });
  };

  // Crop handles pointer events
  const handleCropHandleDown = (handle: string, e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveCropHandle(handle);
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const pos = getNormalizedPos(clientX, clientY);
    setCropDragStart({ x: pos.x, y: pos.y, box: { ...cropBox } });
  };

  // Window-level move and up listeners during drag
  useEffect(() => {
    if (activeDragCorner === null && activeCropHandle === null) return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      const pos = getNormalizedPos(clientX, clientY);

      if (activeDragCorner !== null) {
        setCorners((prev) => {
          const next = [...prev] as [Point, Point, Point, Point];
          next[activeDragCorner] = { x: pos.x, y: pos.y };
          return next;
        });

        setLoupeInfo({
          visible: true,
          x: clientX,
          y: clientY - 80,
          srcX: pos.x,
          srcY: pos.y,
        });
      } else if (activeCropHandle !== null && cropDragStart) {
        const dx = pos.x - cropDragStart.x;
        const dy = pos.y - cropDragStart.y;
        const orig = cropDragStart.box;

        if (activeCropHandle === "move") {
          const newX = Math.max(0, Math.min(1 - orig.w, orig.x + dx));
          const newY = Math.max(0, Math.min(1 - orig.h, orig.y + dy));
          setCropBox({ ...orig, x: newX, y: newY });
        } else {
          let newX = orig.x;
          let newY = orig.y;
          let newW = orig.w;
          let newH = orig.h;

          // Resize edges
          if (activeCropHandle.includes("e")) {
            newW = Math.max(0.05, Math.min(1 - orig.x, orig.w + dx));
          }
          if (activeCropHandle.includes("w")) {
            const possibleX = Math.max(0, Math.min(orig.x + orig.w - 0.05, orig.x + dx));
            newW = orig.w + (orig.x - possibleX);
            newX = possibleX;
          }
          if (activeCropHandle.includes("s")) {
            newH = Math.max(0.05, Math.min(1 - orig.y, orig.h + dy));
          }
          if (activeCropHandle.includes("n")) {
            const possibleY = Math.max(0, Math.min(orig.y + orig.h - 0.05, orig.y + dy));
            newH = orig.h + (orig.y - possibleY);
            newY = possibleY;
          }

          // Maintain Aspect Ratio constraint if specified
          if (aspectRatioMode !== "free") {
            let targetRatio = 1;
            if (aspectRatioMode === "4:3") targetRatio = 4 / 3;
            if (aspectRatioMode === "16:9") targetRatio = 16 / 9;
            if (aspectRatioMode === "1:1") targetRatio = 1;
            if (aspectRatioMode === "paper") targetRatio = 1 / 1.414; // A4 / B5 vertical ratio

            const imageRatio = naturalDimensions.width / naturalDimensions.height;
            // newW / newH * imageRatio = targetRatio => newH = (newW * imageRatio) / targetRatio
            newH = Math.max(0.05, Math.min(1 - newY, (newW * imageRatio) / targetRatio));
          }

          setCropBox({ x: newX, y: newY, w: newW, h: newH });
        }
      }
    };

    const handlePointerUp = () => {
      setActiveDragCorner(null);
      setActiveCropHandle(null);
      setCropDragStart(null);
      setLoupeInfo(null);
    };

    window.addEventListener("mousemove", handlePointerMove, { passive: false });
    window.addEventListener("mouseup", handlePointerUp);
    window.addEventListener("touchmove", handlePointerMove, { passive: false });
    window.addEventListener("touchend", handlePointerUp);

    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
      window.removeEventListener("touchmove", handlePointerMove);
      window.removeEventListener("touchend", handlePointerUp);
    };
  }, [activeDragCorner, activeCropHandle, cropDragStart, getNormalizedPos, aspectRatioMode, naturalDimensions]);

  // Global keyboard shortcuts: Enter for Next Step, Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !isProcessing) {
        const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (targetTag !== "input" && targetTag !== "textarea") {
          e.preventDefault();
          onConfirm(currentImage);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, onConfirm, currentImage, isProcessing]);

  if (!isOpen) return null;

  // Render SVG polygon and perspective grid
  const renderPerspectiveSvgOverlay = () => {
    const [p0, p1, p2, p3] = corners;
    const polyPoints = `${p0.x * 100},${p0.y * 100} ${p1.x * 100},${p1.y * 100} ${p2.x * 100},${p2.y * 100} ${p3.x * 100},${p3.y * 100}`;

    // Perspective internal grid lines (3x3 grid)
    const gridLines = [];
    for (let i = 1; i <= 2; i++) {
      const t = i / 3;
      // Horizontal grid line from left edge (p0->p3) to right edge (p1->p2)
      const lx = p0.x + (p3.x - p0.x) * t;
      const ly = p0.y + (p3.y - p0.y) * t;
      const rx = p1.x + (p2.x - p1.x) * t;
      const ry = p1.y + (p2.y - p1.y) * t;
      gridLines.push(
        <line
          key={`h-${i}`}
          x1={`${lx * 100}%`}
          y1={`${ly * 100}%`}
          x2={`${rx * 100}%`}
          y2={`${ry * 100}%`}
          stroke="rgba(56, 189, 248, 0.45)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      );

      // Vertical grid line from top edge (p0->p1) to bottom edge (p3->p2)
      const tx = p0.x + (p1.x - p0.x) * t;
      const ty = p0.y + (p1.y - p0.y) * t;
      const bx = p3.x + (p2.x - p3.x) * t;
      const by = p3.y + (p2.y - p3.y) * t;
      gridLines.push(
        <line
          key={`v-${i}`}
          x1={`${tx * 100}%`}
          y1={`${ty * 100}%`}
          x2={`${bx * 100}%`}
          y2={`${by * 100}%`}
          stroke="rgba(56, 189, 248, 0.45)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      );
    }

    const cornerLabels = ["↖ 左上", "↗ 右上", "↘ 右下", "↙ 左下"];
    const backdropPath = `M 0 0 L 100 0 L 100 100 L 0 100 Z M ${p0.x * 100} ${p0.y * 100} L ${p1.x * 100} ${p1.y * 100} L ${p2.x * 100} ${p2.y * 100} L ${p3.x * 100} ${p3.y * 100} Z`;

    return (
      <div className="absolute inset-0 pointer-events-none">
        <svg className="w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
          {/* Dimmed backdrop outside polygon using robust evenodd cutout */}
          <path d={backdropPath} fill="rgba(15, 23, 42, 0.5)" fillRule="evenodd" />

          {/* Perspective grid lines */}
          {gridLines}

          {/* Quad border */}
          <polygon
            points={polyPoints}
            fill="rgba(14, 165, 233, 0.1)"
            stroke="#38bdf8"
            strokeWidth="1.8"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* 4 Interactive Corner Pins */}
        {corners.map((p, idx) => {
          const isDragging = activeDragCorner === idx;
          return (
            <div
              key={idx}
              onMouseDown={(e) => handleCornerDown(idx, e)}
              onTouchStart={(e) => handleCornerDown(idx, e)}
              style={{
                left: `${p.x * 100}%`,
                top: `${p.y * 100}%`,
                touchAction: "none",
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto cursor-grab active:cursor-grabbing group z-20 w-12 h-12 flex items-center justify-center"
            >
              {/* Target Handle */}
              <div
                className={`w-7 h-7 rounded-full border-2 border-white flex items-center justify-center shadow-lg transition-transform ${
                  isDragging
                    ? "scale-125 bg-red-500 ring-4 ring-red-400/40"
                    : "bg-sky-600 hover:scale-115 hover:bg-sky-500"
                }`}
              >
                <div className="w-2 h-2 rounded-full bg-white" />
              </div>

              {/* Tooltip badge: top corners above pin, bottom corners below pin */}
              <div
                className={`absolute ${
                  idx < 2 ? "-top-7" : "top-8"
                } left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-bold text-white shadow-xs backdrop-blur-xs select-none pointer-events-none transition-opacity ${
                  isDragging ? "bg-red-600 opacity-100" : "bg-slate-900/85 opacity-85 group-hover:opacity-100"
                }`}
              >
                {cornerLabels[idx]}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Render crop box overlay
  const renderCropOverlay = () => {
    const handles = [
      { id: "nw", label: "nw", x: cropBox.x, y: cropBox.y, cursor: "nwse-resize" },
      { id: "ne", label: "ne", x: cropBox.x + cropBox.w, y: cropBox.y, cursor: "nesw-resize" },
      { id: "se", label: "se", x: cropBox.x + cropBox.w, y: cropBox.y + cropBox.h, cursor: "nwse-resize" },
      { id: "sw", label: "sw", x: cropBox.x, y: cropBox.y + cropBox.h, cursor: "nesw-resize" },
      { id: "n", label: "n", x: cropBox.x + cropBox.w / 2, y: cropBox.y, cursor: "ns-resize" },
      { id: "s", label: "s", x: cropBox.x + cropBox.w / 2, y: cropBox.y + cropBox.h, cursor: "ns-resize" },
      { id: "w", label: "w", x: cropBox.x, y: cropBox.y + cropBox.h / 2, cursor: "ew-resize" },
      { id: "e", label: "e", x: cropBox.x + cropBox.w, y: cropBox.y + cropBox.h / 2, cursor: "ew-resize" },
    ];

    const currentCropPixelsW = Math.round(cropBox.w * naturalDimensions.width);
    const currentCropPixelsH = Math.round(cropBox.h * naturalDimensions.height);

    const x1 = cropBox.x * 100;
    const y1 = cropBox.y * 100;
    const x2 = (cropBox.x + cropBox.w) * 100;
    const y2 = (cropBox.y + cropBox.h) * 100;
    const cropBackdropPath = `M 0 0 L 100 0 L 100 100 L 0 100 Z M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2} L ${x1} ${y2} Z`;

    return (
      <div className="absolute inset-0 pointer-events-none">
        <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {/* Dark shaded backdrop outside crop box using robust evenodd cutout */}
          <path d={cropBackdropPath} fill="rgba(15, 23, 42, 0.5)" fillRule="evenodd" />
        </svg>

        {/* The Crop Box itself */}
        <div
          onMouseDown={(e) => handleCropHandleDown("move", e)}
          onTouchStart={(e) => handleCropHandleDown("move", e)}
          style={{
            left: `${cropBox.x * 100}%`,
            top: `${cropBox.y * 100}%`,
            width: `${cropBox.w * 100}%`,
            height: `${cropBox.h * 100}%`,
            touchAction: "none",
          }}
          className="absolute border-2 border-emerald-400 bg-emerald-500/10 pointer-events-auto cursor-move select-none shadow-sm z-10"
        >
          {/* 3x3 Rule-of-thirds alignment grid inside crop box */}
          <div className="w-full h-full grid grid-cols-3 grid-rows-3 pointer-events-none">
            <div className="border-r border-b border-emerald-400/30" />
            <div className="border-r border-b border-emerald-400/30" />
            <div className="border-b border-emerald-400/30" />
            <div className="border-r border-b border-emerald-400/30" />
            <div className="border-r border-b border-emerald-400/30" />
            <div className="border-b border-emerald-400/30" />
            <div className="border-r border-emerald-400/30" />
            <div className="border-r border-emerald-400/30" />
            <div />
          </div>

          {/* Dimension badge */}
          <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md bg-slate-900/85 text-emerald-300 font-mono text-[10px] whitespace-nowrap pointer-events-none backdrop-blur-xs flex items-center gap-1">
            <Crop className="w-3 h-3" />
            {currentCropPixelsW} × {currentCropPixelsH} px
          </div>
        </div>

        {/* 8 Resize Handles */}
        {handles.map((h) => (
          <div
            key={h.id}
            onMouseDown={(e) => handleCropHandleDown(h.id, e)}
            onTouchStart={(e) => handleCropHandleDown(h.id, e)}
            style={{
              left: `${h.x * 100}%`,
              top: `${h.y * 100}%`,
              cursor: h.cursor,
              touchAction: "none",
            }}
            className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto z-20 group w-11 h-11 flex items-center justify-center"
          >
            <div
              className={`w-3.5 h-3.5 rounded-sm bg-white border-2 border-emerald-600 shadow-md group-hover:scale-130 transition-transform ${
                activeCropHandle === h.id ? "scale-140 bg-emerald-500 border-white ring-2 ring-emerald-300" : ""
              }`}
            />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="app-screen-overlay app-screen-overlay-photo bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="app-screen-sheet bg-white rounded-none sm:rounded-2xl shadow-2xl max-w-5xl h-full sm:h-[min(860px,100%)] sm:max-h-[860px] sm:self-center border-0 sm:border border-slate-200">
        {/* Modal Header */}
        <div className="px-2.5 sm:px-5 py-2 sm:py-3 border-b border-slate-200 flex items-center justify-between bg-white shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="hidden sm:flex w-8 h-8 rounded-xl bg-sky-600 text-white items-center justify-center shadow-xs shrink-0">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-sm sm:text-base leading-tight truncate">
                  {title}
                </h3>
                <span className="hidden lg:inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-50 text-sky-700 border border-sky-200/60">
                  按 Enter 快速進入下一步
                </span>
              </div>
              <p className="text-[11px] text-slate-500 hidden md:block truncate">
                支援四點透視拉正斜拍試卷，並自由框選裁切精準保留題目內容
              </p>
            </div>
          </div>

          {/* Mode Switcher Tabs as Steps */}
          <div className="hidden md:flex items-center gap-1 bg-slate-100 p-1 rounded-xl shrink-0">
            <button
              type="button"
              onClick={() => setMode("perspective")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                mode === "perspective"
                  ? "bg-white text-sky-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Maximize2 className="w-3.5 h-3.5 text-sky-600" />
              <span>步驟 1：透視拉正</span>
            </button>
            <button
              type="button"
              onClick={() => setMode("crop")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                mode === "crop"
                  ? "bg-white text-emerald-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Crop className="w-3.5 h-3.5 text-emerald-600" />
              <span>步驟 2：框選裁切</span>
            </button>
          </div>

          {/* Top Bar Action Buttons (ALWAYS visible at the very top on PC screens) */}
          <div className="flex items-center gap-2 shrink-0">
            {onSkip && !isExistingQuestion && (
              <button
                type="button"
                onClick={() => onSkip(imageSrc)}
                disabled={isProcessing}
                className="inline-flex px-2 sm:px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition"
                title="跳過校正，直接送出原圖進行 AI 辨識"
              >
                略過校正
              </button>
            )}

            <button
              id="top-header-next-step-btn"
              type="button"
              onClick={() => onConfirm(currentImage)}
              disabled={isProcessing}
              className="hidden sm:inline-flex px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs font-extrabold text-white bg-sky-600 hover:bg-sky-500 active:scale-95 transition shadow-sm items-center gap-1.5"
              title="完成校正並進行下一步"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <span>{isExistingQuestion ? "下一步：儲存截圖" : "下一步：AI 分析"}</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
              title="關閉視窗"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Secondary Tool Bar */}
        <div className="px-2 sm:px-5 py-1.5 sm:py-2.5 bg-white border-b border-slate-100 flex items-center gap-1.5 sm:gap-3 text-xs shrink-0 overflow-x-auto">
          {/* Left: Mode-specific tips or aspect ratio buttons */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {mode === "perspective" ? (
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className="hidden sm:inline-flex items-center gap-1 text-sky-700 bg-sky-50 px-2 py-1 rounded-md font-medium text-[11px]">
                  <Info className="w-3.5 h-3.5" />
                  拖曳四角圓點對齊考卷近白色紙角（開啟時會自動偵測），即可將歪斜拍照展平
                </span>
                <button
                  type="button"
                  onClick={() => applyDetectedPaperCorners(imgRef.current)}
                  className="px-2 py-1 text-slate-600 hover:bg-slate-100 rounded border border-slate-200 text-[11px] transition whitespace-nowrap"
                >
                  對齊紙角
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1 sm:gap-1.5 flex-nowrap">
                <span className="hidden sm:inline text-slate-500 font-medium mr-1 text-[11px]">裁切比例：</span>
                {(
                  [
                    { id: "free", label: "自由" },
                    { id: "4:3", label: "4:3" },
                    { id: "16:9", label: "16:9" },
                    { id: "1:1", label: "1:1" },
                    { id: "paper", label: "A4/B5 考卷" },
                  ] as const
                ).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setAspectRatioMode(r.id)}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                      aspectRatioMode === r.id
                        ? "bg-emerald-600 text-white font-bold shadow-2xs"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCropBox({ x: 0, y: 0, w: 1, h: 1 })}
                  className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 whitespace-nowrap"
                  title="裁切框貼齊照片四邊"
                >
                  貼齊邊緣
                </button>
              </div>
            )}
          </div>

          {/* Right: Shadow Removal, Zoom, Rotate and Undo Tools */}
          <div className="flex items-center gap-1 sm:gap-1.5 ml-auto shrink-0">
            {/* Shadow Removal / Paper Whitening Quick Actions */}
            <div className="flex items-center gap-0.5 bg-amber-50/90 p-0.5 rounded-lg border border-amber-200 shadow-2xs">
              <button
                type="button"
                onClick={() => handleRemoveShadows("pure_bw")}
                disabled={isProcessing}
                className="px-2 sm:px-2.5 py-1 rounded-md text-[11px] font-bold text-amber-950 bg-amber-200/80 hover:bg-amber-300 active:scale-95 transition flex items-center gap-1 sm:gap-1.5 cursor-pointer whitespace-nowrap"
                title="去除所有陰影、黃光與暗角，將紙張底色轉為 100% 純白，文字強化為深黑"
              >
                <Wand2 className="w-3.5 h-3.5 text-amber-700" />
                <span className="sm:hidden">去陰影</span>
                <span className="hidden sm:inline">去除陰影 (純白底黑字)</span>
              </button>

              <div className="relative group">
                <button
                  type="button"
                  className="p-1 rounded-md text-amber-800 hover:bg-amber-200/70 transition text-[11px]"
                  title="選擇更多去陰影模式"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                <div className="absolute right-0 top-full mt-1 hidden group-hover:flex flex-col bg-white rounded-xl shadow-xl border border-slate-200 py-1 w-44 z-50 animate-in fade-in">
                  <button
                    type="button"
                    onClick={() => handleRemoveShadows("pure_bw")}
                    className="px-3 py-1.5 text-left text-xs font-semibold text-slate-800 hover:bg-amber-50 flex items-center gap-2"
                  >
                    <span className="w-2 h-2 rounded-full bg-slate-950" />
                    純白底黑字 (強烈推薦)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveShadows("clean_gray")}
                    className="px-3 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                  >
                    <span className="w-2 h-2 rounded-full bg-slate-400" />
                    清爽灰階 (保留筆觸)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveShadows("clean_color")}
                    className="px-3 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                  >
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    彩色去陰影 (保留紅筆)
                  </button>
                </div>
              </div>
            </div>

            <div className="w-px h-4 bg-slate-200 mx-0.5 hidden sm:block" />

            {/* Zoom Controls */}
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => setZoomScale((z) => Math.max(0.6, Math.round((z - 0.2) * 10) / 10))}
                disabled={zoomScale <= 0.6 || isProcessing}
                className="p-1 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition disabled:opacity-30"
                title="縮小檢視"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoomScale(1)}
                className="px-1.5 py-0.5 text-[11px] font-bold text-slate-700 hover:text-slate-900 hover:bg-white rounded transition"
                title="最適化全覽 (Fit to Window)"
              >
                {Math.round(zoomScale * 100)}%
              </button>
              <button
                type="button"
                onClick={() => setZoomScale((z) => Math.min(2.5, Math.round((z + 0.2) * 10) / 10))}
                disabled={zoomScale >= 2.5 || isProcessing}
                className="p-1 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition disabled:opacity-30"
                title="放大檢視"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="w-px h-4 bg-slate-200 mx-0.5" />

            <button
              type="button"
              onClick={() => handleRotate(-90)}
              disabled={isProcessing}
              className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 border border-slate-200 transition"
              title="逆時針旋轉 90°"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleRotate(90)}
              disabled={isProcessing}
              className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 border border-slate-200 transition"
              title="順時針旋轉 90°"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-4 bg-slate-200 mx-1" />
            <button
              type="button"
              onClick={handleUndo}
              disabled={history.length === 0 || isProcessing}
              className="px-2 py-1 rounded-lg text-slate-600 hover:bg-slate-100 border border-slate-200 transition disabled:opacity-40 flex items-center gap-1"
              title="復原上一步"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">復原</span>
            </button>
            <button
              type="button"
              onClick={handleResetToOriginal}
              disabled={history.length === 0 || isProcessing}
              className="px-2 py-1 rounded-lg text-slate-600 hover:bg-slate-100 border border-slate-200 transition disabled:opacity-40 flex items-center gap-1"
              title="重置回原圖"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">重置</span>
            </button>
          </div>
        </div>

        {/* Interactive Workspace Area */}
        <div
          ref={containerRef}
          className="relative flex-1 bg-slate-900 flex items-center justify-center px-9 py-8 sm:p-6 overflow-hidden select-none min-h-0"
        >
          {/* Working Image and Interactive Overlay */}
          <div
            style={{
              width: `${displayDimensions.width}px`,
              height: `${displayDimensions.height}px`,
            }}
            className="relative shrink-0 shadow-2xl rounded-none sm:rounded-lg overflow-visible bg-white sm:border border-slate-700/60"
          >
            {imageLoadError ? (
              <div className="w-full h-full min-h-[260px] flex flex-col items-center justify-center p-6 text-center text-slate-700 bg-slate-50 rounded-lg">
                <AlertCircle className="w-10 h-10 text-amber-500 mb-2" />
                <div className="font-bold text-slate-900 text-sm">考卷圖片暫時無法讀取</div>
                <div className="text-xs text-slate-500 max-w-xs mt-1 mb-4">
                  此題圖片暫存可能已清空或格式需要更新，您可以直接重新選取或上傳考卷相片。
                </div>
                <label className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg cursor-pointer transition shadow-sm flex items-center gap-1.5 active:scale-95">
                  <Upload className="w-3.5 h-3.5" />
                  <span>重新選取考卷圖片</span>
                  <input
                    type="file"
                    accept="image/*,.heic,.heif,image/heic,image/heif"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const compressed = await compressImage(file);
                        setCurrentImage(compressed);
                        setImageLoadError(false);
                        setIsImageReady(true);
                        onReplaceTargetImage?.(compressed);
                      } catch (err) {
                        console.error("Replace image error:", err);
                      } finally {
                        e.target.value = "";
                      }
                    }}
                  />
                </label>
              </div>
            ) : (
              <>
                <img
                  ref={imgRef}
                  src={normalizeImageSrc(currentImage)}
                  alt="待校正考題"
                  onLoad={handleImageLoaded}
                  onError={() => setImageLoadError(true)}
                  className="w-full h-full object-fill rounded-lg pointer-events-none block select-none bg-white"
                />

                {/* Render Perspective Overlay or Crop Overlay */}
                {mode === "perspective" ? renderPerspectiveSvgOverlay() : renderCropOverlay()}
              </>
            )}
          </div>

          {/* Floating Magnifier Loupe during handle drag */}
          {loupeInfo && loupeInfo.visible && (
            <div
              style={{
                left: `${loupeInfo.x}px`,
                top: `${loupeInfo.y}px`,
              }}
              className="fixed -translate-x-1/2 -translate-y-1/2 pointer-events-none z-50 rounded-full shadow-2xl overflow-hidden ring-3 ring-sky-500 bg-slate-950"
            >
              <canvas
                ref={loupeCanvasRef}
                width={120}
                height={120}
                className="rounded-full block"
              />
              <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-mono font-bold text-white bg-black/60 px-1.5 py-0.2 rounded-full">
                2.5×
              </div>
            </div>
          )}

          {/* Processing Spinner Overlay */}
          {isProcessing && (
            <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-xs flex flex-col items-center justify-center text-white z-40">
              <RefreshCw className="w-8 h-8 animate-spin text-sky-400 mb-2" />
              <div className="text-sm font-bold">{processingText}</div>
            </div>
          )}
        </div>

        {/* Modal Footer / Action Bar */}
        <div className="app-safe-footer px-2 sm:px-6 pt-2 sm:pt-3 bg-slate-50 border-t border-slate-200 flex flex-row items-center justify-between gap-1.5 sm:gap-3 shrink-0 z-10">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1 sm:flex-none sm:w-auto">
            {/* Mode Actions & Step progression */}
            {mode === "perspective" ? (
              <>
                <button
                  type="button"
                  onClick={handleApplyPerspective}
                  disabled={isProcessing}
                  className="flex-1 sm:flex-none px-2.5 sm:px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 active:scale-95 transition shadow-xs flex items-center justify-center gap-1 sm:gap-1.5 disabled:opacity-50"
                  title="執行四點透視展平"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span className="sm:hidden">套用拉正</span>
                  <span className="hidden sm:inline">套用透視拉正</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("crop")}
                  className="px-2.5 sm:px-3.5 py-2 rounded-xl text-xs font-semibold text-sky-800 bg-sky-50 hover:bg-sky-100 active:scale-95 transition border border-sky-200/80 flex items-center gap-1"
                  title="切換至步驟 2 框選題目"
                >
                  <Crop className="w-3.5 h-3.5 text-sky-600" />
                  框選裁切
                  <ChevronRight className="w-3.5 h-3.5 hidden sm:block" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleApplyCrop}
                  disabled={isProcessing}
                  className="flex-1 sm:flex-none px-2.5 sm:px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-95 transition shadow-xs flex items-center justify-center gap-1 sm:gap-1.5 disabled:opacity-50"
                  title="裁切保留所選區域"
                >
                  <Crop className="w-3.5 h-3.5" />
                  <span className="sm:hidden">套用裁切</span>
                  <span className="hidden sm:inline">套用框選裁切</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("perspective")}
                  className="px-2 sm:px-3 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-200/70 active:scale-95 transition flex items-center gap-1"
                  title="回到步驟 1 透視拉正"
                >
                  ← 拉正
                </button>
              </>
            )}

            {history.length > 0 && (
              <span className="text-[11px] text-slate-500 font-medium hidden md:inline ml-1">
                已套用 {history.length} 次變換
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {isExistingQuestion && (
              <button
                type="button"
                onClick={onClose}
                disabled={isProcessing}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200/80 transition"
              >
                取消
              </button>
            )}

            <button
              id="bottom-footer-next-step-btn"
              type="button"
              onClick={() => onConfirm(currentImage)}
              disabled={isProcessing}
              className="sm:hidden px-3 py-2 rounded-xl text-xs font-extrabold text-white bg-slate-900 hover:bg-slate-800 active:scale-95 transition shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>{isExistingQuestion ? "儲存" : "開始分析"}</span>
              <ArrowRight className="w-3.5 h-3.5 text-sky-400" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
