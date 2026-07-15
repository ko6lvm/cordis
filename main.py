import time
import random
import string
import jwt
import re
from typing import Optional
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, WebSocket, Depends, WebSocketDisconnect, HTTPException, status, Query, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
import models
import db_models
from database import get_db, engine
import bcrypt
import os
import storage
import httpx
from bs4 import BeautifulSoup
import asyncio

db_models.Base.metadata.create_all(bind=engine)

app = FastAPI()

SYSTEM_USER_ID = None
ALL_ROLES = ["default", "mod", "admin"]

def is_system_user(user_id: int, db: Session = None) -> bool:
    global SYSTEM_USER_ID
    if SYSTEM_USER_ID is not None:
        return user_id == SYSTEM_USER_ID
    if db is not None:
        system_user = db.query(db_models.DBUser).filter(func.lower(db_models.DBUser.username) == "system").first()
        if system_user:
            SYSTEM_USER_ID = system_user.user_id
            return user_id == SYSTEM_USER_ID
    return False

@app.on_event("startup")
def startup_event():
    global SYSTEM_USER_ID
    db = next(get_db())
    try:
        try:
            from sqlalchemy import text
            db.execute(text("ALTER TABLE users ADD COLUMN last_active_at INTEGER"))
            db.commit()
        except Exception:
            db.rollback()
            
        try:
            from sqlalchemy import text
            db.execute(text("ALTER TABLE users ADD COLUMN muted_until INTEGER"))
            db.commit()
        except Exception:
            db.rollback()

        try:
            from sqlalchemy import text
            db.execute(text("ALTER TABLE users ADD COLUMN display_name VARCHAR"))
            db.commit()
            db.execute(text("UPDATE users SET display_name = username WHERE display_name IS NULL"))
            db.commit()
        except Exception:
            db.rollback()

        for stmt in [
            "ALTER TABLE servers ADD COLUMN member_roles JSON",
            "ALTER TABLE channels ADD COLUMN category_id INTEGER",
            "ALTER TABLE channels ADD COLUMN position INTEGER DEFAULT 0",
            "ALTER TABLE channels ADD COLUMN view_roles JSON",
            "ALTER TABLE channels ADD COLUMN send_roles JSON",
        ]:
            try:
                from sqlalchemy import text
                db.execute(text(stmt))
                db.commit()
            except Exception:
                db.rollback()

        system_user = db.query(db_models.DBUser).filter(func.lower(db_models.DBUser.username) == "system").first()
        desired_hash = "$2b$12$nIW.6/aVmj9CGIlmVEsfa.hQ9XG.qGETc34QFULL21eISUUIKmsCG"
        if not system_user:
            system_user = db_models.DBUser(
                username="System",
                display_name="System",
                hashed_password=desired_hash,
                permissions=["SYSTEM_ADMIN"],
                status="ONLINE",
                description="Cordis System",
                profile_picture=""
            )
            db.add(system_user)
            db.commit()
            db.refresh(system_user)
        else:
            try:
                is_correct = bcrypt.checkpw("cordisSystemAdmin123!".encode('utf-8'), system_user.hashed_password.encode('utf-8'))
            except Exception:
                is_correct = False
            if not is_correct:
                system_user.hashed_password = desired_hash
            perms = list(system_user.permissions or [])
            if "ADMIN" in perms: perms.remove("ADMIN")
            if "SYSTEM_ADMIN" not in perms: perms.append("SYSTEM_ADMIN")
            system_user.permissions = perms
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(system_user, "permissions")
            db.commit()
            
        SYSTEM_USER_ID = system_user.user_id
            
        global_server = db.query(db_models.DBServer).filter(db_models.DBServer.invite_code == "GLOBAL").first()
        if not global_server:
            global_server = db_models.DBServer(
                server_name="General",
                server_description="The official global server for everyone.",
                server_image="",
                members=[system_user.user_id],
                folders=0,
                channels=0,
                invite_code="GLOBAL",
                is_public=True,
                owner_id=system_user.user_id
            )
            db.add(global_server)
            db.commit()
            db.refresh(global_server)
            
            general_channel = db_models.DBChannel(
                server_id=global_server.server_id,
                channel_name="general",
                channel_type="text",
                members=[system_user.user_id],
                category_id=None,
                position=0,
                view_roles=list(ALL_ROLES),
                send_roles=list(ALL_ROLES),
            )
            db.add(general_channel)
            global_server.channels = 1
            global_server.member_roles = {str(system_user.user_id): "admin"}
            db.commit()
        else:
            if global_server.server_name == "Global Hub":
                global_server.server_name = "General"
                db.commit()

        from sqlalchemy.orm.attributes import flag_modified as _flag_mod
        for ch in db.query(db_models.DBChannel).filter(db_models.DBChannel.server_id != None).all():
            changed = False
            if not ch.view_roles:
                ch.view_roles = list(ALL_ROLES)
                changed = True
            if not ch.send_roles:
                ch.send_roles = list(ALL_ROLES)
                changed = True
            if ch.position is None:
                ch.position = 0
                changed = True
            if changed:
                _flag_mod(ch, "view_roles")
                _flag_mod(ch, "send_roles")
        for srv in db.query(db_models.DBServer).all():
            if not srv.member_roles:
                roles = {}
                for mid in (srv.members or []):
                    roles[str(mid)] = "admin" if mid == srv.owner_id else "default"
                srv.member_roles = roles
                _flag_mod(srv, "member_roles")
        db.commit()
    finally:
        db.close()

def get_member_role(server: db_models.DBServer, user_id: int) -> str:
    if not server:
        return "default"
    if server.owner_id == user_id:
        return "admin"
    roles = server.member_roles or {}
    return roles.get(str(user_id), "default")

def set_member_role(server: db_models.DBServer, user_id: int, role: str):
    roles = dict(server.member_roles or {})
    roles[str(user_id)] = role
    server.member_roles = roles
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(server, "member_roles")

def can_manage_channels(server: db_models.DBServer, user_id: int) -> bool:
    return get_member_role(server, user_id) == "admin"

def can_kick_members(server: db_models.DBServer, user_id: int) -> bool:
    return get_member_role(server, user_id) in ("mod", "admin")

def can_view_channel(channel: db_models.DBChannel, server: Optional[db_models.DBServer], user_id: int) -> bool:
    if channel.server_id is None:
        return user_id in (channel.members or [])
    if not server or user_id not in (server.members or []):
        return False
    if server.owner_id == user_id:
        return True
    view = channel.view_roles or list(ALL_ROLES)
    return get_member_role(server, user_id) in view

def can_send_in_channel(channel: db_models.DBChannel, server: Optional[db_models.DBServer], user_id: int) -> bool:
    if not can_view_channel(channel, server, user_id):
        return False
    if channel.server_id is None:
        return True
    if server and server.owner_id == user_id:
        return True
    send = channel.send_roles or list(ALL_ROLES)
    return get_member_role(server, user_id) in send

def sync_channel_members_from_roles(channel: db_models.DBChannel, server: db_models.DBServer):
    view = channel.view_roles or list(ALL_ROLES)
    members = []
    for mid in (server.members or []):
        if server.owner_id == mid or get_member_role(server, mid) in view:
            members.append(mid)
    channel.members = members
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(channel, "members")

def channel_to_response(channel: db_models.DBChannel, server: Optional[db_models.DBServer], user_id: int, target_user=None) -> dict:
    return {
        "channel_id": channel.channel_id,
        "server_id": channel.server_id,
        "channel_name": channel.channel_name,
        "channel_type": channel.channel_type,
        "members": channel.members or [],
        "category_id": channel.category_id,
        "position": channel.position or 0,
        "view_roles": channel.view_roles or list(ALL_ROLES),
        "send_roles": channel.send_roles or list(ALL_ROLES),
        "can_send": can_send_in_channel(channel, server, user_id),
        "target_user": target_user,
    }

def ensure_user_in_global_hub(user_id: int, db: Session):
    global_server = db.query(db_models.DBServer).filter(db_models.DBServer.invite_code == "GLOBAL").first()
    if global_server:
        members = list(global_server.members) if global_server.members else []
        if user_id not in members:
            members.append(user_id)
            global_server.members = members
            set_member_role(global_server, user_id, "default")
            channels = db.query(db_models.DBChannel).filter(db_models.DBChannel.server_id == global_server.server_id).all()
            for channel in channels:
                if can_view_channel(channel, global_server, user_id):
                    chan_members = list(channel.members) if channel.members else []
                    if user_id not in chan_members:
                        chan_members.append(user_id)
                        channel.members = chan_members
            db.commit()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SECRET_KEY = os.getenv("SECRET_KEY", "super-secret-key-that-i-dont-wanna-write-rn-but-i-hope-i-dont-forget")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", str(60 * 24 * 7)))

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

def create_access_token(data: dict):
    to_encode = data.copy()
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def update_user_activity(user_id: int, db: Session):
    current_time = int(time.time())
    user = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == user_id).first()
    if user:
        if not user.last_active_at or (current_time - user.last_active_at) > 60:
            user.last_active_at = current_time
            db.commit()

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid auth credentials")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid auth credentials")
    
    user = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == int(user_id)).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
        
    update_user_activity(user.user_id, db)
    return user

def generate_invite_code(length=6):
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))

# websockets
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[int, list[WebSocket]] = {}
        self.user_sockets: dict[int, list[WebSocket]] = {} # user_id -> list of active WebSockets

    async def connect(self, websocket: WebSocket, channel_id: int, user_id: int, db: Session):
        await websocket.accept()
        if channel_id not in self.active_connections:
            self.active_connections[channel_id] = []
        self.active_connections[channel_id].append(websocket)
        
        # Presence logic
        if user_id not in self.user_sockets:
            self.user_sockets[user_id] = []
        self.user_sockets[user_id].append(websocket)
        
        if len(self.user_sockets[user_id]) == 1:
            await self.broadcast_presence_to_server(channel_id, user_id, "online", db)
            
        update_user_activity(user_id, db)
    
    async def disconnect(self, websocket: WebSocket, channel_id: int, user_id: int, db: Session):
        if channel_id in self.active_connections:
            self.active_connections[channel_id].remove(websocket)
            if not self.active_connections[channel_id]:
                del self.active_connections[channel_id]
                
        # Presence logic
        if user_id in self.user_sockets:
            if websocket in self.user_sockets[user_id]:
                self.user_sockets[user_id].remove(websocket)
            if not self.user_sockets[user_id]:
                del self.user_sockets[user_id]
                await self.broadcast_presence_to_server(channel_id, user_id, "offline", db)
                
                user = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == user_id).first()
                if user:
                    user.last_active_at = int(time.time())
                    db.commit()
    
    async def broadcast(self, channel_id: int, message_data: dict):
        if channel_id in self.active_connections:
            for connection in self.active_connections[channel_id]:
                await connection.send_json(message_data)
                
    async def send_personal_notification(self, user_id: int, event_data: dict):
        if user_id in self.user_sockets:
            for connection in self.user_sockets[user_id]:
                try:
                    await connection.send_json(event_data)
                except:
                    pass
                
    async def broadcast_presence_to_server(self, source_channel_id: int, user_id: int, status: str, db: Session):
        channel = db.query(db_models.DBChannel).filter(db_models.DBChannel.channel_id == source_channel_id).first()
        if not channel:
            return
        
        if channel.server_id is None:
            if channel.channel_id in self.active_connections:
                for connection in self.active_connections[channel.channel_id]:
                    try:
                        await connection.send_json({"type": "presence", "user_id": user_id, "status": status})
                    except:
                        pass
            return

        server_channels = db.query(db_models.DBChannel).filter(db_models.DBChannel.server_id == channel.server_id).all()
        for ch in server_channels:
            if ch.channel_id in self.active_connections:
                for connection in self.active_connections[ch.channel_id]:
                    try:
                        await connection.send_json({"type": "presence", "user_id": user_id, "status": status})
                    except:
                        pass

manager = ConnectionManager()

def extract_youtube_video_id(url: str) -> Optional[str]:
    if not url:
        return None
    cleaned = url.strip().rstrip(").,;]!>'\"")
    patterns = [
        r'(?:youtube\.com/watch\?(?:[^#\s]*&)?v=|youtube\.com/embed/|youtube\.com/v/|youtube\.com/shorts/|youtu\.be/)([A-Za-z0-9_-]{11})',
        r'youtube\.com/live/([A-Za-z0-9_-]{11})',
    ]
    for pattern in patterns:
        match = re.search(pattern, cleaned, re.IGNORECASE)
        if match:
            return match.group(1)
    return None


async def fetch_youtube_embed(client: httpx.AsyncClient, url: str, video_id: str) -> dict:
    watch_url = f"https://www.youtube.com/watch?v={video_id}"
    title = "YouTube"
    description = ""
    image = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    author = ""

    try:
        oembed_url = f"https://www.youtube.com/oembed?url={watch_url}&format=json"
        resp = await client.get(oembed_url, timeout=5.0)
        if resp.status_code == 200:
            data = resp.json()
            title = data.get("title") or title
            author = data.get("author_name") or ""
            if data.get("thumbnail_url"):
                image = data["thumbnail_url"]
            if author:
                description = f"YouTube · {author}"
            else:
                description = "YouTube"
    except Exception:
        description = "YouTube"

    for quality in ("maxresdefault", "sddefault", "hqdefault"):
        candidate = f"https://i.ytimg.com/vi/{video_id}/{quality}.jpg"
        try:
            head = await client.head(candidate, timeout=3.0, follow_redirects=True)
            if head.status_code == 200 and int(head.headers.get("content-length", "1")) > 2000:
                image = candidate
                break
        except Exception:
            continue

    return {
        "title": title,
        "description": description,
        "url": watch_url,
        "image": image,
        "type": "youtube",
        "video_id": video_id,
        "provider": "YouTube",
    }


async def fetch_link_metadata_task(channel_id: int, message_id: int, url: str):
    db = next(get_db())
    try:
        url = (url or "").strip().rstrip(").,;]!>'\"")
        async with httpx.AsyncClient(timeout=8.0, headers={
            "User-Agent": "Mozilla/5.0 (compatible; CordisBot/1.0; +https://cordis.local)"
        }) as client:
            video_id = extract_youtube_video_id(url)
            if video_id:
                embed = await fetch_youtube_embed(client, url, video_id)
            else:
                response = await client.get(url, follow_redirects=True)
                response.raise_for_status()

                soup = BeautifulSoup(response.text, 'html.parser')

                title_tag = soup.find("meta", property="og:title")
                title = title_tag["content"] if title_tag else (soup.title.string if soup.title else url)

                desc_tag = soup.find("meta", property="og:description")
                description = desc_tag["content"] if desc_tag else ""

                img_tag = soup.find("meta", property="og:image")
                image = img_tag["content"] if img_tag else ""

                embed = {
                    "title": title,
                    "description": description,
                    "url": url,
                    "image": image,
                    "type": "link",
                    "video_id": None,
                    "provider": None,
                }

            db_msg = db.query(db_models.DBMessage).filter(db_models.DBMessage.message_id == message_id).first()
            if db_msg:
                content = dict(db_msg.content)
                embeds = list(content.get("embeds", []))
                already = any(
                    (e.get("video_id") and e.get("video_id") == embed.get("video_id"))
                    or (e.get("url") and e.get("url") == embed.get("url"))
                    for e in embeds
                    if isinstance(e, dict)
                )
                if not already:
                    embeds.append(embed)
                    content["embeds"] = embeds
                    db_msg.content = content

                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(db_msg, "content")
                    db.commit()

                    channel = db.query(db_models.DBChannel).filter(db_models.DBChannel.channel_id == channel_id).first()
                    author_user = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == db_msg.author_id).first()

                    broadcast_msg = {
                        "type": "message_update",
                        "message_id": db_msg.message_id,
                        "channel_id": db_msg.channel_id,
                        "server_id": channel.server_id if channel else None,
                        "author_id": db_msg.author_id,
                        "author": models.UserResponse.from_orm(author_user).dict() if author_user else None,
                        "content": db_msg.content,
                        "created_at": db_msg.created_at,
                        "modified_at": db_msg.modified_at,
                        "message_type": db_msg.message_type,
                        "parent_id": db_msg.parent_id,
                        "thread_id": db_msg.thread_id,
                        "mentions": db_msg.mentions,
                        "flags": db_msg.flags,
                        "reactions": db_msg.reactions
                    }

                    await manager.broadcast(channel_id, broadcast_msg)

    except Exception as e:
        print(f"Error fetching metadata for {url}: {e}")
    finally:
        db.close()

@app.websocket("/ws/{channel_id}")
async def websocket_endpoint(websocket: WebSocket, channel_id: int, token: str = Query(...), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        user = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == int(user_id)).first()
        if not user:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid User")
            return
        if user.status == "BANNED":
            await websocket.accept()
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Banned")
            return
    except jwt.PyJWTError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid Token")
        return

    channel = db.query(db_models.DBChannel).filter(db_models.DBChannel.channel_id == channel_id).first()
    server = None
    if channel and channel.server_id is not None:
        server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == channel.server_id).first()
    
    if not channel or not can_view_channel(channel, server, user.user_id):
        await websocket.accept()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Access Denied: Not a member.")
        return

    await manager.connect(websocket, channel_id, user.user_id, db)
    
    try:
        while True:
            raw_data = await websocket.receive_json()
            
            update_user_activity(user.user_id, db)
            
            # Special real-time events (typing)
            if "type" in raw_data and raw_data["type"] == "typing":
                raw_data["user_id"] = user.user_id
                await manager.broadcast(channel_id, raw_data)
                continue
                
            if "type" in raw_data and raw_data["type"] == "read_update":
                message_id = raw_data.get("message_id", 0)
                read_state = db.query(db_models.DBChannelReadState).filter(
                    db_models.DBChannelReadState.user_id == user.user_id,
                    db_models.DBChannelReadState.channel_id == channel_id
                ).first()
                if not read_state:
                    read_state = db_models.DBChannelReadState(user_id=user.user_id, channel_id=channel_id, last_read_message_id=message_id)
                    db.add(read_state)
                else:
                    current_read_msg = db.query(db_models.DBMessage).filter(db_models.DBMessage.message_id == read_state.last_read_message_id).first()
                    new_read_msg = db.query(db_models.DBMessage).filter(db_models.DBMessage.message_id == message_id).first()
                    
                    if new_read_msg:
                        read_state.last_read_message_id = message_id
                db.commit()
                continue

            if "type" in raw_data and raw_data["type"] == "message_edit":
                if user.muted_until and user.muted_until > int(time.time()):
                    await websocket.send_json({"type": "error", "message": "You are currently muted."})
                    continue
                msg_id = raw_data.get("message_id")
                new_content = raw_data.get("content")
                if msg_id and new_content:
                    db_msg = db.query(db_models.DBMessage).filter(db_models.DBMessage.message_id == msg_id).first()
                    if db_msg and db_msg.author_id == user.user_id:
                        db_msg.content = new_content
                        db_msg.modified_at = int(time.time())
                        flags = list(db_msg.flags or [])
                        if "EDITED" not in flags:
                            flags.append("EDITED")
                        db_msg.flags = flags
                        from sqlalchemy.orm.attributes import flag_modified
                        flag_modified(db_msg, "flags")
                        db.commit()
                        
                        broadcast_msg = {
                            "type": "message_update",
                            "message_id": db_msg.message_id,
                            "channel_id": db_msg.channel_id,
                            "server_id": channel.server_id,
                            "author_id": db_msg.author_id,
                            "author": models.UserResponse.from_orm(user).dict(),
                            "content": db_msg.content,
                            "created_at": db_msg.created_at,
                            "modified_at": db_msg.modified_at,
                            "message_type": db_msg.message_type,
                            "parent_id": db_msg.parent_id,
                            "thread_id": db_msg.thread_id,
                            "mentions": db_msg.mentions,
                            "flags": db_msg.flags,
                            "reactions": db_msg.reactions
                        }
                        await manager.broadcast(channel_id, broadcast_msg)
                continue

            if "type" in raw_data and raw_data["type"] == "reaction_toggle":
                msg_id = raw_data.get("message_id")
                emoji = raw_data.get("emoji")
                if msg_id and emoji:
                    db_msg = db.query(db_models.DBMessage).filter(db_models.DBMessage.message_id == msg_id).first()
                    if db_msg:
                        current_reactions = list(db_msg.reactions or [])
                        reaction_index = -1
                        for i, r in enumerate(current_reactions):
                            if r.get("emoji") == emoji:
                                reaction_index = i
                                break
                        
                        if reaction_index != -1:
                            r = current_reactions[reaction_index]
                            user_ids = list(r.get("user_ids", []))
                            if user.user_id in user_ids:
                                user_ids.remove(user.user_id)
                                r["count"] -= 1
                            else:
                                user_ids.append(user.user_id)
                                r["count"] += 1
                            r["user_ids"] = user_ids
                            
                            if r["count"] <= 0:
                                current_reactions.pop(reaction_index)
                        else:
                            current_reactions.append({
                                "emoji": emoji,
                                "count": 1,
                                "user_ids": [user.user_id]
                            })
                            
                        db_msg.reactions = current_reactions
                        from sqlalchemy.orm.attributes import flag_modified
                        flag_modified(db_msg, "reactions")
                        db.commit()
                        
                        author_user = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == db_msg.author_id).first()
                        broadcast_msg = {
                            "type": "message_update",
                            "message_id": db_msg.message_id,
                            "channel_id": db_msg.channel_id,
                            "server_id": channel.server_id,
                            "author_id": db_msg.author_id,
                            "author": models.UserResponse.from_orm(author_user).dict() if author_user else None,
                            "content": db_msg.content,
                            "created_at": db_msg.created_at,
                            "modified_at": db_msg.modified_at,
                            "message_type": db_msg.message_type,
                            "parent_id": db_msg.parent_id,
                            "thread_id": db_msg.thread_id,
                            "mentions": db_msg.mentions,
                            "flags": db_msg.flags,
                            "reactions": db_msg.reactions
                        }
                        await manager.broadcast(channel_id, broadcast_msg)
                continue

            if "type" in raw_data and raw_data["type"] == "message_delete":
                msg_id = raw_data.get("message_id")
                if msg_id:
                    db_msg = db.query(db_models.DBMessage).filter(db_models.DBMessage.message_id == msg_id).first()
                    if db_msg:
                        # Check permissions
                        is_author = db_msg.author_id == user.user_id
                        is_server_owner = False
                        if channel.server_id:
                            server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == channel.server_id).first()
                            if server and server.owner_id == user.user_id:
                                is_server_owner = True
                                
                        if is_author or is_server_owner:
                            # Do not clear content in DB, only flag it
                            db_msg.modified_at = int(time.time())
                            flags = list(db_msg.flags or [])
                            if "DELETED" not in flags:
                                flags.append("DELETED")
                            db_msg.flags = flags
                            from sqlalchemy.orm.attributes import flag_modified
                            flag_modified(db_msg, "flags")
                            db.commit()
                            
                            author_user = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == db_msg.author_id).first()
                            
                            censored_content = {"text": "", "attachments": [], "embeds": []}
                            broadcast_msg = {
                                "type": "message_update",
                                "message_id": db_msg.message_id,
                                "channel_id": db_msg.channel_id,
                                "server_id": channel.server_id,
                                "author_id": db_msg.author_id,
                                "author": models.UserResponse.from_orm(author_user).dict() if author_user else None,
                                "content": censored_content,
                                "created_at": db_msg.created_at,
                                "modified_at": db_msg.modified_at,
                                "message_type": db_msg.message_type,
                                "parent_id": db_msg.parent_id,
                                "thread_id": db_msg.thread_id,
                                "mentions": db_msg.mentions,
                                "flags": db_msg.flags,
                                "reactions": db_msg.reactions
                            }
                            await manager.broadcast(channel_id, broadcast_msg)
                continue

            if user.muted_until and user.muted_until > int(time.time()):
                await websocket.send_json({"type": "error", "message": "You are currently muted."})
                continue

            if not can_send_in_channel(channel, server, user.user_id):
                await websocket.send_json({"type": "error", "message": "You cannot send messages in this channel."})
                continue

            validated_msg = models.MessageSend(**raw_data)
            
            # parse mentions
            current_mentions = set(validated_msg.mentions) if validated_msg.mentions else set()
            if validated_msg.content and validated_msg.content.text:
                mentioned_usernames = re.findall(r'@([a-zA-Z0-9_]+)', validated_msg.content.text)
                if mentioned_usernames:
                    mentioned_users = db.query(db_models.DBUser).filter(db_models.DBUser.username.in_(mentioned_usernames)).all()
                    current_mentions.update(u.user_id for u in mentioned_users)
            
            # auto-mention on reply
            if getattr(validated_msg, "parent_id", 0) != 0:
                parent_msg = db.query(db_models.DBMessage).filter(db_models.DBMessage.message_id == validated_msg.parent_id).first()
                if parent_msg and parent_msg.author_id:
                    current_mentions.add(parent_msg.author_id)
            
            validated_msg.mentions = list(current_mentions)

            timestamp = int(time.time())
            
            db_msg = db_models.DBMessage(
                channel_id=channel_id,
                author_id=user.user_id,
                content=validated_msg.content.dict(),
                mentions=validated_msg.mentions,
                flags=validated_msg.flags,
                reactions=[r.dict() for r in validated_msg.reactions],
                created_at=timestamp,
                modified_at=timestamp,
                message_type=validated_msg.message_type,
                parent_id=validated_msg.parent_id,
                thread_id=validated_msg.thread_id
            )
            db.add(db_msg)
            db.commit()
            db.refresh(db_msg)
            msg_id = db_msg.message_id
            
            broadcast_msg = {
                "message_id": msg_id,
                "channel_id": channel_id,
                "server_id": channel.server_id,
                "author_id": user.user_id,
                "author": models.UserResponse.from_orm(user).dict(),
                "content": validated_msg.content.dict(),
                "created_at": timestamp,
                "modified_at": timestamp,
                "message_type": validated_msg.message_type,
                "parent_id": validated_msg.parent_id,
                "thread_id": validated_msg.thread_id,
                "mentions": validated_msg.mentions,
                "flags": validated_msg.flags,
                "reactions": [r.dict() for r in validated_msg.reactions]
            }
            
            if validated_msg.parent_id != 0:
                parent_msg = db.query(db_models.DBMessage).filter(db_models.DBMessage.message_id == validated_msg.parent_id).first()
                if parent_msg:
                    p_dict = models.Message.from_orm(parent_msg).dict()
                    p_author = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == parent_msg.author_id).first()
                    if p_author:
                        p_dict["author"] = models.UserResponse.from_orm(p_author).dict()
                    broadcast_msg["parent_message"] = p_dict

            await manager.broadcast(channel_id, broadcast_msg)
            
            if validated_msg.content and validated_msg.content.text:
                urls = re.findall(r'(<)?(https?:\/\/[^\s<>]+)(>)?', validated_msg.content.text)
                for has_open, url, has_close in urls:
                    if not (has_open and has_close):
                        asyncio.create_task(fetch_link_metadata_task(channel_id, msg_id, url))
                        break
            
            # Send notifications to other members of the channel who are online but not actively in this channel
            channel_members = channel.members if channel.members else []
            for member_id in channel_members:
                if member_id == user.user_id:
                    continue
                active_sockets_in_chan = manager.active_connections.get(channel_id, [])
                member_sockets = manager.user_sockets.get(member_id, [])
                is_actively_in_chan = any(ws in active_sockets_in_chan for ws in member_sockets)
                if member_sockets and not is_actively_in_chan:
                    await manager.send_personal_notification(member_id, {
                        "type": "unread_notification",
                        "message_id": msg_id,
                        "channel_id": channel_id,
                        "server_id": channel.server_id,
                        "author_id": user.user_id,
                        "author": models.UserResponse.from_orm(user).dict(),
                        "content": validated_msg.content.dict(),
                        "created_at": timestamp,
                        "modified_at": timestamp,
                        "message_type": validated_msg.message_type,
                        "parent_id": validated_msg.parent_id,
                        "thread_id": validated_msg.thread_id,
                        "mentions": validated_msg.mentions,
                        "flags": validated_msg.flags,
                        "reactions": [r.dict() for r in validated_msg.reactions]
                    })
    except WebSocketDisconnect:
        await manager.disconnect(websocket, channel_id, user.user_id, db)

@app.post("/register", response_model=models.UserResponse, status_code=status.HTTP_201_CREATED)
def register_account(account_data: models.UserRegister, db: Session = Depends(get_db)):
    if len(account_data.password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 8 characters long.")
    if not (any(c.isalpha() for c in account_data.password) and any(c.isdigit() for c in account_data.password)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must contain both letters and numbers.")
    
    existing_user = db.query(db_models.DBUser).filter(func.lower(db_models.DBUser.username) == account_data.username.lower()).first()
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username taken.")
    
    password_bytes = account_data.password.encode('utf-8')
    salt = bcrypt.gensalt()
    secured_hash = bcrypt.hashpw(password_bytes, salt).decode('utf-8')
    
    db_user = db_models.DBUser(
        username=account_data.username,
        display_name=account_data.username,
        hashed_password=secured_hash,
        permissions=["USER_BASIC"],
        status="ONLINE",
        description="",
        profile_picture=""
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    ensure_user_in_global_hub(db_user.user_id, db)
    return db_user

@app.post("/login", response_model=models.Token)
def login(account_data: models.UserLogin, db: Session = Depends(get_db)):
    user = db.query(db_models.DBUser).filter(func.lower(db_models.DBUser.username) == account_data.username.lower()).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    if not bcrypt.checkpw(account_data.password.encode('utf-8'), user.hashed_password.encode('utf-8')):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    ensure_user_in_global_hub(user.user_id, db)
    
    access_token = create_access_token(data={"sub": str(user.user_id)})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/users/me", response_model=models.UserResponse)
def get_me(current_user: db_models.DBUser = Depends(get_current_user)):
    return current_user

@app.put("/users/me", response_model=models.UserResponse)
def update_me(update_data: models.UserUpdate, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if update_data.username != current_user.username:
        existing = db.query(db_models.DBUser).filter(func.lower(db_models.DBUser.username) == update_data.username.lower()).first()
        if existing:
            raise HTTPException(status_code=400, detail="Username already taken.")
        current_user.username = update_data.username
    
    if update_data.display_name is not None:
        current_user.display_name = update_data.display_name
    
    if update_data.description is not None:
        current_user.description = update_data.description
    
    if update_data.profile_picture is not None:
        if update_data.profile_picture and not update_data.profile_picture.startswith(("http://", "https://", "/uploads/")):
            raise HTTPException(status_code=400, detail="Invalid profile picture URL.")
        if current_user.profile_picture and current_user.profile_picture != update_data.profile_picture:
            storage.delete_file(current_user.profile_picture)
        current_user.profile_picture = update_data.profile_picture
        
    if update_data.banner is not None:
        if update_data.banner and not update_data.banner.startswith(("http://", "https://", "/uploads/")):
            raise HTTPException(status_code=400, detail="Invalid banner URL.")
        if current_user.banner and current_user.banner != update_data.banner:
            storage.delete_file(current_user.banner)
        current_user.banner = update_data.banner
        
    db.commit()
    db.refresh(current_user)
    return current_user

@app.get("/users/me/unreads", response_model=dict[int, models.UnreadState])
def get_my_unreads(current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    servers = db.query(db_models.DBServer).all()
    user_servers = [s for s in servers if current_user.user_id in s.members]
    server_ids = [s.server_id for s in user_servers]
    
    channels = db.query(db_models.DBChannel).filter(db_models.DBChannel.server_id.in_(server_ids)).all()
    dms = db.query(db_models.DBChannel).filter(db_models.DBChannel.channel_type == "dm").all()
    user_dms = [dm for dm in dms if current_user.user_id in dm.members]
    
    all_channels = channels + user_dms
    channel_ids = [c.channel_id for c in all_channels]
    
    read_states = db.query(db_models.DBChannelReadState).filter(
        db_models.DBChannelReadState.user_id == current_user.user_id,
        db_models.DBChannelReadState.channel_id.in_(channel_ids)
    ).all()
    read_map = {rs.channel_id: rs.last_read_message_id for rs in read_states}
    
    results = {}
    for cid in channel_ids:
        last_read_id = read_map.get(cid, 0)
        
        latest_msg = db.query(db_models.DBMessage).filter(db_models.DBMessage.channel_id == cid).order_by(db_models.DBMessage.created_at.desc(), db_models.DBMessage.message_id.desc()).first()
        last_msg_id = latest_msg.message_id if latest_msg else 0
        
        last_read_msg = db.query(db_models.DBMessage).filter(db_models.DBMessage.message_id == last_read_id).first() if last_read_id > 0 else None
        
        if last_read_msg:
            new_msgs = db.query(db_models.DBMessage).filter(
                db_models.DBMessage.channel_id == cid,
                (db_models.DBMessage.created_at > last_read_msg.created_at) |
                ((db_models.DBMessage.created_at == last_read_msg.created_at) & (db_models.DBMessage.message_id > last_read_id))
            ).all()
        else:
            new_msgs = db.query(db_models.DBMessage).filter(
                db_models.DBMessage.channel_id == cid,
                db_models.DBMessage.message_id > last_read_id
            ).all()
        
        channel_obj = next((c for c in all_channels if c.channel_id == cid), None)
        server_id = channel_obj.server_id if channel_obj else None
        
        mentions_count = 0
        for m in new_msgs:
            if m.author_id == current_user.user_id:
                continue
            if channel_obj and channel_obj.channel_type == "dm":
                mentions_count += 1
            elif m.mentions and current_user.user_id in m.mentions:
                mentions_count += 1
        
        results[cid] = models.UnreadState(
            server_id=server_id,
            last_read_message_id=last_read_id,
            last_message_id=last_msg_id,
            mentions_count=mentions_count,
            has_unread=len(new_msgs) > 0
        )
        
    return results

@app.get("/users/{user_id}", response_model=models.UserResponse)
def get_user(user_id: int, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    user = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.get("/users/by-username/{username}", response_model=models.UserResponse)
def get_user_by_username(username: str, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    user = db.query(db_models.DBUser).filter(func.lower(db_models.DBUser.username) == username.lower()).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.get("/servers/discover", response_model=list[models.ServerResponse])
def discover_servers(db: Session = Depends(get_db)):
    servers = db.query(db_models.DBServer).filter(db_models.DBServer.is_public == True).all()
    return servers

def server_to_response(server: db_models.DBServer, user_id: int) -> dict:
    return {
        "server_id": server.server_id,
        "server_name": server.server_name,
        "server_description": server.server_description,
        "server_image": server.server_image,
        "server_banner": server.server_banner,
        "members": server.members or [],
        "member_roles": server.member_roles or {},
        "folders": server.folders or 0,
        "channels": server.channels or 0,
        "invite_code": server.invite_code,
        "is_public": server.is_public,
        "owner_id": server.owner_id,
        "my_role": get_member_role(server, user_id),
    }

@app.get("/servers/me", response_model=list[models.ServerResponse])
def get_my_servers(current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    servers = db.query(db_models.DBServer).all()
    return [server_to_response(s, current_user.user_id) for s in servers if current_user.user_id in (s.members or [])]

@app.post("/servers", response_model=models.ServerResponse, status_code=201)
def create_server(server_data: models.ServerCreate, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if server_data.server_image and not server_data.server_image.startswith(("http://", "https://", "/uploads/")):
        raise HTTPException(status_code=400, detail="Invalid server image URL.")
    if getattr(server_data, "server_banner", None) and not server_data.server_banner.startswith(("http://", "https://", "/uploads/")):
        raise HTTPException(status_code=400, detail="Invalid server banner URL.")

    invite = generate_invite_code()
    db_server = db_models.DBServer(
        server_name=server_data.server_name,
        server_description=server_data.server_description,
        server_image=server_data.server_image or "",
        server_banner=getattr(server_data, "server_banner", "") or "",
        members=[current_user.user_id],
        member_roles={str(current_user.user_id): "admin"},
        folders=0,
        channels=0,
        invite_code=invite,
        is_public=server_data.is_public,
        owner_id=current_user.user_id
    )
    db.add(db_server)
    db.commit()
    db.refresh(db_server)
    
    db_channel = db_models.DBChannel(
        server_id=db_server.server_id,
        channel_name="general",
        channel_type="TEXT",
        members=[current_user.user_id],
        category_id=None,
        position=0,
        view_roles=list(ALL_ROLES),
        send_roles=list(ALL_ROLES),
    )
    db.add(db_channel)
    db_server.channels = 1
    db.commit()
    
    return server_to_response(db_server, current_user.user_id)

@app.put("/servers/{server_id}", response_model=models.ServerResponse)
def update_server(server_id: int, update_data: models.ServerUpdate, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
        
    if server.owner_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Only the server owner can edit these settings")
        
    if update_data.server_name is not None:
        server.server_name = update_data.server_name
    if update_data.server_description is not None:
        server.server_description = update_data.server_description
    if update_data.server_image is not None:
        if update_data.server_image and not update_data.server_image.startswith(("http://", "https://", "/uploads/")):
            raise HTTPException(status_code=400, detail="Invalid server image URL.")
        if server.server_image and server.server_image != update_data.server_image:
            storage.delete_file(server.server_image)
        server.server_image = update_data.server_image
    if getattr(update_data, "server_banner", None) is not None:
        if update_data.server_banner and not update_data.server_banner.startswith(("http://", "https://", "/uploads/")):
            raise HTTPException(status_code=400, detail="Invalid server banner URL.")
        if server.server_banner and server.server_banner != update_data.server_banner:
            storage.delete_file(server.server_banner)
        server.server_banner = update_data.server_banner
        
    db.commit()
    db.refresh(server)
    return server

@app.delete("/servers/{server_id}")
def delete_server(server_id: int, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
        
    if server.invite_code == "GLOBAL":
        raise HTTPException(status_code=400, detail="The General server cannot be deleted")
        
    if current_user.user_id not in server.members:
        raise HTTPException(status_code=400, detail="You are not a member of this server")
        
    if server.owner_id == current_user.user_id:
        # Owner deletes the server: delete completely from database
        channels = db.query(db_models.DBChannel).filter(db_models.DBChannel.server_id == server_id).all()
        channel_ids = [c.channel_id for c in channels]
        db.query(db_models.DBMessage).filter(db_models.DBMessage.channel_id.in_(channel_ids)).delete(synchronize_session=False)
        db.query(db_models.DBChannel).filter(db_models.DBChannel.server_id == server_id).delete(synchronize_session=False)
        db.delete(server)
    else:
        # Non-owner "deletes" (leaves) the server: remove membership
        updated_server_members = list(server.members)
        updated_server_members.remove(current_user.user_id)
        server.members = updated_server_members
        
        # Remove user from channel members
        channels = db.query(db_models.DBChannel).filter(db_models.DBChannel.server_id == server_id).all()
        for channel in channels:
            if current_user.user_id in channel.members:
                updated_channel_members = list(channel.members)
                updated_channel_members.remove(current_user.user_id)
                channel.members = updated_channel_members
            
    db.commit()
    return {"status": "success", "detail": "Server deleted" if server.owner_id == current_user.user_id else "Server removed"}

@app.post("/servers/{server_id}/leave")
def leave_server(server_id: int, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
        
    if server.invite_code == "GLOBAL":
        raise HTTPException(status_code=400, detail="You cannot leave the General server")
        
    if current_user.user_id not in server.members:
        raise HTTPException(status_code=400, detail="You are not a member of this server")
        
    if server.owner_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="The server owner cannot leave. Delete the server instead.")
        
    updated_server_members = list(server.members)
    updated_server_members.remove(current_user.user_id)
    server.members = updated_server_members
    
    channels = db.query(db_models.DBChannel).filter(db_models.DBChannel.server_id == server_id).all()
    for channel in channels:
        if current_user.user_id in channel.members:
            updated_channel_members = list(channel.members)
            updated_channel_members.remove(current_user.user_id)
            channel.members = updated_channel_members
            
    db.commit()
    return {"status": "success", "detail": "Left server"}

@app.get("/servers/{server_id}/members", response_model=list[models.ServerMemberResponse])
def get_server_members(server_id: int, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    if current_user.user_id not in server.members:
        raise HTTPException(status_code=403, detail="Access Denied")
    
    users = db.query(db_models.DBUser).filter(db_models.DBUser.user_id.in_(server.members)).all()
    result = []
    for u in users:
        data = models.UserResponse.from_orm(u).dict()
        data["server_role"] = get_member_role(server, u.user_id)
        result.append(data)
    return result

@app.put("/servers/{server_id}/members/{user_id}/role", response_model=models.ServerMemberResponse)
def set_server_member_role(server_id: int, user_id: int, body: models.MemberRoleUpdate, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    if server.owner_id != current_user.user_id and get_member_role(server, current_user.user_id) != "admin":
        raise HTTPException(status_code=403, detail="Only admins can change roles")
    if user_id not in (server.members or []):
        raise HTTPException(status_code=404, detail="User is not a member")
    if user_id == server.owner_id:
        raise HTTPException(status_code=400, detail="Cannot change the owner's role")
    role = (body.role or "default").lower()
    if role not in ALL_ROLES:
        raise HTTPException(status_code=400, detail="Role must be default, mod, or admin")
    set_member_role(server, user_id, role)
    channels = db.query(db_models.DBChannel).filter(db_models.DBChannel.server_id == server_id).all()
    for ch in channels:
        sync_channel_members_from_roles(ch, server)
    db.commit()
    user = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == user_id).first()
    data = models.UserResponse.from_orm(user).dict()
    data["server_role"] = role
    return data

@app.post("/servers/{server_id}/members/{user_id}/kick")
def kick_server_member(server_id: int, user_id: int, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    if server.invite_code == "GLOBAL":
        raise HTTPException(status_code=400, detail="Cannot kick from the General server")
    if not can_kick_members(server, current_user.user_id):
        raise HTTPException(status_code=403, detail="Mods and admins can remove members")
    if user_id not in (server.members or []):
        raise HTTPException(status_code=404, detail="User is not a member")
    if user_id == server.owner_id:
        raise HTTPException(status_code=400, detail="Cannot kick the server owner")
    if user_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="Use leave server instead")
    actor_rank = {"default": 0, "mod": 1, "admin": 2}[get_member_role(server, current_user.user_id)]
    target_rank = {"default": 0, "mod": 1, "admin": 2}[get_member_role(server, user_id)]
    if server.owner_id != current_user.user_id and target_rank >= actor_rank:
        raise HTTPException(status_code=403, detail="Cannot kick someone with equal or higher role")
    members = list(server.members)
    members.remove(user_id)
    server.members = members
    roles = dict(server.member_roles or {})
    roles.pop(str(user_id), None)
    server.member_roles = roles
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(server, "members")
    flag_modified(server, "member_roles")
    channels = db.query(db_models.DBChannel).filter(db_models.DBChannel.server_id == server_id).all()
    for ch in channels:
        if user_id in (ch.members or []):
            cm = list(ch.members)
            cm.remove(user_id)
            ch.members = cm
            flag_modified(ch, "members")
    db.commit()
    return {"status": "success", "detail": "Member removed"}

@app.get("/servers/{server_id}/presence", response_model=list[int])
def get_server_presence(server_id: int, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    if current_user.user_id not in server.members:
        raise HTTPException(status_code=403, detail="Access Denied")
        
    online_user_ids = []
    for uid in server.members:
        if len(manager.user_sockets.get(uid, [])) > 0 or is_system_user(uid, db):
            online_user_ids.append(uid)
            
    return online_user_ids

@app.get("/servers/invite/{invite_code}/preview", response_model=models.InvitePreview)
def get_invite_preview(invite_code: str, db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.invite_code == invite_code).first()
    if not server:
        raise HTTPException(status_code=404, detail="Invalid invite code")
        
    online_count = sum(1 for uid in server.members if len(manager.user_sockets.get(uid, [])) > 0 or is_system_user(uid, db))
    
    return {
        "server_name": server.server_name,
        "server_description": server.server_description,
        "server_image": server.server_image,
        "total_members": len(server.members),
        "online_members": online_count
    }

@app.post("/servers/join-by-invite/{invite_code}")
def join_by_invite(invite_code: str, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.invite_code == invite_code).first()
    if not server:
        raise HTTPException(status_code=404, detail="Invalid invite code")
        
    if current_user.user_id not in server.members:
        updated_server_members = list(server.members)
        updated_server_members.append(current_user.user_id)
        server.members = updated_server_members
        set_member_role(server, current_user.user_id, "default")
        
        channels = db.query(db_models.DBChannel).filter(db_models.DBChannel.server_id == server.server_id).all()
        for channel in channels:
            if can_view_channel(channel, server, current_user.user_id):
                updated_channel_members = list(channel.members or [])
                if current_user.user_id not in updated_channel_members:
                    updated_channel_members.append(current_user.user_id)
                    channel.members = updated_channel_members
        
        db.commit()
    return {"status": "success", "detail": f"Joined server"}

@app.get("/servers/{server_id}/categories", response_model=list[models.CategoryResponse])
def get_server_categories(server_id: int, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    if current_user.user_id not in (server.members or []):
        raise HTTPException(status_code=403, detail="Access Denied")
    cats = db.query(db_models.DBChannelCategory).filter(db_models.DBChannelCategory.server_id == server_id).order_by(db_models.DBChannelCategory.position.asc(), db_models.DBChannelCategory.category_id.asc()).all()
    return cats

@app.post("/servers/{server_id}/categories", response_model=models.CategoryResponse, status_code=201)
def create_category(server_id: int, body: models.CategoryCreate, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    if not can_manage_channels(server, current_user.user_id):
        raise HTTPException(status_code=403, detail="Only admins can create categories")
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    max_pos = db.query(func.max(db_models.DBChannelCategory.position)).filter(db_models.DBChannelCategory.server_id == server_id).scalar()
    cat = db_models.DBChannelCategory(server_id=server_id, name=name, position=(max_pos or 0) + 1)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat

@app.patch("/categories/{category_id}", response_model=models.CategoryResponse)
def update_category(category_id: int, body: models.CategoryUpdate, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    cat = db.query(db_models.DBChannelCategory).filter(db_models.DBChannelCategory.category_id == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == cat.server_id).first()
    if not server or not can_manage_channels(server, current_user.user_id):
        raise HTTPException(status_code=403, detail="Only admins can edit categories")
    if body.name is not None:
        cat.name = body.name.strip() or cat.name
    if body.position is not None:
        cat.position = body.position
    db.commit()
    db.refresh(cat)
    return cat

@app.delete("/categories/{category_id}")
def delete_category(category_id: int, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    cat = db.query(db_models.DBChannelCategory).filter(db_models.DBChannelCategory.category_id == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == cat.server_id).first()
    if not server or not can_manage_channels(server, current_user.user_id):
        raise HTTPException(status_code=403, detail="Only admins can delete categories")
    channels = db.query(db_models.DBChannel).filter(db_models.DBChannel.category_id == category_id).all()
    for ch in channels:
        ch.category_id = None
    db.delete(cat)
    db.commit()
    return {"status": "success"}

@app.get("/servers/{server_id}/channels", response_model=list[models.ChannelResponse])
def get_server_channels(server_id: int, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    if current_user.user_id not in server.members:
        raise HTTPException(status_code=403, detail="Access Denied")
    channels = db.query(db_models.DBChannel).filter(db_models.DBChannel.server_id == server_id).order_by(db_models.DBChannel.position.asc(), db_models.DBChannel.channel_id.asc()).all()
    return [channel_to_response(c, server, current_user.user_id) for c in channels if can_view_channel(c, server, current_user.user_id)]

@app.post("/channels", response_model=models.ChannelResponse, status_code=201)
def create_channel(channel_data: models.ChannelCreate, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == channel_data.server_id).first()
    if not server or not can_manage_channels(server, current_user.user_id):
        raise HTTPException(status_code=403, detail="Only admins can create channels")

    view_roles = channel_data.view_roles if channel_data.view_roles is not None else list(ALL_ROLES)
    send_roles = channel_data.send_roles if channel_data.send_roles is not None else list(ALL_ROLES)
    view_roles = [r for r in view_roles if r in ALL_ROLES] or list(ALL_ROLES)
    send_roles = [r for r in send_roles if r in ALL_ROLES] or list(ALL_ROLES)

    if channel_data.category_id is not None:
        cat = db.query(db_models.DBChannelCategory).filter(
            db_models.DBChannelCategory.category_id == channel_data.category_id,
            db_models.DBChannelCategory.server_id == server.server_id
        ).first()
        if not cat:
            raise HTTPException(status_code=400, detail="Invalid category")

    max_pos = db.query(func.max(db_models.DBChannel.position)).filter(db_models.DBChannel.server_id == server.server_id).scalar()
    db_channel = db_models.DBChannel(
        server_id=channel_data.server_id,
        channel_name=channel_data.channel_name.strip(),
        channel_type=channel_data.channel_type or "TEXT",
        members=[],
        category_id=channel_data.category_id,
        position=(max_pos or 0) + 1,
        view_roles=view_roles,
        send_roles=send_roles,
    )
    db.add(db_channel)
    db.flush()
    sync_channel_members_from_roles(db_channel, server)
    server.channels = (server.channels or 0) + 1
    db.commit()
    db.refresh(db_channel)
    return channel_to_response(db_channel, server, current_user.user_id)

@app.patch("/channels/{channel_id}", response_model=models.ChannelResponse)
def update_channel(channel_id: int, body: models.ChannelUpdate, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    channel = db.query(db_models.DBChannel).filter(db_models.DBChannel.channel_id == channel_id).first()
    if not channel or channel.server_id is None:
        raise HTTPException(status_code=404, detail="Channel not found")
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == channel.server_id).first()
    if not server or not can_manage_channels(server, current_user.user_id):
        raise HTTPException(status_code=403, detail="Only admins can edit channels")
    if body.channel_name is not None:
        channel.channel_name = body.channel_name.strip() or channel.channel_name
    if body.category_id is not None:
        if body.category_id == 0:
            channel.category_id = None
        else:
            cat = db.query(db_models.DBChannelCategory).filter(
                db_models.DBChannelCategory.category_id == body.category_id,
                db_models.DBChannelCategory.server_id == server.server_id
            ).first()
            if not cat:
                raise HTTPException(status_code=400, detail="Invalid category")
            channel.category_id = body.category_id
    if body.position is not None:
        channel.position = body.position
    if body.view_roles is not None:
        channel.view_roles = [r for r in body.view_roles if r in ALL_ROLES] or list(ALL_ROLES)
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(channel, "view_roles")
    if body.send_roles is not None:
        channel.send_roles = [r for r in body.send_roles if r in ALL_ROLES] or list(ALL_ROLES)
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(channel, "send_roles")
    sync_channel_members_from_roles(channel, server)
    db.commit()
    db.refresh(channel)
    return channel_to_response(channel, server, current_user.user_id)

@app.delete("/channels/{channel_id}")
def delete_channel(channel_id: int, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    channel = db.query(db_models.DBChannel).filter(db_models.DBChannel.channel_id == channel_id).first()
    if not channel or channel.server_id is None:
        raise HTTPException(status_code=404, detail="Channel not found")
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == channel.server_id).first()
    if not server or not can_manage_channels(server, current_user.user_id):
        raise HTTPException(status_code=403, detail="Only admins can delete channels")
    count = db.query(db_models.DBChannel).filter(db_models.DBChannel.server_id == server.server_id).count()
    if count <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last channel")
    db.query(db_models.DBMessage).filter(db_models.DBMessage.channel_id == channel_id).delete(synchronize_session=False)
    db.delete(channel)
    server.channels = max(0, (server.channels or 1) - 1)
    db.commit()
    return {"status": "success"}

@app.get("/channels/{channel_id}/messages", response_model=list[models.Message])
def get_channel_history(channel_id: int, limit: int = 50, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    channel = db.query(db_models.DBChannel).filter(db_models.DBChannel.channel_id == channel_id).first()
    server = None
    if channel and channel.server_id is not None:
        server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == channel.server_id).first()
    if not channel or not can_view_channel(channel, server, current_user.user_id):
        raise HTTPException(status_code=403, detail="Access Denied")
        
    messages = db.query(db_models.DBMessage).filter(db_models.DBMessage.channel_id == channel_id).order_by(db_models.DBMessage.created_at.desc()).limit(limit).all()
    
    author_ids = {m.author_id for m in messages}
    
    # Fetch parent messages
    parent_ids = {m.parent_id for m in messages if getattr(m, "parent_id", 0) != 0}
    parent_messages = []
    if parent_ids:
        parent_messages = db.query(db_models.DBMessage).filter(db_models.DBMessage.message_id.in_(parent_ids)).all()
        author_ids.update({m.author_id for m in parent_messages})
        
    users = db.query(db_models.DBUser).filter(db_models.DBUser.user_id.in_(author_ids)).all()
    user_map = {u.user_id: u for u in users}
    
    parent_map = {}
    for p_msg in parent_messages:
        p_dict = models.Message.from_orm(p_msg).dict()
        if "DELETED" in (p_dict.get("flags") or []):
            p_dict["content"] = {"text": "", "attachments": [], "embeds": []}
        if p_msg.author_id in user_map:
            p_dict["author"] = models.UserResponse.from_orm(user_map[p_msg.author_id]).dict()
        parent_map[p_msg.message_id] = p_dict
    
    results = []
    for msg in reversed(messages):
        msg_dict = models.Message.from_orm(msg).dict()
        if "DELETED" in (msg_dict.get("flags") or []):
            msg_dict["content"] = {"text": "", "attachments": [], "embeds": []}
        if msg.author_id in user_map:
            msg_dict["author"] = models.UserResponse.from_orm(user_map[msg.author_id]).dict()
        if getattr(msg, "parent_id", 0) != 0 and msg.parent_id in parent_map:
            msg_dict["parent_message"] = parent_map[msg.parent_id]
        results.append(msg_dict)
        
    return results

@app.get("/messages/{message_id}", response_model=models.Message)
def get_single_message(message_id: int, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    msg = db.query(db_models.DBMessage).filter(db_models.DBMessage.message_id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
        
    channel = db.query(db_models.DBChannel).filter(db_models.DBChannel.channel_id == msg.channel_id).first()
    if not channel or current_user.user_id not in channel.members:
        raise HTTPException(status_code=403, detail="Access Denied")
        
    if "DELETED" in (msg.flags or []):
        is_admin = "SYSTEM_ADMIN" in (current_user.permissions or []) or "SYSTEM_MOD" in (current_user.permissions or [])
        is_owner = False
        if channel.server_id:
            server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == channel.server_id).first()
            if server and server.owner_id == current_user.user_id:
                is_owner = True
        if not (is_admin or is_owner or current_user.user_id == msg.author_id):
            raise HTTPException(status_code=403, detail="Not authorized to view deleted message content")

    msg_dict = models.Message.from_orm(msg).dict()
    author_user = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == msg.author_id).first()
    if author_user:
        msg_dict["author"] = models.UserResponse.from_orm(author_user).dict()
        
    if getattr(msg, "parent_id", 0) != 0:
        parent_msg = db.query(db_models.DBMessage).filter(db_models.DBMessage.message_id == msg.parent_id).first()
        if parent_msg:
            p_dict = models.Message.from_orm(parent_msg).dict()
            if "DELETED" in (p_dict.get("flags") or []):
                p_dict["content"] = {"text": "", "attachments": [], "embeds": []}
            p_author = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == parent_msg.author_id).first()
            if p_author:
                p_dict["author"] = models.UserResponse.from_orm(p_author).dict()
            msg_dict["parent_message"] = p_dict

    return msg_dict

@app.get("/dms", response_model=list[models.ChannelResponse])
def get_dms(current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    dms = db.query(db_models.DBChannel).filter(
        db_models.DBChannel.server_id.is_(None),
        db_models.DBChannel.channel_type == "dm"
    ).all()
    user_dms = [dm for dm in dms if current_user.user_id in dm.members]
    
    # Attach target user info
    for dm in user_dms:
        target_id = dm.members[0] if dm.members[0] != current_user.user_id else dm.members[1]
        target_user = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == target_id).first()
        dm.target_user = target_user
        
    return user_dms

@app.post("/dms", response_model=models.ChannelResponse, status_code=201)
def create_dm(dm_data: models.DMCreate, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    target_user = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == dm_data.target_user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="Target user not found")
        
    if target_user.user_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="Cannot DM yourself")

    dms = db.query(db_models.DBChannel).filter(
        db_models.DBChannel.server_id.is_(None),
        db_models.DBChannel.channel_type == "dm"
    ).all()
    
    for dm in dms:
        if current_user.user_id in dm.members and target_user.user_id in dm.members:
            dm.target_user = target_user
            return dm

    db_channel = db_models.DBChannel(
        server_id=None,
        channel_name=f"DM_{current_user.user_id}_{target_user.user_id}",
        channel_type="dm",
        members=[current_user.user_id, target_user.user_id]
    )
    db.add(db_channel)
    db.commit()
    db.refresh(db_channel)
    db_channel.target_user = target_user
    return db_channel

@app.get("/admin/users/{user_id}/servers", response_model=list[models.ServerResponse])
def get_user_servers_admin(user_id: int, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if "SYSTEM_ADMIN" not in (current_user.permissions or []) and "SYSTEM_MOD" not in (current_user.permissions or []):
        raise HTTPException(status_code=403, detail="Not authorized")
    target_user = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    servers = db.query(db_models.DBServer).all()
    return [server_to_response(s, user_id) for s in servers if user_id in (s.members or [])]

@app.post("/admin/ban/{user_id}")
async def ban_user(user_id: int, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if "SYSTEM_ADMIN" not in (current_user.permissions or []):
        raise HTTPException(status_code=403, detail="Not authorized")
    target = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == user_id).first()
    if not target: raise HTTPException(status_code=404, detail="User not found")
    target.status = "BANNED"
    db.commit()
    await manager.send_personal_notification(user_id, {"type": "ban_update", "status": "BANNED"})
    if user_id in manager.user_sockets:
        for ws in list(manager.user_sockets[user_id]):
            try: await ws.close(code=1008)
            except: pass
    return {"detail": "User banned"}

@app.post("/admin/unban/{user_id}")
async def unban_user(user_id: int, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if "SYSTEM_ADMIN" not in (current_user.permissions or []):
        raise HTTPException(status_code=403, detail="Not authorized")
    target = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == user_id).first()
    if not target: raise HTTPException(status_code=404, detail="User not found")
    target.status = "OFFLINE"
    db.commit()
    await manager.send_personal_notification(user_id, {"type": "ban_update", "status": "OFFLINE"})
    return {"detail": "User unbanned"}

@app.post("/admin/mute/{user_id}")
async def mute_user(user_id: int, req: models.MuteRequest, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    perms = current_user.permissions or []
    if "SYSTEM_ADMIN" not in perms and "SYSTEM_MOD" not in perms:
        raise HTTPException(status_code=403, detail="Not authorized")
    target = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == user_id).first()
    if not target: raise HTTPException(status_code=404, detail="User not found")
    if req.duration_seconds == 0:
        target.muted_until = 2147483647
    else:
        target.muted_until = int(time.time()) + req.duration_seconds
    db.commit()
    await manager.send_personal_notification(user_id, {"type": "mute_update", "muted_until": target.muted_until})
    return {"detail": "User muted"}

@app.post("/admin/unmute/{user_id}")
async def unmute_user(user_id: int, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    perms = current_user.permissions or []
    if "SYSTEM_ADMIN" not in perms and "SYSTEM_MOD" not in perms:
        raise HTTPException(status_code=403, detail="Not authorized")
    target = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == user_id).first()
    if not target: raise HTTPException(status_code=404, detail="User not found")
    target.muted_until = None
    db.commit()
    await manager.send_personal_notification(user_id, {"type": "mute_update", "muted_until": None})
    return {"detail": "User unmuted"}

@app.post("/admin/promote/{user_id}")
def promote_user(user_id: int, req: models.PromoteRequest, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if "SYSTEM_ADMIN" not in (current_user.permissions or []):
        raise HTTPException(status_code=403, detail="Not authorized")
    if req.role not in ["SYSTEM_ADMIN", "SYSTEM_MOD"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    target = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == user_id).first()
    if not target: raise HTTPException(status_code=404, detail="User not found")
    perms = list(target.permissions or [])
    if req.role not in perms:
        perms.append(req.role)
        target.permissions = perms
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(target, "permissions")
    db.commit()
    return {"detail": f"User promoted to {req.role}"}

@app.post("/admin/demote/{user_id}")
def demote_user(user_id: int, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if "SYSTEM_ADMIN" not in (current_user.permissions or []):
        raise HTTPException(status_code=403, detail="Not authorized")
    target = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == user_id).first()
    if not target: raise HTTPException(status_code=404, detail="User not found")
    perms = list(target.permissions or [])
    if "SYSTEM_ADMIN" in perms: perms.remove("SYSTEM_ADMIN")
    if "SYSTEM_MOD" in perms: perms.remove("SYSTEM_MOD")
    target.permissions = perms
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(target, "permissions")
    db.commit()
    return {"detail": "User demoted"}

@app.get("/sandbox")
def get_sandbox():
    return FileResponse("index.html")

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_FRONTEND_DIST = os.path.join(_BASE_DIR, "frontend", "dist")
_FRONTEND_ASSETS = os.path.join(_FRONTEND_DIST, "assets")
_UPLOADS_DIR = os.path.join(_BASE_DIR, "uploads")
_FRONTEND_INDEX = os.path.join(_FRONTEND_DIST, "index.html")

@app.exception_handler(StarletteHTTPException)
async def custom_http_exception_handler(request, exc):
    if exc.status_code == 404:
        path = request.url.path
        if path.startswith("/assets/") or path.startswith("/uploads/") or path.startswith("/api/"):
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
        if "." in path.rsplit("/", 1)[-1]:
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
        api_prefixes = ["/login", "/register", "/users", "/servers", "/channels", "/ws", "/admin", "/dms", "/messages"]
        if not any(path.startswith(prefix) for prefix in api_prefixes):
            if os.path.exists(_FRONTEND_INDEX):
                return FileResponse(_FRONTEND_INDEX)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...), upload_type: str = Form("attachments"), current_user: db_models.DBUser = Depends(get_current_user)):
    file_bytes = await file.read()
    if len(file_bytes) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File exceeds 10MB limit")

    import uuid, re
    original_name = getattr(file, "filename", "attachment")
    if not original_name:
        original_name = "attachment"
    safe_name = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', original_name)
    unique_filename = f"{uuid.uuid4().hex}_{safe_name}"
    
    url = storage.upload_file_bytes(file_bytes, unique_filename, file.content_type, folder=upload_type)
    return {"url": url}

if os.path.exists(_UPLOADS_DIR):
    app.mount("/uploads", StaticFiles(directory=_UPLOADS_DIR), name="uploads")

if os.path.isdir(_FRONTEND_ASSETS):
    app.mount("/assets", StaticFiles(directory=_FRONTEND_ASSETS), name="frontend-assets")

if os.path.isdir(_FRONTEND_DIST):
    @app.get("/")
    def serve_spa_index():
        return FileResponse(_FRONTEND_INDEX)

    @app.get("/favicon.svg")
    def serve_favicon():
        path = os.path.join(_FRONTEND_DIST, "favicon.svg")
        if os.path.exists(path):
            return FileResponse(path)
        raise HTTPException(status_code=404)

    @app.get("/icons.svg")
    def serve_icons():
        path = os.path.join(_FRONTEND_DIST, "icons.svg")
        if os.path.exists(path):
            return FileResponse(path)
        raise HTTPException(status_code=404)