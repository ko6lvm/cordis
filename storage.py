import os
import uuid
import base64
import mimetypes
import boto3
from botocore.config import Config
from typing import Optional

# Cloudflare R2 Configuration
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_ENDPOINT_URL = os.getenv("R2_ENDPOINT_URL")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME")
R2_PUBLIC_URL = os.getenv("R2_PUBLIC_URL")

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

def upload_file_bytes(data: bytes, filename: str, content_type: str) -> str:
    """
    Uploads file bytes to Cloudflare R2 if configured, or saves locally as a fallback.
    Returns the public URL or the local path.
    """
    if USE_R2:
        # User requested: store everything in a base cordis/ folder in the R2
        object_key = f"cordis/{filename}"
        s3_client.put_object(
            Bucket=R2_BUCKET_NAME,
            Key=object_key,
            Body=data,
            ContentType=content_type
        )
        return f"{R2_PUBLIC_URL.rstrip('/')}/{object_key}"
    else:
        # Fallback to local storage
        file_path = os.path.join(LOCAL_UPLOAD_DIR, filename)
        with open(file_path, "wb") as f:
            f.write(data)
        # Assuming the backend will mount 'uploads' to '/uploads'
        return f"/uploads/{filename}"

def upload_base64_image(base64_str: str, prefix: str = "image") -> Optional[str]:
    """
    Parses a base64 string from the frontend.
    If it's a valid data URL, extracts bytes, uploads to storage, and returns the new URL.
    If it's already a URL (e.g. starts with http or /), returns it as-is.
    If empty, returns empty string.
    """
    if not base64_str:
        return ""
    
    # If it's already a URL or path, don't re-upload
    if base64_str.startswith("http://") or base64_str.startswith("https://") or base64_str.startswith("/"):
        return base64_str

    if base64_str.startswith("data:"):
        try:
            # Format: data:image/png;base64,iVBORw0KGgo...
            header, encoded = base64_str.split(",", 1)
            # header looks like: data:image/png;base64
            mime_part = header.split(";")[0]
            content_type = mime_part.split(":")[1]
            
            ext = mimetypes.guess_extension(content_type) or ".bin"
            # Some extensions might be weird like .jpe, normalize if needed
            if ext == ".jpe": ext = ".jpg"
            
            file_data = base64.b64decode(encoded)
            filename = f"{prefix}_{uuid.uuid4().hex}{ext}"
            
            return upload_file_bytes(file_data, filename, content_type)
        except Exception as e:
            print(f"Error parsing base64 image: {e}")
            return base64_str
            
    return base64_str
