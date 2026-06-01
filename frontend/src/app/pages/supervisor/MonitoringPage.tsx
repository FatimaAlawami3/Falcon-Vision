import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Navigation } from '../../components/Navigation';
import { Footer } from '../../components/Footer';
import {
  Camera,
  Play,
  Save,
  Square,
  X,
} from 'lucide-react';
import { WarningModal } from '../../components/WarningModal';
import { WarningConfirmModal } from '../../components/WarningConfirmModal';
import { clearAuthSession, getAccessToken } from '../../lib/auth';
import {
  clearAlertsHistory,
  type AlertResponse,
  deleteAlert,
  type FaceRecognitionResponse,
  type LivePPEResult,
  type FallDetectionResponse,
  type FireDetectionResponse,
  getFaceRecognitionStatus,
  getCurrentRegulation,
  getMonitoringSafetyWebSocketUrl,
  listAlerts,
  type MonitoringSessionReportDocument,
  saveMonitoringSessionReport,
  resolveStorageUrl,
  recognizeEmployeeFaces,
} from '../../lib/api';

const TRACKING_MIN_INTERVAL_MS = 8;
const TRACKING_SMOOTHING_FACTOR = 0.9;
const TRACKING_BOX_MAX_AGE_MS = 500;
// Keep a box alive across brief detection dropouts so it doesn't blink out.
const OVERLAY_MOVING_TRACK_MAX_MISSING_MS = 1500;
const OVERLAY_STATIONARY_TRACK_MAX_MISSING_MS = 1500;
const OVERLAY_PREDICTION_MAX_MS = 220; // how far ahead (ms) to project velocity between detections
const OVERLAY_REANCHOR_LEAD_MAX_MS = 230; // latency compensation when a fresh (stale) detection lands
const OVERLAY_PREDICTION_MAX_LEAD_FRACTION = 1.05; // cap the lead at this × box diagonal
const VELOCITY_SMOOTHING = 0.72; // EMA weight per new velocity sample (higher = more responsive)
const OVERLAY_MAX_CONSECUTIVE_MISSES = 2; // drop a track after this many unmatched detection frames
const OVERLAY_SMOOTHING_FACTOR = 0.95;
const OVERLAY_MOTION_IMMEDIATE_CATCHUP = 0.9;
const OVERLAY_MATCH_DISTANCE_THRESHOLD = 1.4;
const OVERLAY_MATCH_IOU_THRESHOLD = 0.01;
const OVERLAY_MOTION_CENTER_EPSILON = 0.003;
const OVERLAY_MOTION_SIZE_EPSILON = 0.01;
const OVERLAY_DUPLICATE_IOU_THRESHOLD = 0.45; // merge same-label boxes when they clearly overlap (one object)
const OVERLAY_DUPLICATE_PROXIMITY = 0.7; // ...or when clustered within ~one box-width (spread duplicates on one person)
const OVERLAY_DUPLICATE_FRAME_FLOOR = 0.1; // floor for tiny far-away boxes: treat the "box size" as >=10% of the frame
const PPE_OVERLAY_MIN_CONFIDENCE = 0.5; // higher → only confident, stable detections (cuts flicker/duplicates)
const PPE_NEGATIVE_OVERLAY_MIN_CONFIDENCE = 0.5;
const PPE_PAIRED_OVERLAY_MIN_CONFIDENCE = 0.35; // gloves/shoes/ear protectors are small — lower floor
// Client-side pixel tracker: follow each box by matching its patch against the
// live frame between server detections.
const PIXEL_TRACKER_ENABLED = true;
const PIXEL_TRACKER_SAMPLE_WIDTH = 160;
const PIXEL_TRACKER_INTERVAL_MS = 33;
const PIXEL_TRACKER_SEARCH_RADIUS = 12;
const PIXEL_TRACKER_SAMPLE_STRIDE = 3;
const PIXEL_TRACKER_MIN_AGE_MS = 20;
const PIXEL_TRACKER_MATCH_TOLERANCE = 30;
const PIXEL_TRACKER_MAX_SHIFT_RATIO = 0.12;
const DEFAULT_MONITORING_ZONE = 'production';
const MAX_INFERENCE_FRAME_WIDTH = 320;
const INFERENCE_JPEG_QUALITY = 0.6;
const FRAME_LOOP_INTERVAL_MS = 6;
const SAFETY_DETECTION_FRAME_SKIP = 1;
const FACE_DETECTION_INTERVAL_MS = 2000;
const HAZARD_DETECTION_INTERVAL_MS = 2000;
const DETECTION_WARMUP_MS = 0; // no warmup — detect as soon as the socket is open and the video has frames

type AlertRow = {
  id: string;
  occurredAt: string;
  date: string;
  time: string;
  image: string;
  imageUrl?: string | null;
  typeLabel: string;
  detail: string;
};

type AlertGroup = 'critical' | 'compliance' | 'other';

type OverlayTrack = {
  trackId: string;
  backendTrackId?: string | number | null;
  id: string;
  label: string;
  confidence?: number;
  borderColor: string;
  badgeColor: string;
  currentX1: number;
  currentY1: number;
  currentX2: number;
  currentY2: number;
  sourceWidth: number;
  sourceHeight: number;
  targetX1: number;
  targetY1: number;
  targetX2: number;
  targetY2: number;
  lastSeenAt: number;
  lastUpdatedAt: number;
  velocityX: number;
  velocityY: number;
  misses: number; // consecutive detection frames this track went unmatched; dropped past a small limit so ghosts never linger
};

type LocalFaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
};

type BrowserDetectedFace = {
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type BrowserFaceDetector = {
  detect: (source: ImageBitmapSource) => Promise<BrowserDetectedFace[]>;
};

declare global {
  interface Window {
    FaceDetector?: new (options?: {
      maxDetectedFaces?: number;
      fastMode?: boolean;
    }) => BrowserFaceDetector;
  }
}

type CapturedVideoFrame = {
  blob: Blob;
  width: number;
  height: number;
};

// A downscaled single-channel (luma) snapshot of the video, used by the
// client-side pixel tracker to follow boxes between server detections.
type GrayscaleFrame = {
  data: Uint8Array;
  width: number;
  height: number;
};

type SafetyModule = 'ppe' | 'fall' | 'fire';

type OverlayDetection = {
  id: string;
  backendTrackId?: string | number | null;
  label: string;
  confidence?: number;
  borderColor: string;
  badgeColor: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  sourceWidth: number;
  sourceHeight: number;
};

type RegulationSetupState = {
  status: 'checking' | 'ready' | 'missing';
  adminName?: string | null;
};

let nextOverlayTrackNumber = 1;

function clampCoordinate(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function normalizeDetectionBox(
  bbox: number[],
  sourceWidth: number,
  sourceHeight: number,
) {
  const [rawX1 = 0, rawY1 = 0, rawX2 = 0, rawY2 = 0] = bbox;
  const maxX = Math.max(sourceWidth, 0);
  const maxY = Math.max(sourceHeight, 0);
  const x1 = clampCoordinate(Math.min(rawX1, rawX2), 0, maxX);
  const y1 = clampCoordinate(Math.min(rawY1, rawY2), 0, maxY);
  const x2 = clampCoordinate(Math.max(rawX1, rawX2), 0, maxX);
  const y2 = clampCoordinate(Math.max(rawY1, rawY2), 0, maxY);

  return { x1, y1, x2, y2 };
}

function getPpeOverlayMinConfidence(className: string) {
  const normalizedClassName = className.trim().toLowerCase();

  // Gloves/shoes/ear protectors are small — on a 2nd/farther person they detect at
  // lower confidence. Use a lower floor so they still show, without loosening the
  // other (bigger) classes that don't need it.
  if (isPairedOverlayLabel(className)) {
    return PPE_PAIRED_OVERLAY_MIN_CONFIDENCE;
  }

  if (normalizedClassName.startsWith('no ')) {
    return PPE_NEGATIVE_OVERLAY_MIN_CONFIDENCE;
  }

  return PPE_OVERLAY_MIN_CONFIDENCE;
}

function shouldRenderPpeDetection(item: { class_name: string; confidence: number }) {
  return item.confidence >= getPpeOverlayMinConfidence(item.class_name);
}

async function captureVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): Promise<CapturedVideoFrame | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;

  if (!width || !height) {
    return null;
  }

  const scale = width > MAX_INFERENCE_FRAME_WIDTH ? MAX_INFERENCE_FRAME_WIDTH / width : 1;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  context.drawImage(video, 0, 0, targetWidth, targetHeight);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(null);
        return;
      }

      resolve({
        blob,
        width: targetWidth,
        height: targetHeight,
      });
    }, 'image/jpeg', INFERENCE_JPEG_QUALITY);
  });
}

// Pack a JPEG frame as a binary WebSocket message: a 4-byte big-endian header
// length, the UTF-8 JSON header, then the raw JPEG bytes. This avoids the
// base64/JSON.stringify round-trip (which inflates the payload by ~33% and adds
// async FileReader overhead) and lets the backend read metadata without
// decoding the image first.
async function buildSafetyFrameMessage(
  blob: Blob,
  header: Record<string, unknown>,
): Promise<ArrayBuffer> {
  const imageBytes = new Uint8Array(await blob.arrayBuffer());
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));

  const message = new Uint8Array(4 + headerBytes.length + imageBytes.length);
  new DataView(message.buffer).setUint32(0, headerBytes.length, false);
  message.set(headerBytes, 4);
  message.set(imageBytes, 4 + headerBytes.length);

  return message.buffer;
}

function getFaceOverlayLabel(result: FaceRecognitionResponse) {
  if (result.status === 'no_gallery') {
    return 'Face detected';
  }

  if (result.authorized) {
    return result.matched_employee_name || 'Authorized Employee';
  }

  if (result.matched_employee_id || result.matched_employee_name) {
    return 'Unauthorized person';
  }

  return 'Unknown person';
}

function getOverlayStyle(
  box: OverlayTrack,
  video: HTMLVideoElement | null,
) {
  if (box.sourceWidth <= 0 || box.sourceHeight <= 0 || !video) {
    return null;
  }

  const containerWidth = video.clientWidth;
  const containerHeight = video.clientHeight;
  if (!containerWidth || !containerHeight) {
    return null;
  }

  const scale = Math.min(
    containerWidth / box.sourceWidth,
    containerHeight / box.sourceHeight,
  );
  const renderedWidth = box.sourceWidth * scale;
  const renderedHeight = box.sourceHeight * scale;
  const offsetX = (containerWidth - renderedWidth) / 2;
  const offsetY = (containerHeight - renderedHeight) / 2;

  return {
    left: `${offsetX + box.currentX1 * scale}px`,
    top: `${offsetY + box.currentY1 * scale}px`,
    width: `${Math.max(box.currentX2 - box.currentX1, 0) * scale}px`,
    height: `${Math.max(box.currentY2 - box.currentY1, 0) * scale}px`,
  };
}

function getLocalFaceBoxStyle(
  box: LocalFaceBox,
  video: HTMLVideoElement | null,
) {
  if (box.sourceWidth <= 0 || box.sourceHeight <= 0 || !video) {
    return null;
  }

  const containerWidth = video.clientWidth;
  const containerHeight = video.clientHeight;
  if (!containerWidth || !containerHeight) {
    return null;
  }

  const scale = Math.min(
    containerWidth / box.sourceWidth,
    containerHeight / box.sourceHeight,
  );
  const renderedWidth = box.sourceWidth * scale;
  const renderedHeight = box.sourceHeight * scale;
  const offsetX = (containerWidth - renderedWidth) / 2;
  const offsetY = (containerHeight - renderedHeight) / 2;

  return {
    left: `${offsetX + box.x * scale}px`,
    top: `${offsetY + box.y * scale}px`,
    width: `${Math.max(box.width, 0) * scale}px`,
    height: `${Math.max(box.height, 0) * scale}px`,
  };
}

function strokeRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

// Draw all overlay boxes + labels onto a single canvas, fully cleared each call.
function drawOverlays(
  canvas: HTMLCanvasElement | null,
  video: HTMLVideoElement | null,
  tracks: OverlayTrack[],
  faceBox: LocalFaceBox | null,
) {
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const cssWidth = video?.clientWidth ?? 0;
  const cssHeight = video?.clientHeight ?? 0;
  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(cssWidth * dpr);
  const pixelHeight = Math.round(cssHeight * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  if (!video || !cssWidth || !cssHeight) {
    return;
  }

  const drawBox = (
    left: number,
    top: number,
    width: number,
    height: number,
    borderColor: string,
    badgeColor: string,
    label: string,
  ) => {
    ctx.lineWidth = 3;
    ctx.strokeStyle = borderColor;
    ctx.strokeRect(left, top, width, height);

    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const paddingX = 8;
    const badgeHeight = 20;
    const textWidth = ctx.measureText(label).width;
    const badgeWidth = textWidth + paddingX * 2;
    const badgeY = top - badgeHeight - 2;
    ctx.fillStyle = badgeColor;
    strokeRoundedRectPath(ctx, left, badgeY, badgeWidth, badgeHeight, 10);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, left + paddingX, badgeY + badgeHeight / 2 + 0.5);
  };

  for (const box of tracks) {
    const style = getOverlayStyle(box, video);
    if (!style) {
      continue;
    }
    const label =
      box.label + (typeof box.confidence === 'number' ? ` ${(box.confidence * 100).toFixed(0)}%` : '');
    drawBox(
      parseFloat(style.left),
      parseFloat(style.top),
      parseFloat(style.width),
      parseFloat(style.height),
      box.borderColor,
      box.badgeColor,
      label,
    );
  }

  if (faceBox) {
    const style = getLocalFaceBoxStyle(faceBox, video);
    if (style) {
      drawBox(
        parseFloat(style.left),
        parseFloat(style.top),
        parseFloat(style.width),
        parseFloat(style.height),
        '#f59e0b',
        '#b45309',
        'Face detected',
      );
    }
  }
}

function getOverlayPalette(label: string) {
  const normalized = label.toLowerCase();
  const exactPalette: Record<string, { borderColor: string; badgeColor: string }> = {
    Coverall: { borderColor: '#14b8a6', badgeColor: '#0f766e' },
    'No Coverall': { borderColor: '#0f766e', badgeColor: '#134e4a' },
    'Ear Protectors': { borderColor: '#8b5cf6', badgeColor: '#6d28d9' },
    'No Ear Protectors': { borderColor: '#6d28d9', badgeColor: '#4c1d95' },
    'Face Shield': { borderColor: '#a78bfa', badgeColor: '#7c3aed' },
    'No Face Shield': { borderColor: '#7c3aed', badgeColor: '#581c87' },
    Gloves: { borderColor: '#34d399', badgeColor: '#047857' },
    'No Gloves': { borderColor: '#10b981', badgeColor: '#065f46' },
    Helmet: { borderColor: '#fbbf24', badgeColor: '#b7791f' },
    'No Helmet': { borderColor: '#f59e0b', badgeColor: '#92400e' },
    Mask: { borderColor: '#22c55e', badgeColor: '#15803d' },
    'No Mask': { borderColor: '#16a34a', badgeColor: '#166534' },
    'Safety Glasses': { borderColor: '#c084fc', badgeColor: '#9333ea' },
    'No Safety Glasses': { borderColor: '#9333ea', badgeColor: '#6b21a8' },
    'Safety Harness': { borderColor: '#ec4899', badgeColor: '#be185d' },
    'No Safety Harness': { borderColor: '#db2777', badgeColor: '#9d174d' },
    'Safety Shoes': { borderColor: '#f97316', badgeColor: '#c2410c' },
    'No Safety Shoes': { borderColor: '#ea580c', badgeColor: '#9a3412' },
    'Safety Vest': { borderColor: '#60a5fa', badgeColor: '#2563eb' },
    'No Safety Vest': { borderColor: '#3b82f6', badgeColor: '#1d4ed8' },
    'Fall detected': { borderColor: '#ff4d4f', badgeColor: '#c44536' },
    Fire: { borderColor: '#ef4444', badgeColor: '#b91c1c' },
    Smoke: { borderColor: '#94a3b8', badgeColor: '#475569' },
  };

  if (exactPalette[label]) {
    return exactPalette[label];
  }

  if (normalized.includes('fall')) {
    return {
      borderColor: '#ff4d4f',
      badgeColor: '#c44536',
    };
  }

  if (normalized.includes('fire')) {
    return {
      borderColor: '#ef4444',
      badgeColor: '#b91c1c',
    };
  }

  if (normalized.includes('smoke')) {
    return {
      borderColor: '#94a3b8',
      badgeColor: '#475569',
    };
  }

  return {
    borderColor: '#ff8c42',
    badgeColor: '#b66b1f',
  };
}

function getOverlayIntersectionRatio(a: OverlayTrack, b: OverlayTrack) {
  const x1 = Math.max(a.currentX1, b.currentX1);
  const y1 = Math.max(a.currentY1, b.currentY1);
  const x2 = Math.min(a.currentX2, b.currentX2);
  const y2 = Math.min(a.currentY2, b.currentY2);
  const intersectionWidth = Math.max(0, x2 - x1);
  const intersectionHeight = Math.max(0, y2 - y1);
  const intersectionArea = intersectionWidth * intersectionHeight;
  const areaA = Math.max(0, a.currentX2 - a.currentX1) * Math.max(0, a.currentY2 - a.currentY1);
  const areaB = Math.max(0, b.currentX2 - b.currentX1) * Math.max(0, b.currentY2 - b.currentY1);
  // Overlap over the SMALLER box (not IoU) so a small box nested in a larger one
  // — a common duplicate — still scores ~1.0 and gets merged.
  const smaller = Math.min(areaA, areaB);

  return smaller > 0 ? intersectionArea / smaller : 0;
}

// Center distance between two tracks as a fraction of their average size
// (~0 same spot, ~1 one box-width apart). Lets us merge spread duplicates on one
// object while keeping far-apart boxes (different people) separate.
function getOverlayTrackCenterGap(a: OverlayTrack, b: OverlayTrack) {
  const ax = (a.currentX1 + a.currentX2) / 2;
  const ay = (a.currentY1 + a.currentY2) / 2;
  const bx = (b.currentX1 + b.currentX2) / 2;
  const by = (b.currentY1 + b.currentY2) / 2;
  const dist = Math.hypot(ax - bx, ay - by);
  const diagA = Math.hypot(a.currentX2 - a.currentX1, a.currentY2 - a.currentY1);
  const diagB = Math.hypot(b.currentX2 - b.currentX1, b.currentY2 - b.currentY1);
  const frameDiag = Math.hypot(a.sourceWidth, a.sourceHeight);
  // Floor the denominator so tiny far-away boxes don't make the gap blow up —
  // clustered duplicates still merge regardless of how small the boxes are.
  const denom = Math.max((diagA + diagB) / 2, OVERLAY_DUPLICATE_FRAME_FLOOR * frameDiag);
  return denom > 0 ? dist / denom : Number.POSITIVE_INFINITY;
}

function getPendingOverlayIntersectionRatio(a: OverlayDetection, b: OverlayDetection) {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const intersectionWidth = Math.max(0, x2 - x1);
  const intersectionHeight = Math.max(0, y2 - y1);
  const intersectionArea = intersectionWidth * intersectionHeight;
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  // Overlap over the SMALLER box (not IoU) so nested duplicate boxes still merge.
  const smaller = Math.min(areaA, areaB);

  return smaller > 0 ? intersectionArea / smaller : 0;
}

function getPendingOverlayCenterGap(a: OverlayDetection, b: OverlayDetection) {
  const ax = (a.x1 + a.x2) / 2;
  const ay = (a.y1 + a.y2) / 2;
  const bx = (b.x1 + b.x2) / 2;
  const by = (b.y1 + b.y2) / 2;
  const dist = Math.hypot(ax - bx, ay - by);
  const diagA = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
  const diagB = Math.hypot(b.x2 - b.x1, b.y2 - b.y1);
  const frameDiag = Math.hypot(a.sourceWidth, a.sourceHeight);
  // Floor the denominator so tiny far-away boxes don't make the gap blow up —
  // clustered duplicates still merge regardless of how small the boxes are.
  const denom = Math.max((diagA + diagB) / 2, OVERLAY_DUPLICATE_FRAME_FLOOR * frameDiag);
  return denom > 0 ? dist / denom : Number.POSITIVE_INFINITY;
}

// PPE that legitimately appears as a PAIR per person (two hands, two feet). For
// these, only a true overlap (same physical item detected twice) is a duplicate
// — proximity must NOT merge them, or the two gloves/shoes collapse into one.
// Matches both positive and "No …" variants.
const PAIRED_PPE_BASE_CLASSES = new Set(['gloves', 'safety shoes', 'ear protectors']);
function isPairedOverlayLabel(label: string) {
  return PAIRED_PPE_BASE_CLASSES.has(label.toLowerCase().replace(/^no\s+/, '').trim());
}

function getOverlayBackendTrackKey(overlay: Pick<OverlayTrack | OverlayDetection, 'id' | 'backendTrackId'>) {
  if (overlay.backendTrackId === undefined || overlay.backendTrackId === null || overlay.backendTrackId === '') {
    return null;
  }

  return `${getOverlayKind(overlay)}-${String(overlay.backendTrackId)}`;
}

function dedupeOverlayDetections(overlays: OverlayDetection[]) {
  const sortedOverlays = [...overlays].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const keptOverlays: OverlayDetection[] = [];

  sortedOverlays.forEach((overlay) => {
    const isDuplicate = keptOverlays.some((keptOverlay) => {
      // A backend track-id mismatch must NOT block dedupe: ByteTrack reassigns ids
      // on motion, so one object can carry two ids. Dedupe on label + overlap.
      if (
        keptOverlay.label !== overlay.label ||
        keptOverlay.sourceWidth !== overlay.sourceWidth ||
        keptOverlay.sourceHeight !== overlay.sourceHeight
      ) {
        return false;
      }

      // A real overlap is always a duplicate (same physical item detected twice).
      if (getPendingOverlayIntersectionRatio(keptOverlay, overlay) > OVERLAY_DUPLICATE_IOU_THRESHOLD) {
        return true;
      }
      // Paired items (gloves/shoes) legitimately appear twice on one person, so
      // only overlap merges them — never mere proximity. For single-per-person
      // classes, also merge spread boxes clustered within ~one box-width.
      if (isPairedOverlayLabel(overlay.label)) {
        return false;
      }
      return getPendingOverlayCenterGap(keptOverlay, overlay) < OVERLAY_DUPLICATE_PROXIMITY;
    });

    if (!isDuplicate) {
      keptOverlays.push(overlay);
    }
  });

  return keptOverlays;
}

function createOverlayTrack(
  overlay: OverlayDetection,
  now: number,
): OverlayTrack {
  const backendTrackKey = getOverlayBackendTrackKey(overlay);

  return {
    trackId: backendTrackKey ? `backend-${backendTrackKey}` : `track-${nextOverlayTrackNumber++}`,
    backendTrackId: overlay.backendTrackId,
    id: overlay.id,
    label: overlay.label,
    confidence: overlay.confidence,
    borderColor: overlay.borderColor,
    badgeColor: overlay.badgeColor,
    currentX1: overlay.x1,
    currentY1: overlay.y1,
    currentX2: overlay.x2,
    currentY2: overlay.y2,
    sourceWidth: overlay.sourceWidth,
    sourceHeight: overlay.sourceHeight,
    targetX1: overlay.x1,
    targetY1: overlay.y1,
    targetX2: overlay.x2,
    targetY2: overlay.y2,
    lastSeenAt: now,
    lastUpdatedAt: now,
    velocityX: 0,
    velocityY: 0,
    misses: 0,
  };
}

function getOverlayKind(overlay: Pick<OverlayTrack | OverlayDetection, 'id'>) {
  return overlay.id.split('-')[0] || overlay.id;
}

function shouldDedupeOverlayTrack(a: OverlayTrack, b: OverlayTrack) {
  // A backend track-id mismatch must NOT block dedupe: ByteTrack reassigns ids on
  // motion, so the same object can carry two ids. Dedupe on kind + label and let
  // the caller's overlap check decide.
  const kindA = getOverlayKind(a);
  const kindB = getOverlayKind(b);

  if (
    kindA !== kindB ||
    a.sourceWidth !== b.sourceWidth ||
    a.sourceHeight !== b.sourceHeight
  ) {
    return false;
  }

  return kindA === 'face' || a.label === b.label;
}

function isCompatibleTrackDetection(track: OverlayTrack, detection: OverlayDetection) {
  if (
    track.sourceWidth !== detection.sourceWidth ||
    track.sourceHeight !== detection.sourceHeight
  ) {
    return false;
  }

  const trackKind = getOverlayKind(track);
  const detectionKind = getOverlayKind(detection);

  if (trackKind !== detectionKind) {
    return false;
  }

  const trackBackendTrackKey = getOverlayBackendTrackKey(track);
  const detectionBackendTrackKey = getOverlayBackendTrackKey(detection);

  // A matching backend track id is a strong positive signal, but a MISMATCH must
  // not veto association: ByteTrack reassigns ids on fast motion at low frame
  // rates, so fall back to kind+label and let the distance scorer link
  // spatially-close boxes. Otherwise every frame spawns a new track (velocity
  // stays 0) and boxes freeze-then-jump instead of tracking.
  if (trackBackendTrackKey && detectionBackendTrackKey && trackBackendTrackKey === detectionBackendTrackKey) {
    return true;
  }

  return trackKind === 'face' || track.label === detection.label;
}

function getOverlayDisplayCenter(overlay: Pick<OverlayTrack, 'currentX1' | 'currentY1' | 'currentX2' | 'currentY2'>) {
  return {
    x: (overlay.currentX1 + overlay.currentX2) / 2,
    y: (overlay.currentY1 + overlay.currentY2) / 2,
  };
}

// Center of the last raw detection (target box) — used to measure velocity
// between consecutive detections rather than against the predicted display box.
function getOverlayTargetCenter(overlay: Pick<OverlayTrack, 'targetX1' | 'targetY1' | 'targetX2' | 'targetY2'>) {
  return {
    x: (overlay.targetX1 + overlay.targetX2) / 2,
    y: (overlay.targetY1 + overlay.targetY2) / 2,
  };
}

function getDetectionCenter(overlay: Pick<OverlayDetection, 'x1' | 'y1' | 'x2' | 'y2'>) {
  return {
    x: (overlay.x1 + overlay.x2) / 2,
    y: (overlay.y1 + overlay.y2) / 2,
  };
}

function getTrackDetectionCenterDistance(track: OverlayTrack, detection: OverlayDetection) {
  const trackCenter = getOverlayDisplayCenter(track);
  const detectionCenter = getDetectionCenter(detection);
  const distance = Math.hypot(trackCenter.x - detectionCenter.x, trackCenter.y - detectionCenter.y);
  const diagonal = Math.hypot(track.sourceWidth, track.sourceHeight);

  return diagonal > 0 ? distance / diagonal : Number.POSITIVE_INFINITY;
}

function getTrackDetectionIntersectionRatio(track: OverlayTrack, detection: OverlayDetection) {
  const x1 = Math.max(track.currentX1, detection.x1);
  const y1 = Math.max(track.currentY1, detection.y1);
  const x2 = Math.min(track.currentX2, detection.x2);
  const y2 = Math.min(track.currentY2, detection.y2);
  const intersectionWidth = Math.max(0, x2 - x1);
  const intersectionHeight = Math.max(0, y2 - y1);
  const intersectionArea = intersectionWidth * intersectionHeight;
  const trackArea = Math.max(0, track.currentX2 - track.currentX1) * Math.max(0, track.currentY2 - track.currentY1);
  const detectionArea = Math.max(0, detection.x2 - detection.x1) * Math.max(0, detection.y2 - detection.y1);
  const unionArea = trackArea + detectionArea - intersectionArea;

  return unionArea > 0 ? intersectionArea / unionArea : 0;
}

function getTrackDetectionMotion(track: OverlayTrack, detection: OverlayDetection) {
  // Compare the previous raw detection (target) to this one, not the predicted box.
  const trackCenter = getOverlayTargetCenter(track);
  const detectionCenter = getDetectionCenter(detection);
  const diagonal = Math.hypot(track.sourceWidth, track.sourceHeight);
  const centerDelta = diagonal > 0
    ? Math.hypot(trackCenter.x - detectionCenter.x, trackCenter.y - detectionCenter.y) / diagonal
    : Number.POSITIVE_INFINITY;
  const trackWidth = Math.max(1, track.targetX2 - track.targetX1);
  const trackHeight = Math.max(1, track.targetY2 - track.targetY1);
  const detectionWidth = Math.max(1, detection.x2 - detection.x1);
  const detectionHeight = Math.max(1, detection.y2 - detection.y1);
  const widthDelta = Math.abs(detectionWidth - trackWidth) / trackWidth;
  const heightDelta = Math.abs(detectionHeight - trackHeight) / trackHeight;
  const sizeDelta = Math.max(widthDelta, heightDelta);

  return {
    centerDelta,
    hasMeaningfulMotion:
      centerDelta > OVERLAY_MOTION_CENTER_EPSILON ||
      sizeDelta > OVERLAY_MOTION_SIZE_EPSILON,
  };
}

function getTrackSpeed(track: Pick<OverlayTrack, 'velocityX' | 'velocityY'>) {
  return Math.hypot(track.velocityX, track.velocityY);
}

function getTrackMissingTimeoutMs(track: OverlayTrack) {
  return getTrackSpeed(track) > 0
    ? OVERLAY_MOVING_TRACK_MAX_MISSING_MS
    : OVERLAY_STATIONARY_TRACK_MAX_MISSING_MS;
}

function keepLiveOverlayTracks(overlays: OverlayTrack[], now: number) {
  return overlays.filter((overlay) => now - overlay.lastSeenAt <= getTrackMissingTimeoutMs(overlay));
}

// Clamp a predicted lead vector to a fraction of the box diagonal (keeps small/far
// boxes with noisy velocity from being flung; direction preserved).
function clampLeadToBoxSize(
  dx: number,
  dy: number,
  box: Pick<OverlayTrack, 'currentX1' | 'currentY1' | 'currentX2' | 'currentY2'>,
) {
  const boxDiagonal = Math.hypot(box.currentX2 - box.currentX1, box.currentY2 - box.currentY1);
  const maxLead = OVERLAY_PREDICTION_MAX_LEAD_FRACTION * boxDiagonal;
  const magnitude = Math.hypot(dx, dy);
  if (magnitude <= maxLead || magnitude === 0) {
    return { x: dx, y: dy };
  }
  const scale = maxLead / magnitude;
  return { x: dx * scale, y: dy * scale };
}

function advanceOverlayTrack(overlay: OverlayTrack, now: number): OverlayTrack | null {
  const ageMs = now - overlay.lastSeenAt;
  const missingTimeoutMs = getTrackMissingTimeoutMs(overlay);

  if (ageMs > missingTimeoutMs) {
    return null;
  }

  // Project the box forward along its tracked velocity for the WHOLE gap between
  // detections (capped), not just the first moment — this compensates for the
  // server's inference latency so a fast-moving box keeps up instead of freezing
  // at the last detection. Stationary tracks have velocity 0, so they stay put
  // and never drift.
  const predictionMs = Math.min(ageMs, OVERLAY_PREDICTION_MAX_MS);
  // Clamp the lead to a fraction of the box's own size. A small/far box has a
  // noisy, inflated velocity (a few px of detection jitter is huge relative to a
  // tiny box), so an uncapped lead flings it around. Capping the lead to the box
  // size keeps a far box pinned on the object while still letting a large close
  // box lead generously.
  const { x: leadX, y: leadY } = clampLeadToBoxSize(
    overlay.velocityX * predictionMs,
    overlay.velocityY * predictionMs,
    overlay,
  );
  const predictedX1 = overlay.targetX1 + leadX;
  const predictedY1 = overlay.targetY1 + leadY;
  const predictedX2 = overlay.targetX2 + leadX;
  const predictedY2 = overlay.targetY2 + leadY;
  const alpha = OVERLAY_SMOOTHING_FACTOR;

  return {
    ...overlay,
    currentX1: overlay.currentX1 + (predictedX1 - overlay.currentX1) * alpha,
    currentY1: overlay.currentY1 + (predictedY1 - overlay.currentY1) * alpha,
    currentX2: overlay.currentX2 + (predictedX2 - overlay.currentX2) * alpha,
    currentY2: overlay.currentY2 + (predictedY2 - overlay.currentY2) * alpha,
    lastUpdatedAt: now,
  };
}

// Draw the current video frame to an offscreen canvas at reduced size and
// return its luma channel. Returns null if the frame isn't ready or the canvas
// is tainted (e.g. cross-origin stream).
function sampleVideoGrayscale(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  targetWidth: number,
): GrayscaleFrame | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) {
    return null;
  }

  const scale = Math.min(1, targetWidth / vw);
  const width = Math.max(1, Math.round(vw * scale));
  const height = Math.max(1, Math.round(vh * scale));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return null;
  }

  context.drawImage(video, 0, 0, width, height);
  let rgba: ImageData;
  try {
    rgba = context.getImageData(0, 0, width, height);
  } catch {
    return null;
  }

  const gray = new Uint8Array(width * height);
  const source = rgba.data;
  for (let i = 0, p = 0; i < source.length; i += 4, p += 1) {
    // Rec. 601 luma via an integer approximation (>> 8 == / 256).
    gray[p] = (source[i] * 77 + source[i + 1] * 150 + source[i + 2] * 29) >> 8;
  }
  return { data: gray, width, height };
}

// Estimate the integer (dx, dy) translation of a box patch between two
// grayscale frames using a small SAD block-matching search. Coordinates are in
// grayscale-frame pixels. Returns null when the patch is too small to match.
function estimateBoxTranslation(
  prev: GrayscaleFrame,
  curr: GrayscaleFrame,
  box: { x1: number; y1: number; x2: number; y2: number },
  searchRadius: number,
  stride: number,
): { dx: number; dy: number; meanAbsDiff: number } | null {
  if (prev.width !== curr.width || prev.height !== curr.height) {
    return null;
  }

  const { width, height } = prev;
  const bx1 = Math.max(0, Math.floor(box.x1));
  const by1 = Math.max(0, Math.floor(box.y1));
  const bx2 = Math.min(width - 1, Math.ceil(box.x2));
  const by2 = Math.min(height - 1, Math.ceil(box.y2));
  if (bx2 - bx1 < 6 || by2 - by1 < 6) {
    return null;
  }

  const prevData = prev.data;
  const currData = curr.data;
  let bestDx = 0;
  let bestDy = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let dy = -searchRadius; dy <= searchRadius; dy += 1) {
    for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
      let sum = 0;
      let count = 0;
      let aborted = false;
      for (let y = by1; y <= by2; y += stride) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) {
          aborted = true;
          break;
        }
        const prevRow = y * width;
        const currRow = ny * width;
        for (let x = bx1; x <= bx2; x += stride) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) {
            continue;
          }
          const diff = prevData[prevRow + x] - currData[currRow + nx];
          sum += diff < 0 ? -diff : diff;
          count += 1;
        }
      }
      if (aborted || count === 0) {
        continue;
      }
      // Tiny bias toward zero motion so static patches don't jitter on ties.
      const score = sum / count + (dx === 0 && dy === 0 ? 0 : 0.01);
      if (score < bestScore) {
        bestScore = score;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }

  if (!Number.isFinite(bestScore)) {
    return null;
  }
  return { dx: bestDx, dy: bestDy, meanAbsDiff: bestScore };
}

// Nudge a track's box to follow the actual pixels between server detections.
// Falls back to the unchanged (velocity-extrapolated) track whenever the match
// is weak, the patch is tiny, or the implied jump is implausibly large.
function applyPixelFlowToTrack(
  track: OverlayTrack,
  prev: GrayscaleFrame,
  curr: GrayscaleFrame,
  now: number,
): OverlayTrack {
  if (now - track.lastSeenAt < PIXEL_TRACKER_MIN_AGE_MS) {
    return track;
  }
  if (track.sourceWidth <= 0 || track.sourceHeight <= 0) {
    return track;
  }

  const scaleX = curr.width / track.sourceWidth;
  const scaleY = curr.height / track.sourceHeight;

  const result = estimateBoxTranslation(
    prev,
    curr,
    {
      x1: track.currentX1 * scaleX,
      y1: track.currentY1 * scaleY,
      x2: track.currentX2 * scaleX,
      y2: track.currentY2 * scaleY,
    },
    PIXEL_TRACKER_SEARCH_RADIUS,
    PIXEL_TRACKER_SAMPLE_STRIDE,
  );

  if (!result) {
    return track;
  }
  if (result.meanAbsDiff > PIXEL_TRACKER_MATCH_TOLERANCE) {
    return track;
  }
  if (result.dx === 0 && result.dy === 0) {
    return track;
  }

  const shiftX = result.dx / scaleX;
  const shiftY = result.dy / scaleY;
  if (
    Math.abs(shiftX) > track.sourceWidth * PIXEL_TRACKER_MAX_SHIFT_RATIO ||
    Math.abs(shiftY) > track.sourceHeight * PIXEL_TRACKER_MAX_SHIFT_RATIO
  ) {
    return track;
  }

  return {
    ...track,
    currentX1: track.currentX1 + shiftX,
    currentY1: track.currentY1 + shiftY,
    currentX2: track.currentX2 + shiftX,
    currentY2: track.currentY2 + shiftY,
    targetX1: track.targetX1 + shiftX,
    targetY1: track.targetY1 + shiftY,
    targetX2: track.targetX2 + shiftX,
    targetY2: track.targetY2 + shiftY,
    lastUpdatedAt: now,
  };
}

// Below this velocity (px/ms) an axis counts as "not moving" → correct freely.
const REANCHOR_DIRECTION_EPSILON = 0.02;

// Ease a coordinate toward the detection anchor, but never against the motion
// direction — avoids the box dipping back to a stale detection then catching up.
function reanchorNoBackstep(current: number, anchor: number, velocity: number) {
  const moved = current + (anchor - current) * OVERLAY_MOTION_IMMEDIATE_CATCHUP;
  if (velocity > REANCHOR_DIRECTION_EPSILON) {
    return Math.max(moved, current);
  }
  if (velocity < -REANCHOR_DIRECTION_EPSILON) {
    return Math.min(moved, current);
  }
  return moved;
}

function reconcileTracks(
  current: OverlayTrack[],
  incoming: OverlayDetection[],
  now: number,
) {
  const usedCurrentIndexes = new Set<number>();
  const nextOverlays: OverlayTrack[] = [];

  incoming.forEach((overlay) => {
    let bestMatchIndex = -1;
    let bestMatchScore = Number.POSITIVE_INFINITY;

    current.forEach((existing, currentIndex) => {
      if (usedCurrentIndexes.has(currentIndex)) {
        return;
      }

      if (!isCompatibleTrackDetection(existing, overlay)) {
        return;
      }

      const existingBackendTrackKey = getOverlayBackendTrackKey(existing);
      const overlayBackendTrackKey = getOverlayBackendTrackKey(overlay);

      if (existingBackendTrackKey && overlayBackendTrackKey && existingBackendTrackKey === overlayBackendTrackKey) {
        bestMatchScore = Number.NEGATIVE_INFINITY;
        bestMatchIndex = currentIndex;
        return;
      }

      const distance = getTrackDetectionCenterDistance(existing, overlay);
      const overlap = getTrackDetectionIntersectionRatio(existing, overlay);
      const isTrackCandidate =
        distance <= OVERLAY_MATCH_DISTANCE_THRESHOLD ||
        overlap >= OVERLAY_MATCH_IOU_THRESHOLD;

      if (!isTrackCandidate) {
        return;
      }

      // Weighted score: distance penalised, overlap rewarded.
      // Lower is better. Cap distance contribution so a fast-
      // moving box doesn't get orphaned just because it moved.
      const cappedDistance = Math.min(distance, OVERLAY_MATCH_DISTANCE_THRESHOLD);
      const score = cappedDistance * 1.5 - overlap * 2.0;
      if (score < bestMatchScore) {
        bestMatchScore = score;
        bestMatchIndex = currentIndex;
      }
    });

    if (bestMatchIndex >= 0) {
      usedCurrentIndexes.add(bestMatchIndex);
      const previous = current[bestMatchIndex];
      const elapsedMs = Math.max(now - previous.lastSeenAt, TRACKING_MIN_INTERVAL_MS);
      const previousCenter = getOverlayTargetCenter(previous);
      const nextCenter = getDetectionCenter(overlay);
      const motion = getTrackDetectionMotion(previous, overlay);
      const rawVelocityX = motion.hasMeaningfulMotion ? (nextCenter.x - previousCenter.x) / elapsedMs : 0;
      const rawVelocityY = motion.hasMeaningfulMotion ? (nextCenter.y - previousCenter.y) / elapsedMs : 0;
      // EMA of velocity: jitter averages out, consistent motion accumulates.
      const nextVelocityX = previous.velocityX * (1 - VELOCITY_SMOOTHING) + rawVelocityX * VELOCITY_SMOOTHING;
      const nextVelocityY = previous.velocityY * (1 - VELOCITY_SMOOTHING) + rawVelocityY * VELOCITY_SMOOTHING;
      // Re-anchor to a latency-compensated position, clamped to the box size.
      const leadMs = Math.min(elapsedMs, OVERLAY_REANCHOR_LEAD_MAX_MS);
      const { x: anchorLeadX, y: anchorLeadY } = clampLeadToBoxSize(
        nextVelocityX * leadMs,
        nextVelocityY * leadMs,
        { currentX1: overlay.x1, currentY1: overlay.y1, currentX2: overlay.x2, currentY2: overlay.y2 },
      );
      const anchorX1 = overlay.x1 + anchorLeadX;
      const anchorY1 = overlay.y1 + anchorLeadY;
      const anchorX2 = overlay.x2 + anchorLeadX;
      const anchorY2 = overlay.y2 + anchorLeadY;
      const nextCurrentX1 = reanchorNoBackstep(previous.currentX1, anchorX1, nextVelocityX);
      const nextCurrentY1 = reanchorNoBackstep(previous.currentY1, anchorY1, nextVelocityY);
      const nextCurrentX2 = reanchorNoBackstep(previous.currentX2, anchorX2, nextVelocityX);
      const nextCurrentY2 = reanchorNoBackstep(previous.currentY2, anchorY2, nextVelocityY);
      nextOverlays.push({
        ...previous,
        backendTrackId: overlay.backendTrackId ?? previous.backendTrackId,
        id: previous.id,
        label: overlay.label,
        confidence: overlay.confidence,
        borderColor: overlay.borderColor,
        badgeColor: overlay.badgeColor,
        currentX1: nextCurrentX1,
        currentY1: nextCurrentY1,
        currentX2: nextCurrentX2,
        currentY2: nextCurrentY2,
        sourceWidth: overlay.sourceWidth,
        sourceHeight: overlay.sourceHeight,
        targetX1: motion.hasMeaningfulMotion ? overlay.x1 : previous.targetX1,
        targetY1: motion.hasMeaningfulMotion ? overlay.y1 : previous.targetY1,
        targetX2: motion.hasMeaningfulMotion ? overlay.x2 : previous.targetX2,
        targetY2: motion.hasMeaningfulMotion ? overlay.y2 : previous.targetY2,
        lastSeenAt: now,
        lastUpdatedAt: now,
        velocityX: nextVelocityX,
        velocityY: nextVelocityY,
        misses: 0, // matched this frame → reset the miss counter
      });
      return;
    }

    nextOverlays.push(createOverlayTrack(overlay, now));
  });

  // Classes that were detected somewhere in THIS frame. An un-linked old track
  // of one of these classes is a ghost — the same object that moved or got a new
  // tracker id — so drop it instead of leaving it stranded at the old position.
  const seenThisFrame = new Set(incoming.map((overlay) => `${getOverlayKind(overlay)}|${overlay.label}`));

  current.forEach((overlay, currentIndex) => {
    if (usedCurrentIndexes.has(currentIndex)) {
      return;
    }
    if (now - overlay.lastSeenAt > getTrackMissingTimeoutMs(overlay)) {
      return;
    }
    if (seenThisFrame.has(`${getOverlayKind(overlay)}|${overlay.label}`)) {
      return; // same class already detected this frame → this leftover is a ghost
    }
    // Went unmatched this detection frame. Bridge a single dropped frame, but drop
    // the track once it misses too many in a row so a frozen ghost can never
    // linger (and never stack into a duplicate when its class reappears offset).
    const nextMisses = overlay.misses + 1;
    if (nextMisses >= OVERLAY_MAX_CONSECUTIVE_MISSES) {
      return;
    }
    nextOverlays.push({ ...overlay, misses: nextMisses });
  });

  return keepLiveOverlayTracks(nextOverlays, now).filter((overlay, overlayIndex) => {
    const newerDuplicateIndex = nextOverlays.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > overlayIndex &&
        shouldDedupeOverlayTrack(candidate, overlay) &&
        // Overlap = same physical item (always merge). Proximity-merge only for
        // single-per-person classes; paired items (gloves/shoes) keep both boxes.
        (getOverlayIntersectionRatio(candidate, overlay) > OVERLAY_DUPLICATE_IOU_THRESHOLD ||
          (!isPairedOverlayLabel(overlay.label) &&
            getOverlayTrackCenterGap(candidate, overlay) < OVERLAY_DUPLICATE_PROXIMITY)),
    );

    return newerDuplicateIndex < 0;
  });
}

const TrackManager = {
  advanceTrack: advanceOverlayTrack,
  dedupeDetections: dedupeOverlayDetections,
  keepLiveTracks: keepLiveOverlayTracks,
  reconcileTracks,
};

function getLargestDetectedFace(detections: BrowserDetectedFace[]) {
  if (!detections.length) {
    return null;
  }

  return detections.reduce((largest, current) => {
    const currentBox = current.boundingBox;
    const largestBox = largest.boundingBox;
    const currentArea = currentBox.width * currentBox.height;
    const largestArea = largestBox.width * largestBox.height;
    return currentArea > largestArea ? current : largest;
  });
}

function smoothFaceBox(
  previous: LocalFaceBox | null,
  next: LocalFaceBox,
  factor: number,
) {
  if (!previous || previous.sourceWidth !== next.sourceWidth || previous.sourceHeight !== next.sourceHeight) {
    return next;
  }

  return {
    x: previous.x + (next.x - previous.x) * factor,
    y: previous.y + (next.y - previous.y) * factor,
    width: previous.width + (next.width - previous.width) * factor,
    height: previous.height + (next.height - previous.height) * factor,
    sourceWidth: next.sourceWidth,
    sourceHeight: next.sourceHeight,
  };
}

function isTokenError(error: unknown) {
  return error instanceof Error && /invalid or expired token/i.test(error.message);
}

function isMissingFaceGalleryError(error: unknown) {
  return error instanceof Error && /no uploaded employee face images were found(?: for your organization)?/i.test(error.message);
}

function isFaceRecognitionDisabledError(error: unknown) {
  return error instanceof Error && /face recognition is disabled for this organization/i.test(error.message);
}

function getAlertTypeLabel(alert: Pick<AlertResponse, 'category' | 'message'>) {
  const message = alert.message.toLowerCase();

  if (alert.category === 'ppe') {
    return 'PPE Violation';
  }

  if (alert.category === 'fire_smoke') {
    if (message.includes('smoke')) {
      return 'Smoke Alert';
    }
    if (message.includes('fire')) {
      return 'Fire Alert';
    }
    return 'Fire / Smoke Alert';
  }

  if (alert.category === 'fall') {
    return 'Fall Alert';
  }

  if (alert.category === 'access_control') {
    if (message.includes('no face gallery')) {
      return 'Face Setup Alert';
    }
    return 'Access Alert';
  }

  return 'Alert';
}

function getAlertGroup(alert: Pick<AlertRow, 'typeLabel'>): AlertGroup {
  if (
    alert.typeLabel === 'Fire Alert' ||
    alert.typeLabel === 'Smoke Alert' ||
    alert.typeLabel === 'Fire / Smoke Alert' ||
    alert.typeLabel === 'Fall Alert'
  ) {
    return 'critical';
  }

  if (alert.typeLabel === 'PPE Violation') {
    return 'compliance';
  }

  return 'other';
}

function escapePdfText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapPdfText(value: string, maxChars = 92) {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [''];
  }

  const lines: string[] = [];
  let current = words[0];

  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    lines.push(current);
    current = word;
  }

  lines.push(current);
  return lines;
}

function buildMonitoringReportLines(report: MonitoringSessionReportDocument) {
  const lines: string[] = [];
  lines.push(`Falcon Vision Monitoring Session Report`);
  lines.push(`Saved At: ${new Date(report.saved_at).toLocaleString()}`);
  lines.push(`Report Name: ${report.report_name}`);
  lines.push('');
  lines.push('Supervisor');
  lines.push(`Name: ${report.supervisor.full_name || 'N/A'}`);
  lines.push(`Email: ${report.supervisor.email || 'N/A'}`);
  lines.push(`Role: ${report.supervisor.role || 'N/A'}`);
  lines.push('');
  lines.push('Session');
  lines.push(`Zone: ${report.session.zone}`);
  lines.push(`Started At: ${report.session.started_at ? new Date(report.session.started_at).toLocaleString() : 'N/A'}`);
  lines.push(`Ended At: ${report.session.ended_at ? new Date(report.session.ended_at).toLocaleString() : 'N/A'}`);
  lines.push(`Duration (seconds): ${report.session.duration_seconds ?? 'N/A'}`);
  lines.push(`Head Count: ${report.session.head_count ?? 'N/A'}`);
  lines.push(`Face Recognition Enabled: ${report.session.face_recognition_enabled ? 'Yes' : 'No'}`);
  lines.push(`Modules: ${report.session.modules.join(', ') || 'N/A'}`);
  lines.push('');
  lines.push('Active Regulation');
  lines.push(`Title: ${report.active_regulation?.title || 'N/A'}`);
  lines.push(`Version: ${report.active_regulation?.version ?? 'N/A'}`);
  lines.push(`Status: ${report.active_regulation?.status || 'N/A'}`);
  lines.push('');
  lines.push('Summary');
  lines.push(`Total Alerts: ${report.summary.total_alerts}`);
  lines.push(`Critical Alerts: ${report.summary.critical_alerts}`);
  lines.push(`Compliance Alerts: ${report.summary.compliance_alerts}`);
  lines.push(`Other Alerts: ${report.summary.other_alerts}`);
  lines.push(`Persisted Alerts: ${report.summary.persisted_alerts}`);
  lines.push(`Live-only Alerts: ${report.summary.live_only_alerts}`);
  lines.push('');
  lines.push('Alerts');

  if (report.alerts.length === 0) {
    lines.push('No alerts were recorded during this session.');
    return lines;
  }

  report.alerts.forEach((alert, index) => {
    lines.push(`${index + 1}. ${alert.type_label} - ${new Date(alert.occurred_at).toLocaleString()}`);
    lines.push(`Group: ${alert.group}`);
    lines.push(`Image Label: ${alert.image_label}`);
    lines.push(`Saved To DB: ${alert.persisted ? 'Yes' : 'No'}`);
    wrapPdfText(`Detail: ${alert.detail}`, 88).forEach((line) => lines.push(line));
    lines.push('');
  });

  return lines;
}

function buildPdfBlob(report: MonitoringSessionReportDocument) {
  const lines = buildMonitoringReportLines(report);
  const pageHeight = 792;
  const top = 760;
  const bottom = 48;
  const lineHeight = 16;
  const fontSize = 11;
  const pages: string[][] = [];

  let currentPage: string[] = [];
  let cursorY = top;

  for (const line of lines) {
    if (cursorY < bottom) {
      pages.push(currentPage);
      currentPage = [];
      cursorY = top;
    }

    currentPage.push(`BT /F1 ${fontSize} Tf 48 ${cursorY} Td (${escapePdfText(line)}) Tj ET`);
    cursorY -= lineHeight;
  }

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  const objects: string[] = [];
  objects.push('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj');

  const pageObjectIds = pages.map((_page, index) => 4 + index * 2);
  objects.push(`2 0 obj << /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >> endobj`);
  objects.push('3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj');

  pages.forEach((pageLines, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    const contentStream = pageLines.join('\n');
    objects.push(
      `${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >> endobj`,
    );
    objects.push(
      `${contentId} 0 obj << /Length ${contentStream.length} >> stream\n${contentStream}\nendstream endobj`,
    );
  });

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += `${object}\n`;
  }

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return new Blob([pdf], { type: 'application/pdf' });
}

function downloadPdfReport(filename: string, report: MonitoringSessionReportDocument) {
  const blob = buildPdfBlob(report);
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}

export function MonitoringPage() {
  const location = useLocation();
  const isAdminView = location.pathname.startsWith('/admin');
  const [headCount, setHeadCount] = useState<number | null>(null);
  const [modalState, setModalState] = useState({ isOpen: false, title: '', message: '' });
  const [alertConfirmState, setAlertConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: (() => void) | null;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
  });
  const [exitConfirm, setExitConfirm] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [, setIsRecognizing] = useState(false);
  const [, setRecognitionResult] = useState<FaceRecognitionResponse | null>(null);
  const [recognitionResults, setRecognitionResults] = useState<FaceRecognitionResponse[]>([]);
  const [cameraMessage, setCameraMessage] = useState('Start the camera to begin live monitoring.');
  const [hasLiveVideo, setHasLiveVideo] = useState(false);
  const [trackedFaceBox, setTrackedFaceBox] = useState<LocalFaceBox | null>(null);
  const [, setIsLocalTrackingEnabled] = useState(false);
  const [isFaceRecognitionActive, setIsFaceRecognitionActive] = useState(true);
  const [activeSafetyModules, setActiveSafetyModules] = useState<SafetyModule[]>(['ppe', 'fall', 'fire']);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [overlayTracks, setOverlayTracks] = useState<OverlayTrack[]>([]);
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [isSavingReport, setIsSavingReport] = useState(false);
  const [regulationSetupState, setRegulationSetupState] = useState<RegulationSetupState>({
    status: isAdminView ? 'ready' : 'checking',
    adminName: null,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackingInFlightRef = useRef(false);
  const faceDetectorRef = useRef<BrowserFaceDetector | null>(null);
  const trackingFrameRef = useRef<number | null>(null);
  const overlayAnimationFrameRef = useRef<number | null>(null);
  const flowCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevGrayRef = useRef<GrayscaleFrame | null>(null);
  const lastTrackingRunAtRef = useRef(0);
  const lastTrackedFaceBoxRef = useRef<LocalFaceBox | null>(null);
  const lastTrackedFaceAtRef = useRef(0);
  const faceVelocityRef = useRef({ x: 0, y: 0 }); // video px/ms, for predicting the face box between detects
  const safetySocketRef = useRef<WebSocket | null>(null);
  const sessionStartedAtRef = useRef<string | null>(null);
  const emptySafetyResultStreakRef = useRef(0);
  const safetyRequestSentAtRef = useRef(0);
  const safetyFrameSkipRef = useRef(0);
  const detectionWarmupUntilRef = useRef(0);
  const detectorInFlightRef = useRef({
    face: false,
    safety: false,
  });
  const lastDetectorRunAtRef = useRef({
    face: 0,
    safety: 0,
    hazard: 0,
  });

  const attachStreamToVideo = async () => {
    const video = videoRef.current;
    const stream = streamRef.current;

    if (!video) {
      return;
    }

    if (!stream) {
      if (!video.src) {
        return;
      }

      try {
        await video.play();
        setHasLiveVideo(video.videoWidth > 0 && video.videoHeight > 0);
      } catch {
        // Playback can fail briefly until metadata is ready.
      }
      return;
    }

    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }

    try {
      await video.play();
      setHasLiveVideo(video.videoWidth > 0 && video.videoHeight > 0);
    } catch {
      // Playback can fail briefly until metadata is ready.
    }
  };

  const lastAlertSignatureRef = useRef({
    face: '',
    ppe: '',
    fall: '',
    fire: '',
  });

  const addAlert = (image: string, typeLabel: string, detail: string, imageUrl?: string | null) => {
    const now = new Date();
    const nextAlert: AlertRow = {
      id: `${now.getTime()}-${typeLabel}-${image}`,
      occurredAt: now.toISOString(),
      date: now.toLocaleDateString('en-CA'),
      time: now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      image,
      imageUrl,
      typeLabel,
      detail,
    };

    setAlerts((current) => [nextAlert, ...current]);
  };

  const hasEvidencePreview = (alert: AlertRow) => Boolean(alert.imageUrl);
  const isPersistedAlert = (alert: AlertRow) => !alert.id.startsWith('live-');

  const mapSavedAlertRow = (alert: AlertResponse): AlertRow => {
    const detectedAt = new Date(alert.detected_at);
    return {
      id: alert.id,
      occurredAt: detectedAt.toISOString(),
      date: detectedAt.toLocaleDateString('en-CA'),
      time: detectedAt.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      image: alert.employee_name || alert.category,
      imageUrl: alert.evidence_image_data_url || resolveStorageUrl(alert.evidence_image_path),
      typeLabel: getAlertTypeLabel(alert),
      detail: alert.message,
    };
  };

  const mergeSavedAlerts = (savedAlerts: AlertResponse[]) => {
    if (!savedAlerts.length) {
      return;
    }

    setAlerts((current) => {
      const next = [...current];
      const sessionStartedAtMs = sessionStartedAtRef.current
        ? Date.parse(sessionStartedAtRef.current)
        : Number.NaN;

      savedAlerts.forEach((alert) => {
        if (
          Number.isFinite(sessionStartedAtMs) &&
          Date.parse(alert.detected_at) < sessionStartedAtMs
        ) {
          return;
        }

        if (next.some((item) => item.id === alert.id)) {
          return;
        }

        const savedRow = mapSavedAlertRow(alert);
        const liveIndex = next.findIndex(
          (item) =>
            item.id.startsWith('live-') &&
            item.typeLabel === savedRow.typeLabel &&
            item.detail === savedRow.detail,
        );

        if (liveIndex >= 0) {
          next[liveIndex] = savedRow;
          return;
        }

        next.unshift(savedRow);
      });

      return next;
    });
  };

  const syncAlertState = (
    key: 'face' | 'ppe' | 'fall' | 'fire',
    signature: string,
    image: string,
    detail: string,
  ) => {
    if (!signature) {
      lastAlertSignatureRef.current[key] = '';
      return;
    }

    if (lastAlertSignatureRef.current[key] === signature) {
      return;
    }

    lastAlertSignatureRef.current[key] = signature;
    addAlert(image, key === 'ppe' ? 'PPE Violation' : 'Alert', detail);
  };

  const updateRecognizingState = () => {
    const anyDetectorRunning = Object.values(detectorInFlightRef.current).some(Boolean);
    setIsRecognizing(anyDetectorRunning);
  };

  const stopTrackingLoop = () => {
    if (trackingFrameRef.current !== null) {
      window.cancelAnimationFrame(trackingFrameRef.current);
      trackingFrameRef.current = null;
    }
    if (overlayAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(overlayAnimationFrameRef.current);
      overlayAnimationFrameRef.current = null;
    }
    trackingInFlightRef.current = false;
    lastTrackingRunAtRef.current = 0;
    lastTrackedFaceBoxRef.current = null;
    lastTrackedFaceAtRef.current = 0;
  };

  const stopCameraStream = (options?: { preserveSessionData?: boolean }) => {
    const preserveSessionData = options?.preserveSessionData ?? false;
    stopTrackingLoop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }

    setHasLiveVideo(false);
    setTrackedFaceBox(null);
    setIsLocalTrackingEnabled(false);
    setIsStreaming(false);
    setIsRecognizing(false);
    setOverlayTracks([]);
    setIsSavingReport(false);
    detectorInFlightRef.current = {
      face: false,
      safety: false,
    };
    lastDetectorRunAtRef.current = {
      face: 0,
      safety: 0,
      hazard: 0,
    };
    emptySafetyResultStreakRef.current = 0;
    safetyRequestSentAtRef.current = 0;
    safetyFrameSkipRef.current = 0;
    detectionWarmupUntilRef.current = 0;
    safetySocketRef.current?.close();
    safetySocketRef.current = null;

    if (!preserveSessionData) {
      setIsFaceRecognitionActive(true);
      setRecognitionResult(null);
      setRecognitionResults([]);
      setHeadCount(null);
      setSessionStartedAt(null);
      sessionStartedAtRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopCameraStream();
      faceDetectorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (isAdminView) {
      setRegulationSetupState({ status: 'ready', adminName: null });
      return;
    }

    const token = getAccessToken();
    if (!token) {
      return;
    }

    let isCancelled = false;
    setRegulationSetupState((current) => ({
      status: current.status === 'missing' ? 'missing' : 'checking',
      adminName: current.adminName ?? null,
    }));

    getCurrentRegulation(token)
      .then((response) => {
        if (isCancelled) {
          return;
        }

        if (!response.regulation || response.summary.total_rules <= 0) {
          stopCameraStream();
          setRegulationSetupState({
            status: 'missing',
            adminName: response.admin_name ?? null,
          });
          return;
        }

        setRegulationSetupState({
          status: 'ready',
          adminName: response.admin_name ?? null,
        });
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }

        if (isTokenError(error)) {
          clearAuthSession();
          setModalState({
            isOpen: true,
            title: 'Session Expired',
            message: 'Your login session expired. Please log in again.',
          });
          window.setTimeout(() => {
            window.location.href = '/login';
          }, 300);
          return;
        }

        stopCameraStream();
        setRegulationSetupState({ status: 'missing', adminName: null });
      });

    return () => {
      isCancelled = true;
    };
  }, [isAdminView]);

  useEffect(() => {
    if (!isStreaming) {
      return;
    }

    const token = getAccessToken();
    if (!token) {
      return;
    }

    let isCancelled = false;

    const refreshSavedAlerts = async () => {
      try {
        const response = await listAlerts(token, 20);
        if (isCancelled) {
          return;
        }

        mergeSavedAlerts(response.items.filter((alert) => Boolean(alert.evidence_image_path)));
      } catch (error) {
        if (isTokenError(error)) {
          return;
        }
        console.error('Could not refresh saved alert evidence:', error);
      }
    };

    void refreshSavedAlerts();
    const intervalId = window.setInterval(refreshSavedAlerts, 2500);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isStreaming]);

  useEffect(() => {
    if (!isStreaming) {
      return;
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }

    const handleReady = () => {
      setHasLiveVideo(video.videoWidth > 0 && video.videoHeight > 0);
      void attachStreamToVideo();
    };

    video.addEventListener('loadedmetadata', handleReady);
    video.addEventListener('canplay', handleReady);
    void attachStreamToVideo();

    return () => {
      video.removeEventListener('loadedmetadata', handleReady);
      video.removeEventListener('canplay', handleReady);
    };
  }, [isStreaming]);

  useEffect(() => {
    if (!isStreaming || !hasLiveVideo) {
      return;
    }

    let isCancelled = false;
    let lastFlowAt = 0;

    const animateOverlays = () => {
      if (isCancelled) {
        return;
      }

      const now = performance.now();

      // Snapshot the live frame once per animation frame for the pixel tracker.
      let currGray: GrayscaleFrame | null = null;
      const video = videoRef.current;
      if (
        PIXEL_TRACKER_ENABLED &&
        video &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        now - lastFlowAt >= PIXEL_TRACKER_INTERVAL_MS
      ) {
        lastFlowAt = now;
        if (!flowCanvasRef.current) {
          flowCanvasRef.current = document.createElement('canvas');
        }
        currGray = sampleVideoGrayscale(video, flowCanvasRef.current, PIXEL_TRACKER_SAMPLE_WIDTH);
      }
      const prevGray = prevGrayRef.current;

      setOverlayTracks((current) => {
        if (current.length === 0) {
          return current;
        }

        const advanced = current
          .map((overlay) => TrackManager.advanceTrack(overlay, now))
          .filter((overlay): overlay is OverlayTrack => Boolean(overlay));

        if (!currGray || !prevGray) {
          return advanced;
        }
        const framePrev = prevGray;
        const frameCurr = currGray;
        return advanced.map((overlay) => applyPixelFlowToTrack(overlay, framePrev, frameCurr, now));
      });

      if (currGray) {
        prevGrayRef.current = currGray;
      }

      // Project the face box forward between (slow) browser detects so it follows
      // continuously instead of freezing at the last detection.
      const faceAnchor = lastTrackedFaceBoxRef.current;
      if (faceAnchor && now - lastTrackedFaceAtRef.current <= TRACKING_BOX_MAX_AGE_MS) {
        const lead = Math.min(now - lastTrackedFaceAtRef.current, OVERLAY_PREDICTION_MAX_MS);
        let dx = faceVelocityRef.current.x * lead;
        let dy = faceVelocityRef.current.y * lead;
        const maxLead = OVERLAY_PREDICTION_MAX_LEAD_FRACTION * Math.hypot(faceAnchor.width, faceAnchor.height);
        const mag = Math.hypot(dx, dy);
        if (mag > maxLead && mag > 0) {
          dx *= maxLead / mag;
          dy *= maxLead / mag;
        }
        setTrackedFaceBox({ ...faceAnchor, x: faceAnchor.x + dx, y: faceAnchor.y + dy });
      }

      overlayAnimationFrameRef.current = window.requestAnimationFrame(animateOverlays);
    };

    overlayAnimationFrameRef.current = window.requestAnimationFrame(animateOverlays);

    return () => {
      isCancelled = true;
      prevGrayRef.current = null;
      if (overlayAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(overlayAnimationFrameRef.current);
        overlayAnimationFrameRef.current = null;
      }
    };
  }, [isStreaming, hasLiveVideo]);

  // The instant monitoring stops, wipe overlay state so stale/frozen detection
  // boxes can never linger on screen after the camera goes offline.
  useEffect(() => {
    if (!isStreaming) {
      setOverlayTracks([]);
      prevGrayRef.current = null;
    }
  }, [isStreaming]);

  // Render every overlay box onto the single canvas. Runs on each track change
  // (~60fps while moving) and fully clears+redraws — no per-box DOM, so the GPU
  // can never retain a "frozen" ghost box, during streaming or after stop.
  useEffect(() => {
    const hasRecogFace = overlayTracks.some((overlay) => overlay.id.startsWith('face-recognition'));
    const faceBox = isStreaming && hasLiveVideo && trackedFaceBox && !hasRecogFace ? trackedFaceBox : null;
    drawOverlays(
      overlayCanvasRef.current,
      videoRef.current,
      isStreaming && hasLiveVideo ? overlayTracks : [],
      faceBox,
    );
  }, [overlayTracks, trackedFaceBox, isStreaming, hasLiveVideo]);

  useEffect(() => {
    if (!isStreaming || !hasLiveVideo) {
      return;
    }

    let isCancelled = false;

    const runTracking = async () => {
      if (isCancelled) {
        return;
      }

      const detector = faceDetectorRef.current;
      const video = videoRef.current;
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        trackingFrameRef.current = window.requestAnimationFrame(runTracking);
        return;
      }

      const now = performance.now();
      if (
        trackingInFlightRef.current ||
        now - lastTrackingRunAtRef.current < TRACKING_MIN_INTERVAL_MS
      ) {
        trackingFrameRef.current = window.requestAnimationFrame(runTracking);
        return;
      }

      trackingInFlightRef.current = true;
      lastTrackingRunAtRef.current = now;

      try {
        const activeDetector = detector;
        if (!activeDetector) {
          setIsLocalTrackingEnabled(false);
          setTrackedFaceBox(null);
          trackingFrameRef.current = window.requestAnimationFrame(runTracking);
          return;
        }

        const detections = await activeDetector.detect(video);
        const largestFace = getLargestDetectedFace(detections);
        const box = largestFace?.boundingBox;

        if (!box) {
          if (lastTrackedFaceBoxRef.current && now - lastTrackedFaceAtRef.current <= TRACKING_BOX_MAX_AGE_MS) {
            setTrackedFaceBox(lastTrackedFaceBoxRef.current);
          } else {
            lastTrackedFaceBoxRef.current = null;
            setTrackedFaceBox(null);
          }
        } else {
          setIsLocalTrackingEnabled(true);
          const nextBox = {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            sourceWidth: video.videoWidth,
            sourceHeight: video.videoHeight,
          };
          const smoothedBox = smoothFaceBox(
            lastTrackedFaceBoxRef.current,
            nextBox,
            TRACKING_SMOOTHING_FACTOR,
          );

          // Velocity from the previous anchor to this detection (for forward projection).
          const previousAnchor = lastTrackedFaceBoxRef.current;
          const dtMs = Math.max(now - lastTrackedFaceAtRef.current, TRACKING_MIN_INTERVAL_MS);
          if (previousAnchor && dtMs <= TRACKING_BOX_MAX_AGE_MS) {
            const prevCx = previousAnchor.x + previousAnchor.width / 2;
            const prevCy = previousAnchor.y + previousAnchor.height / 2;
            const nextCx = smoothedBox.x + smoothedBox.width / 2;
            const nextCy = smoothedBox.y + smoothedBox.height / 2;
            faceVelocityRef.current = { x: (nextCx - prevCx) / dtMs, y: (nextCy - prevCy) / dtMs };
          } else {
            faceVelocityRef.current = { x: 0, y: 0 };
          }

          lastTrackedFaceBoxRef.current = smoothedBox;
          lastTrackedFaceAtRef.current = now;
          setTrackedFaceBox(smoothedBox);
        }
      } catch {
        faceDetectorRef.current = null;
        setIsLocalTrackingEnabled(false);
        lastTrackedFaceBoxRef.current = null;
        setTrackedFaceBox(null);
      } finally {
        trackingInFlightRef.current = false;
      }

      if (!isCancelled) {
        trackingFrameRef.current = window.requestAnimationFrame(runTracking);
      }
    };

    void runTracking();

    return () => {
      isCancelled = true;
      stopTrackingLoop();
    };
  }, [isStreaming, hasLiveVideo]);

  // Handle face recognition overlays
  useEffect(() => {
    const now = performance.now();
    const visibleFaceResults = recognitionResults.filter(
      (result) => result.face_box && result.status !== 'no_face',
    );

    if (visibleFaceResults.length === 0) {
      setOverlayTracks((current) =>
        TrackManager.keepLiveTracks(current, now)
      );
      return;
    }

    const faceOverlays: OverlayDetection[] = visibleFaceResults.map((result, index) => ({
      id: `face-recognition-${index}`,
      backendTrackId: result.matched_face_id || result.matched_employee_id || null,
      label: getFaceOverlayLabel(result),
      confidence: result.score || undefined,
      borderColor: result.authorized ? '#10b981' : '#ef4444',
      badgeColor: result.authorized ? '#10b981' : '#ef4444',
      x1: result.face_box!.x1,
      y1: result.face_box!.y1,
      x2: result.face_box!.x2,
      y2: result.face_box!.y2,
      sourceWidth: result.face_box!.image_width,
      sourceHeight: result.face_box!.image_height,
    }));

    setOverlayTracks((current) => {
      return TrackManager.reconcileTracks(current, TrackManager.dedupeDetections(faceOverlays), now);
    });
  }, [recognitionResults]);

  useEffect(() => {
    if (!isStreaming) {
      return;
    }

    const token = getAccessToken();
    if (!token) {
      stopCameraStream();
      setModalState({
        isOpen: true,
        title: 'Session Expired',
        message: 'Please log in again before using live monitoring.',
      });
      return;
    }

    let isCancelled = false;
    let timerId: number | null = null;

    const scheduleNextLoop = (delayMs = FRAME_LOOP_INTERVAL_MS) => {
      if (!isCancelled) {
        timerId = window.setTimeout(runMonitoringLoop, delayMs);
      }
    };

    const handleTokenExpiry = () => {
      if (isCancelled) {
        return;
      }

      isCancelled = true;
      stopCameraStream();
      clearAuthSession();
      setModalState({
        isOpen: true,
        title: 'Session Expired',
        message: 'Your login session expired. Please log in again.',
      });
      window.setTimeout(() => {
        window.location.href = '/login';
      }, 300);
    };

    const closeSafetySocket = () => {
      safetySocketRef.current?.close();
      safetySocketRef.current = null;
    };

    const applySafetyResult = (safetyResult: {
      ppe: LivePPEResult;
      fall: FallDetectionResponse;
      fire: FireDetectionResponse;
      alerts?: AlertResponse[];
      frame_width?: number;
      frame_height?: number;
    }) => {
      const now = performance.now();
      const frameWidth = typeof safetyResult.frame_width === 'number' ? safetyResult.frame_width : MAX_INFERENCE_FRAME_WIDTH;
      const frameHeight = typeof safetyResult.frame_height === 'number' ? safetyResult.frame_height : Math.round(MAX_INFERENCE_FRAME_WIDTH * 9 / 16);
      const renderablePpeItems = safetyResult.ppe.detected_items.filter(shouldRenderPpeDetection);
      const hasDetections =
        renderablePpeItems.length > 0 ||
        safetyResult.fall.detections.length > 0 ||
        safetyResult.fire.detections.length > 0;
      emptySafetyResultStreakRef.current = hasDetections ? 0 : emptySafetyResultStreakRef.current + 1;

      const nextOverlays = TrackManager.dedupeDetections([
        ...renderablePpeItems.map((item, index) => {
          const palette = getOverlayPalette(item.class_name);
          const sourceWidth = safetyResult.ppe.image_width || frameWidth;
          const sourceHeight = safetyResult.ppe.image_height || frameHeight;
          const box = normalizeDetectionBox(item.bbox, sourceWidth, sourceHeight);
          const backendTrackId = null; // PPE boxes match spatially; no backend id needed
          return {
            id: `ppe-${index}-${item.class_name}`,
            backendTrackId,
            label: item.class_name,
            confidence: item.confidence,
            borderColor: palette.borderColor,
            badgeColor: palette.badgeColor,
            x1: box.x1,
            y1: box.y1,
            x2: box.x2,
            y2: box.y2,
            sourceWidth,
            sourceHeight,
          };
        }),
        ...safetyResult.fall.detections
          .filter((item) => item.is_fallen)
          .map((item, index) => {
            const palette = getOverlayPalette('Fall detected');
            const box = normalizeDetectionBox(item.bbox, frameWidth, frameHeight);
            const backendTrackId = item.track_id ?? item.person_id ?? null;
            return {
              id: backendTrackId !== null ? `fall-${backendTrackId}` : `fall-${index}-${item.person_id}`,
              backendTrackId,
              label: 'Fall detected',
              confidence: item.confidence,
              borderColor: palette.borderColor,
              badgeColor: palette.badgeColor,
              x1: box.x1,
              y1: box.y1,
              x2: box.x2,
              y2: box.y2,
              sourceWidth: frameWidth,
              sourceHeight: frameHeight,
            };
          }),
        ...safetyResult.fire.detections.map((item, index) => {
          const palette = getOverlayPalette(item.class);
          const box = normalizeDetectionBox(item.bbox, frameWidth, frameHeight);
          const backendTrackId = item.track_id ?? null;
          return {
            id: backendTrackId !== null ? `fire-${backendTrackId}-${item.class}` : `fire-${index}-${item.class}`,
            backendTrackId,
            label: item.class,
            confidence: item.confidence,
            borderColor: palette.borderColor,
            badgeColor: palette.badgeColor,
            x1: box.x1,
            y1: box.y1,
            x2: box.x2,
            y2: box.y2,
            sourceWidth: frameWidth,
            sourceHeight: frameHeight,
          };
        }),
      ]);

      setOverlayTracks((current) => TrackManager.reconcileTracks(current, nextOverlays, now));

      if (Array.isArray(safetyResult.alerts) && safetyResult.alerts.length > 0) {
        setAlerts((current) => {
          const existingIds = new Set(current.map((alert) => alert.id));
          const mapped = safetyResult.alerts
            .filter((alert) => !existingIds.has(alert.id))
            .map((alert) => ({
              ...mapSavedAlertRow(alert),
              imageUrl:
                alert.evidence_image_data_url ||
                resolveStorageUrl(alert.evidence_image_path),
            }));

          return [...mapped, ...current];
        });
      }

      setHeadCount((current) => (safetyResult.fall.people_count > 0 ? safetyResult.fall.people_count : current));
      setActiveSafetyModules((currentModules) => {
        const nextModules = new Set(currentModules);
        const fallDetail = (safetyResult.fall as FallDetectionResponse & { detail?: string }).detail;
        const fireWasSkipped = safetyResult.fire.reason === 'Skipped for this frame';

        if (safetyResult.ppe.status === 'clear' || safetyResult.ppe.status === 'violation') {
          nextModules.add('ppe');
        } else if (safetyResult.ppe.status === 'inactive' || safetyResult.ppe.status === 'skipped') {
          nextModules.delete('ppe');
        }

        if (fallDetail !== 'Skipped for this frame') {
          if (safetyResult.fall.fall_detection_active) {
            nextModules.add('fall');
          } else {
            nextModules.delete('fall');
          }
        }

        if (!fireWasSkipped) {
          if (safetyResult.fire.fire_detection_active) {
            nextModules.add('fire');
          } else {
            nextModules.delete('fire');
          }
        }

        return Array.from(nextModules);
      });
    };

    const runFaceRecognition = async (capturedFrame: CapturedVideoFrame) => {
      detectorInFlightRef.current.face = true;
      updateRecognizingState();

      try {
        const result = await recognizeEmployeeFaces(capturedFrame.blob, token);
        if (isCancelled) {
          return;
        }

        const faces = result.faces ?? [];
        const firstFace = faces[0] ?? null;
        setRecognitionResults(faces);
        setRecognitionResult(firstFace);
        setCameraMessage(
          result.status === 'no_face' || faces.length === 0
            ? 'Camera is live. No face is currently visible to the model.'
            : result.status === 'no_gallery'
              ? 'Camera is live. Faces were detected, but no employee face gallery is uploaded for this organization.'
              : 'Camera is live and face, PPE, fall, and fire monitoring are running.',
        );

        const faceAlerts = faces
          .map((face) => face.alert)
          .filter((alert): alert is AlertResponse => Boolean(alert));

        if (faceAlerts.length > 0) {
          setAlerts((current) => {
            const existingIds = new Set(current.map((alert) => alert.id));
            const nextAlerts = faceAlerts
              .filter((alert) => !existingIds.has(alert.id))
              .map((alert) => {
                const detectedAt = new Date(alert.detected_at);
                return {
                  id: alert.id,
                  occurredAt: detectedAt.toISOString(),
                  date: detectedAt.toLocaleDateString('en-CA'),
                  time: detectedAt.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                  image: alert.employee_name || alert.category,
                  imageUrl: resolveStorageUrl(alert.evidence_image_path),
                  typeLabel: getAlertTypeLabel(alert),
                  detail: alert.message,
                };
              });

            return [...nextAlerts, ...current];
          });
        }

        syncAlertState('face', '', '', '');
      } catch (error) {
        if (isTokenError(error)) {
          handleTokenExpiry();
          return;
        }

        if (isMissingFaceGalleryError(error)) {
          setRecognitionResult(null);
          setRecognitionResults([]);
          setCameraMessage('Camera is live, but no employee face images have been uploaded for this organization yet.');
          syncAlertState('face', '', '', '');
        } else if (isFaceRecognitionDisabledError(error)) {
          setRecognitionResult(null);
          setRecognitionResults([]);
          setIsFaceRecognitionActive(false);
          syncAlertState('face', '', '', '');
        } else {
          console.error('Face recognition failed:', error);
          setRecognitionResult(null);
          setRecognitionResults([]);
          setCameraMessage('Camera is live. Face recognition is unavailable right now, but monitoring continues.');
        }
      } finally {
        detectorInFlightRef.current.face = false;
        updateRecognizingState();
      }
    };

    const initializeSafetySocket = () => {
      if (safetySocketRef.current) {
        return;
      }

      const socket = new WebSocket(getMonitoringSafetyWebSocketUrl(token));
      socket.binaryType = 'arraybuffer';
      safetySocketRef.current = socket;

      socket.onmessage = (event) => {
        if (isCancelled) {
          return;
        }

        try {
          const payload =
            typeof event.data === 'string'
              ? JSON.parse(event.data)
              : JSON.parse(new TextDecoder().decode(event.data)) as {
                  type?: string;
                  detail?: string;
                  ppe: LivePPEResult;
                  fall: FallDetectionResponse;
                  fire: FireDetectionResponse;
                  frame_width?: number;
                  frame_height?: number;
                  alerts?: AlertResponse[];
                };

          if (payload.type === 'safety_result') {
            applySafetyResult(payload);
          } else if (payload.type === 'error') {
            console.error('Safety websocket error:', payload.detail);
          }
        } catch (error) {
          console.error('Failed to parse safety websocket payload:', error);
        } finally {
          detectorInFlightRef.current.safety = false;
          updateRecognizingState();
        }
      };

      socket.onclose = (event) => {
        console.error('Safety websocket closed', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });
        detectorInFlightRef.current.safety = false;
        updateRecognizingState();
        if (safetySocketRef.current === socket) {
          safetySocketRef.current = null;
        }
      };

      socket.onerror = (event) => {
        console.error('Safety websocket transport error', event);
        detectorInFlightRef.current.safety = false;
        updateRecognizingState();
      };
    };

    const runSafetyDetection = async (capturedFrame: CapturedVideoFrame, modules: SafetyModule[]) => {
      detectorInFlightRef.current.safety = true;
      updateRecognizingState();

      try {
        const socket = safetySocketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          detectorInFlightRef.current.safety = false;
          updateRecognizingState();
          return;
        }

        const message = await buildSafetyFrameMessage(capturedFrame.blob, {
          type: 'frame',
          frame_width: capturedFrame.width,
          frame_height: capturedFrame.height,
          zone_type: DEFAULT_MONITORING_ZONE,
          modules,
        });
        if (isCancelled) {
          return;
        }

        socket.send(message);
        safetyRequestSentAtRef.current = performance.now();
      } catch (error) {
        console.error('Safety monitoring failed:', error);
        detectorInFlightRef.current.safety = false;
        updateRecognizingState();
      }
    };

    const runMonitoringLoop = async () => {
      if (isCancelled) {
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        scheduleNextLoop();
        return;
      }

      const now = performance.now();
      const isDetectionWarmingUp = now < detectionWarmupUntilRef.current;
      const shouldRunFaceRecognition =
        !isDetectionWarmingUp &&
        isFaceRecognitionActive &&
        !detectorInFlightRef.current.face &&
        now - lastDetectorRunAtRef.current.face >= FACE_DETECTION_INTERVAL_MS;
      const isSafetyFrameEligible =
        !isDetectionWarmingUp &&
        safetySocketRef.current?.readyState === WebSocket.OPEN &&
        !detectorInFlightRef.current.safety &&
        now - lastDetectorRunAtRef.current.safety >= FRAME_LOOP_INTERVAL_MS;
      const shouldRunSafetyDetection =
        isSafetyFrameEligible &&
        safetyFrameSkipRef.current % SAFETY_DETECTION_FRAME_SKIP === 0;

      if (isDetectionWarmingUp) {
        scheduleNextLoop(Math.min(120, detectionWarmupUntilRef.current - now));
        return;
      }

      if (isSafetyFrameEligible) {
        safetyFrameSkipRef.current = (safetyFrameSkipRef.current + 1) % SAFETY_DETECTION_FRAME_SKIP;

        if (!shouldRunSafetyDetection) {
          lastDetectorRunAtRef.current.safety = now;
        }
      }

      if (!shouldRunFaceRecognition && !shouldRunSafetyDetection) {
        scheduleNextLoop();
        return;
      }

      const capturedFrame = await captureVideoFrame(video, canvas);
      if (!capturedFrame) {
        scheduleNextLoop();
        return;
      }

      if (shouldRunFaceRecognition) {
        lastDetectorRunAtRef.current.face = now;
        void runFaceRecognition(capturedFrame);
      }

      if (shouldRunSafetyDetection) {
        const shouldRunHazards = now - lastDetectorRunAtRef.current.hazard >= HAZARD_DETECTION_INTERVAL_MS;
        const safetyModules: SafetyModule[] = shouldRunHazards
          ? ['ppe', 'fall', 'fire']
          : ['ppe'];

        if (shouldRunHazards) {
          lastDetectorRunAtRef.current.hazard = now;
        }

        lastDetectorRunAtRef.current.safety = now;
        detectorInFlightRef.current.safety = true;
        updateRecognizingState();
        void runSafetyDetection(capturedFrame, safetyModules);
      }

      scheduleNextLoop();
    };

    initializeSafetySocket();
    void runMonitoringLoop();

    return () => {
      isCancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      closeSafetySocket();
    };
  }, [isFaceRecognitionActive, isStreaming]);

  const handleStartCamera = async () => {
    const token = getAccessToken();
    if (!token) {
      setModalState({
        isOpen: true,
        title: 'Session Expired',
        message: 'Please log in again before starting the live camera feed.',
      });
      return;
    }

    try {
      const video = videoRef.current;
      if (!video) {
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setModalState({
          isOpen: true,
          title: 'Camera Unsupported',
          message: 'Your browser does not support webcam access for live monitoring.',
        });
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      let faceRecognitionEnabled = true;
      try {
        const status = await getFaceRecognitionStatus(token);
        faceRecognitionEnabled = status.enabled;
      } catch (error) {
        if (isTokenError(error)) {
          clearAuthSession();
          setModalState({
            isOpen: true,
            title: 'Session Expired',
            message: 'Your login session expired. Please log in again.',
          });
          window.setTimeout(() => {
            window.location.href = '/login';
          }, 300);
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
      }

      streamRef.current = stream;
      video.removeAttribute('src');
      video.srcObject = stream;
      video.loop = false;
      video.muted = true;
      video.playsInline = true;

      setRecognitionResult(null);
      setRecognitionResults([]);
      setHasLiveVideo(false);
      setTrackedFaceBox(null);
      setIsLocalTrackingEnabled(false);
      setIsFaceRecognitionActive(faceRecognitionEnabled);
      setActiveSafetyModules(['ppe', 'fall', 'fire']);
      setHeadCount(null);
      setAlerts([]);
      setOverlayTracks([]);
      const nextSessionStartedAt = new Date().toISOString();
      setSessionStartedAt(nextSessionStartedAt);
      sessionStartedAtRef.current = nextSessionStartedAt;
      detectionWarmupUntilRef.current = performance.now() + DETECTION_WARMUP_MS;
      lastDetectorRunAtRef.current = {
        face: detectionWarmupUntilRef.current - FACE_DETECTION_INTERVAL_MS,
        safety: detectionWarmupUntilRef.current - FRAME_LOOP_INTERVAL_MS,
        hazard: detectionWarmupUntilRef.current - HAZARD_DETECTION_INTERVAL_MS,
      };
      safetyFrameSkipRef.current = 0;
      lastAlertSignatureRef.current = {
        face: '',
        ppe: '',
        fall: '',
        fire: '',
      };
      faceDetectorRef.current = window.FaceDetector
        ? new window.FaceDetector({
            maxDetectedFaces: 10,
            fastMode: true,
          })
        : null;
      setCameraMessage('Camera is live. Detection will start after the stream stabilizes.');
      setIsStreaming(true);
      window.setTimeout(() => {
        if (detectionWarmupUntilRef.current > 0) {
          setCameraMessage('Camera is live and monitoring is running.');
        }
      }, DETECTION_WARMUP_MS);

      try {
        await video.play();
      } catch {
        // The ready-state effect will retry playback when the video metadata is available.
      }
    } catch (error) {
      setModalState({
        isOpen: true,
        title: 'Camera Access Failed',
        message:
          error instanceof Error
            ? error.message
            : 'The browser could not open your camera.',
      });
    }
  };

  const handleStopCamera = () => {
    stopCameraStream({ preserveSessionData: true });
    setCameraMessage('Camera stopped. Start the stream again when you want to resume monitoring.');
  };

  const handleSave = async () => {
    const token = getAccessToken();
    if (!token) {
      setModalState({
        isOpen: true,
        title: 'Session Expired',
        message: 'Please log in again before saving the monitoring session report.',
      });
      return;
    }

    const endedAt = new Date().toISOString();
    const sessionAlerts = alerts.filter((alert) => {
      if (!sessionStartedAt) {
        return true;
      }

      return Date.parse(alert.occurredAt) >= Date.parse(sessionStartedAt);
    });

    setIsSavingReport(true);
    try {
      const response = await saveMonitoringSessionReport(
        {
          started_at: sessionStartedAt,
          ended_at: endedAt,
          head_count: headCount,
          zone: DEFAULT_MONITORING_ZONE,
          face_recognition_enabled: isFaceRecognitionActive,
          modules: [
            ...(activeSafetyModules.includes('ppe') ? ['ppe_detection'] : []),
            ...(activeSafetyModules.includes('fall') ? ['fall_detection'] : []),
            ...(activeSafetyModules.includes('fire') ? ['fire_smoke_detection'] : []),
            ...(isFaceRecognitionActive ? ['face_access_control'] : []),
          ],
          alerts: sessionAlerts.map((alert) => ({
            alert_id: isPersistedAlert(alert) ? alert.id : null,
            occurred_at: alert.occurredAt,
            image_label: alert.image,
            type_label: alert.typeLabel,
            detail: alert.detail,
            group: getAlertGroup(alert),
            persisted: isPersistedAlert(alert),
          })),
        },
        token,
      );

      const pdfFilename = response.filename.replace(/\.json$/i, '.pdf');
      downloadPdfReport(pdfFilename, response.report);
      setModalState({
        isOpen: true,
        title: 'Report Saved',
        message: 'The monitoring session report was saved and downloaded to this device as a PDF.',
      });
    } catch (error) {
      if (isTokenError(error)) {
        handleTokenExpiry();
        return;
      }

      setModalState({
        isOpen: true,
        title: 'Save Failed',
        message:
          error instanceof Error
            ? error.message
            : 'The monitoring session report could not be saved right now.',
      });
    } finally {
      setIsSavingReport(false);
    }
  };

  const handleExitClick = () => {
    setExitConfirm(true);
  };

  const handleExitConfirm = () => {
    setExitConfirm(false);
    stopCameraStream();
    window.history.back();
  };

  const handleExitCancel = () => {
    setExitConfirm(false);
  };

  const promptDeleteMonitoringAlert = (alert: AlertRow) => {
    setAlertConfirmState({
      isOpen: true,
      title: 'Delete Violation',
      message: isPersistedAlert(alert)
        ? 'This will remove the selected violation from alert history.'
        : 'This will remove the live violation card from this monitoring view.',
      onConfirm: () => {
        const removeLocalAlert = () => {
          setAlerts((current) => current.filter((item) => item.id !== alert.id));
        };

        if (!isPersistedAlert(alert)) {
          removeLocalAlert();
          return;
        }

        const token = getAccessToken();
        if (!token) {
          showWarning('Please log in again before deleting this violation.');
          return;
        }

        void deleteAlert(alert.id, token)
          .then(() => {
            removeLocalAlert();
          })
          .catch((error) => {
            if (isTokenError(error)) {
              clearAuthSession();
              setModalState({
                isOpen: true,
                title: 'Session Expired',
                message: 'Your login session expired. Please log in again.',
              });
              window.setTimeout(() => {
                window.location.href = '/login';
              }, 300);
              return;
            }

            showWarning(error instanceof Error ? error.message : 'Failed to delete the selected violation.');
          });
      },
    });
  };

  const promptClearMonitoringAlerts = () => {
    setAlertConfirmState({
      isOpen: true,
      title: 'Clear Alert History',
      message: 'This will remove all alert history records for your company and clear the monitoring list.',
      onConfirm: () => {
        const token = getAccessToken();
        if (!token) {
          setAlerts([]);
          return;
        }

        void clearAlertsHistory(token)
          .then(() => {
            setAlerts([]);
          })
          .catch((error) => {
            if (isTokenError(error)) {
              clearAuthSession();
              setModalState({
                isOpen: true,
                title: 'Session Expired',
                message: 'Your login session expired. Please log in again.',
              });
              window.setTimeout(() => {
                window.location.href = '/login';
              }, 300);
              return;
            }

            showWarning(error instanceof Error ? error.message : 'Failed to clear alert history.');
          });
      },
    });
  };

  const criticalAlerts = useMemo(
    () => alerts.filter((alert) => getAlertGroup(alert) === 'critical'),
    [alerts],
  );
  const ppeAlerts = useMemo(
    () => alerts.filter((alert) => getAlertGroup(alert) === 'compliance'),
    [alerts],
  );
  const otherAlerts = useMemo(
    () => alerts.filter((alert) => getAlertGroup(alert) === 'other'),
    [alerts],
  );

  const renderAlertSection = (
    title: string,
    sectionAlerts: AlertRow[],
    emptyText: string,
    tone: 'critical' | 'compliance' | 'other',
  ) => {
    const toneClasses =
      tone === 'critical'
        ? {
            title: 'text-[#9e2a2b]',
            badge: 'bg-red-100 text-red-700',
            border: 'border-red-200',
          }
        : tone === 'compliance'
          ? {
              title: 'text-[#b45309]',
              badge: 'bg-orange-100 text-orange-700',
              border: 'border-orange-200',
            }
          : {
              title: 'text-[#475569]',
              badge: 'bg-slate-100 text-slate-700',
              border: 'border-slate-200',
            };

    return (
      <div className={`rounded-2xl border p-4 ${toneClasses.border}`}>
        <h3 className={`font-serif text-xl mb-4 ${toneClasses.title}`}>{title}</h3>
        {sectionAlerts.length > 0 ? (
          <div className="space-y-3">
            {sectionAlerts.map((alert, index) => (
              <div
                key={alert.id || `${alert.date}-${alert.time}-${alert.typeLabel}-${index}`}
                className="rounded-2xl border border-[#e5dcc9] bg-[#f9f6f0] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-[#6b5d4f]">
                      {alert.date} at {alert.time}
                    </p>
                    <span className={`mt-2 inline-block px-3 py-1 rounded-full text-sm ${toneClasses.badge}`}>
                      {alert.typeLabel}
                    </span>
                    <p className="mt-2 text-sm text-[#4a3c2a]">{alert.detail}</p>
                  </div>
                  <div className="shrink-0">
                    {hasEvidencePreview(alert) ? (
                      <div className="flex flex-col items-end gap-2">
                        <div className="w-16 h-16 rounded-lg overflow-hidden border-2 border-[#d4cbb7]">
                          <img
                            src={alert.imageUrl}
                            alt="Detected event"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => promptDeleteMonitoringAlert(alert)}
                          className="rounded-full border border-[#d4bfa7] bg-white px-3 py-1.5 text-xs text-[#8b4a32] shadow-sm transition-colors hover:bg-[#fff3e6]"
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-end gap-2">
                        <span className="text-xs text-[#8b7355]">No image</span>
                        <button
                          type="button"
                          onClick={() => promptDeleteMonitoringAlert(alert)}
                          className="rounded-full border border-[#d4bfa7] bg-white px-3 py-1.5 text-xs text-[#8b4a32] shadow-sm transition-colors hover:bg-[#fff3e6]"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#6b5d4f]">{emptyText}</p>
        )}
      </div>
    );
  };

  if (!isAdminView && regulationSetupState.status !== 'ready') {
    const adminText = regulationSetupState.adminName
      ? `your admin ${regulationSetupState.adminName}`
      : 'your admin';
    const isCheckingRegulation = regulationSetupState.status === 'checking';

    return (
      <div className="min-h-screen flex flex-col bg-[#f5f3ed]">
        <Navigation isAdmin={false} />

        <div className="flex-1 py-12 px-6">
          <div className="max-w-3xl mx-auto">
            <div className="bg-white rounded-3xl shadow-xl p-8 border border-[#d4cbb7] text-center">
              <h1 className="font-serif text-4xl text-[#4a3c2a] mb-4">
                {isCheckingRegulation ? 'Checking monitoring setup...' : 'No regulation uploaded'}
              </h1>
              <p className="text-[#6b5d4f] text-lg leading-relaxed">
                {isCheckingRegulation
                  ? 'Please wait while Falcon Vision checks whether your company regulation is ready.'
                  : `No regulation uploaded. ${adminText} should upload the company regulation first.`}
              </p>
            </div>
          </div>
        </div>

        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#f5f3ed]">
      <Navigation isAdmin={isAdminView} />

      <div className="flex-1 py-12 px-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="font-serif text-4xl text-[#4a3c2a] mb-8">Supervisor – Monitoring & Alert Notification</h1>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7]">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                  <h2 className="font-serif text-2xl text-[#4a3c2a]">Live Camera Feed</h2>

                  <div className="flex gap-3">
                    {!isStreaming ? (
                      <button
                        onClick={handleStartCamera}
                        className="flex items-center gap-2 bg-[#ff8c42] text-white px-5 py-2.5 rounded-full shadow-md hover:bg-[#ff7a2e] transition-colors"
                      >
                        <Play className="w-4 h-4" />
                        Start Camera
                      </button>
                    ) : (
                      <button
                        onClick={handleStopCamera}
                        className="flex items-center gap-2 bg-gray-700 text-white px-5 py-2.5 rounded-full shadow-md hover:bg-gray-800 transition-colors"
                      >
                        <Square className="w-4 h-4" />
                        Stop Camera
                      </button>
                    )}
                  </div>
                </div>

                <div className="aspect-video bg-gray-900 rounded-2xl relative overflow-hidden">
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    className={`h-full w-full object-contain transition-opacity ${
                      hasLiveVideo ? 'opacity-100' : 'opacity-0'
                    }`}
                  />

                  {/* Single canvas for ALL detection overlays — cleared and redrawn
                      every frame, so no per-box DOM layers can leave frozen ghosts. */}
                  <canvas
                    ref={overlayCanvasRef}
                    className="absolute inset-0 h-full w-full pointer-events-none"
                  />

                  <div className="absolute top-4 left-4 bg-red-600 px-3 py-1 rounded flex items-center gap-2">
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                    <span className="text-white text-sm font-semibold">{isStreaming ? 'LIVE' : 'OFFLINE'}</span>
                  </div>

                  {(!isStreaming || !hasLiveVideo) && (
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center p-6">
                      <div className="text-center text-white max-w-sm">
                        <Camera className="w-12 h-12 mx-auto mb-3" />
                        <p className="text-lg font-medium mb-2">
                          {isStreaming ? 'Connecting to camera...' : 'Camera is ready'}
                        </p>
                        <p className="text-sm text-white/85">
                          {isStreaming
                            ? 'The browser opened your camera. Waiting for the live video frames to appear.'
                            : cameraMessage}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-2xl border border-[#e5dcc9] bg-[#f9f6f0] p-4">
                  <p className="text-sm text-[#6b5d4f]">{cameraMessage}</p>
                </div>
              </div>

              {headCount !== null && (
              <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="text-[#6b5d4f]">Head Count</p>
                      <p className="font-serif text-3xl text-[#4a3c2a]">{headCount}</p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <button
                      onClick={handleSave}
                      disabled={isSavingReport}
                      className="flex items-center gap-2 bg-[#ff8c42] text-white px-6 py-3 rounded-full shadow-md transition-colors hover:bg-[#ff7a2e] disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <Save className="w-5 h-5" />
                      {isSavingReport ? 'Saving...' : 'Save Session Report'}
                    </button>
                    <button
                      onClick={handleExitClick}
                      className="flex items-center gap-2 bg-gray-600 text-white px-6 py-3 rounded-full shadow-md hover:bg-gray-700 transition-colors"
                    >
                      <X className="w-5 h-5" />
                      Exit
                    </button>
                  </div>
                </div>
              </div>
              )}
            </div>

            <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7] space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-serif text-2xl text-[#4a3c2a]">Real-Time Monitoring Feed</h2>
                <button
                  type="button"
                  onClick={promptClearMonitoringAlerts}
                  className="rounded-full border border-[#d4bfa7] bg-white px-4 py-2 text-sm text-[#8b4a32] shadow-sm transition-colors hover:bg-[#fff3e6]"
                >
                  Clear History
                </button>
              </div>
              {alerts.length === 0 ? (
                <div className="rounded-2xl border border-[#d4cbb7] bg-[#f9f6f0] p-6 text-center text-[#6b5d4f] text-sm">
                  Start the camera to begin live PPE, fall, fire/smoke, and face recognition monitoring.
                </div>
              ) : (
                <>
                  {renderAlertSection(
                    'Critical Alerts',
                    criticalAlerts,
                    'No fire, smoke, or fall alerts have been detected yet.',
                    'critical',
                  )}
                  {renderAlertSection(
                    'PPE Violations',
                    ppeAlerts,
                    'No PPE violations have been detected yet.',
                    'compliance',
                  )}
                  {renderAlertSection(
                    'Other Alerts',
                    otherAlerts,
                    'No access or setup alerts have been detected yet.',
                    'other',
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />

      <WarningModal
        isOpen={modalState.isOpen}
        onClose={() => setModalState({ ...modalState, isOpen: false })}
        title={modalState.title}
        message={modalState.message}
      />

      <WarningConfirmModal
        isOpen={exitConfirm}
        onCancel={handleExitCancel}
        onConfirm={handleExitConfirm}
        title="Warning!"
        message="Are you sure you want to exit monitoring?"
      />
      <WarningConfirmModal
        isOpen={alertConfirmState.isOpen}
        onCancel={() => setAlertConfirmState({ isOpen: false, title: '', message: '', onConfirm: null })}
        onConfirm={() => {
          const action = alertConfirmState.onConfirm;
          setAlertConfirmState({ isOpen: false, title: '', message: '', onConfirm: null });
          action?.();
        }}
        title={alertConfirmState.title}
        message={alertConfirmState.message}
      />

      <Footer />
    </div>
  );
}

