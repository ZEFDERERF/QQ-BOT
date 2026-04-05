# QQ-Minecraft Cross-Platform Bot

A multifunctional bot based on **Napcat QQ Bot Framework** and **Mineflayer Minecraft Bot Framework**. Supports AI chat (with image recognition), QQ-Minecraft cross-platform messaging, message recall logging, random cat pictures, likes, system info, and more.

---


### Features

- **AI Chat** (QQ group/private chat)  
  Supports text and image input, powered by local LLM via LM Studio (OpenAI-compatible API). Tool calls for time, user info, context, Minecraft operations, etc.

- **Minecraft Integration**  
  - Auto-connect to any Minecraft Java server (offline mode supported)  
  - Forward QQ messages to in-game chat, and vice versa  
  - Query online player list (`#cx` in game or `/查服` in QQ)  
  - Execute commands (admin only) and send messages via AI tool calls  

- **Message Recall Logging**  
  - Logs recalled messages in encrypted form (admin can decrypt with `$解密#G群号-序号`)  
  - Stores up to 1000 records, auto-clear on limit  

- **Useful Commands** (prefix `/` in QQ)  
  - `/菜单` or `/help` – Show command menu  
  - `/查服` or `/cx` – Get Minecraft online players  
  - `/随机柴郡` or `/cj` – Random Cheshire cat image  
  - `/点赞` or `/dz` – Like the sender (10 likes, 30s cooldown, once per day)  
  - `/系统信息` or `/sysinfo` – Display system & bot status  
  - `/清空记录` (admin only) – Clear all recall records  

- **Other Features**  
  - Automatic reply to mentions/replies  
  - Censorship of banned words  
  - Long message splitting & forward message support  
  - Context memory for conversations  
  - Health check & auto-reconnect for WebSocket and Minecraft  

### Prerequisites

- Node.js (v16 or later)
- [Napcat](https://github.com/NapNeko/NapCatQQ) (or any OneBot v11 compatible QQ bot) running locally or remotely
- [LM Studio](https://lmstudio.ai/) (or any OpenAI-compatible LLM API) – optional but required for AI features
- A Minecraft Java Edition server (for MC integration, optional)
