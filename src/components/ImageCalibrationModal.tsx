import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
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
  Plus,
  Eraser,
  Trash2,
  Paintbrush,
} from "lucide-react";

/** Mobile: aim above the finger so the red loupe crosshair is the true drop point. */
const TOUCH_AIM_OFFSET_Y = 72;
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
  FULL_FRAME_CORNERS,
  cropBoxFromCorners,
  paintWhiteBrushOnImage,
  clusterPaintStrokesToRects,
  unionCropRects,
  applyMultiRegionCrop,
  detectTextBlockAtPoint,
  CropRect,
} from "../utils/imageUtils";
import { removeHandwritingWithAI } from "../services/aiService";

interface ImageCalibrationModalProps {
  isOpen: boolean;
  imageSrc: string;
  onClose: () => void;
  onConfirm: (processedImages: string[]) => void;
  onSkip?: (originalBase64: string) => void;
  title?: string;
  isExistingQuestion?: boolean;
  initialMode?: CalibrationMode;
  onReplaceTargetImage?: (newBase64: string) => void;
}

type CalibrationMode = "perspective" | "crop";
/** paint = 點文字框選／拖曳拉框；frame = 矩形微調；erase = 塗白手寫 */
type CropTool = "paint" | "frame" | "erase";
type AspectRatioMode = "free" | "4:3" | "16:9" | "1:1" | "paper";
type BrushSizeKey = "s" | "m" | "l";

const BRUSH_RADIUS_NORM: Record<BrushSizeKey, number> = {
  s: 0.012,
  m: 0.022,
  l: 0.038,
};

/** Drag farther than this (normalized) → rubber-band box; else tap-to-box text. */
const TAP_DRAG_THRESHOLD = 0.018;


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
  const [pendingCrops, setPendingCrops] = useState<string[]>([]);
  const [cropTool, setCropTool] = useState<CropTool>("paint");
  const [brushSize, setBrushSize] = useState<BrushSizeKey>("m");
  const [eraseStrokePoints, setEraseStrokePoints] = useState<Point[] | null>(null);
  const [isErasing, setIsErasing] = useState(false);
  const [isErasingBusy, setIsErasingBusy] = useState(false);
  const [selectRegions, setSelectRegions] = useState<CropRect[]>([]);
  /** Rubber-band box while dragging (like selecting text). */
  const [dragSelectRect, setDragSelectRect] = useState<CropRect | null>(null);
  const [isSelectPainting, setIsSelectPainting] = useState(false);
  const eraseStrokeRef = useRef<Point[] | null>(null);
  const selectDragStartRef = useRef<Point | null>(null);
  const selectRegionsRef = useRef<CropRect[]>([]);
  const cropDirtyAfterAddRef = useRef(false);
  const currentImageRef = useRef(currentImage);
  const brushSizeRef = useRef(brushSize);
  currentImageRef.current = currentImage;
  brushSizeRef.current = brushSize;
  selectRegionsRef.current = selectRegions;

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
    // Leave room for the 44px crop handles so left/right pins stay on-screen.
    const handleGutter = 44;
    const maxW = Math.max(80, (containerSize.width || 880) - handleGutter);
    const maxH = Math.max(80, (containerSize.height || 420) - handleGutter);

    const natW = naturalDimensions.width || 800;
    const natH = naturalDimensions.height || 600;

    const imgAspect = natW / natH;
    const containerAspect = maxW / maxH;

    let w: number;
    let h: number;

    if (imgAspect > containerAspect) {
      w = maxW;
      h = maxW / imgAspect;
    } else {
      h = maxH;
      w = maxH * imgAspect;
    }

    w *= zoomScale;
    h *= zoomScale;

    const minSide = 64;
    const shortest = Math.min(w, h);
    if (shortest > 0 && shortest < minSide) {
      const bump = minSide / shortest;
      const bumpedW = w * bump;
      const bumpedH = h * bump;
      if (bumpedW <= maxW * Math.max(1, zoomScale) && bumpedH <= maxH * Math.max(1, zoomScale)) {
        w = bumpedW;
        h = bumpedH;
      }
    }

    if (w > maxW * Math.max(1, zoomScale) || h > maxH * Math.max(1, zoomScale)) {
      const fit = Math.min(
        (maxW * Math.max(1, zoomScale)) / w,
        (maxH * Math.max(1, zoomScale)) / h
      );
      w *= fit;
      h *= fit;
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
  const [cropBox, setCropBox] = useState<{ x: number; y: number; w: number; h: number }>(
    cropBoxFromCorners(FALLBACK_PERSPECTIVE_CORNERS)
  );

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
      setCropBox(cropBoxFromCorners(FALLBACK_PERSPECTIVE_CORNERS));
      setPendingCrops([]);
      setCropTool("paint");
      setBrushSize("m");
      setEraseStrokePoints(null);
      setIsErasing(false);
      setIsErasingBusy(false);
      eraseStrokeRef.current = null;
      setSelectRegions([]);
      selectRegionsRef.current = [];
      setDragSelectRect(null);
      selectDragStartRef.current = null;
      setIsSelectPainting(false);
      cropDirtyAfterAddRef.current = false;

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
            const detected = detectNearWhitePaperCorners(img);
            setCorners(detected);
            setCropBox(cropBoxFromCorners(detected));
          } catch {
            setCorners(FALLBACK_PERSPECTIVE_CORNERS);
            setCropBox(cropBoxFromCorners(FALLBACK_PERSPECTIVE_CORNERS));
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
      setCropBox(cropBoxFromCorners(FALLBACK_PERSPECTIVE_CORNERS));
      return;
    }
    try {
      const detected = detectNearWhitePaperCorners(img);
      setCorners(detected);
      setCropBox(cropBoxFromCorners(detected));
    } catch {
      setCorners(FALLBACK_PERSPECTIVE_CORNERS);
      setCropBox(cropBoxFromCorners(FALLBACK_PERSPECTIVE_CORNERS));
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

  const clearSelectPaint = () => {
    setSelectRegions([]);
    selectRegionsRef.current = [];
    setDragSelectRect(null);
    selectDragStartRef.current = null;
    setIsSelectPainting(false);
  };

  const syncSelectRegions = (regions: CropRect[]) => {
    // Merge overlapping / nearby boxes so multi-line taps become one range
    const merged = clusterPaintStrokesToRects(
      regions.map((r) => [
        { x: r.x, y: r.y },
        { x: r.x + r.width, y: r.y + r.height },
      ]),
      0.01,
      0.03
    );
    const finalRegions = merged.length ? merged : regions;
    selectRegionsRef.current = finalRegions;
    setSelectRegions(finalRegions);
    const overall = unionCropRects(finalRegions);
    if (overall) {
      setCropBox({
        x: overall.x,
        y: overall.y,
        w: overall.width,
        h: overall.height,
      });
      cropDirtyAfterAddRef.current = true;
    }
  };

  const addSelectRegion = (rect: CropRect) => {
    syncSelectRegions([...selectRegionsRef.current, rect]);
  };

  const enterCropMode = () => {
    setCropBox(cropBoxFromCorners(corners));
    setMode("crop");
    setCropTool("paint");
    clearSelectPaint();
  };

  const handleResetToOriginal = () => {
    setHistory([]);
    setCurrentImage(imageSrc);
    setCropBox(cropBoxFromCorners(FALLBACK_PERSPECTIVE_CORNERS));
  };

  // Rotate image by +/- 90 degrees
  const handleRotate = async (deg: number) => {
    setIsProcessing(true);
    try {
      const rotated = await rotateImage(currentImage, deg);
      pushHistory(rotated);
      setCropBox(cropBoxFromCorners(FALLBACK_PERSPECTIVE_CORNERS));
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

      // After straightening, default to paint-select so user can finger-highlight the wrong region
      setMode("crop");
      setCropTool("paint");
      clearSelectPaint();
      setCorners(FULL_FRAME_CORNERS);
      setCropBox(cropBoxFromCorners(FULL_FRAME_CORNERS));
    } catch (err) {
      console.error("Apply perspective failed:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  const applyPendingTransforms = async (): Promise<string> => {
    if (mode === "perspective") {
      const natW = imgRef.current?.naturalWidth || naturalDimensions.width;
      const natH = imgRef.current?.naturalHeight || naturalDimensions.height;
      const realCorners: [Point, Point, Point, Point] = [
        { x: corners[0].x * natW, y: corners[0].y * natH },
        { x: corners[1].x * natW, y: corners[1].y * natH },
        { x: corners[2].x * natW, y: corners[2].y * natH },
        { x: corners[3].x * natW, y: corners[3].y * natH },
      ];
      return applyPerspectiveCorrection(currentImage, realCorners);
    }
    return applyCrop(
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
  };

  const cropCurrentBox = async (): Promise<string> => {
    if (mode === "perspective") {
      return applyPendingTransforms();
    }
    // Same question may be multiple paint islands (stem + map) → multi-rect composite
    if (selectRegionsRef.current.length > 0) {
      return applyMultiRegionCrop(currentImage, selectRegionsRef.current, 0.92);
    }
    return applyCrop(
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
  };

  const markCropDirty = () => {
    cropDirtyAfterAddRef.current = true;
  };

  const handleAddPendingCrop = async () => {
    if (isProcessing || isErasingBusy || isExistingQuestion || mode !== "crop") return;
    if (cropTool === "paint" && selectRegionsRef.current.length === 0) {
      setProcessingText("請先點選文字（或拖曳拉框）選出錯題範圍");
      setIsProcessing(true);
      setTimeout(() => setIsProcessing(false), 1400);
      return;
    }
    setIsProcessing(true);
    const regionCount = selectRegionsRef.current.length;
    setProcessingText(
      regionCount > 1
        ? `正在合成同一題的 ${regionCount} 個範圍...`
        : "正在加入錯題範圍..."
    );
    try {
      const cropped = await cropCurrentBox();
      if (cropped) {
        setPendingCrops((prev) => [...prev, cropped]);
        // Keep base image; reset for the next wrong region (paint again)
        setCropBox({ x: 0.08, y: 0.08, w: 0.84, h: 0.35 });
        setCropTool("paint");
        clearSelectPaint();
        cropDirtyAfterAddRef.current = false;
      }
    } catch (err) {
      console.error("Add pending crop failed:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFinish = async () => {
    if (isProcessing || isErasingBusy) return;
    setIsProcessing(true);
    setProcessingText(
      pendingCrops.length > 0 ? `正在準備錯題...` : "正在套用校正..."
    );
    try {
      let results: string[] = [];
      if (pendingCrops.length === 0) {
        const output = await cropCurrentBox();
        results = [output || currentImage];
      } else {
        results = [...pendingCrops];
        // If user reframed after the last「加入」but forgot to add again, include it
        if (cropDirtyAfterAddRef.current && mode === "crop") {
          const current = await cropCurrentBox();
          if (current) results.push(current);
        }
      }
      onConfirm(results.filter(Boolean));
    } catch (err) {
      console.error("Finish calibration failed:", err);
      onConfirm([currentImage]);
    } finally {
      setIsProcessing(false);
    }
  };

  // Legacy destructive crop: bake current box into the working image (existing-question path)
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

  const commitEraseStroke = async (points: Point[]) => {
    if (!points.length) return;
    setIsErasingBusy(true);
    try {
      const painted = await paintWhiteBrushOnImage(currentImageRef.current, {
        points,
        radiusNorm: BRUSH_RADIUS_NORM[brushSizeRef.current],
      });
      setHistory((prev) => [...prev, currentImageRef.current]);
      currentImageRef.current = painted;
      setCurrentImage(painted);
    } catch (err) {
      console.error("Erase handwriting failed:", err);
    } finally {
      setIsErasingBusy(false);
    }
  };

  const handleErasePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (cropTool !== "erase" || mode !== "crop" || isProcessing || isErasingBusy) return;
    e.preventDefault();
    e.stopPropagation();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const pos = getNormalizedPos(clientX, clientY);
    eraseStrokeRef.current = [pos];
    setEraseStrokePoints([pos]);
    setIsErasing(true);
  };

  /** Tap text → auto box; drag → rubber-band box (like selecting text). */
  const handleSelectPaintDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (cropTool !== "paint" || mode !== "crop" || isProcessing || isErasingBusy) return;
    e.preventDefault();
    e.stopPropagation();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const pos = getNormalizedPos(clientX, clientY);
    selectDragStartRef.current = pos;
    setDragSelectRect(null);
    setIsSelectPainting(true);
  };

  const rectFromPoints = (a: Point, b: Point): CropRect => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return {
      x,
      y,
      width: Math.max(0.02, Math.abs(b.x - a.x)),
      height: Math.max(0.02, Math.abs(b.y - a.y)),
    };
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

  /** AI inpainting: blank student answer marks / handwriting; keep print & maps. */
  const handleAiRemoveHandwriting = async () => {
    if (isProcessing || isErasingBusy) return;
    setIsProcessing(true);
    setProcessingText("AI 正在挖空選答與手寫（約需數秒）...");
    try {
      // Higher res helps thin pencil circles / ticks survive until the model sees them
      const prepared = await compressImage(currentImage, 2048, 2048, 0.92);
      const cleaned = await removeHandwritingWithAI(prepared);
      if (cleaned) {
        pushHistory(cleaned);
      }
    } catch (err: any) {
      console.error("AI remove handwriting failed:", err);
      setProcessingText(err?.message || "AI 去手寫失敗，請稍後再試");
      await new Promise((r) => setTimeout(r, 2200));
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

    // Source image draw zoomed — use live natural/client sizes (state can lag on mobile)
    const img = imgRef.current;
    const natW = img.naturalWidth || naturalDimensions.width || 1;
    const natH = img.naturalHeight || naturalDimensions.height || 1;
    const dispW = Math.max(1, img.clientWidth || displayDimensions.width || 1);
    const dispH = Math.max(1, img.clientHeight || displayDimensions.height || 1);
    const srcX = loupeInfo.srcX * natW;
    const srcY = loupeInfo.srcY * natH;

    const sWidth = (size / zoom) * (natW / dispW);
    const sHeight = (size / zoom) * (natH / dispH);

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
  }, [loupeInfo, naturalDimensions, displayDimensions]);

  // Pointer position relative to displayed image (object-fill box = full img rect)
  const getNormalizedPos = useCallback((clientX: number, clientY: number) => {
    if (!imgRef.current) return { x: 0.5, y: 0.5 };
    const rect = imgRef.current.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / w));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / h));
    return { x, y };
  }, []);

  /** Mouse: tip = aim. Touch: aim above finger (same point the loupe crosshair shows). */
  const getAimFromEvent = useCallback(
    (e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent) => {
      const isTouch = "touches" in e && e.touches.length > 0;
      const clientX = isTouch
        ? e.touches[0].clientX
        : "clientX" in e
        ? e.clientX
        : 0;
      const clientY = isTouch
        ? e.touches[0].clientY
        : "clientY" in e
        ? e.clientY
        : 0;
      const aimX = clientX;
      const aimY = isTouch ? clientY - TOUCH_AIM_OFFSET_Y : clientY;
      return { clientX, clientY, aimX, aimY, isTouch };
    },
    []
  );

  // Corner pointer events for 4-point perspective
  const handleCornerDown = (index: number, e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveDragCorner(index);
    const { aimX, aimY } = getAimFromEvent(e);
    const pos = getNormalizedPos(aimX, aimY);

    // Touch: snap pin to aim point immediately so it matches the loupe crosshair
    setCorners((prev) => {
      const next = [...prev] as [Point, Point, Point, Point];
      next[index] = { x: pos.x, y: pos.y };
      return next;
    });

    setLoupeInfo({
      visible: true,
      x: aimX,
      y: aimY,
      srcX: pos.x,
      srcY: pos.y,
    });
  };

  // Crop handles pointer events
  const handleCropHandleDown = (handle: string, e: React.MouseEvent | React.TouchEvent) => {
    if (cropTool === "erase" || cropTool === "paint") return;
    e.preventDefault();
    e.stopPropagation();
    setActiveCropHandle(handle);
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const pos = getNormalizedPos(clientX, clientY);
    setCropDragStart({ x: pos.x, y: pos.y, box: { ...cropBox } });
  };

  // Tap-to-box / drag rubber-band select
  useEffect(() => {
    if (!isSelectPainting) return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      const start = selectDragStartRef.current;
      if (!start) return;
      if ("touches" in e) e.preventDefault();
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      const pos = getNormalizedPos(clientX, clientY);
      const dist = Math.hypot(pos.x - start.x, pos.y - start.y);
      if (dist >= TAP_DRAG_THRESHOLD) {
        setDragSelectRect(rectFromPoints(start, pos));
      }
    };

    const handlePointerUp = (e: MouseEvent | TouchEvent) => {
      const start = selectDragStartRef.current;
      selectDragStartRef.current = null;
      setIsSelectPainting(false);
      setDragSelectRect(null);
      if (!start) return;

      let end = start;
      if ("changedTouches" in e && e.changedTouches.length) {
        end = getNormalizedPos(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      } else if ("clientX" in e) {
        end = getNormalizedPos(e.clientX, e.clientY);
      }
      const dist = Math.hypot(end.x - start.x, end.y - start.y);

      if (dist >= TAP_DRAG_THRESHOLD) {
        addSelectRegion(rectFromPoints(start, end));
        return;
      }

      // Tap: auto-frame text / content under the point
      const img = imgRef.current;
      if (!img || !(img.naturalWidth || img.width)) return;
      try {
        const block = detectTextBlockAtPoint(img, start.x, start.y);
        if (block) addSelectRegion(block);
      } catch (err) {
        console.error("detectTextBlockAtPoint failed:", err);
      }
    };

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp);
    window.addEventListener("touchmove", handlePointerMove, { passive: false });
    window.addEventListener("touchend", handlePointerUp);
    window.addEventListener("touchcancel", handlePointerUp);
    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
      window.removeEventListener("touchmove", handlePointerMove);
      window.removeEventListener("touchend", handlePointerUp);
      window.removeEventListener("touchcancel", handlePointerUp);
    };
  }, [isSelectPainting, getNormalizedPos]);

  // Erase brush stroke tracking
  useEffect(() => {
    if (!isErasing) return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      if (!eraseStrokeRef.current) return;
      if ("touches" in e) e.preventDefault();
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      const pos = getNormalizedPos(clientX, clientY);
      const next = [...eraseStrokeRef.current, pos];
      eraseStrokeRef.current = next;
      setEraseStrokePoints(next);
    };

    const handlePointerUp = () => {
      const points = eraseStrokeRef.current || [];
      eraseStrokeRef.current = null;
      setEraseStrokePoints(null);
      setIsErasing(false);
      if (points.length) {
        void commitEraseStroke(points);
      }
    };

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp);
    window.addEventListener("touchmove", handlePointerMove, { passive: false });
    window.addEventListener("touchend", handlePointerUp);
    window.addEventListener("touchcancel", handlePointerUp);
    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
      window.removeEventListener("touchmove", handlePointerMove);
      window.removeEventListener("touchend", handlePointerUp);
      window.removeEventListener("touchcancel", handlePointerUp);
    };
  }, [isErasing, getNormalizedPos]);

  // Window-level move and up listeners during drag
  useEffect(() => {
    if (activeDragCorner === null && activeCropHandle === null) return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      if ("touches" in e) e.preventDefault();
      const { aimX, aimY } = getAimFromEvent(e);
      const pos = getNormalizedPos(aimX, aimY);

      if (activeDragCorner !== null) {
        setCorners((prev) => {
          const next = [...prev] as [Point, Point, Point, Point];
          next[activeDragCorner] = { x: pos.x, y: pos.y };
          return next;
        });

        // Loupe is centered on the aim point (= red crosshair = pin drop point)
        setLoupeInfo({
          visible: true,
          x: aimX,
          y: aimY,
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
          cropDirtyAfterAddRef.current = true;
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

          cropDirtyAfterAddRef.current = true;
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
  }, [
    activeDragCorner,
    activeCropHandle,
    cropDragStart,
    getNormalizedPos,
    getAimFromEvent,
    aspectRatioMode,
    naturalDimensions,
  ]);

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
          void handleFinish();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, handleFinish, isProcessing]);

  if (!isOpen) return null;

  const loupePortal =
    loupeInfo &&
    loupeInfo.visible &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        style={{
          left: `${loupeInfo.x}px`,
          top: `${loupeInfo.y}px`,
        }}
        className="fixed -translate-x-1/2 -translate-y-1/2 pointer-events-none z-[200] rounded-full shadow-2xl overflow-hidden ring-3 ring-sky-500 bg-slate-950"
      >
        <canvas
          ref={loupeCanvasRef}
          width={120}
          height={120}
          className="rounded-full block"
        />
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-mono font-bold text-white bg-black/60 px-1.5 py-0.2 rounded-full">
          對準角 · 2.5×
        </div>
      </div>,
      document.body
    );

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
                透視一次後點選文字框出錯題（可多塊：題幹＋圖）
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
              onClick={enterCropMode}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                mode === "crop"
                  ? "bg-white text-emerald-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Paintbrush className="w-3.5 h-3.5 text-emerald-600" />
              <span>步驟 2：點選文字</span>
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
              onClick={() => void handleFinish()}
              disabled={isProcessing}
              className="hidden sm:inline-flex px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs font-extrabold text-white bg-sky-600 hover:bg-sky-500 active:scale-95 transition shadow-sm items-center gap-1.5"
              title="完成校正並進行下一步"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <span>
                {isExistingQuestion
                  ? "下一步：儲存截圖"
                  : pendingCrops.length > 0
                  ? `開始分析 (${pendingCrops.length})`
                  : "下一步：AI 分析"}
              </span>
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
                <span className="sm:hidden inline-flex items-center gap-1 text-sky-700 bg-sky-50 px-2 py-1 rounded-md font-medium text-[10px] max-w-[11rem] leading-snug">
                  拖角點：以紅色十字線對準紙角（在指尖上方）
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
                <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg border border-slate-200 mr-0.5">
                  <button
                    type="button"
                    onClick={() => setCropTool("paint")}
                    className={`px-2 py-1 rounded-md text-[11px] font-bold transition flex items-center gap-1 ${
                      cropTool === "paint"
                        ? "bg-emerald-600 text-white shadow-2xs"
                        : "text-slate-600 hover:bg-white"
                    }`}
                    title="點一下文字自動框起來；拖曳則像選取文字一樣拉框。同一題可點多塊（題幹＋圖）"
                  >
                    <Paintbrush className="w-3 h-3" />
                    點選
                  </button>
                  <button
                    type="button"
                    onClick={() => setCropTool("frame")}
                    className={`px-2 py-1 rounded-md text-[11px] font-bold transition flex items-center gap-1 ${
                      cropTool === "frame"
                        ? "bg-sky-600 text-white shadow-2xs"
                        : "text-slate-600 hover:bg-white"
                    }`}
                    title="矩形框微調範圍"
                  >
                    <Crop className="w-3 h-3" />
                    框選
                  </button>
                  <button
                    type="button"
                    onClick={() => setCropTool("erase")}
                    className={`px-2 py-1 rounded-md text-[11px] font-bold transition flex items-center gap-1 ${
                      cropTool === "erase"
                        ? "bg-rose-600 text-white shadow-2xs"
                        : "text-slate-600 hover:bg-white"
                    }`}
                    title="塗白手寫答案"
                  >
                    <Eraser className="w-3 h-3" />
                    去手寫
                  </button>
                </div>
                {cropTool === "erase" ? (
                  <div className="flex items-center gap-0.5">
                    {([
                      { id: "s" as const, label: "細" },
                      { id: "m" as const, label: "中" },
                      { id: "l" as const, label: "粗" },
                    ]).map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setBrushSize(b.id)}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                          brushSize === b.id
                            ? "bg-rose-600 text-white font-bold"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                ) : cropTool === "paint" ? (
                  selectRegions.length > 0 ? (
                    <button
                      type="button"
                      onClick={clearSelectPaint}
                      className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 whitespace-nowrap"
                      title="清除框選，重新點選"
                    >
                      清除
                    </button>
                  ) : null
                ) : (
                  <>
                    <span className="hidden sm:inline text-slate-500 font-medium mr-1 text-[11px]">比例：</span>
                    {(
                      [
                        { id: "free", label: "自由" },
                        { id: "4:3", label: "4:3" },
                        { id: "16:9", label: "16:9" },
                        { id: "1:1", label: "1:1" },
                        { id: "paper", label: "考卷" },
                      ] as const
                    ).map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          markCropDirty();
                          setAspectRatioMode(r.id);
                        }}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                          aspectRatioMode === r.id
                            ? "bg-sky-600 text-white font-bold shadow-2xs"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        markCropDirty();
                        setCropBox({ x: 0, y: 0, w: 1, h: 1 });
                      }}
                      className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 whitespace-nowrap"
                      title="裁切框貼齊照片四邊"
                    >
                      貼齊
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right: Shadow Removal, Zoom, Rotate and Undo Tools */}
          <div className="flex items-center gap-1 sm:gap-1.5 ml-auto shrink-0">
            {/* AI handwriting removal (Gemini image edit) */}
            <button
              type="button"
              onClick={() => void handleAiRemoveHandwriting()}
              disabled={isProcessing || isErasingBusy}
              className="px-2 sm:px-2.5 py-1 rounded-md text-[11px] font-bold text-violet-950 bg-violet-100 hover:bg-violet-200 active:scale-95 transition flex items-center gap-1 sm:gap-1.5 cursor-pointer whitespace-nowrap border border-violet-200 disabled:opacity-50"
              title="AI 挖空學生選答與手寫（圈選、打勾、填塗、紅藍鉛筆跡），保留印刷字與彩色地圖。需 Gemini API Key"
            >
              <Sparkles className="w-3.5 h-3.5 text-violet-700" />
              <span className="sm:hidden">AI挖空</span>
              <span className="hidden sm:inline">AI 去手寫</span>
            </button>

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
          className="relative flex-1 bg-slate-900 flex items-center justify-center px-9 py-8 sm:p-6 overflow-auto select-none min-h-0"
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
                {mode === "perspective"
                  ? renderPerspectiveSvgOverlay()
                  : cropTool === "frame"
                  ? renderCropOverlay()
                  : null}

                {/* Tap text to box / drag rubber-band (multi-rect OK) */}
                {mode === "crop" && cropTool === "paint" && (
                  <div
                    className="absolute inset-0 z-30 cursor-text touch-none"
                    onMouseDown={handleSelectPaintDown}
                    onTouchStart={handleSelectPaintDown}
                    style={{ touchAction: "none" }}
                  >
                    {selectRegions.map((r, idx) => (
                      <div
                        key={`reg-${idx}`}
                        className="absolute border-2 border-emerald-500 bg-emerald-400/10 pointer-events-none rounded-sm shadow-[0_0_0_1px_rgba(16,185,129,0.35)]"
                        style={{
                          left: `${r.x * 100}%`,
                          top: `${r.y * 100}%`,
                          width: `${r.width * 100}%`,
                          height: `${r.height * 100}%`,
                        }}
                      >
                        <div className="absolute -top-5 left-0 px-1.5 py-0.5 rounded bg-emerald-700/90 text-white text-[9px] font-bold whitespace-nowrap">
                          範圍 {idx + 1}
                        </div>
                      </div>
                    ))}
                    {dragSelectRect && (
                      <div
                        className="absolute border-2 border-dashed border-emerald-400 bg-emerald-300/15 pointer-events-none rounded-sm"
                        style={{
                          left: `${dragSelectRect.x * 100}%`,
                          top: `${dragSelectRect.y * 100}%`,
                          width: `${dragSelectRect.width * 100}%`,
                          height: `${dragSelectRect.height * 100}%`,
                        }}
                      />
                    )}
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 px-2 py-1 rounded-full bg-emerald-600/90 text-white text-[10px] font-bold pointer-events-none max-w-[92%] text-center">
                      {selectRegions.length > 1
                        ? `同一題 ${selectRegions.length} 個框（題幹／圖可分開點）→ 加入錯題`
                        : selectRegions.length === 1
                        ? "可再點另一塊（如圖），或按「加入錯題」"
                        : "點文字自動框起來；拖曳像選取文字一樣拉框"}
                    </div>
                  </div>
                )}

                {/* Erase handwriting canvas layer */}
                {mode === "crop" && cropTool === "erase" && (
                  <div
                    className="absolute inset-0 z-30 cursor-crosshair touch-none"
                    onMouseDown={handleErasePointerDown}
                    onTouchStart={handleErasePointerDown}
                    style={{ touchAction: "none" }}
                  >
                    {eraseStrokePoints && eraseStrokePoints.length > 0 && (
                      <svg className="absolute inset-0 w-full h-full pointer-events-none">
                        <polyline
                          fill="none"
                          stroke="rgba(255,255,255,0.92)"
                          strokeWidth={
                            Math.min(displayDimensions.width, displayDimensions.height) *
                            BRUSH_RADIUS_NORM[brushSize] *
                            2
                          }
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={eraseStrokePoints
                            .map(
                              (p) =>
                                `${p.x * displayDimensions.width},${p.y * displayDimensions.height}`
                            )
                            .join(" ")}
                        />
                      </svg>
                    )}
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 px-2 py-1 rounded-full bg-rose-600/90 text-white text-[10px] font-bold pointer-events-none">
                      {isErasingBusy ? "塗白套用中…" : "手指塗白手寫答案"}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Processing Spinner Overlay (erase brush uses quiet busy flag instead) */}
          {isProcessing && (
            <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-xs flex flex-col items-center justify-center text-white z-40">
              <RefreshCw className="w-8 h-8 animate-spin text-sky-400 mb-2" />
              <div className="text-sm font-bold">{processingText}</div>
            </div>
          )}
          {isErasingBusy && !isProcessing && (
            <div className="absolute top-3 right-3 z-40 px-2.5 py-1 rounded-full bg-rose-600/90 text-white text-[10px] font-bold shadow-md">
              塗白中…
            </div>
          )}
        </div>

        {/* Pending multi-crop queue */}
        {!isExistingQuestion && mode === "crop" && (
          <div className="px-2 sm:px-5 py-1 text-[10px] sm:text-[11px] text-slate-500 bg-slate-50 border-t border-slate-100 shrink-0">
            「點選」：點文字自動框起來（像選取文字）；題幹／圖可分開點成多框（仍算同一題）。建議先「AI 去手寫」；再按「加入此錯題」。
          </div>
        )}
        {!isExistingQuestion && pendingCrops.length > 0 && (
          <div className="px-2 sm:px-5 py-1.5 bg-emerald-50/90 border-t border-emerald-100 flex items-center gap-2 shrink-0 overflow-x-auto">
            <span className="text-[11px] font-bold text-emerald-800 whitespace-nowrap">
              已選 {pendingCrops.length} 題
            </span>
            <div className="flex items-center gap-1.5">
              {pendingCrops.map((src, idx) => (
                <div
                  key={`pending-${idx}`}
                  className="relative w-12 h-12 rounded-lg overflow-hidden border border-emerald-300 bg-white shrink-0"
                >
                  <img src={src} alt={`錯題 ${idx + 1}`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() =>
                      setPendingCrops((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="absolute top-0.5 right-0.5 p-0.5 rounded bg-slate-900/70 text-white"
                    title="移除此範圍"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

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
                  onClick={enterCropMode}
                  className="px-2.5 sm:px-3.5 py-2 rounded-xl text-xs font-semibold text-sky-800 bg-sky-50 hover:bg-sky-100 active:scale-95 transition border border-sky-200/80 flex items-center gap-1"
                  title="切換至步驟 2：點選文字框出錯題"
                >
                  <Paintbrush className="w-3.5 h-3.5 text-sky-600" />
                  點選文字
                  <ChevronRight className="w-3.5 h-3.5 hidden sm:block" />
                </button>
              </>
            ) : (
              <>
                {!isExistingQuestion ? (
                  <button
                    type="button"
                    onClick={() => void handleAddPendingCrop()}
                    disabled={
                      isProcessing ||
                      cropTool === "erase" ||
                      (cropTool === "paint" && selectRegions.length === 0)
                    }
                    className="flex-1 sm:flex-none px-2.5 sm:px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-95 transition shadow-xs flex items-center justify-center gap-1 sm:gap-1.5 disabled:opacity-50 min-h-10"
                    title="將目前框選範圍加入錯題清單，可再選下一題"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span className="sm:hidden">加入錯題</span>
                    <span className="hidden sm:inline">加入此錯題</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleApplyCrop}
                    disabled={isProcessing || cropTool === "erase"}
                    className="flex-1 sm:flex-none px-2.5 sm:px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-95 transition shadow-xs flex items-center justify-center gap-1 sm:gap-1.5 disabled:opacity-50"
                    title="裁切保留所選區域"
                  >
                    <Crop className="w-3.5 h-3.5" />
                    <span className="sm:hidden">套用裁切</span>
                    <span className="hidden sm:inline">套用框選裁切</span>
                  </button>
                )}
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
              onClick={() => void handleFinish()}
              disabled={isProcessing}
              className="sm:hidden px-3 py-2 rounded-xl text-xs font-extrabold text-white bg-slate-900 hover:bg-slate-800 active:scale-95 transition shadow-md flex items-center justify-center gap-1.5 cursor-pointer min-h-10"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>
                {isExistingQuestion
                  ? "儲存"
                  : pendingCrops.length > 0
                  ? `分析(${pendingCrops.length})`
                  : "開始分析"}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-sky-400" />
            </button>
          </div>
        </div>
      </div>
      {loupePortal}
    </div>
  );
};
