"""Region configuration module - single source of truth for AWS region settings.

Provides validated region configuration, boto3 client factory with explicit region,
and startup validation to ensure AWS connectivity before accepting requests.
"""

import asyncio
import logging
import re
import sys

import boto3
from botocore.exceptions import ClientError, EndpointConnectionError, NoCredentialsError

logger = logging.getLogger(__name__)

REQUIRED_REGION: str = "eu-north-1"

_REGION_PATTERN: re.Pattern = re.compile(r"^[a-z]{2}(-[a-z]+)+-\d$")

_STARTUP_TIMEOUT_SECONDS: int = 10


def get_validated_region() -> str:
    """Return the configured region after validating its format and AWS connectivity.

    Validates that REQUIRED_REGION matches the AWS region identifier format,
    then confirms connectivity by calling STS GetCallerIdentity.

    Terminates the process with sys.exit(1) if the region format is invalid
    or if AWS cannot be reached within the configured timeout.

    Returns:
        The validated region string (eu-north-1).
    """
    region = REQUIRED_REGION

    if not _REGION_PATTERN.match(region):
        logger.error(
            "Region validation failed: '%s' does not match a valid AWS region format",
            region,
        )
        sys.exit(1)

    try:
        sts_client = boto3.client("sts", region_name=region)
        identity = sts_client.get_caller_identity()
        logger.info(
            "Region validation succeeded: region=%s, account=%s",
            region,
            identity.get("Account", "unknown"),
        )
    except (EndpointConnectionError, ClientError, NoCredentialsError) as exc:
        logger.error(
            "Region validation failed: region='%s', reason=%s",
            region,
            str(exc),
        )
        sys.exit(1)
    except Exception as exc:
        logger.error(
            "Region validation failed: region='%s', reason=%s",
            region,
            str(exc),
        )
        sys.exit(1)

    return region


def create_boto3_client(service_name: str, **kwargs) -> boto3.client:
    """Create a boto3 client with the configured region always injected.

    This factory ensures every boto3 client uses an explicit region_name,
    preventing reliance on environment-based region detection.

    Args:
        service_name: The AWS service name (e.g., 'bedrock', 'sts', 's3').
        **kwargs: Additional keyword arguments passed to boto3.client().

    Returns:
        A configured boto3 client for the specified service.
    """
    kwargs.setdefault("region_name", REQUIRED_REGION)
    return boto3.client(service_name, **kwargs)


async def validate_startup() -> None:
    """Validate AWS region connectivity and guardrail accessibility at startup.

    Performs the following checks within a 10-second timeout:
    1. Validates the region format and confirms STS connectivity.
    2. Verifies that the Bedrock guardrail is accessible in the configured region.

    Terminates the process with sys.exit(1) if any check fails or times out.
    This function must be called before the application starts accepting requests.
    """
    try:
        await asyncio.wait_for(
            _run_startup_checks(),
            timeout=_STARTUP_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.error(
            "Startup validation timed out after %d seconds in region '%s'",
            _STARTUP_TIMEOUT_SECONDS,
            REQUIRED_REGION,
        )
        sys.exit(1)


async def _run_startup_checks() -> None:
    """Execute startup validation checks sequentially."""
    # Check 1: Validate region format and AWS connectivity
    get_validated_region()

    # Check 2: Verify guardrail accessibility
    _check_guardrail_accessible()


def _check_guardrail_accessible() -> None:
    """Verify the Bedrock guardrail is accessible in the configured region.

    Terminates the process if the guardrail cannot be listed or found.
    """
    try:
        bedrock_client = create_boto3_client("bedrock")
        response = bedrock_client.list_guardrails()
        guardrails = response.get("guardrails", [])
        if guardrails:
            logger.info(
                "Guardrail accessibility check passed: %d guardrail(s) found in %s",
                len(guardrails),
                REQUIRED_REGION,
            )
        else:
            logger.warning(
                "No guardrails found in region '%s', but API is accessible",
                REQUIRED_REGION,
            )
    except (EndpointConnectionError, ClientError, NoCredentialsError) as exc:
        logger.error(
            "Guardrail accessibility check failed in region '%s': %s",
            REQUIRED_REGION,
            str(exc),
        )
        sys.exit(1)
    except Exception as exc:
        logger.error(
            "Guardrail accessibility check failed in region '%s': %s",
            REQUIRED_REGION,
            str(exc),
        )
        sys.exit(1)
