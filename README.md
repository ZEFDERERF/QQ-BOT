## 🌐 语言 / Language

[English](README_EN_US.md) | [简体中文](README.zh-CN.md)

# QQ-我的世界 跨平台机器人

一个基于 **Napcat QQ 机器人框架** 和 **Mineflayer Minecraft 机器人框架** 的多功能机器人。支持 AI 聊天（含图像识别）、QQ-我的世界跨平台消息互通、消息撤回记录、随机猫图、点赞、系统信息等功能。

---

### 功能特性

- **AI 聊天**（QQ群聊/私聊）  
  支持文本和图像输入，通过 LM Studio（兼容 OpenAI API）调用本地大语言模型。支持工具调用，可获取时间、用户信息、上下文、执行 Minecraft 操作等。

- **Minecraft 集成**  
  - 自动连接任意 Minecraft Java 版服务器（支持离线模式）  
  - 将 QQ 消息转发到游戏内聊天，反之亦然  
  - 查询在线玩家列表（游戏内使用 `#cx`，QQ 内使用 `/查服`）  
  - 通过 AI 工具调用执行命令（仅管理员）和发送消息  

- **消息撤回记录**  
  - 以加密形式记录被撤回的消息（管理员可使用 `$解密#G群号-序号` 进行解密）  
  - 最多存储 1000 条记录，超出后自动清空  

- **实用命令**（QQ 中使用前缀 `/`）  
  - `/菜单` 或 `/help` – 显示命令菜单  
  - `/查服` 或 `/cx` – 获取 Minecraft 在线玩家  
  - `/随机柴郡` 或 `/cj` – 随机柴郡猫图片  
  - `/点赞` 或 `/dz` – 给发送者点赞（10个赞，30秒冷却，每天一次）  
  - `/系统信息` 或 `/sysinfo` – 显示系统及机器人状态  
  - `/清空记录`（仅管理员）– 清空所有撤回记录  

- **其他功能**  
  - 自动回复提及/回复消息  
  - 违禁词审查  
  - 长消息拆分与转发消息支持  
  - 对话上下文记忆  
  - WebSocket 与 Minecraft 的健康检查及自动重连  

### 前提条件

- Node.js（v16 或更高版本）
- 本地或远程运行的 [Napcat](https://github.com/NapNeko/NapCatQQ)（或任何兼容 OneBot v11 的 QQ 机器人）
- [LM Studio](https://lmstudio.ai/)（或任何兼容 OpenAI 的 LLM API）– 可选，但 AI 功能需要
- Minecraft Java 版服务器（用于 MC 集成，可选）

### 必须安装

```NodeJS
npm install axios

npm install mineflayer

npm install ws
