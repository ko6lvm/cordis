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

class UserResponse(BaseModel):
    user_id: int
    username: str
    permissions: List[str]
    status: str
    description: str
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

class ServerResponse(BaseModel):
    server_id: int
    server_name: str
    server_description: str
    server_image: str
    members: List[int]
    folders: int
    channels: int

    class Config:
        from_attributes = True


# ==========================================
# 4. CHANNEL SCHEMAS
# ==========================================
class ChannelCreate(BaseModel):
    server_id: int
    channel_name: str
    channel_type: str

class ChannelResponse(BaseModel):
    channel_id: int
    server_id: int
    channel_name: str
    channel_type: str
    members: List[int]

    class Config:
        from_attributes = True


# ==========================================
# 5. MESSAGE SCHEMAS
# ==========================================
class Message(BaseModel):
    message_id: int
    channel_id: int
    author_id: int
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