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
  Trash2,
  Paintbrush,
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
  FULL_FRAME_CORNERS,
  cropBoxFromCorners,
  unionCropRects,
  applyMultiRegionCrop,
  clusterTightStrokeRects,
  cropFigureRegionsOnly,
  separateDifferentKindRects,
  CropRect,
  LabeledCropRect,
  RegionKind,
} from "../utils/imageUtils";
import { removeHandwritingWithAI } from "../services/aiService";
import { CalibratedCrop } from "../types";

interface ImageCalibrationModalProps {
  isOpen: boolean;
  imageSrc: string;
  onClose: () => void;
  onConfirm: (crops: CalibratedCrop[]) => void;
  onSkip?: (originalBase64: string) => void;
  title?: string;
  isExistingQuestion?: boolean;
  initialMode?: CalibrationMode;
  onReplaceTargetImage?: (newBase64: string) => void;
}

type CalibrationMode = "perspective" | "crop";
/** paint = 選文字滑到哪框到哪、選圖形緊貼筆畫；frame = 矩形微調 */
type CropTool = "paint" | "frame";
type AspectRatioMode = "free" | "4:3" | "16:9" | "1:1" | "paper";
/** Explicit paint target: start with text, tap again for diagram. */
type PaintKind = RegionKind;

/** Default zoom after capture / open calibration (1 = fit viewport). */
const DEFAULT_CALIBRATION_ZOOM = 1.3;

type SelectSnapshot = {
  strokes: Point[][];
  kinds: RegionKind[];
  regions: LabeledCropRect[];
  cropBox: { x: number; y: number; w: number; h: number };
  paintKind: PaintKind;
};

/** Thin stroke preview while painting (normalized width factor). */
const PAINT_PREVIEW_WIDTH = 0.018;
/** Mobile: aim above the finger so the red crosshair (not the finger tip) is the drop point. */
const TOUCH_AIM_OFFSET_Y = 72;
/** Loupe diameter in CSS px — keep in sync with canvas width/height. */
const LOUPE_SIZE_PX = 120;
/** Lift loupe center above the aim so the magnifier never covers the drop point. */
const LOUPE_ABOVE_AIM_PX = LOUPE_SIZE_PX / 2 + 36;

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
  const [zoomScale, setZoomScale] = useState<number>(DEFAULT_CALIBRATION_ZOOM);
  const [imageLoadError, setImageLoadError] = useState<boolean>(false);
  const [isImageReady, setIsImageReady] = useState<boolean>(false);
  const [pendingCrops, setPendingCrops] = useState<CalibratedCrop[]>([]);
  const [cropTool, setCropTool] = useState<CropTool>("paint");
  /** Default 選文字；切到 選圖形 後筆畫強制標成圖區。 */
  const [paintKind, setPaintKind] = useState<PaintKind>("text");
  const [selectPaintStrokes, setSelectPaintStrokes] = useState<Point[][]>([]);
  const [selectStrokeKinds, setSelectStrokeKinds] = useState<RegionKind[]>([]);
  const [selectRegions, setSelectRegions] = useState<LabeledCropRect[]>([]);
  const [activeSelectStroke, setActiveSelectStroke] = useState<Point[] | null>(null);
  const [isSelectPainting, setIsSelectPainting] = useState(false);
  const selectStrokeRef = useRef<Point[] | null>(null);
  const selectPaintStrokesRef = useRef<Point[][]>([]);
  const selectStrokeKindsRef = useRef<RegionKind[]>([]);
  const selectRegionsRef = useRef<LabeledCropRect[]>([]);
  const paintKindRef = useRef<PaintKind>("text");
  const cropToolRef = useRef<CropTool>("paint");
  const cropDirtyAfterAddRef = useRef(false);
  /** Snapshots before each paint stroke / frame lock — step undo without full 清除 */
  const selectHistoryRef = useRef<SelectSnapshot[]>([]);
  const [selectHistoryLen, setSelectHistoryLen] = useState(0);
  const pushSelectHistoryRef = useRef<() => void>(() => undefined);
  const syncPaintRegionsRef = useRef<
    (strokes: Point[][], kinds?: RegionKind[]) => void
  >(() => undefined);
  /** Captured on stroke start so live line-preview cannot poison undo. */
  const pendingSelectSnapshotRef = useRef<SelectSnapshot | null>(null);
  paintKindRef.current = paintKind;
  cropToolRef.current = cropTool;
  selectStrokeKindsRef.current = selectStrokeKinds;
  const currentImageRef = useRef(currentImage);
  currentImageRef.current = currentImage;
  selectPaintStrokesRef.current = selectPaintStrokes;
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
  const cropBoxRef = useRef(cropBox);
  cropBoxRef.current = cropBox;

  // Dragging states
  const [activeDragCorner, setActiveDragCorner] = useState<number | null>(null);
  const [activeCropHandle, setActiveCropHandle] = useState<string | null>(null);
  const [cropDragStart, setCropDragStart] = useState<{ x: number; y: number; box: typeof cropBox } | null>(null);

  // Loupe + screen-space aim (aim = true pin drop point; loupe floats above it)
  const [loupeInfo, setLoupeInfo] = useState<{
    visible: boolean;
    loupeX: number;
    loupeY: number;
    aimX: number;
    aimY: number;
    srcX: number;
    srcY: number;
  } | null>(null);

  // References
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);
  /** Which finger owns the active corner drag (multi-touch safe). */
  const activeTouchIdRef = useRef<number | null>(null);
  /** Last valid aim during corner drag — used if release event has no usable coords. */
  const lastCornerAimRef = useRef<{ aimX: number; aimY: number; x: number; y: number } | null>(null);

  // Initialize or reset when imageSrc or modal opens
  useEffect(() => {
    if (isOpen && imageSrc) {
      const normalized = normalizeImageSrc(imageSrc);
      setCurrentImage(normalized);
      setImageLoadError(false);
      setIsImageReady(false);
      setHistory([]);
      setMode(initialMode || "perspective");
      setZoomScale(DEFAULT_CALIBRATION_ZOOM);
      setCorners(FALLBACK_PERSPECTIVE_CORNERS);
      setCropBox(cropBoxFromCorners(FALLBACK_PERSPECTIVE_CORNERS));
      setPendingCrops([]);
      setCropTool("paint");
      setPaintKind("text");
      paintKindRef.current = "text";
      setSelectPaintStrokes([]);
      selectPaintStrokesRef.current = [];
      setSelectStrokeKinds([]);
      selectStrokeKindsRef.current = [];
      setSelectRegions([]);
      selectRegionsRef.current = [];
      setActiveSelectStroke(null);
      selectStrokeRef.current = null;
      setIsSelectPainting(false);
      selectHistoryRef.current = [];
      setSelectHistoryLen(0);
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

  const snapshotSelection = (): SelectSnapshot => ({
    strokes: selectPaintStrokesRef.current.map((stroke) =>
      stroke.map((p) => ({ x: p.x, y: p.y }))
    ),
    kinds: [...selectStrokeKindsRef.current],
    regions: selectRegionsRef.current.map((r) => ({ ...r })),
    cropBox: { ...cropBoxRef.current },
    paintKind: paintKindRef.current,
  });

  const pushSelectHistory = () => {
    selectHistoryRef.current = [
      ...selectHistoryRef.current,
      snapshotSelection(),
    ];
    setSelectHistoryLen(selectHistoryRef.current.length);
  };
  pushSelectHistoryRef.current = pushSelectHistory;

  const restoreSelectSnapshot = (snap: SelectSnapshot) => {
    selectPaintStrokesRef.current = snap.strokes;
    setSelectPaintStrokes(snap.strokes);
    selectStrokeKindsRef.current = snap.kinds;
    setSelectStrokeKinds(snap.kinds);
    selectRegionsRef.current = snap.regions;
    setSelectRegions(snap.regions);
    cropBoxRef.current = snap.cropBox;
    setCropBox(snap.cropBox);
    setPaintKind(snap.paintKind);
    paintKindRef.current = snap.paintKind;
    setActiveSelectStroke(null);
    selectStrokeRef.current = null;
    setIsSelectPainting(false);
    cropDirtyAfterAddRef.current = snap.regions.length > 0 || snap.strokes.length > 0;
  };

  const clearSelectPaint = () => {
    selectHistoryRef.current = [];
    setSelectHistoryLen(0);
    setSelectPaintStrokes([]);
    selectPaintStrokesRef.current = [];
    setSelectStrokeKinds([]);
    selectStrokeKindsRef.current = [];
    setSelectRegions([]);
    selectRegionsRef.current = [];
    setActiveSelectStroke(null);
    selectStrokeRef.current = null;
    setIsSelectPainting(false);
    // Avoid「清除」後完成仍以殘留 cropBox 追加幽靈裁切
    cropDirtyAfterAddRef.current = false;
  };

  /** Undo last 選文字／選圖形 stroke or 框選 lock — not a full clear */
  const undoLastSelection = () => {
    if (selectHistoryRef.current.length > 0) {
      const prev = selectHistoryRef.current[selectHistoryRef.current.length - 1];
      selectHistoryRef.current = selectHistoryRef.current.slice(0, -1);
      setSelectHistoryLen(selectHistoryRef.current.length);
      restoreSelectSnapshot(prev);
      return;
    }
    // Fallback: drop last stroke when history missing
    if (selectPaintStrokesRef.current.length === 0) return;
    const nextStrokes = selectPaintStrokesRef.current.slice(0, -1);
    const nextKinds = selectStrokeKindsRef.current.slice(0, -1);
    selectPaintStrokesRef.current = nextStrokes;
    selectStrokeKindsRef.current = nextKinds;
    setSelectPaintStrokes(nextStrokes);
    setSelectStrokeKinds(nextKinds);
    syncPaintRegionsFromStrokes(nextStrokes, nextKinds);
  };

  const canUndoSelection =
    selectHistoryLen > 0 || selectPaintStrokes.length > 0;

  const applyPaintKind = (kind: PaintKind) => {
    setPaintKind(kind);
    paintKindRef.current = kind;
  };

  /** Suggest a second frame that sits beside / below an existing island. */
  const defaultBoxForKind = (
    kind: PaintKind,
    existing: LabeledCropRect[]
  ): { x: number; y: number; w: number; h: number } => {
    const other = existing.find((r) => r.kind !== kind);
    if (!other) {
      return kind === "text"
        ? { x: 0.08, y: 0.08, w: 0.84, h: 0.35 }
        : { x: 0.52, y: 0.42, w: 0.4, h: 0.42 };
    }
    const right = 1 - (other.x + other.width);
    if (right >= 0.22) {
      return {
        x: Math.min(0.98 - 0.2, other.x + other.width + 0.02),
        y: other.y,
        w: Math.max(0.18, Math.min(0.42, right - 0.03)),
        h: Math.max(0.18, Math.min(0.5, other.height || 0.3)),
      };
    }
    const below = 1 - (other.y + other.height);
    if (below >= 0.18) {
      return {
        x: other.x,
        y: Math.min(0.98 - 0.16, other.y + other.height + 0.02),
        w: Math.max(0.2, Math.min(0.55, other.width || 0.4)),
        h: Math.max(0.16, Math.min(0.4, below - 0.03)),
      };
    }
    return { x: 0.48, y: 0.48, w: 0.36, h: 0.32 };
  };

  /** Lock / update one kind's rectangle into the dual-region store (non-overlapping). */
  const upsertFrameRegion = (
    kind: PaintKind,
    box: { x: number; y: number; w: number; h: number } = cropBoxRef.current
  ) => {
    if (box.w < 0.02 || box.h < 0.02) return selectRegionsRef.current;
    const frameRegion: LabeledCropRect = {
      x: box.x,
      y: box.y,
      width: box.w,
      height: box.h,
      kind,
    };
    const others = selectRegionsRef.current.filter((r) => r.kind !== kind);
    const next = separateDifferentKindRects([...others, frameRegion]).filter(
      (r) => r.width >= 0.012 && r.height >= 0.012
    );
    selectRegionsRef.current = next;
    setSelectRegions(next);
    cropDirtyAfterAddRef.current = true;
    const active = next.find((r) => r.kind === kind);
    if (active && kind === paintKindRef.current) {
      const synced = {
        x: active.x,
        y: active.y,
        w: active.width,
        h: active.height,
      };
      cropBoxRef.current = synced;
      setCropBox(synced);
    }
    return next;
  };

  const loadCropBoxForKind = (kind: PaintKind) => {
    const existing = selectRegionsRef.current.find((r) => r.kind === kind);
    const next = existing
      ? { x: existing.x, y: existing.y, w: existing.width, h: existing.height }
      : defaultBoxForKind(kind, selectRegionsRef.current);
    cropBoxRef.current = next;
    setCropBox(next);
  };

  /** 選文字／選圖形合併為一鍵：進工具預設文字，再點切換圖形。 */
  const activatePaintTool = () => {
    if (cropTool === "paint") {
      applyPaintKind(paintKind === "text" ? "diagram" : "text");
      return;
    }
    // Leaving frame: commit active rectangle so paint can refine both islands
    if (cropTool === "frame") {
      pushSelectHistory();
      upsertFrameRegion(paintKindRef.current, cropBoxRef.current);
    }
    setCropTool("paint");
    applyPaintKind("text");
  };

  /**
   * 框文字／框圖形合併為一鍵。
   * 再點切換時會鎖定目前矩形為一區，並打開另一 kind 的第二框（與畫選雙區塊對齊）。
   */
  const activateFrameTool = () => {
    if (cropTool === "frame") {
      // Snapshot before locking current box as one island
      pushSelectHistory();
      upsertFrameRegion(paintKind, cropBoxRef.current);
      const nextKind: PaintKind = paintKind === "text" ? "diagram" : "text";
      applyPaintKind(nextKind);
      loadCropBoxForKind(nextKind);
      return;
    }
    setCropTool("frame");
    applyPaintKind("text");
    const textReg = selectRegionsRef.current.find((r) => r.kind === "text");
    if (textReg) {
      const box = {
        x: textReg.x,
        y: textReg.y,
        w: textReg.width,
        h: textReg.height,
      };
      cropBoxRef.current = box;
      setCropBox(box);
    } else if (selectRegionsRef.current.length > 0) {
      loadCropBoxForKind("text");
    }
    // else keep current cropBox as the starting 框文字
  };

  const syncPaintRegionsFromStrokes = (
    strokes: Point[][],
    kinds: RegionKind[] = selectStrokeKindsRef.current
  ) => {
    const img = imgRef.current;
    if (!img || !(img.naturalWidth || img.width) || !strokes.length) {
      selectRegionsRef.current = [];
      setSelectRegions([]);
      return;
    }
    // Explicit kinds from 選文字／選圖形; different kinds stay separate & non-overlapping
    const fromStrokes = clusterTightStrokeRects(img, strokes, 0.02, 0.035, kinds);
    // Keep frame-only islands whose kind has no paint strokes yet
    // (e.g. 框圖形後再選文字，不應抹掉圖區)
    const kindsInStrokes = new Set(
      strokes.map((_, i) => kinds[i]).filter((k): k is RegionKind => Boolean(k))
    );
    const preserved = selectRegionsRef.current.filter(
      (r) => !kindsInStrokes.has(r.kind)
    );
    const regions = separateDifferentKindRects([
      ...preserved,
      ...fromStrokes,
    ]).filter((r) => r.width >= 0.012 && r.height >= 0.012);
    selectRegionsRef.current = regions;
    setSelectRegions(regions);
    const overall = unionCropRects(regions);
    if (overall) {
      const box = {
        x: overall.x,
        y: overall.y,
        w: overall.width,
        h: overall.height,
      };
      cropBoxRef.current = box;
      setCropBox(box);
      cropDirtyAfterAddRef.current = true;
    }
  };
  syncPaintRegionsRef.current = syncPaintRegionsFromStrokes;

  const enterCropMode = () => {
    setCropBox(cropBoxFromCorners(corners));
    setMode("crop");
    setCropTool("paint");
    setPaintKind("text");
    paintKindRef.current = "text";
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

      // After straightening, default to 選文字 so user paints stem first
      setMode("crop");
      setCropTool("paint");
      setPaintKind("text");
      paintKindRef.current = "text";
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

  const cropCurrentBox = async (): Promise<CalibratedCrop> => {
    if (mode === "perspective") {
      const imageBase64 = await applyPendingTransforms();
      return { imageBase64 };
    }
    // Frame: commit active rectangle into the dual-region store (文字 + 圖形)
    // before packing — same two-island model as 選文字／選圖形.
    let regions: LabeledCropRect[];
    if (cropTool === "frame") {
      regions = upsertFrameRegion(paintKindRef.current, cropBoxRef.current);
      if (regions.length === 0) {
        regions = [
          {
            x: cropBox.x,
            y: cropBox.y,
            width: cropBox.w,
            height: cropBox.h,
            kind: paintKindRef.current,
          },
        ];
      }
    } else if (selectRegionsRef.current.length > 0) {
      regions = selectRegionsRef.current;
    } else {
      regions = [
        {
          x: cropBox.x,
          y: cropBox.y,
          width: cropBox.w,
          height: cropBox.h,
          kind: paintKindRef.current,
        },
      ];
    }
    const imageBase64 = await applyMultiRegionCrop(currentImage, regions, 0.92);
    const figureOnly = await cropFigureRegionsOnly(currentImage, regions, 0.95);
    // "" = explicit none so PDF textOnly won't fall back to the stem screenshot
    return { imageBase64, figureImageBase64: figureOnly || "" };
  };

  const markCropDirty = () => {
    cropDirtyAfterAddRef.current = true;
  };

  const handleAddPendingCrop = async () => {
    if (isProcessing || isExistingQuestion || mode !== "crop") return;
    if (cropTool === "paint" && selectRegionsRef.current.length === 0) {
      setProcessingText(
        paintKind === "diagram"
          ? "請先畫過地圖／圖形範圍（目前為「選圖形」）"
          : "請先滑過要框的文字（目前為「選文字」，滑到哪就框到哪；再點按鈕可切換選圖形）"
      );
      setIsProcessing(true);
      setTimeout(() => setIsProcessing(false), 1400);
      return;
    }
    setIsProcessing(true);
    // Frame may still need one last upsert before counting islands
    if (cropTool === "frame") {
      upsertFrameRegion(paintKindRef.current, cropBoxRef.current);
    }
    const regionCount = selectRegionsRef.current.length;
    setProcessingText(
      regionCount > 1
        ? `正在拼接文字／圖共 ${regionCount} 個區塊...`
        : "正在加入錯題範圍..."
    );
    try {
      const cropped = await cropCurrentBox();
      if (cropped?.imageBase64) {
        setPendingCrops((prev) => [...prev, cropped]);
        // Keep base image; reset for the next wrong region (paint again)
        setCropBox({ x: 0.08, y: 0.08, w: 0.84, h: 0.35 });
        setCropTool("paint");
        setPaintKind("text");
        paintKindRef.current = "text";
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
    if (isProcessing) return;
    setIsProcessing(true);
    setProcessingText(
      pendingCrops.length > 0 ? `正在準備錯題...` : "正在套用校正..."
    );
    try {
      let results: CalibratedCrop[] = [];
      if (pendingCrops.length === 0) {
        const output = await cropCurrentBox();
        results = [output?.imageBase64 ? output : { imageBase64: currentImage }];
      } else {
        results = [...pendingCrops];
        // If user reframed after the last「加入」but forgot to add again, include it
        if (cropDirtyAfterAddRef.current && mode === "crop") {
          const current = await cropCurrentBox();
          if (current?.imageBase64) results.push(current);
        }
      }
      onConfirm(results.filter((r) => Boolean(r.imageBase64)));
    } catch (err) {
      console.error("Finish calibration failed:", err);
      onConfirm([{ imageBase64: currentImage }]);
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

  /** Finger-draw over text / diagram; box tightly follows painted content. */
  const handleSelectPaintDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (cropTool !== "paint" || mode !== "crop" || isProcessing) return;
    e.preventDefault();
    e.stopPropagation();
    pendingSelectSnapshotRef.current = snapshotSelection();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const pos = getNormalizedPos(clientX, clientY);
    selectStrokeRef.current = [pos];
    setActiveSelectStroke([pos]);
    setIsSelectPainting(true);
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

  /** Detect mark boxes with AI, then locally paper-fill (no full-page redraw). */
  const handleAiRemoveHandwriting = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    setProcessingText("AI 正在定位作答痕跡並挖空（約需數秒）...");
    try {
      const prepared = await compressImage(currentImage, 1600, 1600, 0.92);
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

  // Render loupe magnifier (samples image at aim / drop point)
  useEffect(() => {
    if (!loupeInfo || !loupeInfo.visible || !loupeCanvasRef.current || !imgRef.current) return;
    const canvas = loupeCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = canvas.width; // LOUPE_SIZE_PX
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

    // Uniform scale so the loupe isn't stretched when display ≠ natural aspect
    const scale = Math.max(natW / dispW, natH / dispH);
    const sWidth = (size / zoom) * scale;
    const sHeight = (size / zoom) * scale;

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

  const findTouchById = useCallback((list: TouchList | undefined, id: number | null) => {
    if (!list || list.length === 0) return null;
    if (id == null) return list[0];
    for (let i = 0; i < list.length; i++) {
      if (list[i].identifier === id) return list[i];
    }
    return null;
  }, []);

  /**
   * Resolve pointer client coords.
   * - During move: follow the tracked finger in touches[]
   * - On touchend/touchcancel: the ended finger is ONLY in changedTouches
   *   (prefer that over remaining touches[0], which may be another finger)
   */
  const getPointerClient = useCallback(
    (
      e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent,
      preferredTouchId: number | null = activeTouchIdRef.current
    ) => {
      if ("touches" in e) {
        const type = "type" in e ? String(e.type) : "";
        const isEndOrCancel = type === "touchend" || type === "touchcancel";
        // When a touch id is bound, never fall back to a different finger
        const changedExact =
          "changedTouches" in e ? findTouchById(e.changedTouches, preferredTouchId) : null;
        const activeExact = findTouchById(e.touches, preferredTouchId);
        const changedFallback =
          preferredTouchId == null && "changedTouches" in e && e.changedTouches?.length > 0
            ? e.changedTouches[0]
            : null;
        const activeFallback =
          preferredTouchId == null && e.touches?.length > 0 ? e.touches[0] : null;

        const changed = changedExact || changedFallback;
        const active = activeExact || activeFallback;
        const t = isEndOrCancel ? changed || active : active || changed;
        if (t) {
          return {
            clientX: t.clientX,
            clientY: t.clientY,
            isTouch: true as const,
            ok: true as const,
            touchId: t.identifier,
          };
        }
        return { clientX: 0, clientY: 0, isTouch: true as const, ok: false as const, touchId: null };
      }
      if ("clientX" in e && typeof e.clientX === "number") {
        return {
          clientX: e.clientX,
          clientY: e.clientY,
          isTouch: false as const,
          ok: true as const,
          touchId: null,
        };
      }
      return { clientX: 0, clientY: 0, isTouch: false as const, ok: false as const, touchId: null };
    },
    [findTouchById]
  );

  /** Mouse: tip = aim. Touch: aim above finger (same point the on-image red crosshair shows). */
  const getAimFromEvent = useCallback(
    (e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent) => {
      const { clientX, clientY, isTouch, ok } = getPointerClient(e);
      const aimX = clientX;
      const aimY = isTouch ? clientY - TOUCH_AIM_OFFSET_Y : clientY;
      return { clientX, clientY, aimX, aimY, isTouch, ok };
    },
    [getPointerClient]
  );

  const buildLoupeInfo = useCallback((aimX: number, aimY: number, pos: Point) => {
    const half = LOUPE_SIZE_PX / 2;
    const margin = 8;
    const vw = typeof window !== "undefined" ? window.innerWidth : 400;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;

    // Prefer above the aim; flip below when near the top edge
    let loupeY = aimY - LOUPE_ABOVE_AIM_PX;
    if (loupeY < half + margin) {
      loupeY = aimY + LOUPE_ABOVE_AIM_PX;
    }
    loupeY = Math.max(half + margin, Math.min(vh - half - margin, loupeY));
    const loupeX = Math.max(half + margin, Math.min(vw - half - margin, aimX));

    return {
      visible: true,
      loupeX,
      loupeY,
      aimX,
      aimY,
      srcX: pos.x,
      srcY: pos.y,
    };
  }, []);

  // Corner pointer events for 4-point perspective
  const handleCornerDown = (index: number, e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // touchstart: the new contact is in changedTouches (touches[0] may be an older finger)
    if ("changedTouches" in e && e.changedTouches.length > 0) {
      activeTouchIdRef.current = e.changedTouches[0].identifier;
    } else if ("touches" in e && e.touches.length > 0) {
      activeTouchIdRef.current = e.touches[0].identifier;
    } else {
      activeTouchIdRef.current = null;
    }
    const { aimX, aimY, ok } = getAimFromEvent(e);
    if (!ok) {
      activeTouchIdRef.current = null;
      return;
    }
    const pos = getNormalizedPos(aimX, aimY);
    lastCornerAimRef.current = { aimX, aimY, x: pos.x, y: pos.y };
    setActiveDragCorner(index);

    // Snap pin to aim immediately so pin / crosshair / loupe stay in sync
    setCorners((prev) => {
      const next = [...prev] as [Point, Point, Point, Point];
      next[index] = { x: pos.x, y: pos.y };
      return next;
    });

    setLoupeInfo(buildLoupeInfo(aimX, aimY, pos));
  };

  // Crop handles pointer events
  const handleCropHandleDown = (handle: string, e: React.MouseEvent | React.TouchEvent) => {
    if (cropTool === "paint") return;
    e.preventDefault();
    e.stopPropagation();
    // Snapshot before drag so「復原」可回到調整前的框
    if (cropTool === "frame") pushSelectHistory();
    setActiveCropHandle(handle);
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const pos = getNormalizedPos(clientX, clientY);
    setCropDragStart({ x: pos.x, y: pos.y, box: { ...cropBox } });
  };

  // Paint stroke tracking → text lines snap to the row; diagrams stay tight
  useEffect(() => {
    if (!isSelectPainting) return;

    let previewTimer = 0;
    const scheduleTextPreview = () => {
      if (paintKindRef.current !== "text") return;
      window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(() => {
        const active = selectStrokeRef.current;
        if (!active || active.length < 2 || paintKindRef.current !== "text") return;
        syncPaintRegionsRef.current(
          [...selectPaintStrokesRef.current, active],
          [...selectStrokeKindsRef.current, "text"]
        );
      }, 70);
    };

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      if (!selectStrokeRef.current) return;
      if ("touches" in e) e.preventDefault();
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      const pos = getNormalizedPos(clientX, clientY);
      const next = [...selectStrokeRef.current, pos];
      selectStrokeRef.current = next;
      setActiveSelectStroke(next);
      scheduleTextPreview();
    };

    const handlePointerUp = () => {
      window.clearTimeout(previewTimer);
      const points = selectStrokeRef.current || [];
      selectStrokeRef.current = null;
      setActiveSelectStroke(null);
      setIsSelectPainting(false);
      const prior = pendingSelectSnapshotRef.current;
      pendingSelectSnapshotRef.current = null;
      if (points.length < 2) {
        if (prior) {
          syncPaintRegionsRef.current(
            selectPaintStrokesRef.current,
            selectStrokeKindsRef.current
          );
        }
        return;
      }
      // Use the pre-stroke snapshot — live preview already rewrote regions
      if (prior) {
        selectHistoryRef.current = [...selectHistoryRef.current, prior];
        setSelectHistoryLen(selectHistoryRef.current.length);
      }
      const kind = paintKindRef.current;
      const nextStrokes = [...selectPaintStrokesRef.current, points];
      const nextKinds = [...selectStrokeKindsRef.current, kind];
      selectPaintStrokesRef.current = nextStrokes;
      selectStrokeKindsRef.current = nextKinds;
      setSelectPaintStrokes(nextStrokes);
      setSelectStrokeKinds(nextKinds);
      syncPaintRegionsFromStrokes(nextStrokes, nextKinds);
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
      window.clearTimeout(previewTimer);
    };
  }, [isSelectPainting, getNormalizedPos]);


  // Window-level move and up listeners during drag
  useEffect(() => {
    if (activeDragCorner === null && activeCropHandle === null) return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      if ("touches" in e) {
        // Ignore moves from other fingers while a corner drag is owned by one touch id
        if (
          activeDragCorner !== null &&
          activeTouchIdRef.current != null &&
          !findTouchById(e.touches, activeTouchIdRef.current)
        ) {
          return;
        }
        e.preventDefault();
      }

      if (activeDragCorner !== null) {
        const { aimX, aimY, ok } = getAimFromEvent(e);
        if (!ok) return;
        const pos = getNormalizedPos(aimX, aimY);
        lastCornerAimRef.current = { aimX, aimY, x: pos.x, y: pos.y };
        setCorners((prev) => {
          const next = [...prev] as [Point, Point, Point, Point];
          next[activeDragCorner] = { x: pos.x, y: pos.y };
          return next;
        });
        setLoupeInfo(buildLoupeInfo(aimX, aimY, pos));
      } else if (activeCropHandle !== null && cropDragStart) {
        // Crop handles use finger tip (no aim offset) — match handleCropHandleDown
        const { clientX, clientY, ok } = getPointerClient(e, null);
        if (!ok) return;
        const cropPos = getNormalizedPos(clientX, clientY);
        const dx = cropPos.x - cropDragStart.x;
        const dy = cropPos.y - cropDragStart.y;
        const orig = cropDragStart.box;

        if (activeCropHandle === "move") {
          const newX = Math.max(0, Math.min(1 - orig.w, orig.x + dx));
          const newY = Math.max(0, Math.min(1 - orig.h, orig.y + dy));
          cropDirtyAfterAddRef.current = true;
          const moved = { ...orig, x: newX, y: newY };
          cropBoxRef.current = moved;
          setCropBox(moved);
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
          const resized = { x: newX, y: newY, w: newW, h: newH };
          cropBoxRef.current = resized;
          setCropBox(resized);
        }
      }
    };

    /** Commit final corner from the release event (changedTouches on touchend). */
    const handlePointerUp = (e: MouseEvent | TouchEvent) => {
      // Touch-owned drag: ignore compatibility mouseup (no aim offset; can overwrite drop)
      if (activeTouchIdRef.current != null && e.type === "mouseup") {
        return;
      }

      if (activeDragCorner !== null) {
        // Only end when the owning finger lifts/cancels (ignore other fingers)
        if (
          "changedTouches" in e &&
          activeTouchIdRef.current != null &&
          (e.type === "touchend" || e.type === "touchcancel")
        ) {
          const ended = findTouchById(e.changedTouches, activeTouchIdRef.current);
          if (!ended) return;
        }

        const { aimX, aimY, ok } = getAimFromEvent(e);
        const fallback = lastCornerAimRef.current;
        const drop = ok
          ? (() => {
              const p = getNormalizedPos(aimX, aimY);
              return { x: p.x, y: p.y };
            })()
          : fallback
          ? { x: fallback.x, y: fallback.y }
          : null;

        if (drop) {
          setCorners((prev) => {
            const next = [...prev] as [Point, Point, Point, Point];
            next[activeDragCorner] = drop;
            return next;
          });
        }
      }
      // After resizing/moving a frame, lock it into the dual-region store so
      // the other kind's box stays visible alongside it.
      if (activeCropHandle !== null && cropToolRef.current === "frame") {
        // History was pushed on pointer down (pre-drag); sync cropBox after carve
        upsertFrameRegion(paintKindRef.current, cropBoxRef.current);
      }
      activeTouchIdRef.current = null;
      lastCornerAimRef.current = null;
      setActiveDragCorner(null);
      setActiveCropHandle(null);
      setCropDragStart(null);
      setLoupeInfo(null);
    };

    window.addEventListener("mousemove", handlePointerMove, { passive: false });
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
  }, [
    activeDragCorner,
    activeCropHandle,
    cropDragStart,
    getNormalizedPos,
    getAimFromEvent,
    getPointerClient,
    findTouchById,
    buildLoupeInfo,
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
      <>
        {/* True drop point — thin red crosshair on the image (not covered by loupe) */}
        <div
          style={{
            left: `${loupeInfo.aimX}px`,
            top: `${loupeInfo.aimY}px`,
          }}
          className="fixed -translate-x-1/2 -translate-y-1/2 pointer-events-none z-[199]"
          aria-hidden
        >
          <div className="relative w-10 h-10">
            <div className="absolute left-1/2 top-0 bottom-0 w-[2px] -translate-x-1/2 bg-red-500 shadow-[0_0_0_1px_rgba(255,255,255,0.85)]" />
            <div className="absolute top-1/2 left-0 right-0 h-[2px] -translate-y-1/2 bg-red-500 shadow-[0_0_0_1px_rgba(255,255,255,0.85)]" />
            <div className="absolute left-1/2 top-1/2 w-2 h-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 ring-2 ring-white" />
          </div>
        </div>
        {/* Magnifier floats above the aim so it never hides the paper corner */}
        <div
          style={{
            left: `${loupeInfo.loupeX}px`,
            top: `${loupeInfo.loupeY}px`,
            width: LOUPE_SIZE_PX,
            height: LOUPE_SIZE_PX,
          }}
          className="fixed -translate-x-1/2 -translate-y-1/2 pointer-events-none z-[200] rounded-full shadow-2xl overflow-hidden ring-3 ring-sky-500 bg-slate-950"
        >
          <canvas
            ref={loupeCanvasRef}
            width={LOUPE_SIZE_PX}
            height={LOUPE_SIZE_PX}
            className="rounded-full block"
          />
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-mono font-bold text-white bg-black/60 px-1.5 py-0.2 rounded-full">
            對準角 · 2.5×
          </div>
        </div>
      </>,
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
              {/* Idle: round pin. Dragging: hide fat pin — screen crosshair is the precise aim. */}
              <div
                className={`w-7 h-7 rounded-full border-2 border-white flex items-center justify-center shadow-lg transition-opacity ${
                  isDragging
                    ? "opacity-0"
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
                  isDragging ? "opacity-0" : "bg-slate-900/85 opacity-85 group-hover:opacity-100"
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
    const isDiagramFrame = paintKind === "diagram";
    // Locked opposite-kind island (文字 ↔ 圖形) — same dual-block model as paint
    const lockedRegions = selectRegions.filter((r) => r.kind !== paintKind);

    const holeRects = [
      cropBox,
      ...lockedRegions.map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })),
    ];
    const holesPath = holeRects
      .map((b) => {
        const x1 = b.x * 100;
        const y1 = b.y * 100;
        const x2 = (b.x + b.w) * 100;
        const y2 = (b.y + b.h) * 100;
        return `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2} L ${x1} ${y2} Z`;
      })
      .join(" ");
    const cropBackdropPath = `M 0 0 L 100 0 L 100 100 L 0 100 Z ${holesPath}`;

    return (
      <div className="absolute inset-0 pointer-events-none">
        <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {/* Dark shaded backdrop; cut out active frame + locked second island */}
          <path d={cropBackdropPath} fill="rgba(15, 23, 42, 0.5)" fillRule="evenodd" />
        </svg>

        {/* Locked second region (not currently being edited) */}
        {lockedRegions.map((r, idx) => {
          const isDiagram = r.kind === "diagram";
          return (
            <div
              key={`locked-frame-${r.kind}-${idx}`}
              className={`absolute border-2 rounded-sm z-[5] ${
                isDiagram
                  ? "border-sky-500 bg-sky-400/15"
                  : "border-emerald-500 bg-emerald-400/15"
              }`}
              style={{
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.width * 100}%`,
                height: `${r.height * 100}%`,
              }}
            >
              <div
                className={`absolute -top-5 left-0 px-1.5 py-0.5 rounded text-white text-[9px] font-bold whitespace-nowrap ${
                  isDiagram ? "bg-sky-700/90" : "bg-emerald-700/90"
                }`}
              >
                {isDiagram ? "圖區（已鎖定）" : "文字區（已鎖定）"}
              </div>
            </div>
          );
        })}

        {/* The active Crop Box itself */}
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
          className={`absolute border-2 pointer-events-auto cursor-move select-none shadow-sm z-10 ${
            isDiagramFrame
              ? "border-sky-400 bg-sky-500/10"
              : "border-emerald-400 bg-emerald-500/10"
          }`}
        >
          {/* 3x3 Rule-of-thirds alignment grid inside crop box */}
          <div className="w-full h-full grid grid-cols-3 grid-rows-3 pointer-events-none">
            <div className={`border-r border-b ${isDiagramFrame ? "border-sky-400/30" : "border-emerald-400/30"}`} />
            <div className={`border-r border-b ${isDiagramFrame ? "border-sky-400/30" : "border-emerald-400/30"}`} />
            <div className={`border-b ${isDiagramFrame ? "border-sky-400/30" : "border-emerald-400/30"}`} />
            <div className={`border-r border-b ${isDiagramFrame ? "border-sky-400/30" : "border-emerald-400/30"}`} />
            <div className={`border-r border-b ${isDiagramFrame ? "border-sky-400/30" : "border-emerald-400/30"}`} />
            <div className={`border-b ${isDiagramFrame ? "border-sky-400/30" : "border-emerald-400/30"}`} />
            <div className={`border-r ${isDiagramFrame ? "border-sky-400/30" : "border-emerald-400/30"}`} />
            <div className={`border-r ${isDiagramFrame ? "border-sky-400/30" : "border-emerald-400/30"}`} />
            <div />
          </div>

          {/* Kind + dimension badge */}
          <div
            className={`absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md bg-slate-900/85 font-mono text-[10px] whitespace-nowrap pointer-events-none backdrop-blur-xs flex items-center gap-1 ${
              isDiagramFrame ? "text-sky-300" : "text-emerald-300"
            }`}
          >
            <Crop className="w-3 h-3" />
            {isDiagramFrame ? "圖區" : "文字區"} · {currentCropPixelsW} × {currentCropPixelsH} px
          </div>
        </div>

        {/* 8 resize hit-targets: invisible so they don't cover text/figures; drag edges/corners still works */}
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
            className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto z-20 w-11 h-11"
            aria-label={`調整裁切框 ${h.id}`}
            title="拖曳邊角調整範圍"
          />
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
                滑到哪就框到哪；圖形另畫一框，兩區不重疊
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
              <span>步驟 2：畫選範圍</span>
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
                <span className="sm:hidden inline-flex items-center gap-1 text-sky-700 bg-sky-50 px-2 py-1 rounded-md font-medium text-[10px] max-w-[12rem] leading-snug">
                  拖角點：以圖上紅色十字對準紙角（放大鏡在上方，鬆手即落點）
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
                    onClick={activatePaintTool}
                    className={`px-2 py-1 rounded-md text-[11px] font-bold transition flex items-center gap-1 ${
                      cropTool === "paint"
                        ? paintKind === "diagram"
                          ? "bg-sky-600 text-white shadow-2xs"
                          : "bg-emerald-600 text-white shadow-2xs"
                        : "text-slate-600 hover:bg-white"
                    }`}
                    title={
                      cropTool === "paint" && paintKind === "diagram"
                        ? "目前選圖形：再點一次切回選文字"
                        : cropTool === "paint"
                        ? "目前選文字：再點一次切換選圖形"
                        : "滑過的字才入框（預設）；進入後再點可切換選圖形"
                    }
                  >
                    <Paintbrush className="w-3 h-3" />
                    {cropTool === "paint" && paintKind === "diagram"
                      ? "選圖形"
                      : "選文字"}
                  </button>
                  <button
                    type="button"
                    onClick={activateFrameTool}
                    className={`px-2 py-1 rounded-md text-[11px] font-bold transition flex items-center gap-1 ${
                      cropTool === "frame"
                        ? paintKind === "diagram"
                          ? "bg-sky-600 text-white shadow-2xs"
                          : "bg-indigo-600 text-white shadow-2xs"
                        : "text-slate-600 hover:bg-white"
                    }`}
                    title={
                      cropTool === "frame" && paintKind === "diagram"
                        ? "目前框圖形：再點一次切回框文字"
                        : cropTool === "frame"
                        ? "目前框文字：再點一次切換框圖形"
                        : "矩形框選題幹文字（預設）；進入後再點可切換框圖形"
                    }
                  >
                    <Crop className="w-3 h-3" />
                    {cropTool === "frame" && paintKind === "diagram"
                      ? "框圖形"
                      : "框文字"}
                  </button>
                </div>
                {canUndoSelection ? (
                  <button
                    type="button"
                    onClick={undoLastSelection}
                    className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100 whitespace-nowrap flex items-center gap-0.5"
                    title="復原上一筆選文字／選圖形或框選（不必全部清除）"
                  >
                    <Undo2 className="w-3 h-3" />
                    復原
                  </button>
                ) : null}
                {selectRegions.length > 0 || selectPaintStrokes.length > 0 ? (
                  <button
                    type="button"
                    onClick={clearSelectPaint}
                    className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 whitespace-nowrap"
                    title={
                      cropTool === "paint"
                        ? "清除全部畫選，重新描繪"
                        : "清除已鎖定的文字／圖形框"
                    }
                  >
                    清除
                  </button>
                ) : null}
                {cropTool === "frame" ? (
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
                        pushSelectHistory();
                        markCropDirty();
                        const full = { x: 0, y: 0, w: 1, h: 1 };
                        cropBoxRef.current = full;
                        setCropBox(full);
                        upsertFrameRegion(paintKindRef.current, full);
                      }}
                      className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 whitespace-nowrap"
                      title="裁切框貼齊照片四邊"
                    >
                      貼齊
                    </button>
                  </>
                ) : null}
              </div>
            )}
          </div>

          {/* Right: Shadow Removal, Zoom, Rotate and Undo Tools */}
          <div className="flex items-center gap-1 sm:gap-1.5 ml-auto shrink-0">
            {/* AI handwriting removal (Gemini image edit) */}
            <button
              type="button"
              onClick={() => void handleAiRemoveHandwriting()}
              disabled={isProcessing}
              className="px-2 sm:px-2.5 py-1 rounded-md text-[11px] font-bold text-violet-950 bg-violet-100 hover:bg-violet-200 active:scale-95 transition flex items-center gap-1 sm:gap-1.5 cursor-pointer whitespace-nowrap border border-violet-200 disabled:opacity-50"
              title="清除紅／藍筆、鉛筆，並以 AI 定位黑手寫後填紙色挖空（不重繪整頁）。需 Gemini API Key"
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
              onClick={() => {
                if (canUndoSelection) {
                  undoLastSelection();
                  return;
                }
                handleUndo();
              }}
              disabled={
                isProcessing || (!canUndoSelection && history.length === 0)
              }
              className="px-2 py-1 rounded-lg text-slate-600 hover:bg-slate-100 border border-slate-200 transition disabled:opacity-40 flex items-center gap-1"
              title={
                canUndoSelection
                  ? "復原上一筆選文字／選圖形或框選"
                  : "復原上一步影像處理"
              }
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

                {/* Paint-over text/diagram → tight multi-rect boxes */}
                {mode === "crop" && cropTool === "paint" && (
                  <div
                    className="absolute inset-0 z-30 cursor-crosshair touch-none"
                    onMouseDown={handleSelectPaintDown}
                    onTouchStart={handleSelectPaintDown}
                    style={{ touchAction: "none" }}
                  >
                    {selectRegions.map((r, idx) => {
                      const isDiagram = r.kind === "diagram";
                      return (
                      <div
                        key={`reg-${idx}`}
                        className={`absolute border-2 pointer-events-none rounded-sm ${
                          isDiagram
                            ? "border-sky-500 bg-sky-400/15"
                            : "border-emerald-500 bg-emerald-400/15"
                        }`}
                        style={{
                          left: `${r.x * 100}%`,
                          top: `${r.y * 100}%`,
                          width: `${r.width * 100}%`,
                          height: `${r.height * 100}%`,
                        }}
                      >
                        <div
                          className={`absolute -top-5 left-0 px-1.5 py-0.5 rounded text-white text-[9px] font-bold whitespace-nowrap ${
                            isDiagram ? "bg-sky-700/90" : "bg-emerald-700/90"
                          }`}
                        >
                          {isDiagram ? "圖區" : "文字區"}
                        </div>
                      </div>
                      );
                    })}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none">
                      {[
                        ...selectPaintStrokes.map((stroke, i) => ({
                          stroke,
                          kind: selectStrokeKinds[i] || "text",
                          key: `done-${i}`,
                        })),
                        ...(activeSelectStroke
                          ? [{ stroke: activeSelectStroke, kind: paintKind, key: "active" }]
                          : []),
                      ].map(({ stroke, kind, key }) => (
                          <polyline
                            key={key}
                            fill="none"
                            stroke={
                              kind === "diagram"
                                ? "rgba(14, 165, 233, 0.5)"
                                : "rgba(16, 185, 129, 0.45)"
                            }
                            strokeWidth={
                              Math.min(displayDimensions.width, displayDimensions.height) *
                              PAINT_PREVIEW_WIDTH
                            }
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={stroke
                              .map(
                                (p) =>
                                  `${p.x * displayDimensions.width},${p.y * displayDimensions.height}`
                              )
                              .join(" ")}
                          />
                        )
                      )}
                    </svg>
                  </div>
                )}

              </>
            )}
          </div>

          {/* Processing Spinner Overlay */}
          {isProcessing && (
            <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-xs flex flex-col items-center justify-center text-white z-40">
              <RefreshCw className="w-8 h-8 animate-spin text-sky-400 mb-2" />
              <div className="text-sm font-bold">{processingText}</div>
            </div>
          )}
        </div>

        {/* Status under image — never overlay on top of the crop preview */}
        {!isExistingQuestion && mode === "crop" && (
          <div
            className={`px-2 sm:px-5 py-1.5 text-[10px] sm:text-[11px] border-t shrink-0 ${
              selectRegions.length > 1
                ? "bg-emerald-50 text-emerald-900 border-emerald-100 font-semibold"
                : cropTool === "paint" && selectPaintStrokes.length > 0
                ? "bg-sky-50 text-sky-900 border-sky-100 font-medium"
                : cropTool === "frame" && selectRegions.length > 0
                ? "bg-sky-50 text-sky-900 border-sky-100 font-medium"
                : "bg-slate-50 text-slate-500 border-slate-100"
            }`}
          >
            {cropTool === "paint"
              ? selectRegions.length > 1
                ? `同一題 ${selectRegions.length} 區塊（文字／圖分開、不重疊）→ 按下方「加入此錯題」`
                : selectPaintStrokes.length > 0
                ? paintKind === "diagram"
                  ? "目前「選圖形」：畫地圖／圖形（與文字區不重疊）；再點按鈕可切回選文字"
                  : "已框住滑過的文字 → 再點「選文字」按鈕切成「選圖形」後畫地圖"
                : paintKind === "diagram"
                ? "「選圖形」：請畫地圖／圖形範圍；再點按鈕可切回選文字"
                : "「選文字」：滑到哪就框到哪，只含該行字高；再點同一按鈕可切換「選圖形」"
              : selectRegions.filter((r) => r.kind !== paintKind).length > 0
              ? paintKind === "diagram"
                ? "已鎖定文字區 → 調整「框圖形」矩形；兩者會一併裁切"
                : "已鎖定圖區 → 調整「框文字」矩形；兩者會一併裁切"
              : paintKind === "diagram"
              ? "「框圖形」：拖曳矩形框選地圖／圖形；再點按鈕可切回框文字（會保留雙區塊）"
              : "「框文字」：先框題幹；再點同一按鈕切換「框圖形」即可出現第二區塊"}
          </div>
        )}
        {!isExistingQuestion && pendingCrops.length > 0 && (
          <div className="px-2 sm:px-5 py-1.5 bg-emerald-50/90 border-t border-emerald-100 flex items-center gap-2 shrink-0 overflow-x-auto">
            <span className="text-[11px] font-bold text-emerald-800 whitespace-nowrap">
              已選 {pendingCrops.length} 題
            </span>
            <div className="flex items-center gap-1.5">
              {pendingCrops.map((crop, idx) => (
                <div
                  key={`pending-${idx}`}
                  className="relative w-12 h-12 rounded-lg overflow-hidden border border-emerald-300 bg-white shrink-0"
                >
                  <img
                    src={crop.imageBase64}
                    alt={`錯題 ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
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
                  title="切換至步驟 2：畫選範圍框出錯題"
                >
                  <Paintbrush className="w-3.5 h-3.5 text-sky-600" />
                  畫選範圍
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
                    disabled={isProcessing}
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
