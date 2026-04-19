import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Navigation } from '../../components/Navigation';
import { Footer } from '../../components/Footer';
import {
  Camera,
  Play,
  Save,
  Square,
  Users,
  X,
} from 'lucide-react';
import { WarningModal } from '../../components/WarningModal';
import { WarningConfirmModal } from '../../components/WarningConfirmModal';
import { clearAuthSession, getAccessToken } from '../../lib/auth';
import {
  type AlertResponse,
  type FaceRecognitionResponse,
  type LivePPEResult,
  type FallDetectionResponse,
  type FireDetectionResponse,
  getFaceRecognitionStatus,
  getMonitoringSafetyWebSocketUrl,
  resolveStorageUrl,
  recognizeEmployeeFace,
} from '../../lib/api';
import liveFeedImage from '../../../assets/images/live-feed.png';

const TRACKING_MIN_INTERVAL_MS = 16;
const TRACKING_SMOOTHING_FACTOR = 0.65;
const TRACKING_BOX_MAX_AGE_MS = 120;
const OVERLAY_TRACKING_SMOOTHING_FACTOR = 0.42;
const TRACKED_OVERLAY_MAX_AGE_MS = 1600;
const OVERLAY_MATCH_DISTANCE_THRESHOLD = 0.35;
const DEFAULT_MONITORING_ZONE = 'production';
const MAX_INFERENCE_FRAME_WIDTH = 960;
const INFERENCE_JPEG_QUALITY = 0.8;
const FRAME_LOOP_INTERVAL_MS = 60;
const FACE_DETECTION_INTERVAL_MS = 1200;

type AlertRow = {
  id: string;
  date: string;
  time: string;
  image: string;
  imageUrl?: string | null;
  violation: string;
};

type DetectionOverlay = {
  id: string;
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
  targetX1: number;
  targetY1: number;
  targetX2: number;
  targetY2: number;
  lastSeenAt: number;
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

function formatRecognitionStatus(
  result: FaceRecognitionResponse | null,
  hasDetectedFace: boolean,
  isRecognitionPending: boolean,
) {
  if (hasDetectedFace && isRecognitionPending) {
    return 'Face detected. Waiting for recognition';
  }

  if (!result) {
    return hasDetectedFace ? 'Face detected. Waiting for recognition' : 'Waiting for recognition';
  }

  if (result.status === 'no_face') {
    return 'No face detected';
  }

  if (result.status === 'no_gallery') {
    return 'Face detected. No uploaded employee face gallery is available.';
  }

  return result.authorized ? 'Authorized employee detected' : 'Unauthorized or unknown face';
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
  box: DetectionOverlay,
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
    left: `${offsetX + box.x1 * scale}px`,
    top: `${offsetY + box.y1 * scale}px`,
    width: `${Math.max(box.x2 - box.x1, 0) * scale}px`,
    height: `${Math.max(box.y2 - box.y1, 0) * scale}px`,
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

function getOverlayCenterDistance(a: DetectionOverlay, b: DetectionOverlay) {
  const centerAX = (a.targetX1 + a.targetX2) / 2;
  const centerAY = (a.targetY1 + a.targetY2) / 2;
  const centerBX = (b.targetX1 + b.targetX2) / 2;
  const centerBY = (b.targetY1 + b.targetY2) / 2;

  const dx = centerAX - centerBX;
  const dy = centerAY - centerBY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const diagonal = Math.sqrt(
    a.sourceWidth * a.sourceWidth +
    a.sourceHeight * a.sourceHeight,
  );

  return diagonal > 0 ? distance / diagonal : Number.POSITIVE_INFINITY;
}

function createTrackedOverlay(
  overlay: Omit<DetectionOverlay, 'targetX1' | 'targetY1' | 'targetX2' | 'targetY2' | 'lastSeenAt'>,
  now: number,
): DetectionOverlay {
  return {
    ...overlay,
    targetX1: overlay.x1,
    targetY1: overlay.y1,
    targetX2: overlay.x2,
    targetY2: overlay.y2,
    lastSeenAt: now,
  };
}

function reconcileDetectionOverlays(
  current: DetectionOverlay[],
  incoming: Array<Omit<DetectionOverlay, 'targetX1' | 'targetY1' | 'targetX2' | 'targetY2' | 'lastSeenAt'>>,
  now: number,
) {
  const usedCurrentIndexes = new Set<number>();

  return incoming.map((overlay, incomingIndex) => {
    const nextOverlay = createTrackedOverlay(overlay, now);
    let bestMatchIndex = -1;
    let bestMatchDistance = Number.POSITIVE_INFINITY;

    current.forEach((existing, currentIndex) => {
      if (usedCurrentIndexes.has(currentIndex)) {
        return;
      }

      if (
        existing.label !== nextOverlay.label ||
        existing.sourceWidth !== nextOverlay.sourceWidth ||
        existing.sourceHeight !== nextOverlay.sourceHeight
      ) {
        return;
      }

      const distance = getOverlayCenterDistance(existing, nextOverlay);
      if (distance < bestMatchDistance) {
        bestMatchDistance = distance;
        bestMatchIndex = currentIndex;
      }
    });

    if (bestMatchIndex >= 0 && bestMatchDistance <= OVERLAY_MATCH_DISTANCE_THRESHOLD) {
      usedCurrentIndexes.add(bestMatchIndex);
      const previous = current[bestMatchIndex];
      return {
        ...previous,
        id: nextOverlay.id || `${nextOverlay.label}-${incomingIndex}`,
        confidence: nextOverlay.confidence,
        borderColor: nextOverlay.borderColor,
        badgeColor: nextOverlay.badgeColor,
        sourceWidth: nextOverlay.sourceWidth,
        sourceHeight: nextOverlay.sourceHeight,
        targetX1: nextOverlay.targetX1,
        targetY1: nextOverlay.targetY1,
        targetX2: nextOverlay.targetX2,
        targetY2: nextOverlay.targetY2,
        lastSeenAt: now,
      };
    }

    return nextOverlay;
  });
}

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

export function MonitoringPage() {
  const location = useLocation();
  const isAdminView = location.pathname.startsWith('/admin');
  const [headCount, setHeadCount] = useState(12);
  const [modalState, setModalState] = useState({ isOpen: false, title: '', message: '' });
  const [exitConfirm, setExitConfirm] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [recognitionResult, setRecognitionResult] = useState<FaceRecognitionResponse | null>(null);
  const [ppeResult, setPpeResult] = useState<LivePPEResult | null>(null);
  const [fallResult, setFallResult] = useState<FallDetectionResponse | null>(null);
  const [fireResult, setFireResult] = useState<FireDetectionResponse | null>(null);
  const [cameraMessage, setCameraMessage] = useState('Start the camera to begin live monitoring.');
  const [hasLiveVideo, setHasLiveVideo] = useState(false);
  const [trackedFaceBox, setTrackedFaceBox] = useState<LocalFaceBox | null>(null);
  const [isLocalTrackingEnabled, setIsLocalTrackingEnabled] = useState(false);
  const [isFaceRecognitionActive, setIsFaceRecognitionActive] = useState(true);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [detectionOverlays, setDetectionOverlays] = useState<DetectionOverlay[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackingInFlightRef = useRef(false);
  const faceDetectorRef = useRef<BrowserFaceDetector | null>(null);
  const trackingFrameRef = useRef<number | null>(null);
  const lastTrackingRunAtRef = useRef(0);
  const lastTrackedFaceBoxRef = useRef<LocalFaceBox | null>(null);
  const lastTrackedFaceAtRef = useRef(0);
  const safetySocketRef = useRef<WebSocket | null>(null);
  const latestSafetyFrameRef = useRef<CapturedVideoFrame | null>(null);
  const detectorInFlightRef = useRef({
    face: false,
    safety: false,
  });
  const lastDetectorRunAtRef = useRef({
    face: 0,
    safety: 0,
  });

  const attachStreamToVideo = async () => {
    const video = videoRef.current;
    const stream = streamRef.current;

    if (!video || !stream) {
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

  const addAlert = (image: string, violation: string, imageUrl?: string | null) => {
    const now = new Date();
    const nextAlert: AlertRow = {
      id: `${now.getTime()}-${violation}-${image}`,
      date: now.toLocaleDateString('en-CA'),
      time: now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      image,
      imageUrl,
      violation,
    };

    setAlerts((current) => [nextAlert, ...current]);
  };

  const syncAlertState = (
    key: 'face' | 'ppe' | 'fall' | 'fire',
    signature: string,
    image: string,
    violation: string,
  ) => {
    if (!signature) {
      lastAlertSignatureRef.current[key] = '';
      return;
    }

    if (lastAlertSignatureRef.current[key] === signature) {
      return;
    }

    lastAlertSignatureRef.current[key] = signature;
    addAlert(image, violation);
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
    trackingInFlightRef.current = false;
    lastTrackingRunAtRef.current = 0;
    lastTrackedFaceBoxRef.current = null;
    lastTrackedFaceAtRef.current = 0;
  };

  const stopCameraStream = () => {
    stopTrackingLoop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setHasLiveVideo(false);
    setTrackedFaceBox(null);
    setIsLocalTrackingEnabled(false);
    setIsFaceRecognitionActive(true);
    setIsStreaming(false);
    setIsRecognizing(false);
    setRecognitionResult(null);
    setPpeResult(null);
    setFallResult(null);
    setFireResult(null);
    setDetectionOverlays([]);
    detectorInFlightRef.current = {
      face: false,
      safety: false,
    };
    lastDetectorRunAtRef.current = {
      face: 0,
      safety: 0,
    };
    latestSafetyFrameRef.current = null;
    safetySocketRef.current?.close();
    safetySocketRef.current = null;
  };

  useEffect(() => {
    return () => {
      stopCameraStream();
      faceDetectorRef.current = null;
    };
  }, []);

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

  useEffect(() => {
    if (!isStreaming) {
      return;
    }

    let animationFrameId: number | null = null;

    const animateOverlays = () => {
      const now = performance.now();

      setDetectionOverlays((current) => {
        const next = current
          .filter((overlay) => now - overlay.lastSeenAt <= TRACKED_OVERLAY_MAX_AGE_MS)
          .map((overlay) => ({
            ...overlay,
            x1: overlay.x1 + (overlay.targetX1 - overlay.x1) * OVERLAY_TRACKING_SMOOTHING_FACTOR,
            y1: overlay.y1 + (overlay.targetY1 - overlay.y1) * OVERLAY_TRACKING_SMOOTHING_FACTOR,
            x2: overlay.x2 + (overlay.targetX2 - overlay.x2) * OVERLAY_TRACKING_SMOOTHING_FACTOR,
            y2: overlay.y2 + (overlay.targetY2 - overlay.y2) * OVERLAY_TRACKING_SMOOTHING_FACTOR,
          }));

        return next;
      });

      animationFrameId = window.requestAnimationFrame(animateOverlays);
    };

    animationFrameId = window.requestAnimationFrame(animateOverlays);

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isStreaming]);

  // Handle face recognition overlays
  useEffect(() => {
    if (!recognitionResult || !recognitionResult.face_box || recognitionResult.status === 'no_face') {
      // Remove face recognition overlay if no face or no result
      setDetectionOverlays((current) =>
        current.filter((overlay) => overlay.id !== 'face-recognition')
      );
      return;
    }

    const now = performance.now();
    const faceOverlay = {
      id: 'face-recognition',
      label: getFaceOverlayLabel(recognitionResult),
      confidence: recognitionResult.score || undefined,
      borderColor: recognitionResult.authorized ? '#10b981' : '#ef4444', // green for authorized, red for unauthorized
      badgeColor: recognitionResult.authorized ? '#10b981' : '#ef4444',
      x1: recognitionResult.face_box.x1,
      y1: recognitionResult.face_box.y1,
      x2: recognitionResult.face_box.x2,
      y2: recognitionResult.face_box.y2,
      sourceWidth: recognitionResult.face_box.image_width,
      sourceHeight: recognitionResult.face_box.image_height,
      targetX1: recognitionResult.face_box.x1,
      targetY1: recognitionResult.face_box.y1,
      targetX2: recognitionResult.face_box.x2,
      targetY2: recognitionResult.face_box.y2,
      lastSeenAt: now,
    };

    setDetectionOverlays((current) => {
      // Remove any existing face recognition overlay
      const withoutFace = current.filter((overlay) => overlay.id !== 'face-recognition');
      // Add the new face recognition overlay
      return [...withoutFace, faceOverlay];
    });
  }, [recognitionResult]);

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

      setPpeResult(safetyResult.ppe);
      setFallResult(safetyResult.fall);
      setFireResult(safetyResult.fire);

      const nextOverlays = [
        ...safetyResult.ppe.detected_items.map((item, index) => {
          const palette = getOverlayPalette(item.class_name);
          return {
            id: `ppe-${index}-${item.class_name}`,
            label: item.class_name,
            confidence: item.confidence,
            borderColor: palette.borderColor,
            badgeColor: palette.badgeColor,
            x1: item.bbox[0],
            y1: item.bbox[1],
            x2: item.bbox[2],
            y2: item.bbox[3],
            sourceWidth: safetyResult.ppe.image_width,
            sourceHeight: safetyResult.ppe.image_height,
          };
        }),
        ...safetyResult.fall.detections
          .filter((item) => item.is_fallen)
          .map((item, index) => {
            const palette = getOverlayPalette('Fall detected');
            return {
              id: `fall-${index}-${item.person_id}`,
              label: 'Fall detected',
              confidence: item.confidence,
              borderColor: palette.borderColor,
              badgeColor: palette.badgeColor,
              x1: item.bbox[0],
              y1: item.bbox[1],
              x2: item.bbox[2],
              y2: item.bbox[3],
              sourceWidth: frameWidth,
              sourceHeight: frameHeight,
            };
          }),
        ...safetyResult.fire.detections.map((item, index) => {
          const palette = getOverlayPalette(item.class);
          return {
            id: `fire-${index}-${item.class}`,
            label: item.class,
            confidence: item.confidence,
            borderColor: palette.borderColor,
            badgeColor: palette.badgeColor,
            x1: item.bbox[0],
            y1: item.bbox[1],
            x2: item.bbox[2],
            y2: item.bbox[3],
            sourceWidth: frameWidth,
            sourceHeight: frameHeight,
          };
        }),
      ];

      setDetectionOverlays((current) => reconcileDetectionOverlays(current, nextOverlays, now));

      if (Array.isArray(safetyResult.alerts) && safetyResult.alerts.length > 0) {
        setAlerts((current) => {
          const existingIds = new Set(current.map((alert) => alert.id));
          const mapped = safetyResult.alerts
            .filter((alert) => !existingIds.has(alert.id))
            .map((alert) => {
              const detectedAt = new Date(alert.detected_at);
              return {
                id: alert.id,
                date: detectedAt.toLocaleDateString('en-CA'),
                time: detectedAt.toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                image: alert.employee_name || alert.category,
                imageUrl: resolveStorageUrl(alert.evidence_image_path),
                violation: alert.message,
              };
            });

          return [...mapped, ...current];
        });
      }

      if (safetyResult.fall.people_count > 0) {
        setHeadCount(safetyResult.fall.people_count);
      }
    };

    const runFaceRecognition = async (capturedFrame: CapturedVideoFrame) => {
      detectorInFlightRef.current.face = true;
      updateRecognizingState();

      try {
        const result = await recognizeEmployeeFace(capturedFrame.blob, token);
        if (isCancelled) {
          return;
        }

        setRecognitionResult(result);
        setCameraMessage(
          result.status === 'no_face'
            ? 'Camera is live. No face is currently visible to the model.'
            : result.status === 'no_gallery'
              ? 'Camera is live. A face was detected, but no employee face gallery is uploaded for this organization.'
              : 'Camera is live and face, PPE, fall, and fire monitoring are running.',
        );

        if (result.status === 'no_gallery' && result.alert) {
          setAlerts((current) => {
            if (current.some((alert) => alert.id === result.alert?.id)) {
              return current;
            }

            const detectedAt = new Date(result.alert.detected_at);
            const nextAlert = {
              id: result.alert.id,
              date: detectedAt.toLocaleDateString('en-CA'),
              time: detectedAt.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              }),
              image: result.alert.employee_name || result.alert.category,
              imageUrl: resolveStorageUrl(result.alert.evidence_image_path),
              violation: result.alert.message,
            };

            return [nextAlert, ...current];
          });
        }

        if (result.status === 'ok' && !result.authorized) {
          if (result.alert) {
            setAlerts((current) => {
              if (current.some((alert) => alert.id === result.alert?.id)) {
                return current;
              }

              const detectedAt = new Date(result.alert.detected_at);
              const nextAlert = {
                id: result.alert.id,
                date: detectedAt.toLocaleDateString('en-CA'),
                time: detectedAt.toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                image: result.alert.employee_name || result.alert.category,
                imageUrl: resolveStorageUrl(result.alert.evidence_image_path),
                violation: result.alert.message,
              };

              return [nextAlert, ...current];
            });
          }
          syncAlertState('face', '', '', '');
        } else {
          syncAlertState('face', '', '', '');
        }
      } catch (error) {
        if (isTokenError(error)) {
          handleTokenExpiry();
          return;
        }

        if (isMissingFaceGalleryError(error)) {
          setRecognitionResult(null);
          setCameraMessage('Camera is live, but no employee face images have been uploaded for this organization yet.');
          syncAlertState('face', '', '', '');
        } else if (isFaceRecognitionDisabledError(error)) {
          setRecognitionResult(null);
          setIsFaceRecognitionActive(false);
          syncAlertState('face', '', '', '');
        } else {
          console.error('Face recognition failed:', error);
          setRecognitionResult(null);
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

      const dispatchLatestSafetyFrame = () => {
        const latestFrame = latestSafetyFrameRef.current;
        if (!latestFrame || detectorInFlightRef.current.safety) {
          return;
        }

        detectorInFlightRef.current.safety = true;
        updateRecognizingState();
        void runSafetyDetection(latestFrame);
      };

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
          dispatchLatestSafetyFrame();
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

    const runSafetyDetection = async (capturedFrame: CapturedVideoFrame) => {
      detectorInFlightRef.current.safety = true;
      updateRecognizingState();

      try {
        const socket = safetySocketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          detectorInFlightRef.current.safety = false;
          updateRecognizingState();
          return;
        }

        socket.send(capturedFrame.blob);
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

      const capturedFrame = await captureVideoFrame(video, canvas);
      if (!capturedFrame) {
        scheduleNextLoop();
        return;
      }

      latestSafetyFrameRef.current = capturedFrame;

      const now = performance.now();

      if (
        isFaceRecognitionActive &&
        !detectorInFlightRef.current.face &&
        now - lastDetectorRunAtRef.current.face >= FACE_DETECTION_INTERVAL_MS
      ) {
        lastDetectorRunAtRef.current.face = now;
        void runFaceRecognition(capturedFrame);
      }

      if (
        safetySocketRef.current &&
        !detectorInFlightRef.current.safety &&
        now - lastDetectorRunAtRef.current.safety >= FRAME_LOOP_INTERVAL_MS
      ) {
        lastDetectorRunAtRef.current.safety = now;
        detectorInFlightRef.current.safety = true;
        updateRecognizingState();
        void runSafetyDetection(capturedFrame);
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

    if (!navigator.mediaDevices?.getUserMedia) {
      setModalState({
        isOpen: true,
        title: 'Camera Unsupported',
        message: 'Your browser does not support webcam access for live monitoring.',
      });
      return;
    }

    try {
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

      setRecognitionResult(null);
      setHasLiveVideo(false);
      setTrackedFaceBox(null);
      setIsLocalTrackingEnabled(false);
      setIsFaceRecognitionActive(faceRecognitionEnabled);
      setHeadCount(12);
      setAlerts([]);
      setDetectionOverlays([]);
      lastAlertSignatureRef.current = {
        face: '',
        ppe: '',
        fall: '',
        fire: '',
      };
      faceDetectorRef.current = window.FaceDetector
        ? new window.FaceDetector({
            maxDetectedFaces: 1,
            fastMode: true,
          })
        : null;
      setCameraMessage('Camera is live and monitoring is running.');
      setIsStreaming(true);
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
    stopCameraStream();
    setCameraMessage('Camera stopped. Start the stream again when you want to resume monitoring.');
  };

  const handleSave = () => {
    setModalState({
      isOpen: true,
      title: 'Success',
      message: 'Monitoring report saved successfully!',
    });
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

  const hasFaceBox = isStreaming ? trackedFaceBox !== null : recognitionResult?.face_box != null;
  const isRecognitionPending =
    hasFaceBox &&
    (recognitionResult === null || recognitionResult.status === 'no_face') &&
    isRecognizing;
  const hasRecognitionFaceOverlay = detectionOverlays.some((overlay) => overlay.id === 'face-recognition');
  const localFaceBoxStyle =
    isStreaming && trackedFaceBox && !hasRecognitionFaceOverlay
      ? getLocalFaceBoxStyle(trackedFaceBox, videoRef.current)
      : null;

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
                    className={`w-full h-full object-contain transition-opacity ${
                      hasLiveVideo ? 'opacity-100' : 'opacity-0'
                    }`}
                  />

                  {(!isStreaming || !hasLiveVideo) && (
                    <img
                      src={liveFeedImage}
                      alt="Live camera placeholder"
                      className="absolute inset-0 w-full h-full object-contain opacity-75"
                    />
                  )}

                  <div className="absolute top-4 left-4 bg-red-600 px-3 py-1 rounded flex items-center gap-2">
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                    <span className="text-white text-sm font-semibold">{isStreaming ? 'LIVE' : 'OFFLINE'}</span>
                  </div>

                  {(!isStreaming || !hasLiveVideo) && (
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center p-6">
                      <div className="text-center text-white max-w-sm">
                        <Camera className="w-12 h-12 mx-auto mb-3" />
                        <p className="text-lg font-medium mb-2">
                          {isStreaming ? 'Connecting to camera...' : 'Live monitoring is ready'}
                        </p>
                        <p className="text-sm text-white/85">
                          {isStreaming
                            ? 'The browser opened your camera. Waiting for the live video frames to appear.'
                            : cameraMessage}
                        </p>
                      </div>
                    </div>
                  )}

                  {isStreaming && hasLiveVideo && detectionOverlays.map((overlay) => {
                    const overlayStyle = getOverlayStyle(overlay, videoRef.current);
                    if (!overlayStyle) {
                      return null;
                    }

                    return (
                      <div key={overlay.id} className="absolute inset-0 pointer-events-none">
                        <div
                          className="absolute rounded-xl border-[3px]"
                          style={{
                            ...overlayStyle,
                            borderColor: overlay.borderColor,
                          }}
                        >
                          <div
                            className="absolute left-0 -top-3 -translate-y-full px-3 py-1 rounded-full text-sm font-semibold text-white whitespace-nowrap"
                            style={{ backgroundColor: overlay.badgeColor }}
                          >
                            {overlay.label}
                            {typeof overlay.confidence === 'number'
                              ? ` ${(overlay.confidence * 100).toFixed(0)}%`
                              : ''}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {isStreaming && hasLiveVideo && localFaceBoxStyle && (
                    <div className="absolute inset-0 pointer-events-none">
                      <div
                        className="absolute rounded-xl border-[3px] border-[#f59e0b]"
                        style={localFaceBoxStyle}
                      >
                        <div className="absolute left-0 -top-3 -translate-y-full rounded-full bg-[#b45309] px-3 py-1 text-sm font-semibold whitespace-nowrap text-white">
                          Face detected
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-2xl border border-[#e5dcc9] bg-[#f9f6f0] p-4">
                  <p className="text-sm text-[#6b5d4f]">{cameraMessage}</p>
                </div>
              </div>

              <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-[#ff8c42]/10 rounded-full flex items-center justify-center">
                      <Users className="w-6 h-6 text-[#ff8c42]" />
                    </div>
                    <div>
                      <p className="text-[#6b5d4f]">Head Count</p>
                      <p className="font-serif text-3xl text-[#4a3c2a]">{headCount}</p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <button
                      onClick={handleSave}
                      className="flex items-center gap-2 bg-[#ff8c42] text-white px-6 py-3 rounded-full shadow-md hover:bg-[#ff7a2e] transition-colors"
                    >
                      <Save className="w-5 h-5" />
                      Save
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
            </div>

            <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7]">
              <h2 className="font-serif text-2xl text-[#4a3c2a] mb-6">Real-Time Alerts</h2>
              <div className="overflow-auto max-h-[600px]">
                <table className="w-full">
                  <thead className="border-b-2 border-[#d4cbb7] sticky top-0 bg-white">
                    <tr>
                      <th className="text-left py-3 px-2 text-[#6b5d4f]">Date</th>
                      <th className="text-left py-3 px-2 text-[#6b5d4f]">Time</th>
                      <th className="text-left py-3 px-2 text-[#6b5d4f]">Detected Image</th>
                      <th className="text-left py-3 px-2 text-[#6b5d4f]">Violation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.length > 0 ? (
                      alerts.map((alert, index) => (
                        <tr key={alert.id || `${alert.date}-${alert.time}-${alert.violation}-${index}`} className="border-b border-[#d4cbb7]/50">
                          <td className="py-3 px-2 text-[#4a3c2a] text-sm">{alert.date}</td>
                          <td className="py-3 px-2 text-[#6b5d4f] text-sm">{alert.time}</td>
                          <td className="py-3 px-2">
                            {alert.imageUrl ? (
                              <div className="w-16 h-16 rounded-lg overflow-hidden border-2 border-red-500">
                                <img
                                  src={alert.imageUrl}
                                  alt="Detected event"
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            ) : (
                              <div className="w-12 h-12 bg-[#ff8c42]/20 rounded-lg flex items-center justify-center text-xs text-[#ff8c42] text-center px-2">
                                {alert.image}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-2">
                            <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm">
                              {alert.violation}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="py-8 px-2 text-center text-[#6b5d4f] text-sm">
                          Start the camera to begin live PPE, fall, fire/smoke, and face recognition monitoring.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
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

      <Footer />
    </div>
  );
}
