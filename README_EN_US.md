# QQ-Minecraft Cross-platform Bot

A multi‑function bot based on the **Napcat QQ Bot Framework** and the **Mineflayer Minecraft Bot Framework**. It supports AI chat (including image recognition), cross‑platform messaging between QQ and Minecraft, message recall logging, random cat pictures, likes, system info, and more.

---

### Features

- **AI Chat** (QQ group / private chat)  
  Supports both text and image input. Calls a local large language model via LM Studio (OpenAI API compatible). Also supports tool calls – can fetch time, user info, conversation context, execute Minecraft commands, etc.

- **Minecraft Integration**  
  - Automatically connect to any Minecraft Java Edition server (offline mode supported)  
  - Forward QQ messages to in‑game chat, and vice versa  
  - Query online player list (`#cx` in game, `/查服` in QQ)  
  - Execute commands (admin only) and send messages via AI tool calls  

- **Message Recall Logging**  
  - Recalled messages are stored in encrypted form (admins can decrypt using `$解密#Ggroup-serial`)  
  - Maximum 1000 records; older entries are automatically cleared when limit is reached  

- **Utility Commands** (prefix `/` in QQ)  
  - `/菜单` or `/help` – Show command menu  
  - `/查服` or `/cx` – Get list of online Minecraft players  
  - `/随机柴郡` or `/cj` – Random Cheshire cat picture  
  - `/点赞` or `/dz` – Give 10 likes to the sender (30s cooldown, once per day)  
  - `/系统信息` or `/sysinfo` – Display system and bot status  
  - `/清空记录` (admin only) – Clear all recall logs  

- **Other Features**  
  - Auto‑reply when mentioned or replied to  
  - Profanity filter  
  - Long message splitting and forwarded message support  
  - Conversation context memory  
  - Health checks and auto‑reconnect for WebSocket and Minecraft  

### Prerequisites

- Node.js (v16 or higher)
- A running [Napcat](https://github.com/NapNeko/NapCatQQ) instance (local or remote) – or any OneBot v11 compatible QQ bot
- [LM Studio](https://lmstudio.ai/) (or any OpenAI‑compatible LLM API) – optional, but required for AI features
- A Minecraft Java Edition server (optional, only needed for Minecraft integration)

### Required Installation

```NodeJS
npm install axios

npm install mineflayer

npm install ws
