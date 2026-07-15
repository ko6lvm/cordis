from sqlalchemy import Column, Integer, String, JSON, Boolean
from database import Base

class DBUser(Base):
    __tablename__ = "users"

    user_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    username = Column(String, unique=True, index=True)
    display_name = Column(String)
    hashed_password = Column(String)
    permissions = Column(JSON)
    status = Column(String)
    description = Column(String)
    profile_picture = Column(String)
    banner = Column(String)
    last_active_at = Column(Integer, nullable=True)
    muted_until = Column(Integer, nullable=True)

class DBServer(Base):
    __tablename__ = "servers"

    server_id = Column(Integer, primary_key=True, index=True)
    server_name = Column(String)
    server_description = Column(String)
    server_image = Column(String)
    server_banner = Column(String)
    members = Column(JSON)
    member_roles = Column(JSON)
    folders = Column(Integer)
    channels = Column(Integer)
    invite_code = Column(String, unique=True, index=True)
    is_public = Column(Boolean, default=False)
    owner_id = Column(Integer, index=True)

class DBChannelCategory(Base):
    __tablename__ = "channel_categories"

    category_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    server_id = Column(Integer, index=True)
    name = Column(String)
    position = Column(Integer, default=0)

class DBChannel(Base):
    __tablename__ = "channels"

    channel_id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer)
    channel_name = Column(String)
    channel_type = Column(String)
    members = Column(JSON)
    category_id = Column(Integer, nullable=True, index=True)
    position = Column(Integer, default=0)
    view_roles = Column(JSON)
    send_roles = Column(JSON)

class DBMessage(Base):
    __tablename__ = "messages"

    message_id = Column(Integer, primary_key=True, index=True)
    channel_id = Column(Integer, index=True)
    author_id = Column(Integer, index=True)
    
    content = Column(JSON)
    mentions = Column(JSON)
    flags = Column(JSON)
    reactions = Column(JSON)
    
    created_at = Column(Integer)
    modified_at = Column(Integer)
    message_type = Column(String)
    parent_id = Column(Integer)
    thread_id = Column(Integer)

class DBChannelReadState(Base):
    __tablename__ = "channel_read_states"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, index=True)
    channel_id = Column(Integer, index=True)
    last_read_message_id = Column(Integer, default=0)