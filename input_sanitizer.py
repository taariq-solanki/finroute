"""Input Sanitizer module for prompt injection defense.

Validates user input against length limits and known injection patterns
before forwarding to the Orchestrator Agent or Bedrock Guardrails.
"""

import re
import hashlib
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class SanitizationResult:
    """Result of input validation."""

    is_valid: bool
    error_message: Optional[str] = None
    rejection_category: Optional[str] = None


class InputSanitizer:
    """Validates and sanitizes user input before LLM invocation.

    Applies layered defense:
    1. Length check (max 4000 characters)
    2. Pattern-based injection detection (plaintext, base64, URL-encoded)
    """

    MAX_LENGTH: int = 4000

    # Compiled regex patterns for injection detection (case-insensitive)
    INJECTION_PATTERNS: list[re.Pattern] = [
        # Direct instruction override attempts
        re.compile(r"ignore\s+(all\s+)?previous\s+instructions", re.IGNORECASE),
        re.compile(r"ignore\s+(all\s+)?prior\s+instructions", re.IGNORECASE),
        re.compile(r"ignore\s+(all\s+)?above\s+instructions", re.IGNORECASE),
        re.compile(r"disregard\s+(all\s+)?previous\s+instructions", re.IGNORECASE),
        re.compile(r"forget\s+(all\s+)?previous\s+instructions", re.IGNORECASE),
        # Identity override attempts
        re.compile(r"you\s+are\s+now\b", re.IGNORECASE),
        re.compile(r"you\s+are\s+a\s+new\b", re.IGNORECASE),
        re.compile(r"pretend\s+you\s+are", re.IGNORECASE),
        re.compile(r"act\s+as\s+if\s+you\s+are", re.IGNORECASE),
        # Role-boundary markers (system prompt injection)
        re.compile(r"^system\s*:", re.IGNORECASE | re.MULTILINE),
        re.compile(r"###\s*system\s*:", re.IGNORECASE),
        re.compile(r"<<SYS>>", re.IGNORECASE),
        re.compile(r"\[INST\]", re.IGNORECASE),
        re.compile(r"\[/INST\]", re.IGNORECASE),
        re.compile(r"<\|im_start\|>system", re.IGNORECASE),
        # Base64-encoded variants
        # "ignore previous" -> "aWdub3JlIHByZXZpb3Vz"
        re.compile(r"aWdub3JlIHByZXZpb3Vz", re.IGNORECASE),
        # "ignore previous instructions" -> "aWdub3JlIHByZXZpb3VzIGluc3RydWN0aW9ucw"
        re.compile(r"aWdub3JlIHByZXZpb3VzIGluc3RydWN0aW9ucw", re.IGNORECASE),
        # "you are now" -> "eW91IGFyZSBub3c"
        re.compile(r"eW91IGFyZSBub3c", re.IGNORECASE),
        # "system:" -> "c3lzdGVtOg"
        re.compile(r"c3lzdGVtOg", re.IGNORECASE),
        # URL-encoded variants
        # "ignore" -> %69%67%6E%6F%72%65
        re.compile(r"%69%67%6[Ee]%6[Ff]%72%65", re.IGNORECASE),
        # "system" -> %73%79%73%74%65%6D
        re.compile(r"%73%79%73%74%65%6[Dd]", re.IGNORECASE),
        # "you are" -> %79%6F%75%20%61%72%65
        re.compile(r"%79%6[Ff]%75%20%61%72%65", re.IGNORECASE),
    ]

    def validate(self, user_input: str) -> SanitizationResult:
        """Validate input against length limits and injection patterns.

        Checks are applied in order:
        1. Length validation (max 4000 characters)
        2. Injection pattern detection

        Args:
            user_input: Raw user input string.

        Returns:
            SanitizationResult indicating pass/fail with optional error details.
        """
        # Type guard: fail CLOSED on missing/None/non-string input. A malformed
        # client payload (missing "prompt", null, or a non-string value) must be
        # rejected here rather than crashing len()/pattern.search() downstream.
        if not isinstance(user_input, str):
            self._log_rejection("", "type")
            return SanitizationResult(
                is_valid=False,
                error_message=(
                    "Your message could not be processed due to policy violation"
                ),
                rejection_category="type",
            )

        # Length check first
        if len(user_input) > self.MAX_LENGTH:
            self._log_rejection(user_input, "length")
            return SanitizationResult(
                is_valid=False,
                error_message=(
                    f"Message exceeds maximum length of {self.MAX_LENGTH} characters"
                ),
                rejection_category="length",
            )

        # Injection pattern check
        for pattern in self.INJECTION_PATTERNS:
            if pattern.search(user_input):
                self._log_rejection(user_input, "injection_pattern")
                return SanitizationResult(
                    is_valid=False,
                    error_message=(
                        "Your message could not be processed due to policy violation"
                    ),
                    rejection_category="injection_pattern",
                )

        return SanitizationResult(is_valid=True)

    def _log_rejection(self, user_input: str, category: str) -> None:
        """Log rejection event with hashed input for security monitoring.

        Logs the SHA-256 hash (first 16 hex characters) of the input,
        the rejection category, and an ISO 8601 timestamp.
        Never logs the original payload.

        Args:
            user_input: The raw input that was rejected.
            category: The rejection reason category.
        """
        input_hash = hashlib.sha256(user_input.encode("utf-8")).hexdigest()[:16]
        timestamp = datetime.now(timezone.utc).isoformat()

        logger.warning(
            "Input rejected: hash=%s category=%s timestamp=%s",
            input_hash,
            category,
            timestamp,
        )
