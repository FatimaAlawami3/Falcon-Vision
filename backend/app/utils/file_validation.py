from pathlib import Path

from app.core.exceptions import AppError


IMAGE_CONTENT_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
}

ZIP_CONTENT_TYPES = {
    "application/zip",
    "application/x-zip-compressed",
    "multipart/x-zip",
}

IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
}

ZIP_EXTENSIONS = {
    ".zip",
}

PDF_CONTENT_TYPES = {
    "application/pdf",
}

PDF_EXTENSIONS = {
    ".pdf",
}


def ensure_file_size(content: bytes, *, max_size_mb: int, label: str) -> None:
    if not content:
        raise AppError(f"{label} is empty")

    max_size_bytes = max_size_mb * 1024 * 1024
    if len(content) > max_size_bytes:
        raise AppError(f"{label} exceeds the maximum size of {max_size_mb} MB")


def is_image_filename(filename: str) -> bool:
    return Path(filename).suffix.lower() in IMAGE_EXTENSIONS


def is_zip_filename(filename: str) -> bool:
    return Path(filename).suffix.lower() in ZIP_EXTENSIONS


def is_pdf_filename(filename: str) -> bool:
    return Path(filename).suffix.lower() in PDF_EXTENSIONS


def is_supported_face_upload(filename: str, content_type: str | None) -> bool:
    normalized_type = (content_type or "").lower()
    if is_image_filename(filename):
        return True
    if is_zip_filename(filename):
        return True
    return normalized_type in IMAGE_CONTENT_TYPES or normalized_type in ZIP_CONTENT_TYPES


def is_supported_pdf_upload(filename: str, content_type: str | None) -> bool:
    normalized_type = (content_type or "").lower()
    return is_pdf_filename(filename) or normalized_type in PDF_CONTENT_TYPES


def infer_image_mime_type(filename: str, fallback: str | None = None) -> str:
    extension = Path(filename).suffix.lower()
    if extension in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if extension == ".png":
        return "image/png"
    return fallback or "application/octet-stream"
