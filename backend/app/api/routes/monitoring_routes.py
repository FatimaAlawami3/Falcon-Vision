import asyncio
import base64
import json
import time
import traceback
from io import BytesIO
from typing import Annotated

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.websockets import WebSocketState
from starlette.datastructures import Headers, UploadFile as StarletteUploadFile

from app.api.deps import (
    get_alert_repository,
    get_alert_service,
    get_current_user,
    get_employee_repository,
    get_extracted_rule_repository,
    get_fall_service,
    get_fire_service,
    get_local_storage_client,
    get_ppe_service,
    get_regulation_repository,
)
from app.core.constants import RuleCategory, Severity, normalize_user_role
from app.core.database import get_database
from app.core.security import decode_access_token
from app.repositories.user_repository import UserRepository
from app.services.fall_service import FallDetectionService
from app.services.fire_service import FireDetectionService
from app.services.ppe_service import PPEService
from app.services.alert_service import AlertService
from app.utils.datetime import utc_now
from app.utils.object_id import validate_object_id


router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])
DEFAULT_MONITORING_ZONE = "production"
WEBRTC_SAFETY_INTERVAL_SECONDS = 0.15
ACTIVE_PEER_CONNECTIONS: set[object] = set()
ALERT_WRITE_COOLDOWN_SECONDS = 8.0
RECENT_ALERT_SIGNATURES: dict[str, float] = {}


def _clone_upload_file(file_bytes: bytes, filename: str, content_type: str | None) -> StarletteUploadFile:
    headers = Headers({"content-type": content_type or "image/jpeg"})
    return StarletteUploadFile(
        file=BytesIO(file_bytes),
        filename=filename,
        size=len(file_bytes),
        headers=headers,
    )


def _empty_ppe_result(detail: str) -> dict:
    return {
        "status": "unavailable",
        "detail": detail,
        "violations": [],
        "detected_items": [],
        "image_width": 0,
        "image_height": 0,
    }


def _empty_fall_result(detail: str, zone_type: str | None) -> dict:
    return {
        "status": "unavailable",
        "detail": detail,
        "people_count": 0,
        "falls_detected": 0,
        "detections": [],
        "fall_detection_active": False,
        "zone_type": zone_type,
    }


def _empty_fire_result(detail: str, zone_type: str | None) -> dict:
    return {
        "alert_level": "no_alert",
        "sensor_prediction": "unavailable",
        "image_decision": "unavailable",
        "image_confidence": 0.0,
        "reason": detail,
        "detections": [],
        "fire_detection_active": False,
        "zone_type": zone_type,
        "sensor_data_used": False,
    }


async def _authenticate_websocket_user(token: str | None) -> dict:
    if not token:
        raise ValueError("Missing token")

    payload = decode_access_token(token)
    if payload is None or not payload.get("sub"):
        raise ValueError("Invalid or expired token")

    user_id = validate_object_id(payload["sub"])
    user_repository = UserRepository(get_database())
    user = await user_repository.find_by_id(user_id)
    if user is None:
        raise ValueError("User no longer exists")

    user["role"] = normalize_user_role(user["role"])
    return user


async def _create_alert_safely(
    *,
    alert_service: AlertService,
    organization_id,
    title: str,
    message: str,
    category: RuleCategory,
    severity: Severity,
    image_bytes: bytes,
    bbox: list[float] | None,
) -> None:
    try:
        await alert_service.create_alert(
            organization_id=organization_id,
            title=title,
            message=message,
            category=category,
            severity=severity,
            image_bytes=image_bytes,
            bbox=bbox,
        )
    except Exception:
        traceback.print_exc()


def _queue_alert_once(
    *,
    alert_service: AlertService,
    organization_id,
    title: str,
    message: str,
    category: RuleCategory,
    severity: Severity,
    image_bytes: bytes,
    bbox: list[float] | None,
) -> dict | None:
    if not organization_id:
        return None

    now = time.monotonic()
    signature = f"{organization_id}:{category}:{title}:{message}"
    last_seen = RECENT_ALERT_SIGNATURES.get(signature, 0.0)
    if now - last_seen < ALERT_WRITE_COOLDOWN_SECONDS:
        return None

    RECENT_ALERT_SIGNATURES[signature] = now
    detected_at = utc_now()
    evidence_image_data_url = None
    if bbox:
        cropped_bytes = alert_service._crop_image_bytes(image_bytes, bbox)
        if cropped_bytes is not None:
            evidence_image_data_url = f"data:image/jpeg;base64,{base64.b64encode(cropped_bytes).decode('ascii')}"

    asyncio.create_task(
        _create_alert_safely(
            alert_service=alert_service,
            organization_id=organization_id,
            title=title,
            message=message,
            category=category,
            severity=severity,
            image_bytes=image_bytes,
            bbox=bbox,
        )
    )
    return {
        "id": f"live-{signature}:{int(now * 1000)}",
        "title": title,
        "message": message,
        "category": str(category),
        "severity": str(severity),
        "status": "open",
        "detected_at": detected_at.isoformat(),
        "camera_name": None,
        "zone_name": None,
        "employee_name": None,
        "evidence_image_path": None,
        "evidence_image_data_url": evidence_image_data_url,
    }


async def _run_safety_detection(
    *,
    file_bytes: bytes,
    filename: str,
    content_type: str | None,
    ppe_service: PPEService,
    fall_service: FallDetectionService,
    fire_service: FireDetectionService,
    alert_service: AlertService,
    current_user: dict,
    zone_type: str | None,
) -> dict:
    organization_id = current_user.get("organization_id") if current_user else None

    ppe_file = _clone_upload_file(file_bytes, filename, content_type)
    fall_file = _clone_upload_file(file_bytes, filename, content_type)
    fire_file = _clone_upload_file(file_bytes, filename, content_type)
    effective_zone_type = zone_type or DEFAULT_MONITORING_ZONE
    required_ppe = await ppe_service.get_live_required_ppe(organization_id) if organization_id else []

    safety_tasks = []
    if required_ppe:
        safety_tasks.append(("ppe", ppe_service.detect_ppe(ppe_file, current_user)))
    safety_tasks.extend(
        [
            (
                "fall",
                fall_service.detect_falls(
                    fall_file,
                    zone_type=effective_zone_type,
                    organization_id=organization_id,
                ),
            ),
            (
                "fire",
                fire_service.detect_fire_image_only(
                    fire_file,
                    zone_type=effective_zone_type,
                    organization_id=organization_id,
                ),
            ),
        ]
    )

    safety_results = await asyncio.gather(
        *(task for _module, task in safety_tasks),
        return_exceptions=True,
    )
    results_by_module = {
        module: result
        for (module, _task), result in zip(safety_tasks, safety_results)
    }

    ppe_detection_result = results_by_module.get("ppe")
    fall_detection_result = results_by_module.get("fall")
    fire_detection_result = results_by_module.get("fire")

    if not required_ppe:
        ppe_detection = {
            "status": "inactive",
            "violations": [],
            "detected_items": [],
            "image_width": 0,
            "image_height": 0,
        }
        filtered_ppe_items = []
        ppe_violations = []
    elif isinstance(ppe_detection_result, Exception):
        ppe_detection = _empty_ppe_result(str(ppe_detection_result))
        filtered_ppe_items = []
        ppe_violations = []
    else:
        detected_ppe_items = [item.model_dump() for item in ppe_detection_result.detected_items]
        filtered_ppe_items, ppe_violations = await ppe_service.get_live_ppe_monitoring_data(
            detected_ppe_items,
            organization_id,
            effective_zone_type,
            required_ppe,
        )
        ppe_detection = {
            "status": "violation" if ppe_violations else "clear",
            "violations": ppe_violations,
            "detected_items": filtered_ppe_items,
            "image_width": ppe_detection_result.image_width,
            "image_height": ppe_detection_result.image_height,
        }

    if isinstance(fall_detection_result, Exception):
        fall_detection = _empty_fall_result(str(fall_detection_result), effective_zone_type)
    else:
        fall_detection = fall_detection_result

    if isinstance(fire_detection_result, Exception):
        fire_detection = _empty_fire_result(str(fire_detection_result), effective_zone_type)
    else:
        fire_detection = fire_detection_result
    created_alerts = []

    for violation_label in ppe_violations:
        normalized_ppe = violation_label[3:] if violation_label.startswith("No ") else violation_label
        matching_detection = next(
            (item for item in filtered_ppe_items if item["class_name"] == violation_label),
            None,
        )
        alert = _queue_alert_once(
            alert_service=alert_service,
            organization_id=organization_id,
            title=f"Missing PPE: {normalized_ppe}",
            message=f"Missing PPE: {normalized_ppe}",
            category=RuleCategory.PPE,
            severity=Severity.HIGH,
            image_bytes=file_bytes,
            bbox=matching_detection["bbox"] if matching_detection else None,
        )
        if alert is not None:
            created_alerts.append(alert)

    if fall_detection.get("fall_detection_active"):
        for fall_detection_item in fall_detection["detections"]:
            if not fall_detection_item["is_fallen"]:
                continue
            alert = _queue_alert_once(
                alert_service=alert_service,
                organization_id=organization_id,
                title="Fall detected",
                message="Fall detected",
                category=RuleCategory.FALL,
                severity=Severity.CRITICAL,
                image_bytes=file_bytes,
                bbox=fall_detection_item["bbox"],
            )
            if alert is not None:
                created_alerts.append(alert)

    if fire_detection.get("fire_detection_active"):
        for fire_detection_item in fire_detection["detections"]:
            class_name = str(fire_detection_item["class"]).strip().lower()
            if class_name not in {"fire", "smoke"}:
                continue
            title = "Fire detected" if class_name == "fire" else "Smoke detected"
            alert = _queue_alert_once(
                alert_service=alert_service,
                organization_id=organization_id,
                title=title,
                message=title,
                category=RuleCategory.FIRE_SMOKE,
                severity=Severity.CRITICAL,
                image_bytes=file_bytes,
                bbox=fire_detection_item["bbox"],
            )
            if alert is not None:
                created_alerts.append(alert)

    return {
        "status": "success",
        "ppe": ppe_detection,
        "fall": fall_detection,
        "fire": fire_detection,
        "alerts": created_alerts,
    }


async def _run_safety_detection_from_ndarray(
    *,
    image,
    ppe_service: PPEService,
    fall_service: FallDetectionService,
    fire_service: FireDetectionService,
    alert_service: AlertService,
    current_user: dict,
    zone_type: str | None,
) -> dict:
    success, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 70])
    if not success:
        raise ValueError("Failed to encode video frame")

    return await _run_safety_detection(
        file_bytes=encoded.tobytes(),
        filename="monitoring-frame.jpg",
        content_type="image/jpeg",
        ppe_service=ppe_service,
        fall_service=fall_service,
        fire_service=fire_service,
        alert_service=alert_service,
        current_user=current_user,
        zone_type=zone_type,
    )


async def _wait_for_ice_gathering_complete(peer_connection) -> None:
    for _ in range(50):
        if getattr(peer_connection, "iceGatheringState", None) == "complete":
            return
        await asyncio.sleep(0.1)


@router.post("/detect")
async def detect_monitoring_safety(
    file: Annotated[UploadFile, File(...)],
    ppe_service: Annotated[PPEService, Depends(get_ppe_service)],
    fall_service: Annotated[FallDetectionService, Depends(get_fall_service)],
    fire_service: Annotated[FireDetectionService, Depends(get_fire_service)],
    alert_service: Annotated[AlertService, Depends(get_alert_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
    zone_type: Annotated[str | None, Form()] = None,
) -> dict:
    file_bytes = await file.read()
    return await _run_safety_detection(
        file_bytes=file_bytes,
        filename=file.filename or "monitoring-frame.jpg",
        content_type=file.content_type,
        ppe_service=ppe_service,
        fall_service=fall_service,
        fire_service=fire_service,
        alert_service=alert_service,
        current_user=current_user,
        zone_type=zone_type,
    )


@router.post("/webrtc/offer")
async def create_monitoring_webrtc_offer(
    body: dict,
    ppe_service: Annotated[PPEService, Depends(get_ppe_service)],
    fall_service: Annotated[FallDetectionService, Depends(get_fall_service)],
    fire_service: Annotated[FireDetectionService, Depends(get_fire_service)],
    alert_service: Annotated[AlertService, Depends(get_alert_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    try:
        from aiortc import RTCPeerConnection, RTCSessionDescription
    except ImportError as exc:
        return {
            "detail": "aiortc is not installed on the backend. Install dependencies and restart the server.",
            "error": str(exc),
        }

    offer_sdp = body.get("sdp")
    offer_type = body.get("type")
    zone_type = body.get("zone_type")
    if not offer_sdp or not offer_type:
        return {"detail": "Missing WebRTC offer payload"}

    pc = RTCPeerConnection()
    ACTIVE_PEER_CONNECTIONS.add(pc)
    channel_ref: dict[str, object | None] = {"channel": None}

    async def close_connection() -> None:
        if pc in ACTIVE_PEER_CONNECTIONS:
            ACTIVE_PEER_CONNECTIONS.discard(pc)
        if pc.connectionState != "closed":
            await pc.close()

    @pc.on("datachannel")
    def on_datachannel(channel) -> None:
        if channel.label == "safety-events":
            channel_ref["channel"] = channel

    @pc.on("connectionstatechange")
    async def on_connectionstatechange() -> None:
        if pc.connectionState in {"failed", "closed", "disconnected"}:
            await close_connection()

    @pc.on("track")
    def on_track(track) -> None:
        if track.kind != "video":
            return

        latest_frame_ref: dict[str, object | None] = {
            "image": None,
            "width": None,
            "height": None,
            "sequence": 0,
        }
        latest_frame_event = asyncio.Event()

        async def receive_video_track() -> None:
            try:
                while True:
                    frame = await track.recv()
                    image = frame.to_ndarray(format="bgr24")
                    latest_frame_ref["image"] = image
                    latest_frame_ref["width"] = image.shape[1]
                    latest_frame_ref["height"] = image.shape[0]
                    latest_frame_ref["sequence"] = int(latest_frame_ref["sequence"] or 0) + 1
                    latest_frame_event.set()
            except Exception:
                latest_frame_event.set()
                await close_connection()

        async def process_video_track() -> None:
            last_processed_sequence = 0
            last_processed_at = 0.0
            try:
                while True:
                    await latest_frame_event.wait()
                    latest_frame_event.clear()

                    current_sequence = int(latest_frame_ref["sequence"] or 0)
                    image = latest_frame_ref["image"]
                    if image is None or current_sequence == last_processed_sequence:
                        if pc.connectionState in {"failed", "closed", "disconnected"}:
                            break
                        continue

                    now = time.monotonic()
                    if now - last_processed_at < WEBRTC_SAFETY_INTERVAL_SECONDS:
                        await asyncio.sleep(WEBRTC_SAFETY_INTERVAL_SECONDS - (now - last_processed_at))
                        current_sequence = int(latest_frame_ref["sequence"] or 0)
                        image = latest_frame_ref["image"]
                        if image is None:
                            continue

                    last_processed_at = time.monotonic()
                    last_processed_sequence = current_sequence

                    result = await _run_safety_detection_from_ndarray(
                        image=image,
                        ppe_service=ppe_service,
                        fall_service=fall_service,
                        fire_service=fire_service,
                        alert_service=alert_service,
                        current_user=current_user,
                        zone_type=zone_type,
                    )

                    channel = channel_ref["channel"]
                    if channel is not None and getattr(channel, "readyState", None) == "open":
                        channel.send(
                            json.dumps(
                                {
                                    "type": "safety_result",
                                    "frame_width": latest_frame_ref["width"],
                                    "frame_height": latest_frame_ref["height"],
                                    **result,
                                }
                            )
                        )
            except Exception:
                await close_connection()

        asyncio.create_task(receive_video_track())
        asyncio.create_task(process_video_track())

    await pc.setRemoteDescription(RTCSessionDescription(sdp=offer_sdp, type=offer_type))
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await _wait_for_ice_gathering_complete(pc)

    return {
        "sdp": pc.localDescription.sdp,
        "type": pc.localDescription.type,
    }


@router.websocket("/ws/safety")
async def monitoring_safety_websocket(
    websocket: WebSocket,
) -> None:
    await websocket.accept()

    try:
        current_user = await _authenticate_websocket_user(websocket.query_params.get("token"))
    except Exception as exc:
        await websocket.send_json({"type": "error", "detail": str(exc)})
        await websocket.close(code=1008)
        return

    ppe_service = get_ppe_service(get_employee_repository(), get_extracted_rule_repository(), get_regulation_repository())
    fall_service = get_fall_service(get_database())
    fire_service = get_fire_service(get_database())
    alert_service = get_alert_service(get_alert_repository(), get_local_storage_client())

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                return

            file_bytes: bytes | None = None
            zone_type = DEFAULT_MONITORING_ZONE
            frame_width: int | None = None
            frame_height: int | None = None

            if message.get("bytes") is not None:
                file_bytes = message["bytes"]
            elif message.get("text") is not None:
                payload = json.loads(message["text"])
                if payload.get("type") != "frame":
                    continue

                image_base64 = payload.get("image")
                if not image_base64:
                    await websocket.send_json({"type": "error", "detail": "Missing image payload"})
                    continue

                if "," in image_base64:
                    image_base64 = image_base64.split(",", 1)[1]

                try:
                    file_bytes = base64.b64decode(image_base64)
                except Exception:
                    await websocket.send_json({"type": "error", "detail": "Invalid base64 image payload"})
                    continue

                zone_type = payload.get("zone_type") or DEFAULT_MONITORING_ZONE
                frame_width = payload.get("frame_width")
                frame_height = payload.get("frame_height")
            else:
                continue

            if not file_bytes:
                await websocket.send_json({"type": "error", "detail": "Missing image payload"})
                continue

            if frame_width is None or frame_height is None:
                decoded_frame = cv2.imdecode(
                    np.frombuffer(file_bytes, dtype=np.uint8),
                    cv2.IMREAD_COLOR,
                )
                if decoded_frame is not None:
                    frame_height, frame_width = decoded_frame.shape[:2]

            result = await _run_safety_detection(
                file_bytes=file_bytes,
                filename="monitoring-frame.jpg",
                content_type="image/jpeg",
                ppe_service=ppe_service,
                fall_service=fall_service,
                fire_service=fire_service,
                alert_service=alert_service,
                current_user=current_user,
                zone_type=zone_type,
            )
            await websocket.send_json(
                {
                    "type": "safety_result",
                    "frame_width": frame_width,
                    "frame_height": frame_height,
                    **result,
                }
            )
    except WebSocketDisconnect:
        return
    except Exception as exc:
        print("monitoring_safety_websocket error:")
        traceback.print_exc()
        if websocket.client_state == WebSocketState.CONNECTED:
            try:
                await websocket.send_json({"type": "error", "detail": str(exc)})
                await websocket.close(code=1011)
            except WebSocketDisconnect:
                return
            except RuntimeError:
                return
