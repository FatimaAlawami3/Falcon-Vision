from enum import StrEnum


class OrganizationStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"


class UserRole(StrEnum):
    ADMIN = "admin"
    SUPERVISOR = "supervisor"


LEGACY_USER_ROLE_MAP: dict[str, UserRole] = {
    "admin": UserRole.ADMIN,
    "organization_admin": UserRole.ADMIN,
    "system_admin": UserRole.ADMIN,
    "supervisor": UserRole.SUPERVISOR,
    "safety_supervisor": UserRole.SUPERVISOR,
    "security_operator": UserRole.SUPERVISOR,
    "viewer": UserRole.SUPERVISOR,
}


def normalize_user_role(value: str | UserRole) -> UserRole:
    if isinstance(value, UserRole):
        return value

    try:
        return LEGACY_USER_ROLE_MAP[value]
    except KeyError as exc:
        raise ValueError(f"Unsupported user role: {value}") from exc


class UserStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"


class RegulationStatus(StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"
    SUPERSEDED = "superseded"


class ExtractionStatus(StrEnum):
    NOT_STARTED = "not_started"
    PENDING = "pending"
    PROCESSING = "processing"
    CANCELLING = "cancelling"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class RuleCategory(StrEnum):
    PPE = "ppe"
    FALL = "fall"
    FIRE_SMOKE = "fire_smoke"
    HAZARD = "hazard"
    ACCESS_CONTROL = "access_control"
    GENERAL_SAFETY = "general_safety"


class Severity(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class EntityStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    ARCHIVED = "archived"


class EmploymentType(StrEnum):
    EMPLOYEE = "employee"
    CONTRACTOR = "contractor"
    VISITOR = "visitor"


class ZoneType(StrEnum):
    ENTRANCE = "entrance"
    PRODUCTION = "production"
    WAREHOUSE = "warehouse"
    MAINTENANCE = "maintenance"
    RESTRICTED = "restricted"
    OFFICE = "office"
    EMERGENCY_EXIT = "emergency_exit"
    FIRE_RISK = "fire_risk"


class AccessDefault(StrEnum):
    ALLOW = "allow"
    DENY = "deny"


class ZonePermissionType(StrEnum):
    ALLOWED = "allowed"
    DENIED = "denied"
    TEMPORARY_ALLOWED = "temporary_allowed"
    TEMPORARY_DENIED = "temporary_denied"


class CameraStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    OFFLINE = "offline"
    MAINTENANCE = "maintenance"


class CameraStreamType(StrEnum):
    RTSP = "rtsp"
    HTTP = "http"
    FILE = "file"


class VisionModule(StrEnum):
    PPE_DETECTION = "ppe_detection"
    FALL_DETECTION = "fall_detection"
    FIRE_SMOKE_DETECTION = "fire_smoke_detection"
    HAZARD_DETECTION = "hazard_detection"
    FACE_ACCESS_CONTROL = "face_access_control"


class MonitoringSessionStatus(StrEnum):
    SCHEDULED = "scheduled"
    ACTIVE = "active"
    PAUSED = "paused"
    STOPPED = "stopped"
    FAILED = "failed"


class DetectionEventType(StrEnum):
    PPE_VIOLATION = "ppe_violation"
    FALL_DETECTED = "fall_detected"
    FIRE_DETECTED = "fire_detected"
    SMOKE_DETECTED = "smoke_detected"
    HAZARD_DETECTED = "hazard_detected"
    UNAUTHORIZED_ACCESS = "unauthorized_access"
    UNKNOWN_FACE_DETECTED = "unknown_face_detected"
    AUTHORIZED_ACCESS = "authorized_access"


class AlertStatus(StrEnum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"
    FALSE_POSITIVE = "false_positive"


class NotificationType(StrEnum):
    ALERT_CREATED = "alert_created"
    ALERT_ACKNOWLEDGED = "alert_acknowledged"
    ALERT_RESOLVED = "alert_resolved"
    EXTRACTION_COMPLETED = "extraction_completed"
    EXTRACTION_FAILED = "extraction_failed"
    CAMERA_OFFLINE = "camera_offline"


class NotificationChannel(StrEnum):
    IN_APP = "in_app"
    EMAIL = "email"
    SMS = "sms"
    WEBSOCKET = "websocket"


class NotificationStatus(StrEnum):
    PENDING = "pending"
    DELIVERED = "delivered"
    FAILED = "failed"
    READ = "read"
