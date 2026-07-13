import time
import random
import string
import jwt
import re
from typing import Optional
from fastapi import FastAPI, WebSocket, Depends, WebSocketDisconnect, HTTPException, status, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from sqlalchemy.orm import Session
import models
import db_models
from database import get_db, engine
import bcrypt
import os
import storage

db_models.Base.metadata.create_all(bind=engine)

app = FastAPI()

@app.on_event("startup")
def startup_event():
    db = next(get_db())
    try:
        system_user = db.query(db_models.DBUser).filter(db_models.DBUser.username == "System").first()
        if not system_user:
            system_user = db_models.DBUser(
                username="System",
                hashed_password="N/A",
                permissions=["ADMIN"],
                status="ONLINE",
                description="Cordis System",
                profile_picture=""
            )
            db.add(system_user)
            db.commit()
            db.refresh(system_user)
            
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
                members=[system_user.user_id]
            )
            db.add(general_channel)
            global_server.channels = 1
            db.commit()
        else:
            if global_server.server_name == "Global Hub":
                global_server.server_name = "General"
                db.commit()
    finally:
        db.close()

def ensure_user_in_global_hub(user_id: int, db: Session):
    global_server = db.query(db_models.DBServer).filter(db_models.DBServer.invite_code == "GLOBAL").first()
    if global_server:
        members = list(global_server.members) if global_server.members else []
        if user_id not in members:
            members.append(user_id)
            global_server.members = members
            
            channels = db.query(db_models.DBChannel).filter(db_models.DBChannel.server_id == global_server.server_id).all()
            for channel in channels:
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

@app.websocket("/ws/{channel_id}")
async def websocket_endpoint(websocket: WebSocket, channel_id: int, token: str = Query(...), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        user = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == int(user_id)).first()
        if not user:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid User")
            return
    except jwt.PyJWTError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid Token")
        return

    channel = db.query(db_models.DBChannel).filter(db_models.DBChannel.channel_id == channel_id).first()
    
    if not channel or user.user_id not in channel.members:
        await websocket.accept()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Access Denied: Not a member.")
        return

    await manager.connect(websocket, channel_id, user.user_id, db)
    
    try:
        while True:
            raw_data = await websocket.receive_json()
            
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
                    read_state.last_read_message_id = max(read_state.last_read_message_id, message_id)
                db.commit()
                continue

            validated_msg = models.MessageSend(**raw_data)
            
            # parse mentions
            if validated_msg.content and validated_msg.content.text:
                mentioned_usernames = re.findall(r'@([a-zA-Z0-9_]+)', validated_msg.content.text)
                if mentioned_usernames:
                    mentioned_users = db.query(db_models.DBUser).filter(db_models.DBUser.username.in_(mentioned_usernames)).all()
                    current_mentions = set(validated_msg.mentions)
                    current_mentions.update(u.user_id for u in mentioned_users)
                    validated_msg.mentions = list(current_mentions)

            msg_id = random.randint(1000000, 9999999) # server generated ID (i hope this is fine)
            timestamp = int(time.time())
            
            db_msg = db_models.DBMessage(
                message_id=msg_id,
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
            await manager.broadcast(channel_id, broadcast_msg)
            
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
    existing_user = db.query(db_models.DBUser).filter(db_models.DBUser.username == account_data.username).first()
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username taken.")
    
    password_bytes = account_data.password.encode('utf-8')
    salt = bcrypt.gensalt()
    secured_hash = bcrypt.hashpw(password_bytes, salt).decode('utf-8')
    
    db_user = db_models.DBUser(
        username=account_data.username,
        hashed_password=secured_hash,
        permissions=["USER_BASIC"],
        status="ONLINE",
        description="ryan @ko6lvm is superior in all forms ever possible", # yes ryan was here and i am superior
        profile_picture=""
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    ensure_user_in_global_hub(db_user.user_id, db)
    return db_user

@app.post("/login", response_model=models.Token)
def login(account_data: models.UserLogin, db: Session = Depends(get_db)):
    user = db.query(db_models.DBUser).filter(db_models.DBUser.username == account_data.username).first()
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
        existing = db.query(db_models.DBUser).filter(db_models.DBUser.username == update_data.username).first()
        if existing:
            raise HTTPException(status_code=400, detail="Username already taken.")
        current_user.username = update_data.username
    
    if update_data.description is not None:
        current_user.description = update_data.description
    
    if update_data.profile_picture is not None:
        current_user.profile_picture = storage.upload_base64_image(update_data.profile_picture, "avatar") or ""
        
    if update_data.banner is not None:
        current_user.banner = storage.upload_base64_image(update_data.banner, "user_banner") or ""
        
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
        
        latest_msg = db.query(db_models.DBMessage).filter(db_models.DBMessage.channel_id == cid).order_by(db_models.DBMessage.message_id.desc()).first()
        last_msg_id = latest_msg.message_id if latest_msg else 0
        
        new_msgs = db.query(db_models.DBMessage).filter(
            db_models.DBMessage.channel_id == cid,
            db_models.DBMessage.message_id > last_read_id
        ).all()
        
        mentions_count = sum(1 for m in new_msgs if m.mentions and current_user.user_id in m.mentions)
        
        channel_obj = next((c for c in all_channels if c.channel_id == cid), None)
        server_id = channel_obj.server_id if channel_obj else None
        
        results[cid] = models.UnreadState(
            server_id=server_id,
            last_read_message_id=last_read_id,
            last_message_id=last_msg_id,
            mentions_count=mentions_count
        )
        
    return results

@app.get("/users/{user_id}", response_model=models.UserResponse)
def get_user_profile(user_id: int, db: Session = Depends(get_db)):
    user = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.get("/servers/discover", response_model=list[models.ServerResponse])
def discover_servers(db: Session = Depends(get_db)):
    servers = db.query(db_models.DBServer).filter(db_models.DBServer.is_public == True).all()
    return servers

@app.get("/servers/me", response_model=list[models.ServerResponse])
def get_my_servers(current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    servers = db.query(db_models.DBServer).all()
    return [s for s in servers if current_user.user_id in s.members]

@app.post("/servers", response_model=models.ServerResponse, status_code=201)
def create_server(server_data: models.ServerCreate, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    invite = generate_invite_code()
    db_server = db_models.DBServer(
        server_name=server_data.server_name,
        server_description=server_data.server_description,
        server_image=storage.upload_base64_image(server_data.server_image, "server_icon") if server_data.server_image else "",
        server_banner=storage.upload_base64_image(getattr(server_data, "server_banner", ""), "server_banner") if getattr(server_data, "server_banner", None) else "",
        members=[current_user.user_id],
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
        members=[current_user.user_id]
    )
    db.add(db_channel)
    db.commit()
    
    return db_server

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
        server.server_image = storage.upload_base64_image(update_data.server_image, "server_icon") or ""
    if getattr(update_data, "server_banner", None) is not None:
        server.server_banner = storage.upload_base64_image(update_data.server_banner, "server_banner") or ""
        
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

@app.get("/servers/{server_id}/members", response_model=list[models.UserResponse])
def get_server_members(server_id: int, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    if current_user.user_id not in server.members:
        raise HTTPException(status_code=403, detail="Access Denied")
    
    users = db.query(db_models.DBUser).filter(db_models.DBUser.user_id.in_(server.members)).all()
    return users

@app.get("/servers/{server_id}/presence", response_model=list[int])
def get_server_presence(server_id: int, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    if current_user.user_id not in server.members:
        raise HTTPException(status_code=403, detail="Access Denied")
        
    online_user_ids = []
    for uid in server.members:
        if len(manager.user_sockets.get(uid, [])) > 0:
            online_user_ids.append(uid)
            
    return online_user_ids

@app.get("/servers/invite/{invite_code}/preview", response_model=models.InvitePreview)
def get_invite_preview(invite_code: str, db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.invite_code == invite_code).first()
    if not server:
        raise HTTPException(status_code=404, detail="Invalid invite code")
        
    online_count = sum(1 for uid in server.members if len(manager.user_sockets.get(uid, [])) > 0)
    
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
        
        channels = db.query(db_models.DBChannel).filter(db_models.DBChannel.server_id == server.server_id).all()
        for channel in channels:
            updated_channel_members = list(channel.members)
            if current_user.user_id not in updated_channel_members:
                updated_channel_members.append(current_user.user_id)
                channel.members = updated_channel_members
        
        db.commit()
    return {"status": "success", "detail": f"Joined server"}

@app.get("/servers/{server_id}/channels", response_model=list[models.ChannelResponse])
def get_server_channels(server_id: int, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    if current_user.user_id not in server.members:
        raise HTTPException(status_code=403, detail="Access Denied")
    channels = db.query(db_models.DBChannel).filter(db_models.DBChannel.server_id == server_id).all()
    return channels

@app.post("/channels", response_model=models.ChannelResponse, status_code=201)
def create_channel(channel_data: models.ChannelCreate, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == channel_data.server_id).first()
    if not server or current_user.user_id not in server.members:
        raise HTTPException(status_code=403, detail="Access Denied")

    db_channel = db_models.DBChannel(
        server_id=channel_data.server_id,
        channel_name=channel_data.channel_name,
        channel_type=channel_data.channel_type,
        members=server.members
    )
    db.add(db_channel)
    db.commit()
    db.refresh(db_channel)
    return db_channel

@app.get("/channels/{channel_id}/messages", response_model=list[models.Message])
def get_channel_history(channel_id: int, limit: int = 50, current_user: db_models.DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    channel = db.query(db_models.DBChannel).filter(db_models.DBChannel.channel_id == channel_id).first()
    if not channel or current_user.user_id not in channel.members:
        raise HTTPException(status_code=403, detail="Access Denied")
        
    messages = db.query(db_models.DBMessage).filter(db_models.DBMessage.channel_id == channel_id).order_by(db_models.DBMessage.created_at.desc()).limit(limit).all()
    
    author_ids = {m.author_id for m in messages}
    users = db.query(db_models.DBUser).filter(db_models.DBUser.user_id.in_(author_ids)).all()
    user_map = {u.user_id: u for u in users}
    
    results = []
    for msg in reversed(messages):
        msg_dict = models.Message.from_orm(msg).dict()
        if msg.author_id in user_map:
            msg_dict["author"] = models.UserResponse.from_orm(user_map[msg.author_id]).dict()
        results.append(msg_dict)
        
    return results

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

@app.get("/sandbox")
def get_sandbox():
    return FileResponse("index.html")

@app.exception_handler(StarletteHTTPException)
async def custom_http_exception_handler(request, exc):
    if exc.status_code == 404:
        # Avoid intercepting API routes
        api_prefixes = ["/login", "/register", "/users", "/servers", "/channels", "/ws"]
        if not any(request.url.path.startswith(prefix) for prefix in api_prefixes):
            if os.path.exists("frontend/dist/index.html"):
                return FileResponse("frontend/dist/index.html")
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

if os.path.exists("frontend/dist"):
    pass # we will mount it later

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...), current_user: db_models.DBUser = Depends(get_current_user)):
    file_bytes = await file.read()
    url = storage.upload_file_bytes(file_bytes, file.filename, file.content_type)
    return {"url": url}

if os.path.exists("uploads"):
    app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
    
if os.path.exists("frontend/dist"):
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="frontend")