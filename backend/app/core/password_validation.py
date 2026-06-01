import re


PASSWORD_REQUIREMENTS_MESSAGE = (
    "Password must be at least 8 characters and include uppercase, "
    "lowercase, number, and symbol."
)


def validate_password_strength(value: str) -> str:
    if len(value) < 8:
        raise ValueError(PASSWORD_REQUIREMENTS_MESSAGE)
    if not re.search(r"[A-Z]", value):
        raise ValueError(PASSWORD_REQUIREMENTS_MESSAGE)
    if not re.search(r"[a-z]", value):
        raise ValueError(PASSWORD_REQUIREMENTS_MESSAGE)
    if not re.search(r"[0-9]", value):
        raise ValueError(PASSWORD_REQUIREMENTS_MESSAGE)
    if not re.search(r"[^A-Za-z0-9]", value):
        raise ValueError(PASSWORD_REQUIREMENTS_MESSAGE)
    return value
