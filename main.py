from fastapi import FastAPI, WebSocket, Depends, WebSocketDisconnect, HTTPException, status
from sqlalchemy.orm import Session
from passlib.context import CryptContext
import models
import db_models
from database import get_db, engine

db_models.Base.metadata.create_all(bind=engine)

app = FastAPI()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[int, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, channel_id: int):
        await websocket.accept()
        if channel_id not in self.active_connections:
            self.active_connections[channel_id] = []
        self.active_connections[channel_id].append(websocket)
    
    def disconnect(self, websocket: WebSocket, channel_id: int):
        if channel_id in self.active_connections:
            self.active_connections[channel_id].remove(websocket)
            if not self.active_connections[channel_id]:
                del self.active_connections[channel_id]
    
    async def broadcast(self, channel_id: int, message_data: dict):
        if channel_id in self.active_connections:
            for connection in self.active_connections[channel_id]:
                await connection.send_json(message_data)

manager = ConnectionManager()

@app.websocket("/ws/{channel_id}")
async def websocket_endpoint(websocket: WebSocket, channel_id: int, user_id: int, db: Session = Depends(get_db)):
    channel = db.query(db_models.DBChannel).filter(db_models.DBChannel.channel_id == channel_id).first()
    
    if not channel or user_id not in channel.members:
        await websocket.accept()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Access Denied: Not a member.")
        return

    await manager.connect(websocket, channel_id)
    try:
        while True:
            raw_data = await websocket.receive_json()
            validated_msg = models.Message(**raw_data)
            db_msg = db_models.DBMessage(
                message_id=validated_msg.message_id,
                channel_id=validated_msg.channel_id,
                author_id=validated_msg.author_id,
                content=validated_msg.content.dict(),
                mentions=validated_msg.mentions,
                flags=validated_msg.flags,
                reactions=[r.dict() for r in validated_msg.reactions],
                created_at=validated_msg.created_at,
                modified_at=validated_msg.modified_at,
                message_type=validated_msg.message_type,
                parent_id=validated_msg.parent_id,
                thread_id=validated_msg.thread_id
            )
            db.add(db_msg)
            db.commit()
            await manager.broadcast(channel_id, raw_data)
    except WebSocketDisconnect:
        manager.disconnect(websocket, channel_id)

@app.get("/users/{user_id}", response_model=models.UserResponse)
def get_user_profile(user_id: int, db: Session = Depends(get_db)):
    user = db.query(db_models.DBUser).filter(db_models.DBUser.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.get("/servers/{server_id}/channels", response_model=list[models.ChannelResponse])
def get_server_channels(server_id: int, current_user_id: int, db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    if current_user_id not in server.members:
        raise HTTPException(
            status_code=403, 
            detail="Access Denied: You are not a member of this server."
        )
    channels = db.query(db_models.DBChannel).filter(db_models.DBChannel.server_id == server_id).all()
    return channels

@app.get("/channels/{channel_id}/messages", response_model=list[models.Message])
def get_channel_history(channel_id: int, current_user_id: int, limit: int = 50, db: Session = Depends(get_db)):
    channel = db.query(db_models.DBChannel).filter(db_models.DBChannel.channel_id == channel_id).first()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    if current_user_id not in channel.members:
        raise HTTPException(
            status_code=403, 
            detail="Access Denied: You are not a member of this channel."
        )
    messages = db.query(db_models.DBMessage).filter(db_models.DBMessage.channel_id == channel_id).order_by(db_models.DBMessage.created_at.desc()).limit(limit).all()
    return reversed(messages)

@app.post("/register", response_model=models.UserResponse, status_code=status.HTTP_201_CREATED)
def register_account(account_data: models.UserRegister, db: Session = Depends(get_db)):
    existing_user = db.query(db_models.DBUser).filter(db_models.DBUser.username == account_data.username).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="Username is already taken."
        )
    secured_hash = pwd_context.hash(account_data.password)
    db_user = db_models.DBUser(
        username=account_data.username,
        hashed_password=secured_hash,
        permissions=["USER_BASIC"],
        status="ONLINE",
        description="Hey there! I'm using the chat app.",
        profile_picture=""
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@app.post("/servers", response_model=models.ServerResponse, status_code=201)
def create_server(server_data: models.ServerCreate, current_user_id: int, db: Session = Depends(get_db)):
    db_server = db_models.DBServer(
        server_name=server_data.server_name,
        server_description=server_data.server_description,
        server_image=server_data.server_image,
        members=[current_user_id],
        folders=0,
        channels=0
    )
    db.add(db_server)
    db.commit()
    db.refresh(db_server)
    return db_server

@app.post("/channels", response_model=models.ChannelResponse, status_code=201)
def create_channel(channel_data: models.ChannelCreate, current_user_id: int, db: Session = Depends(get_db)):
    server = db.query(db_models.DBServer).filter(db_models.DBServer.server_id == channel_data.server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Target server not found")
        
    if current_user_id not in server.members:
        raise HTTPException(
            status_code=403, 
            detail="Access Denied: You cannot create channels in a server you do not belong to."
        )

    db_channel = db_models.DBChannel(
        server_id=channel_data.server_id,
        channel_name=channel_data.channel_name,
        channel_type=channel_data.channel_type,
        members=server.members  # Automatically clones the server's current roster into the channel
    )
    
    db.add(db_channel)
    db.commit()
    db.refresh(db_channel)
    return db_channel