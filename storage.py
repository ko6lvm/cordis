import os
import uuid
import mimetypes
import boto3
from botocore.config import Config
from typing import Optional

# Cloudflare R2 Configuration
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_ENDPOINT_URL = os.getenv("R2_ENDPOINT_URL") or os.getenv("R2_ENDPOINT")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME") or os.getenv("R2_BUCKET")
R2_PUBLIC_URL = os.getenv("R2_PUBLIC_URL")

# If using a local emulator without a dedicated public CDN URL, construct a default public URL
if not R2_PUBLIC_URL and R2_ENDPOINT_URL and R2_BUCKET_NAME:
    R2_PUBLIC_URL = f"{R2_ENDPOINT_URL.rstrip('/')}/{R2_BUCKET_NAME}"

# Clean R2 endpoint URL if it contains the bucket name or any path components
if R2_ENDPOINT_URL:
    from urllib.parse import urlparse, urlunparse
    parsed = urlparse(R2_ENDPOINT_URL)
    if parsed.path and parsed.path.strip("/"):
        R2_ENDPOINT_URL = urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))

# Local fallback configuration
LOCAL_UPLOAD_DIR = "uploads"

# Check if R2 is fully configured
USE_R2 = all([
    R2_ACCESS_KEY_ID, 
    R2_SECRET_ACCESS_KEY, 
    R2_ENDPOINT_URL, 
    R2_BUCKET_NAME,
    R2_PUBLIC_URL
])

s3_client = None
if USE_R2:
    s3_client = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
else:
    if not os.path.exists(LOCAL_UPLOAD_DIR):
        os.makedirs(LOCAL_UPLOAD_DIR, exist_ok=True)

def upload_file_bytes(data: bytes, filename: str, content_type: str, folder: str = "attachments") -> str:
    """
    Uploads file bytes to Cloudflare R2 if configured, or saves locally as a fallback.
    Files are stored in {folder}/.
    Returns the public URL or the local path.
    """
    object_key = f"{folder}/{filename}"
    
    if USE_R2:
        s3_client.put_object(
            Bucket=R2_BUCKET_NAME,
            Key=object_key,
            Body=data,
            ContentType=content_type
        )
        return f"{R2_PUBLIC_URL.rstrip('/')}/{object_key}"
    else:
        # Fallback to local storage
        # E.g. uploads/avatars/avatar_123.png
        file_path = os.path.join(LOCAL_UPLOAD_DIR, object_key)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "wb") as f:
            f.write(data)
        # Assuming the backend will mount 'uploads' to '/uploads'
        return f"/{LOCAL_UPLOAD_DIR}/{object_key}"

def delete_file(url: str):
    """
    Deletes a file from Cloudflare R2 or local storage based on its public URL.
    """
    if not url:
        return
        
    from urllib.parse import unquote
    
    if USE_R2 and R2_PUBLIC_URL and url.startswith(R2_PUBLIC_URL):
        prefix = R2_PUBLIC_URL.rstrip('/') + '/'
        object_key = unquote(url[len(prefix):])
        try:
            s3_client.delete_object(Bucket=R2_BUCKET_NAME, Key=object_key)
        except Exception as e:
            print(f"Failed to delete {object_key} from R2: {e}")
            
    elif url.startswith(f"/{LOCAL_UPLOAD_DIR}/"):
        prefix = f"/{LOCAL_UPLOAD_DIR}/"
        object_key = unquote(url[len(prefix):])
        file_path = os.path.join(LOCAL_UPLOAD_DIR, object_key)
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception as e:
            print(f"Failed to delete local file {file_path}: {e}")
