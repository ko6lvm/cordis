from pydantic import BaseModel
from typing import List, Optional

# ==========================================
# 1. EMBED & REACTION SUB-SCHEMAS (Nested Data)
# ==========================================
class Embed(BaseModel):
    title: str
    text: str

class MessageContent(BaseModel):
    text: str
    attachments: List[str]
    embeds: List[Embed]

class Reaction(BaseModel):
    emoji: str
    count: int
    user_ids: List[int]


# ==========================================
# 2. USER SCHEMAS
# ==========================================
class UserRegister(BaseModel):
    username: str
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None

class UserResponse(BaseModel):
    user_id: int
    username: str
    permissions: List[str]
    status: str
    description: Optional[str] = None
    profile_picture: Optional[str] = None

    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    username: str
    description: Optional[str] = None
    profile_picture: Optional[str] = None

    class Config:
        from_attributes = True


# ==========================================
# 3. SERVER SCHEMAS
# ==========================================
class ServerCreate(BaseModel):
    server_name: str
    server_description: str
    server_image: str
    is_public: Optional[bool] = False

class ServerUpdate(BaseModel):
    server_name: Optional[str] = None
    server_description: Optional[str] = None
    server_image: Optional[str] = None

class ServerResponse(BaseModel):
    server_id: int
    server_name: str
    server_description: str
    server_image: str
    members: List[int]
    folders: int
    channels: int
    invite_code: Optional[str] = None
    is_public: Optional[bool] = False
    owner_id: int

    class Config:
        from_attributes = True

class JoinInvite(BaseModel):
    invite_code: str

class InvitePreview(BaseModel):
    server_name: str
    server_description: str
    server_image: str
    total_members: int
    online_members: int


# ==========================================
# 4. CHANNEL SCHEMAS
# ==========================================
class ChannelCreate(BaseModel):
    server_id: Optional[int] = None
    channel_name: str
    channel_type: str

class DMCreate(BaseModel):
    target_user_id: int

class ChannelResponse(BaseModel):
    channel_id: int
    server_id: Optional[int] = None
    channel_name: str
    channel_type: str
    members: List[int]
    target_user: Optional[UserResponse] = None

    class Config:
        from_attributes = True


# ==========================================
# 5. MESSAGE SCHEMAS
# ==========================================
class Message(BaseModel):
    message_id: int
    channel_id: int
    author_id: int
    author: Optional[UserResponse] = None
    content: MessageContent
    created_at: int
    modified_at: int
    message_type: str
    parent_id: int
    thread_id: int
    mentions: List[int]
    flags: List[str]
    reactions: List[Reaction]

    class Config:
        from_attributes = True

class MessageSend(BaseModel):
    content: MessageContent
    message_type: str = "DEFAULT"
    parent_id: int = 0
    thread_id: int = 0
    mentions: List[int] = []
    flags: List[str] = []
    reactions: List[Reaction] = []