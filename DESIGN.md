# Frontend
- **Unread states & Pings**: Displays a red dot with mention counts for direct messages (under DM tab/home icon) and server icons.
- **DM Sidebar Pings**: When on the DM page, individual DM channel list items now render a red badge showing the unread mention count from that user.
- **Dynamic DM Sidebar Refresh**: Received messages for new DMs that are not currently in the sidebar trigger an async refresh to fetch and list the new conversation in real-time.
- **Modal Keyboard Shortcuts**: Users can use the `Esc` key to exit most active modals and overlay windows.
- **Admin Panel UI**: The Moderator (Admin) Panel is now rendered as a fullscreen overlay rather than a fixed-width popup. The search bar is constrained in width for better UX on ultrawide displays, and the user result card now mimics the styling and layout of a standard profile popover, including rendering the user's joined servers.

# Backend
- **Admin Endpoints**: Added a `GET /admin/users/{user_id}/servers` endpoint to fetch the list of servers a user is a part of (requires SYSTEM_MOD or SYSTEM_ADMIN).
- **Chronological Unread Verification**: Read state updates (`read_update`) and metric checks (`get_my_unreads`) now compare the chronological order using the `created_at` timestamp. This prevents legacy random 7-digit message IDs from permanently locking a channel into the unread state.
- **Automatic Reply Pings**: Messages that are replies automatically include the parent message author's user ID in the `mentions` list to trigger a mention ping.
- **DM Pings**: Every direct message automatically increments the recipient's unread mention counter.
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