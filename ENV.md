
# Environment Variables
## Backend Environment Variables
Create a `.env` file in the root directory (or export them in your terminal session) to configure these settings.
| Variable Name | Description | Default Value | Required? |
| :--- | :--- | :--- | :--- |
| `SECRET_KEY` | Key used for signing JWT access tokens. | `"super-secret-key-..."` | **Recommended in Production** |
| `JWT_ALGORITHM` | Algorithm used for JWT encoding. | `"HS256"` | No |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token lifespan in minutes. | `10080` (1 week) | No |
| `DATABASE_URL` | SQLAlchemy-compatible database URI connection string (SQLite or PostgreSQL). | `"sqlite:///./chat.db"` | No |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 Client Access Key ID. | *None* | Yes (For R2 storage) |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 Client Secret Access Key. | *None* | Yes (For R2 storage) |
| `R2_ENDPOINT_URL` | Cloudflare R2 Endpoint URL (S3 compatible API). | *None* | Yes (For R2 storage) |
| `R2_BUCKET_NAME` | The bucket name in Cloudflare R2. | *None* | Yes (For R2 storage) |
| `R2_PUBLIC_URL` | Public HTTP URL prefix mapping to the R2 bucket. | *None* | Yes (For R2 storage) |

> [!NOTE]
> If any R2 configuration parameters are missing, the server will automatically default to local file storage, serving uploaded files via `/uploads/...` from a local directory named `uploads/` in the project root.

---

## Frontend Environment Variables
Create a `.env` file in the `frontend/` directory to configure these settings.

| Variable Name | Description | Default Value | Required? |
| :--- | :--- | :--- | :--- |
| `VITE_API_BASE` | The base URL of the FastAPI backend API. | `"http://127.0.0.1"` | No |

> [!NOTE]
> The WebSocket URL in the frontend is derived dynamically from `VITE_API_BASE` by converting `http` to `ws`, so you don't need to configure it separately.
