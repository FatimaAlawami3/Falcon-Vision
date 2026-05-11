"""Fire and smoke detection with YOLO vision inference and optional sensor fusion."""
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import List

import cv2
import numpy as np
from ultralytics import YOLO

try:
    import joblib
except ImportError:
    joblib = None


class AlertLevel(str, Enum):
    """Alert levels for fire detection."""
    NO_ALERT = "no_alert"
    LOW_ALERT = "low_alert"
    MEDIUM_ALERT = "medium_alert"
    HIGH_ALERT = "high_alert"


class SensorPrediction(str, Enum):
    """Sensor predictions based on ML classifier."""
    BACKGROUND = "background"
    NUISANCE = "nuisance"
    FIRE = "fire"


@dataclass
class FireDetection:
    """Represents a detected fire/smoke instance in an image."""
    class_name: str  # "fire" or "smoke"
    confidence: float
    bbox: List[float]  # [x1, y1, x2, y2]
    track_id: int | None = None


@dataclass
class MultimodalFireResult:
    """Result from multimodal fire/smoke detection fusion."""
    sensor_prediction: str  # Background, Nuisance, Fire
    image_detections: List[FireDetection]
    image_decision: str  # none, smoke, fire
    image_confidence: float
    alert_level: AlertLevel
    reason: str


class FireSmokeDetector:
    """Fire/smoke detection with multimodal fusion of sensor and vision data."""

    ALERT_CLASS_NAMES = {"fire", "smoke"}

    def __init__(
        self,
        yolo_model_path: str | Path,
        sensor_model_path: str | Path | None = None,
        scaler_path: str | Path | None = None,
        label_encoder_path: str | Path | None = None,
        conf_threshold: float = 0.25,
    ):
        """Initialize fire/smoke detector with YOLO and optional ML sensor models.

        Args:
            yolo_model_path: Path to YOLO fire/smoke detection model (.pt)
            sensor_model_path: Optional path to trained sensor classifier (.pkl)
            scaler_path: Optional path to scaler for sensor data (.pkl)
            label_encoder_path: Optional path to label encoder for sensor predictions (.pkl)
            conf_threshold: Confidence threshold for detections
        """
        self.yolo_model = YOLO(str(yolo_model_path), task="detect")
        self.sensor_model = None
        self.scaler = None
        self.label_encoder = None
        self.conf_threshold = conf_threshold

        self.class_names = {
            int(class_id): str(class_name).strip().lower()
            for class_id, class_name in self.yolo_model.names.items()
        }

        if sensor_model_path and scaler_path and label_encoder_path and joblib is not None:
            self.sensor_model = joblib.load(str(sensor_model_path))
            self.scaler = joblib.load(str(scaler_path))
            self.label_encoder = joblib.load(str(label_encoder_path))

    def detect_fire_smoke_image(self, image: np.ndarray) -> tuple[str, List[FireDetection]]:
        """Detect fire/smoke in image using YOLO.

        Args:
            image: Input image as numpy array (BGR format)

        Returns:
            Tuple of (decision: none/smoke/fire, detections: list of FireDetection)
        """
        results = self.yolo_model.predict(image, conf=self.conf_threshold, verbose=False)
        result = results[0]

        detections = []
        fire_scores = []
        smoke_scores = []

        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            return "none", detections

        for box in boxes:
            cls_id = int(box.cls[0].item())
            conf = float(box.conf[0].item())
            bbox = box.xyxy[0].cpu().numpy()
            label = self.class_names.get(cls_id, str(cls_id))

            if label not in self.ALERT_CLASS_NAMES:
                continue

            detection = FireDetection(
                class_name=label,
                confidence=conf,
                bbox=bbox.tolist(),
            )
            detections.append(detection)

            if label == "fire":
                fire_scores.append(conf)
            elif label == "smoke":
                smoke_scores.append(conf)

        # Determine image decision
        if fire_scores:
            return "fire", detections
        elif smoke_scores:
            return "smoke", detections
        else:
            return "none", detections

    def predict_sensor_status(self, sensor_data: List[float]) -> str:
        """Predict fire status from sensor data using ML classifier.

        Sensor data format: 8 features from temperature, smoke, and CO sensors

        Args:
            sensor_data: List of 8 sensor features

        Returns:
            Prediction: "background", "nuisance", or "fire"
        """
        if self.sensor_model is None or self.scaler is None or self.label_encoder is None:
            return "not_available"

        if len(sensor_data) != 8:
            raise ValueError(f"Expected 8 sensor features, got {len(sensor_data)}")

        try:
            # Prepare sensor data
            sample = np.array(sensor_data).reshape(1, -1)

            # Scale using fitted scaler
            sample_scaled = self.scaler.transform(sample)

            # Predict
            sensor_pred = self.sensor_model.predict(sample_scaled)[0]

            # Decode label
            sensor_pred_label = self.label_encoder.inverse_transform([sensor_pred])[0]

            return sensor_pred_label

        except Exception as e:
            print(f"Error predicting sensor status: {e}")
            return "background"

    def multimodal_fusion(
        self,
        sensor_prediction: str,
        image_decision: str,
        image_confidence: float
    ) -> MultimodalFireResult:
        """Fuse sensor and image predictions for final alert decision.

        Args:
            sensor_prediction: Prediction from sensor ML model
            image_decision: Decision from image model (none, smoke, fire)
            image_confidence: Confidence of image decision

        Returns:
            MultimodalFireResult with alert level and reasoning
        """
        # Normalize predictions
        sensor_pred = sensor_prediction.lower().strip()
        img_decision = image_decision.lower().strip()

        # Apply fusion rules (based on notebook logic)
        if sensor_pred == "background":
            if img_decision == "none":
                return MultimodalFireResult(
                    sensor_prediction=sensor_pred,
                    image_detections=[],
                    image_decision=img_decision,
                    image_confidence=image_confidence,
                    alert_level=AlertLevel.NO_ALERT,
                    reason="Sensor indicates normal background and image shows no hazard."
                )
            elif img_decision == "smoke":
                return MultimodalFireResult(
                    sensor_prediction=sensor_pred,
                    image_detections=[],
                    image_decision=img_decision,
                    image_confidence=image_confidence,
                    alert_level=AlertLevel.MEDIUM_ALERT,
                    reason="Sensor indicates background, but image detected smoke. Possible false positive or early fire."
                )
            elif img_decision == "fire":
                return MultimodalFireResult(
                    sensor_prediction=sensor_pred,
                    image_detections=[],
                    image_decision=img_decision,
                    image_confidence=image_confidence,
                    alert_level=AlertLevel.HIGH_ALERT,
                    reason="Sensor indicates background, but image clearly detected fire. Immediate action required."
                )

        elif sensor_pred == "nuisance":
            if img_decision == "none":
                return MultimodalFireResult(
                    sensor_prediction=sensor_pred,
                    image_detections=[],
                    image_decision=img_decision,
                    image_confidence=image_confidence,
                    alert_level=AlertLevel.LOW_ALERT,
                    reason="Sensor indicates nuisance alarm and image found no visible hazard."
                )
            elif img_decision == "smoke":
                return MultimodalFireResult(
                    sensor_prediction=sensor_pred,
                    image_detections=[],
                    image_decision=img_decision,
                    image_confidence=image_confidence,
                    alert_level=AlertLevel.MEDIUM_ALERT,
                    reason="Sensor indicates nuisance, but image detected smoke."
                )
            elif img_decision == "fire":
                return MultimodalFireResult(
                    sensor_prediction=sensor_pred,
                    image_detections=[],
                    image_decision=img_decision,
                    image_confidence=image_confidence,
                    alert_level=AlertLevel.HIGH_ALERT,
                    reason="Sensor indicates nuisance, but image clearly detected fire."
                )

        elif sensor_pred == "fire":
            if img_decision == "fire":
                return MultimodalFireResult(
                    sensor_prediction=sensor_pred,
                    image_detections=[],
                    image_decision=img_decision,
                    image_confidence=image_confidence,
                    alert_level=AlertLevel.HIGH_ALERT,
                    reason="Both sensor and image confirmed fire. CRITICAL ALERT."
                )
            elif img_decision == "smoke":
                return MultimodalFireResult(
                    sensor_prediction=sensor_pred,
                    image_detections=[],
                    image_decision=img_decision,
                    image_confidence=image_confidence,
                    alert_level=AlertLevel.HIGH_ALERT,
                    reason="Sensor indicates fire and image detected smoke. CRITICAL ALERT."
                )
            elif img_decision == "none":
                return MultimodalFireResult(
                    sensor_prediction=sensor_pred,
                    image_detections=[],
                    image_decision=img_decision,
                    image_confidence=image_confidence,
                    alert_level=AlertLevel.MEDIUM_ALERT,
                    reason="Sensor indicates fire, but image found no visual confirmation. Check sensors."
                )

        # Default fallback
        return MultimodalFireResult(
            sensor_prediction=sensor_pred,
            image_detections=[],
            image_decision=img_decision,
            image_confidence=image_confidence,
            alert_level=AlertLevel.NO_ALERT,
            reason="Unexpected sensor or image prediction."
        )

    def detect_with_fusion(
        self,
        image: np.ndarray,
        sensor_data: List[float] | None = None
    ) -> MultimodalFireResult:
        """Full detection pipeline: image + sensor with fusion.

        Args:
            image: Input image for vision detection
            sensor_data: Optional list of 8 sensor features. If None, only image detection is used.

        Returns:
            MultimodalFireResult with fused prediction
        """
        # Image detection
        image_decision, detections = self.detect_fire_smoke_image(image)
        image_confidence = max(
            [d.confidence for d in detections],
            default=0.0
        )

        sensor_pred = "not_available"
        if sensor_data is not None and len(sensor_data) > 0:
            sensor_pred = self.predict_sensor_status(sensor_data)

        # Sensor detection is optional. Camera monitoring uses image-only inference.
        if sensor_data is None or len(sensor_data) == 0 or sensor_pred == "not_available":
            # No sensor data, use image only
            if image_decision == "fire":
                alert_level = AlertLevel.HIGH_ALERT
            elif image_decision == "smoke":
                alert_level = AlertLevel.MEDIUM_ALERT
            else:
                alert_level = AlertLevel.NO_ALERT

            return MultimodalFireResult(
                sensor_prediction=sensor_pred,
                image_detections=detections,
                image_decision=image_decision,
                image_confidence=image_confidence,
                alert_level=alert_level,
                reason="Image-only detection (sensor data not available)"
            )

        # Multimodal fusion
        result = self.multimodal_fusion(sensor_pred, image_decision, image_confidence)
        result.image_detections = detections

        return result

    def draw_detections(self, image: np.ndarray, detections: List[FireDetection]) -> np.ndarray:
        """Draw fire/smoke detections on image.

        Args:
            image: Input image
            detections: List of FireDetection instances

        Returns:
            Image with bounding boxes and labels
        """
        result_image = image.copy()

        for detection in detections:
            x1, y1, x2, y2 = map(int, detection.bbox)

            # Color: red for fire, orange for smoke
            color = (0, 0, 255) if detection.class_name == "fire" else (0, 165, 255)
            label = f"{detection.class_name.upper()} {detection.confidence:.2f}"

            # Draw bounding box
            cv2.rectangle(result_image, (x1, y1), (x2, y2), color, 2)

            # Draw label
            cv2.putText(
                result_image,
                label,
                (x1, y1 - 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                color,
                2
            )

        return result_image
