# Frontend

# Backend
## Requests
### User Profile & Registration
* `POST /register`
* Returns: UserResponse model
* Status Codes: 201 Created, 400 Bad Request

* `GET /users/{user_id}`
* Returns: UserResponse model
* Status Codes: 200 OK, 404 Not Found

### Servers & Structural Layouts
* `POST /servers`
* Returns: ServerResponse model
* Status Codes: 201 Created, 422 Unprocessable Entity

* `GET /servers/{server_id}/channels`
* Returns: List of ChannelResponse models
* Status Codes: 200 OK, 403 Forbidden, 404 Not Found

### Channels & Chat Control
* `POST /channels`
* Returns: ChannelResponse model
* Status Codes: 201 Created, 403 Forbidden, 404 Not Found

* `GET /channels/{channel_id}/messages`
* Returns: List of Message models
* Status Codes: 200 OK, 403 Forbidden, 404 Not Found

## Websockets
### ConnectionManager
`main.py/ConnectionManager`  
Python `dict` of `dict[channel_id int: list[WebSockets]]`  
On connect, added to list, if list doesn't exist, makes list, and on disconnect, removes from list, if list empty, list gets deleted.  

## Datatypes
### Users
```json
{
    "user_id": "number",
    "username": "string",
    "permissions": ["string"],
    "status": "string",
    "description": "string",
    "profile_picture": "number"
}
```

### Servers
```json
{
    "server_id": "number",
    "server_name": "string",
    "server_description": "string",
    "server_image": "string",
    "members": ["number"],
    "folders": ["number"],
    "channels": ["number"]
}
```

### Channels
```json
{
  "channel_id": "number",
  "server_id": "number",
  "channel_name": "string",
  "channel_type": "string",
  "members": ["number"]
}
```

### Messages
```json
{
  "message_id": "number",
  "channel_id": "number",
  "author_id": "number",
  "content": {
    "text": "string",
    "attachments": [
      "string"
    ],
    "embeds": [
      {
        "title": "string",
        "text": "string"
      }
    ]
  },
  "created_at": "number",
  "modified_at": "number",
  "message_type": "string",
  "parent_id": "number",
  "thread_id": "number",
  "mentions": [
    "number"
  ],
  "flags": [
    "string"
  ],
  "reactions": [
    {
      "emoji": "string",
      "count": "number",
      "user_ids": [
        "number"
      ]
    }
  ]
}
```