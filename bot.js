/**
 * This is a multifunctional bot code based on the Napcat QQ bot framework and the Mineflayer bot framework, written in JavaScript.
 * 这是一个基于Napcat QQ机器人框架和Mineflayer机器人框架的多功能机器人代码，基于JavaScript
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const mineflayer = require('mineflayer');

const CONFIG_FILE = 'config.json';
const PROMPTS_FILE = 'prompts.json';
const BANNED_WORDS_FILE = 'banned_words.json';
const RECALL_STORAGE_FILE = '撤回记录.json';
const CACHE_TTL = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 100;
const MAX_MESSAGE_CACHE = 2000;
const DEFAULT_COOLDOWN = 100;
const DEFAULT_REPLY_DELAY = 100;
const MAX_REQUEST_PER_MINUTE = 15;
const REQUEST_LIMIT_INTERVAL = 30000;
const LIKE_COOLDOWN = 30000;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY = 60000;
const WEB_RECONNECT_BASE_DELAY = 1000;
const MAX_WEB_RECONNECT_DELAY = 30000;
const DEFAULT_IMAGE_TIMEOUT = 10000;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const MAX_CAT_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_AI_RESPONSE_LEN = 2500;
const SHORT_MSG_THRESHOLD = 100;

const defaultConfig = {
  botQQ: 'Bot QQ number',
  coolDownTime: DEFAULT_COOLDOWN,
  replyDelay: DEFAULT_REPLY_DELAY,
  blacklistedUsers: [123456, 123456, 123456],
  allowedGroups: [123456, 123456],
  adminQQ: 'QQ number',
  qqEnabled: true,
  lmStudio: {
    apiUrl: 'http://localhost:1234/v1/chat/completions',
    apiKey: 'lmstudio',
    model: 'local-model'
  },
  apiEndpoints: {
    accessToken: 'WS Token',
    ws: 'ws://localhost:6700',
    http: 'http://localhost:5700',
    httpToken: 'Http Token'
  },
  minecraft: {
    enabled: true,
    host: 'serverIP',
    port: 1234,
    username: 'Bot Name',
    version: 'Minecraft Version',
    auth: 'offline',
    loginCommand: 'Message or command'
  },
  recallEnabled: true,
  recallEncrypt: false,
  filterThink: true,
  debugLog: true,
  randomCommands: ['/菜单', '/查服', '/随机柴郡', '/点赞', '/系统信息']
};

const defaultPrompts = {
  system: "你是一名强大的AI助理，你需要用简短高效的语言回答用户的问题，你必须使用中文回答用户，除非用户让你使用其他语言"
};

if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2), 'utf8');
  console.log('已创建默认配置文件 config.json，请根据需要修改后重启机器人。');
  process.exit(0);
}
if (!fs.existsSync(PROMPTS_FILE)) {
  fs.writeFileSync(PROMPTS_FILE, JSON.stringify(defaultPrompts, null, 2), 'utf8');
  console.log('已创建默认提示词文件 prompts.json，您可以根据需要修改系统提示词。');
}

let botConfig, prompts;
try {
  botConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  prompts = JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8'));
  console.log('成功加载配置文件 config.json 和 prompts.json');
} catch (error) {
  console.error('读取配置文件失败:', error.message);
  process.exit(1);
}

class MinecraftManager {
  constructor(bot, config) {
    this.bot = bot;
    this.config = config;
    this.mcBot = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = MAX_RECONNECT_ATTEMPTS;
    this.reconnectDelay = RECONNECT_DELAY;
    this.lastError = null;
    this.stopped = false;
    this.messageProcessed = new Map();
  }

  init() {
    if (!this.config.enabled) {
      this.bot.logInfo('Minecraft 功能已禁用，跳过连接');
      return;
    }
    this.bot.logInfo('正在连接 Minecraft 服务器...');
    this.createBot();
  }

  createBot() {
    if (this.stopped) return;
    if (this.mcBot) {
      this.mcBot.removeAllListeners();
      this.mcBot.end('reconnect');
      this.mcBot = null;
    }
    try {
      this.mcBot = mineflayer.createBot({
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        auth: this.config.auth || 'offline',
        version: this.config.version || false,
        connectTimeout: 30000
      });

      this.mcBot.once('spawn', () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.bot.logInfo('Minecraft 机器人已进入服务器');
        if (this.config.loginCommand) this.mcBot.chat(this.config.loginCommand);
        setTimeout(() => {
          if (this.mcBot && this.connected) {
            this.mcBot.setControlState('jump', true);
            setTimeout(() => this.mcBot.setControlState('jump', false), 200);
          }
        }, 1000);
      });

      const extractText = (obj) => {
        let text = '';
        if (obj.text) text += obj.text;
        if (obj.extra) for (const part of obj.extra) text += extractText(part);
        return text;
      };

      this.mcBot.on('message', (jsonMsg) => {
        try {
          const msg = typeof jsonMsg === 'string' ? JSON.parse(jsonMsg) : jsonMsg;
          const fullMessage = extractText(msg).trim();
          if (!fullMessage) return;

          let playerName = null;
          if (msg.extra && msg.extra.length > 0) {
            for (const part of msg.extra) {
              if (part.clickEvent && part.clickEvent.action === 'suggest_command') {
                const match = part.clickEvent.command.match(/^\/msg\s+([a-zA-Z0-9_]+)\s*/);
                if (match) { playerName = match[1]; break; }
              }
            }
          }
          if (!playerName && msg.extra) {
            for (const part of msg.extra) {
              if (part.extra && Array.isArray(part.extra)) {
                for (const sub of part.extra) {
                  if (sub.text && /^[a-zA-Z0-9_]+$/.test(sub.text) && sub.text.length > 0) {
                    playerName = sub.text;
                    break;
                  }
                }
              }
              if (playerName) break;
            }
          }
          if (!playerName) return;
          if (playerName === this.mcBot.username) return;

          let messageText = fullMessage.replace(new RegExp(`^.*?${playerName}\\s*[>：:]\\s*`), '');
          if (messageText === fullMessage) {
            const parts = fullMessage.split(/\s+/);
            messageText = parts[parts.length - 1];
          }
          messageText = messageText.trim();
          if (!messageText) return;

          const msgKey = `${playerName}:${messageText}`;
          const now = Date.now();
          if (this.messageProcessed.has(msgKey)) {
            if (now - this.messageProcessed.get(msgKey) < 2000) return;
          }
          this.messageProcessed.set(msgKey, now);
          if (this.messageProcessed.size > 50) {
            const oldest = [...this.messageProcessed.keys()].slice(0, 25);
            oldest.forEach(k => this.messageProcessed.delete(k));
          }

          this.bot.logInfo(`[MC聊天(JSON)] ${playerName}: ${messageText}`);
          if (messageText.startsWith('#')) {
            this.handleGameCommand(playerName, messageText);
            return;
          }
          const aiPrefixRegex = /^@ai\s*/i;
          if (aiPrefixRegex.test(messageText)) {
            const question = messageText.replace(aiPrefixRegex, '').trim();
            if (question) this.bot.handleGameChat(playerName, question);
          }
        } catch (err) {
          this.bot.logError('解析JSON消息失败', err);
        }
      });

      this.mcBot.on('chat', (username, rawMessage) => {
        if (username === this.mcBot.username) return;
        const msgKey = `${username}:${rawMessage}`;
        const now = Date.now();
        if (this.messageProcessed.has(msgKey)) {
          if (now - this.messageProcessed.get(msgKey) < 2000) return;
        }
        this.messageProcessed.set(msgKey, now);
        this.bot.logDebug(`[MC原始] ${username}: ${rawMessage}`);
        if (rawMessage.startsWith('#')) {
          this.handleGameCommand(username, rawMessage);
          return;
        }
        this.bot.logInfo(`[MC聊天] ${username}: ${rawMessage}`);
        let realUsername = username;
        let realMessage = rawMessage;
        const colonIndex = rawMessage.indexOf(':');
        if (colonIndex !== -1) {
          const potentialName = rawMessage.substring(0, colonIndex).trim();
          if (/^[a-zA-Z0-9_]+$/.test(potentialName)) {
            realUsername = potentialName;
            realMessage = rawMessage.substring(colonIndex + 1).trim();
          } else if (potentialName.includes(' ')) {
            const parts = potentialName.split(/\s+/);
            const lastPart = parts[parts.length - 1];
            if (/^[a-zA-Z0-9_]+$/.test(lastPart)) {
              realUsername = lastPart;
              realMessage = rawMessage.substring(rawMessage.indexOf(':', colonIndex + 1) + 1).trim();
            }
          }
        }
        const aiPrefixRegex = /^@ai\s*/i;
        if (aiPrefixRegex.test(realMessage)) {
          const question = realMessage.replace(aiPrefixRegex, '').trim();
          if (question) this.bot.handleGameChat(realUsername, question);
        }
      });

      this.mcBot.on('playerJoined', (player) => this.bot.logInfo(`玩家 ${player.username} 加入游戏`));
      this.mcBot.on('playerLeft', (player) => this.bot.logInfo(`玩家 ${player.username} 离开游戏`));
      this.mcBot.on('error', (err) => {
        this.connected = false;
        this.bot.logError('机器人发生错误:', err);
        this.lastError = err.message;
        this.scheduleReconnect();
      });
      this.mcBot.on('end', (reason) => {
        this.connected = false;
        this.bot.logInfo(`机器人连接断开，原因：${reason}`);
        this.lastError = reason;
        this.scheduleReconnect();
      });
      this.mcBot.on('kicked', (reason) => {
        this.connected = false;
        this.bot.logInfo(`机器人被踢出，原因：${reason}`);
        this.lastError = reason;
        this.scheduleReconnect();
      });
    } catch (err) {
      this.bot.logError('创建机器人失败:', err);
      this.lastError = err.message;
      this.scheduleReconnect();
    }
  }

  handleGameCommand(username, command) {
    const args = command.slice(1).trim().split(/\s+/);
    const cmd = args[0].toLowerCase();
    if (cmd === 'cx') {
      const result = this.getPlayerList();
      if (result.success) {
        const playerListStr = result.list.length ? result.list.join(', ') : '暂无';
        this.mcBot.chat(`当前在线玩家: ${playerListStr} (${result.count}人)`);
      } else {
        this.mcBot.chat(result.message);
      }
    } else {
      this.mcBot.chat('未知指令，可用指令: #cx');
    }
  }

  scheduleReconnect() {
    if (!this.config.enabled || this.stopped) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.bot.logInfo(`达到最大重连次数 (${this.maxReconnectAttempts})，停止重连`);
      const errorMsg = `[!] 机器人未连接：${this.lastError || '未知原因'}\n已尝试 ${this.maxReconnectAttempts} 次，停止重连`;
      for (const groupId of this.bot.allowedGroups) {
        if (this.bot.qqEnabled) this.bot.sendGroupMessage(groupId, errorMsg);
      }
      this.stopped = true;
      return;
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAttempts++;
    this.bot.logInfo(`将在 ${Math.round(this.reconnectDelay / 1000)} 秒后尝试第 ${this.reconnectAttempts} 次重连...`);
    this.reconnectTimer = setTimeout(() => this.createBot(), this.reconnectDelay);
  }

  getPlayerList() {
    if (!this.config.enabled) return { success: false, message: '[!] 功能未启用' };
    if (!this.mcBot || !this.connected) {
      console.error(`[Minecraft] 机器人未连接: mcBot=${!!this.mcBot}, connected=${this.connected}`);
      return { success: false, message: '[!] 机器人未连接\n无法使用该命令!' };
    }
    try {
      const players = Object.values(this.mcBot.players);
      const onlinePlayers = players.map(p => p.username).filter(name => name !== this.mcBot.username);
      console.log(`[Minecraft] 在线玩家: ${JSON.stringify(onlinePlayers)}`);
      return { success: true, count: onlinePlayers.length, list: onlinePlayers };
    } catch (err) {
      this.bot.logError('获取玩家列表失败', err);
      return { success: false, message: '[!] 获取玩家列表时发生错误' };
    }
  }
}

class Bot {
  constructor(config, prompts) {
    this.config = config;
    this.prompts = prompts;
    this.debugLog = config.debugLog === true;
    this.qqEnabled = config.qqEnabled === true;

    this.cache = new Map();
    this.cacheTTL = new Map();
    this.messageCache = new Map();
    this.privateMessageCache = new Map();
    this.dailyLikeRecord = new Map();
    this.conversationContext = new Map();
    this.recentReplies = new Map();
    this.loadBannedWords();

    if (this.qqEnabled) {
      const accessToken = config.apiEndpoints?.accessToken;
      const wsUrl = config.apiEndpoints.ws;
      const wsOptions = accessToken ? { headers: { 'Authorization': 'Bearer ' + accessToken } } : {};
      this.ws = new WebSocket(wsUrl, wsOptions);
      this.wsUrl = wsUrl;
      this.wsOptions = wsOptions;
      this.initWebSocket();
    } else {
      this.logInfo('QQ 功能已禁用，不会连接 WebSocket 或处理 QQ 消息');
      this.ws = { send: () => this.logDebug('QQ 未启用，消息未发送') };
    }

    this.botNickname = null;
    this.lastGameChatTime = 0;
    this.lastLikeTime = 0;
    this.messageCount = 0;
    this.requestCount = 0;
    this.groupNameCache = {};
    this.blacklist = new Set(config.blacklistedUsers || []);
    this.allowedGroups = new Set(config.allowedGroups || []);
    this.adminQQ = config.adminQQ || '';
    this.recallStorageFile = RECALL_STORAGE_FILE;
    this.loadRecallRecords();

    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = Date.now();

    this.startCacheCleanup();
    this.resetMessageCount();

    this.delayedReply = this.delayedReply.bind(this);
    this.replyMessage = this.replyMessage.bind(this);

    this.minecraft = null;
    if (this.config.minecraft) {
      this.minecraft = new MinecraftManager(this, this.config.minecraft);
      this.minecraft.init();
    }

    this.healthCheck().catch(error => this.logError('启动自检失败:', error));

    this.logInfo('机器人初始化完成');
  }

  logInfo(...args) {
    const timestamp = new Date().toISOString();
    const plainMessage = `[${timestamp}] INFO: ${args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ')}`;
    console.log(plainMessage);
    fs.appendFile('./Debug-Crash.log', plainMessage + '\n', (err) => {
      if (err) console.error('写入日志文件失败:', err);
    });
  }

  logError(message, error = '') {
    const timestamp = new Date().toISOString();
    const plainMessage = `[${timestamp}] ERROR: ${message}: ${error instanceof Error ? `${error.message}\n${error.stack}` : error}`;
    console.error(plainMessage);
    fs.appendFile('./Debug-Crash.log', plainMessage + '\n', (err) => {
      if (err) console.error('写入错误日志文件时发生错误:', err);
    });
  }

  logWarn(...args) {
    const timestamp = new Date().toISOString();
    const plainMessage = `[${timestamp}] WARN: ${args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ')}`;
    console.warn(plainMessage);
    fs.appendFile('./Debug-Crash.log', plainMessage + '\n', (err) => {
      if (err) console.error('写入日志文件失败:', err);
    });
  }

  logDebug(...args) {
    if (!this.debugLog) return;
    const timestamp = new Date().toISOString();
    const plainMessage = `[${timestamp}] DEBUG: ${args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : a).join(' ')}`;
    console.log(plainMessage);
    fs.appendFile('./Debug-Crash.log', plainMessage + '\n', (err) => {
      if (err) console.error('写入调试日志文件时发生错误:', err);
    });
  }

  startCacheCleanup() {
    setInterval(() => {
      const now = Date.now();
      for (let [key, time] of this.cacheTTL.entries()) {
        if (now - time > CACHE_TTL) {
          this.cache.delete(key);
          this.cacheTTL.delete(key);
          this.logDebug(`缓存清理: 移除键 ${key}`);
        }
      }
      if (this.cache.size > MAX_CACHE_SIZE) {
        const toDelete = [...this.cache.keys()].slice(0, this.cache.size - MAX_CACHE_SIZE);
        toDelete.forEach(key => {
          this.cache.delete(key);
          this.cacheTTL.delete(key);
          this.logDebug(`缓存清理: 超出大小限制移除键 ${key}`);
        });
      }
    }, CACHE_TTL / 2);
  }

  loadBannedWords() {
    const bannedWordsPath = path.join(__dirname, BANNED_WORDS_FILE);
    if (!fs.existsSync(bannedWordsPath)) {
      fs.writeFileSync(bannedWordsPath, JSON.stringify([], null, 2), 'utf8');
      this.logInfo('已创建默认违禁词文件 banned_words.json（空列表）');
      this.bannedWords = [];
    } else {
      try {
        this.bannedWords = JSON.parse(fs.readFileSync(bannedWordsPath, 'utf8'));
        this.logInfo(`成功加载违禁词列表，共 ${this.bannedWords.length} 条`);
      } catch (error) {
        this.logError('读取违禁词文件失败:', error.message);
        this.bannedWords = [];
      }
    }
  }

  censorText(text) {
    if (!this.bannedWords?.length) return text;
    const combinedPattern = this.bannedWords.map(word => `(?:${word})`).join('|');
    try {
      const regex = new RegExp(combinedPattern, 'gi');
      const censored = text.replace(regex, '###');
      if (censored !== text && this.debugLog) {
        this.logDebug(`[屏蔽词过滤] "${text}" -> "${censored}"`);
      }
      return censored;
    } catch (e) {
      let censored = text;
      for (const word of this.bannedWords) {
        try {
          censored = censored.replace(new RegExp(word, 'gi'), '###');
        } catch (e2) {
          this.logError(`违禁词 "${word}" 不是有效的正则表达式，已跳过`, e2);
        }
      }
      return censored;
    }
  }

  initWebSocket() {
    if (!this.qqEnabled) return;
    this.ws.on('open', () => {
      this.logInfo('WebSocket连接成功');
      this.ws.send(JSON.stringify({ action: 'get_login_info', echo: 'login_info' }));
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.post_type === 'meta_event' && message.meta_event_type === 'heartbeat') return;

        if (message.echo === 'login_info') {
          if (message.data?.nickname) this.botNickname = message.data.nickname;
          this.logInfo(`获取到机器人昵称: ${this.botNickname}`);
          return;
        }

        if (message.post_type === 'message') {
          if (message.message_type === 'group') {
            this.cacheGroupMessage(message);
            this.handleGroupMessage(message);
          } else if (message.message_type === 'private') {
            this.cachePrivateMessage(message);
            this.handlePrivateMessage(message);
          }
        } else if (message.post_type !== 'meta_event') {
          this.logDebug('收到其他类型消息:', message.post_type, message.message_type);
        }

        if (message.post_type === 'notice' && message.notice_type === 'group_recall') {
          this.handleMessageRecall(message);
        }
      } catch (error) {
        this.logError('处理WebSocket消息时出错', error);
        this.logError('错误消息原文', data.toString());
      }
    });

    this.ws.on('error', (error) => this.logError('WebSocket错误:', error));

    let reconnectAttempts = 0;
    this.ws.on('close', () => {
      this.logInfo(`WebSocket连接关闭，尝试重连...`);
      const delay = Math.min(MAX_WEB_RECONNECT_DELAY, WEB_RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts));
      reconnectAttempts++;
      setTimeout(() => {
        this.logInfo('开始重新连接WebSocket...');
        this.ws = new WebSocket(this.wsUrl, this.wsOptions);
        this.initWebSocket();
      }, delay);
    });
  }

  cacheGroupMessage(message) {
    this.messageCache.set(message.message_id, {
      content: message.raw_message,
      sender: message.sender,
      time: Date.now()
    });
    this.logDebug(`缓存群消息 ID ${message.message_id}: ${message.raw_message}`);
    if (this.messageCache.size > MAX_MESSAGE_CACHE) {
      const oldestKey = this.messageCache.keys().next().value;
      this.messageCache.delete(oldestKey);
      this.logDebug(`消息缓存超出限制，移除最旧消息 ID ${oldestKey}`);
    }
  }

  cachePrivateMessage(message) {
    this.privateMessageCache.set(message.message_id, {
      content: message.raw_message,
      sender: message.sender,
      time: Date.now()
    });
    this.logDebug(`缓存私聊消息 ID ${message.message_id}: ${message.raw_message}`);
    if (this.privateMessageCache.size > MAX_MESSAGE_CACHE) {
      const oldestKey = this.privateMessageCache.keys().next().value;
      this.privateMessageCache.delete(oldestKey);
      this.logDebug(`私聊缓存超出限制，移除最旧消息 ID ${oldestKey}`);
    }
  }

  async handleGameChat(username, message) {
    this.logInfo(`[游戏AI] 收到来自 ${username} 的消息: ${message}`);
    await this.askGameAI(message, username);
  }

  async getGroupName(groupId) {
    if (this.groupNameCache && this.groupNameCache[groupId]) {
      return this.groupNameCache[groupId];
    }
    return new Promise((resolve) => {
      const echo = Date.now() + '_group_info_' + groupId;
      const payload = {
        action: 'get_group_info',
        params: { group_id: groupId },
        echo
      };
      this.ws.send(JSON.stringify(payload));

      const handler = (data) => {
        try {
          const resp = JSON.parse(data.toString());
          if (resp.echo === echo) {
            this.ws.off('message', handler);
            if (resp.status === 'ok' && resp.data?.group_name) {
              const groupName = resp.data.group_name;
              if (!this.groupNameCache) this.groupNameCache = {};
              this.groupNameCache[groupId] = groupName;
              resolve(groupName);
            } else {
              resolve(`群${groupId}`);
            }
          }
        } catch (err) {
          resolve(`群${groupId}`);
        }
      };
      this.ws.on('message', handler);
      setTimeout(() => {
        this.ws.off('message', handler);
        resolve(`群${groupId}`);
      }, 3000);
    });
  }

  async handleGroupMessage(message) {
    try {
      this.logDebug('原始群消息对象:', {
        message_id: message.message_id,
        group_id: message.group_id,
        sender: message.sender,
        raw_message: message.raw_message,
        message: Array.isArray(message.message) ? message.message : message.message,
        raw: message.raw ? '<存在 raw 字段>' : '无'
      });

      if (!this.allowedGroups.has(message.group_id)) {
        this.logDebug(`群 ${message.group_id} 不在允许列表中，忽略消息`);
        return;
      }

      const groupId = message.group_id;
      const sender = message.sender;
      const senderName = sender.card || sender.nickname || '未知用户';
      const senderQQ = sender.user_id;
      this.logInfo(`[群聊] 收到群[${groupId}]消息 ${message.message_id} [用户${senderQQ}] ${senderName} 发送了: ${message.raw_message}`);

      if (this.blacklist.has(senderQQ)) {
        this.logDebug(`用户 ${senderQQ} 在黑名单中，忽略消息`);
        return;
      }

      const isArrayFormat = Array.isArray(message.message);
      const rawMsg = message.raw_message;
      const botQQStr = this.config.botQQ.toString();

      let atMe = false;
      if (isArrayFormat) {
        atMe = message.message.some(part => part.type === 'at' && String(part.data.qq) === botQQStr);
      } else {
        atMe = rawMsg.includes(`[CQ:at,qq=${botQQStr}]`);
      }

      let isReplyToMe = false;
      if (message.raw && message.raw.elements) {
        for (const element of message.raw.elements) {
          if (element.elementType === 7 && element.replyElement) {
            const reply = element.replyElement;
            const replyMsgSeq = reply.replayMsgSeq;
            if (replyMsgSeq && message.raw.records) {
              const record = message.raw.records.find(r => String(r.msgSeq) === String(replyMsgSeq));
              if (record && record.sendType === 1 && String(record.senderUin) === this.config.botQQ) {
                isReplyToMe = true;
                this.logDebug(`[回复检测] 用户回复了机器人的消息，消息ID: ${message.message_id}`);
                break;
              }
            }
          }
        }
      }

      if (!isReplyToMe) {
        if (isArrayFormat) {
          isReplyToMe = message.message.some(part => {
            if (part.type !== 'reply') return false;
            if (part.data.qq && String(part.data.qq) === botQQStr) return true;
            if (part.data.id) {
              const msgId = parseInt(part.data.id);
              const cachedMsg = this.messageCache.get(msgId);
              if (cachedMsg && cachedMsg.sender && String(cachedMsg.sender.user_id) === botQQStr) return true;
              if (message.raw && message.raw.records) {
                const record = message.raw.records.find(r => String(r.msgSeq) === String(msgId) || String(r.msgId) === String(msgId));
                if (record && record.sendType === 1 && String(record.senderUin) === this.config.botQQ) return true;
              }
            }
            return false;
          });
        } else {
          const replyMatch = rawMsg.match(/\[CQ:reply,id=(\d+)(?:,qq=(\d+))?\]/);
          if (replyMatch) {
            const replyId = parseInt(replyMatch[1]);
            const replyQQ = replyMatch[2];
            if (replyQQ && String(replyQQ) === botQQStr) {
              isReplyToMe = true;
            } else {
              const cachedMsg = this.messageCache.get(replyId);
              if (cachedMsg && cachedMsg.sender && String(cachedMsg.sender.user_id) === botQQStr) {
                isReplyToMe = true;
              } else if (message.raw && message.raw.records) {
                const record = message.raw.records.find(r => String(r.msgSeq) === String(replyId) || String(r.msgId) === String(replyId));
                if (record && record.sendType === 1 && String(record.senderUin) === this.config.botQQ) {
                  isReplyToMe = true;
                }
              }
            }
          }
        }
      }

      this.logDebug(`检测结果 - @我: ${atMe}, 回复我: ${isReplyToMe}`);

      if (!atMe && !isReplyToMe) {
        this.logDebug('未检测到@机器人或回复机器人，忽略消息');
        return;
      }

      let imageUrls = [];
      if (isArrayFormat) {
        message.message.forEach(part => {
          if (part.type === 'image' && part.data?.url) imageUrls.push(part.data.url);
        });
      } else {
        const imageRegex = /\[CQ:image[^\]]*url=([^\]]+)[^\]]*\]/g;
        let match;
        while ((match = imageRegex.exec(rawMsg)) !== null) imageUrls.push(match[1]);
      }
      imageUrls = [...new Set(imageUrls)];
      this.logDebug(`提取到的图片 URL: ${imageUrls}`);

      let text = rawMsg;
      text = text.replace(new RegExp(`\\[CQ:at,qq=${botQQStr}[^\\]]*\\]`, 'g'), '');
      text = text.replace(/\[CQ:reply[^\]]*\]/g, '');
      text = text.trim();

      const handled = this.handleCommands(text, message, false);
      if (handled) {
        this.logDebug(`命令处理结果: ${handled}`);
        return;
      }

      const forwardToGameRegex = /^转发到游戏\s*[:：]\s*(.+)/i;
      const forwardMatch = text.match(forwardToGameRegex);
      if (forwardMatch) {
        const content = forwardMatch[1].trim();
        if (content) {
          const groupName = await this.getGroupName(groupId);
          this.sendQQToGame(groupName, senderName, content);
          this.replyMessage(groupId, `已转发到游戏：${content}`, senderQQ, message.message_id, 0, false, true, 0, 0, false);
        } else {
          this.replyMessage(groupId, '请提供要转发的消息内容', senderQQ, message.message_id, 0, false, true, 0, 0, false);
        }
        return;
      }

      if (text && (text.startsWith('/') || text.startsWith('$'))) {
        this.logDebug('消息以 / 或 $ 开头，可能是指令，已忽略 AI 处理');
        return;
      }

      if (text || imageUrls.length) {
        this.processQuestion(text, message, imageUrls, false);
      }
    } catch (error) {
      this.logError('处理群消息时出错', error);
      this.logError('错误堆栈:', error.stack);
    }
  }

  async handlePrivateMessage(message) {
    try {
      this.logDebug('原始私聊消息对象:', {
        message_id: message.message_id,
        user_id: message.user_id,
        sender: message.sender,
        raw_message: message.raw_message,
        message: Array.isArray(message.message) ? message.message : message.message,
        raw: message.raw ? '<存在 raw 字段>' : '无'
      });

      const userId = message.user_id;
      const sender = message.sender;
      const senderName = sender.card || sender.nickname || '未知用户';
      this.logInfo(`[私聊] 收到来自 ${senderName} (${userId}) 的消息: ${message.raw_message}`);

      if (this.blacklist.has(userId)) {
        this.logDebug(`用户 ${userId} 在黑名单中，忽略私聊`);
        return;
      }

      const isArrayFormat = Array.isArray(message.message);
      const rawMsg = message.raw_message;
      const botQQStr = this.config.botQQ.toString();

      let imageUrls = [];
      if (isArrayFormat) {
        message.message.forEach(part => {
          if (part.type === 'image' && part.data?.url) imageUrls.push(part.data.url);
        });
      } else {
        const imageRegex = /\[CQ:image[^\]]*url=([^\]]+)[^\]]*\]/g;
        let match;
        while ((match = imageRegex.exec(rawMsg)) !== null) imageUrls.push(match[1]);
      }
      imageUrls = [...new Set(imageUrls)];
      this.logDebug(`提取到的图片 URL: ${imageUrls}`);

      let text = rawMsg;
      text = text.replace(new RegExp(`\\[CQ:at,qq=${botQQStr}[^\\]]*\\]`, 'g'), '');
      text = text.replace(/\[CQ:reply[^\]]*\]/g, '');
      text = text.trim();

      const handled = this.handleCommands(text, message, true);
      if (handled) {
        this.logDebug(`命令处理结果: ${handled}`);
        return;
      }

      const forwardToGameRegex = /^转发到游戏\s*[:：]\s*(.+)/i;
      const forwardMatch = text.match(forwardToGameRegex);
      if (forwardMatch) {
        const content = forwardMatch[1].trim();
        if (content) {
          this.sendQQToGame(userId.toString(), senderName, content);
          this.replyMessage(userId, `已转发到游戏：${content}`, userId, message.message_id, 0, false, true, 0, 0, true);
        } else {
          this.replyMessage(userId, '请提供要转发的消息内容', userId, message.message_id, 0, false, true, 0, 0, true);
        }
        return;
      }

      if (text && (text.startsWith('/') || text.startsWith('$'))) {
        this.logDebug('消息以 / 或 $ 开头，可能是指令，已忽略 AI 处理');
        return;
      }

      if (text || imageUrls.length) {
        this.processQuestion(text, message, imageUrls, true);
      }
    } catch (error) {
      this.logError('处理私聊消息时出错', error);
      this.logError('错误堆栈:', error.stack);
    }
  }

  handleCommands(text, originalMessage, isPrivate) {
    const id = isPrivate ? originalMessage.user_id : originalMessage.group_id;
    const userId = originalMessage.sender.user_id;
    const msgId = originalMessage.message_id;

    const cmdMap = {
      '/': () => {
        const commands = this.config.randomCommands || defaultConfig.randomCommands;
        const randomCmd = commands[Math.floor(Math.random() * commands.length)];
        this.replyMessage(id, `猜你想使用指令 "${randomCmd}"`, userId, msgId, 0, false, true, 0, 0, isPrivate);
        return true;
      },
      '$': () => this.handleCommands('/', originalMessage, isPrivate),
      '/清空记录': () => this.handleClearRecords(originalMessage, isPrivate),
      '/菜单': () => this.showMenu(originalMessage, isPrivate),
      '/help': () => this.showMenu(originalMessage, isPrivate),
      '/查服': () => this.handlePlayerList(originalMessage, isPrivate),
      '/cx': () => this.handlePlayerList(originalMessage, isPrivate),
      '/cj': () => this.handleRandomCat(originalMessage, isPrivate),
      '/随机柴郡': () => this.handleRandomCat(originalMessage, isPrivate),
      '/dz': () => this.handleLike(originalMessage, isPrivate),
      '/点赞': () => this.handleLike(originalMessage, isPrivate),
      '/sysinfo': () => this.handleSysInfo(originalMessage, isPrivate),
      '/系统信息': () => this.handleSysInfo(originalMessage, isPrivate),
    };
    if (cmdMap[text]) return cmdMap[text]();

    const decryptPattern = /^\$解密\s*#G(\d+)-(\d+)/;
    const decryptMatch = text.match(decryptPattern);
    if (decryptMatch) {
      this.handleDecryptRequest(text, originalMessage, isPrivate);
      return true;
    }

    if (text.startsWith('/') || text.startsWith('$')) {
      this.logDebug('检测到未识别的指令，已忽略:', text);
      return true;
    }
    return false;
  }

  async handleSysInfo(originalMessage, isPrivate) {
    const os = require('os');
    const { execSync } = require('child_process');
    const platform = os.platform();
    const arch = os.arch();
    const cpus = os.cpus();
    const totalMem = (os.totalmem() / (1024 ** 3)).toFixed(2);
    const freeMem = (os.freemem() / (1024 ** 3)).toFixed(2);
    const usedMem = (totalMem - freeMem).toFixed(2);
    const uptime = Math.floor(os.uptime() / 60);
    const hostname = os.hostname();
    let osVersion = os.version ? os.version() : os.release();
    if (platform === 'win32') {
      try {
        const ver = execSync('wmic os get Caption,Version /value').toString();
        const match = ver.match(/Caption=(.+)\r?\nVersion=(.+)/);
        if (match) osVersion = `${match[1].trim()} (${match[2].trim()})`;
      } catch (e) {}
    }

    const loadAvg = os.loadavg();
    const cpuCount = cpus.length;
    const load1 = (loadAvg[0] / cpuCount * 100).toFixed(1);
    const load5 = (loadAvg[1] / cpuCount * 100).toFixed(1);
    const load15 = (loadAvg[2] / cpuCount * 100).toFixed(1);

    const now = Date.now();
    const elapsedMs = now - this.lastCpuTime;
    const currentCpuUsage = process.cpuUsage(this.lastCpuUsage);
    const cpuTotal = (currentCpuUsage.user + currentCpuUsage.system) / 1000;
    let cpuPercent = 'N/A';
    if (elapsedMs > 0) cpuPercent = ((cpuTotal / elapsedMs) * 100).toFixed(1);
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = now;

    const memUsage = process.memoryUsage();
    const rss = (memUsage.rss / (1024 ** 2)).toFixed(2);
    const heapTotal = (memUsage.heapTotal / (1024 ** 2)).toFixed(2);
    const heapUsed = (memUsage.heapUsed / (1024 ** 2)).toFixed(2);
    const external = (memUsage.external / (1024 ** 2)).toFixed(2);
    const qqNumber = this.config.botQQ;
    const qqNickname = this.botNickname || '未知';

    const info = [
      `[i] 系统信息`,
      `系统：${platform} ${arch}`,
      `版本：${osVersion}`,
      `主机名：${hostname}`,
      `CPU：${cpus[0].model} (${cpus.length} 核心)`,
      `负载：1分钟 ${load1}% / 5分钟 ${load5}% / 15分钟 ${load15}%`,
      `内存：已用 ${usedMem} GB / 总计 ${totalMem} GB (剩余 ${freeMem} GB)`,
      `运行时间：${uptime} 分钟`,
      `\n[i] 进程信息`,
      `CPU 占用：${cpuPercent}% (相对于单核)`,
      `RSS：${rss} MB`,
      `堆总量：${heapTotal} MB`,
      `堆已用：${heapUsed} MB`,
      `外部内存：${external} MB`,
      `\n[i] QQ 信息`,
      `QQ 号：${qqNumber}`,
      `昵称：${qqNickname}`
    ].join('\n');

    const id = isPrivate ? originalMessage.user_id : originalMessage.group_id;
    this.replyMessage(id, info, originalMessage.sender.user_id, originalMessage.message_id, 0, false, true, 0, 0, isPrivate);
  }

  handlePlayerList(originalMessage, isPrivate) {
    const id = isPrivate ? originalMessage.user_id : originalMessage.group_id;
    if (!this.minecraft) {
      this.replyMessage(id, '[i]功能未配置，无法使用', originalMessage.sender.user_id, originalMessage.message_id, 0, false, true, 0, 0, isPrivate);
      return;
    }
    const result = this.minecraft.getPlayerList();
    if (!result.success) {
      this.replyMessage(id, result.message, originalMessage.sender.user_id, originalMessage.message_id, 0, false, true, 0, 0, isPrivate);
      return;
    }
    const playerListStr = result.list.length ? result.list.join(', ') : '暂无';
    this.replyMessage(id, `[i] 当前在线玩家: ${playerListStr}\n在线人数: ${result.count} 人`, originalMessage.sender.user_id, originalMessage.message_id, 0, false, true, 0, 0, isPrivate);
  }

  async processQuestion(question, originalMessage, imageUrls = [], isPrivate) {
    if (question && (question.startsWith('/') || question.startsWith('$'))) {
      this.logDebug('processQuestion 检测到指令，已忽略');
      return;
    }

    const userId = originalMessage.sender.user_id;
    const startTime = Date.now();
    this.logInfo(`处理问题: 用户 ${userId} 提问: "${question}"，包含图片数: ${imageUrls.length}${isPrivate ? ' (私聊)' : ' (群聊)'}`);

    try {
      if (this.requestCount >= MAX_REQUEST_PER_MINUTE) {
        this.logDebug(`请求频率限制触发，当前请求数: ${this.requestCount}`);
        const id = isPrivate ? originalMessage.user_id : originalMessage.group_id;
        this.replyMessage(id, "AI也需要休息哦！等一会再试试吧~", userId, originalMessage.message_id, 0, false, false, 0, 0, isPrivate);
        return;
      }

      const context = this.conversationContext.get(userId) || [];
      this.logDebug(`用户 ${userId} 当前上下文长度: ${context.length}`);

      let messages = [
        { role: 'system', content: this.buildSystemPrompt() }
      ];

      let userContent = question;
      if (imageUrls.length > 0) {
        const textPart = { type: "text", text: question };
        const imageParts = [];
        for (const url of imageUrls) {
          const base64 = await this.downloadImageAsBase64(url);
          if (base64) {
            imageParts.push({ type: "image_url", image_url: { url: base64 } });
          }
        }
        userContent = [textPart, ...imageParts];
      }
      messages.push({ role: 'user', content: userContent });

      this.logDebug('发送给 AI 的消息:', messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content.substring(0, 200) : JSON.stringify(m.content).substring(0, 200)
      })));

      let finalAnswer = '';
      let totalTokens = 0;
      let totalModelTime = 0;
      let maxIterations = 5;
      let iteration = 0;
      let shouldContinue = true;

      while (shouldContinue && iteration < maxIterations) {
        this.logDebug(`AI 调用迭代 ${iteration + 1}`);
        const result = await this.callAI(messages);
        if (result.error) {
          const id = isPrivate ? originalMessage.user_id : originalMessage.group_id;
          this.replyMessage(id, result.error, userId, originalMessage.message_id, 0, true, false, 0, 0, isPrivate);
          return;
        }

        totalTokens += result.usage?.total_tokens || 0;
        totalModelTime += result.modelElapsed || 0;
        const assistantMsg = result.message;

        this.logDebug('AI 原始响应:', assistantMsg);
        this.logDebug(`AI 耗时: ${result.modelElapsed}s, Token: ${JSON.stringify(result.usage)}`);

        if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
          this.logInfo(`AI 请求工具调用: ${assistantMsg.tool_calls.map(tc => tc.function.name).join(', ')}`);
          messages.push(assistantMsg);
          for (const toolCall of assistantMsg.tool_calls) {
            const args = JSON.parse(toolCall.function.arguments);
            this.logDebug('工具调用参数:', args);
            const toolResult = await this.handleFunctionCall(toolCall.function.name, args, originalMessage);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(toolResult)
            });
          }
          iteration++;
        } else {
          finalAnswer = assistantMsg.content || '';
          shouldContinue = false;
        }
      }

      if (iteration >= maxIterations) finalAnswer = '[!] 工具调用次数过多，已停止。';

      const newContext = [...context];
      newContext.push({ role: 'user', content: question });
      newContext.push({ role: 'assistant', content: finalAnswer });
      if (newContext.length > 6) newContext.splice(0, 2);
      this.conversationContext.set(userId, newContext);
      this.logDebug(`更新用户 ${userId} 上下文，新长度: ${newContext.length}`);

      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(3);
      if (finalAnswer) {
        let cleanedAnswer = finalAnswer;
        if (this.config.filterThink) cleanedAnswer = this.filterThinkContent(cleanedAnswer);
        cleanedAnswer = this.optimizeResponse(cleanedAnswer);
        cleanedAnswer = this.censorText(cleanedAnswer);
        const id = isPrivate ? originalMessage.user_id : originalMessage.group_id;
        this.delayedReply(id, cleanedAnswer, userId, originalMessage.message_id, elapsedTime, false, false, totalTokens, totalModelTime, isPrivate);
      } else {
        this.logDebug('AI 返回空内容');
      }

      this.requestCount++;
      this.messageCount++;
      this.logInfo(`处理完成，耗时 ${elapsedTime}秒，Token: ${totalTokens}, 模型耗时: ${totalModelTime.toFixed(3)}秒`);
    } catch (error) {
      this.logError('处理问题时出错:', error);
      const id = isPrivate ? originalMessage.user_id : originalMessage.group_id;
      this.replyMessage(id, '[!] 处理问题时发生错误，请稍后重试', userId, originalMessage.message_id, 0, true, false, 0, 0, isPrivate);
    }
  }

  buildSystemPrompt() {
    const baseSystem = this.prompts.system || defaultPrompts.system;
    const rules = "禁止色情、暴力、政治敏感。";
    const tools = `工具：
- 时间 get_current_time
- 用户信息 get_user_info
- 上下文记录 get_conversation_context（使用这个工具获取上下文对话记录）
- 游戏发消息 send_mc_message（严禁执行命令!）
- 执行命令 execute_mc_command（如传送 /tpa 玩家）
- 在线玩家 get_mc_players
- 转发到QQ send_qq_message

传送等其他指令操作必须用 execute_mc_command工具不可用 send_mc_message 代替。`;
    return `${baseSystem}\n\n${rules}\n\n${tools}`;
  }

  defineTools() {
    return [
      {
        type: 'function',
        function: {
          name: 'get_current_time',
          description: '获取当前的日期和时间（精确到秒）。当用户询问“现在几点”、“今天几号”、“时间”等时，必须调用此工具获取真实时间，禁止编造。',
          parameters: { type: 'object', properties: {}, required: [] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'get_user_info',
          description: '获取当前对话用户的昵称和QQ号。当用户询问自己的昵称或QQ号时调用此工具。',
          parameters: { type: 'object', properties: {}, required: [] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'get_conversation_context',
          description: '获取当前对话的历史记录。当用户的问题需要引用之前的对话内容时，调用此工具获取上下文。',
          parameters: { type: 'object', properties: {}, required: [] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'send_mc_message',
          description: '向 Minecraft 服务器发送消息。当用户希望向游戏内玩家广播或私聊时调用（除私聊外其他指令严禁执行）',
          parameters: {
            type: 'object',
            properties: {
              message: { type: 'string', description: '要发送的消息内容' },
              target: { type: 'string', description: '目标玩家名，可选。不填则为全局广播' }
            },
            required: ['message']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'execute_mc_command',
          description: '在 Minecraft 服务器执行任意命令。当你需要执行具体操作时使用，例如：传送玩家（tpa <玩家名>）',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: '要执行的命令，不含斜杠。例如："tpa SnowYu_" 或 "back"' }
            },
            required: ['command']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'get_mc_players',
          description: '获取 Minecraft 服务器在线玩家列表。',
          parameters: { type: 'object', properties: {} }
        }
      },
      {
        type: 'function',
        function: {
          name: 'send_qq_message',
          description: '向 QQ 群发送消息（MC玩家可通过此功能将消息转发到 QQ 群）。',
          parameters: {
            type: 'object',
            properties: {
              message: { type: 'string', description: '要发送的消息内容' }
            },
            required: ['message']
          }
        }
      }
    ];
  }

  async callAI(messages, useTools = true) {
    const startTime = Date.now();
    const lmStudio = this.config.lmStudio || {
      apiUrl: 'http://localhost:1234/v1/chat/completions',
      apiKey: '',
      model: 'local-model'
    };
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${lmStudio.apiKey}`
    };
    const payload = { model: lmStudio.model, messages };
    if (useTools) {
      payload.tools = this.defineTools();
      payload.tool_choice = 'auto';
    }
    this.logDebug(`调用 AI API: ${lmStudio.apiUrl}, 模型: ${lmStudio.model}, 消息数: ${messages.length}`);
    this.logDebug('API 请求 payload:', JSON.stringify(payload).substring(0, 500));
    try {
      const response = await axios.post(lmStudio.apiUrl, payload, { headers, timeout: 250000 });
      const modelElapsed = (Date.now() - startTime) / 1000;
      if (!response.data?.choices?.[0]?.message) throw new Error('API返回数据格式异常');
      const message = response.data.choices[0].message;
      this.logDebug(`AI 响应: role=${message.role}, content长度=${message.content?.length || 0}, tool_calls=${message.tool_calls?.length || 0}`);
      return {
        message: {
          role: message.role,
          content: message.content || '',
          tool_calls: message.tool_calls || null
        },
        usage: response.data.usage || null,
        error: null,
        modelElapsed
      };
    } catch (error) {
      this.logError('API调用失败', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
        stack: error.stack
      });
      let errorMsg = '';
      if (error.response?.status === 429) errorMsg = `[!]抱歉，API调用次数已达到限制，请稍后再试~\n${error.message}`;
      else if (error.code === 'ECONNREFUSED') errorMsg = `[!]抱歉，AI服务暂时无法连接，请稍后再试~\n${error.message}`;
      else if (error.code === 'ETIMEDOUT') errorMsg = `[!]抱歉，AI服务响应超时，请稍后再试~\n${error.message}`;
      else errorMsg = `[!]抱歉，AI服务出现问题：${error.message}，请稍后重试~`;
      return { error: errorMsg };
    }
  }

  async handleFunctionCall(functionName, args, originalMessage) {
    this.logDebug(`执行工具: ${functionName}`, args);
    switch (functionName) {
      case 'get_current_time':
        return { message: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) };
      case 'get_user_info':
        const senderName = originalMessage.sender.card || originalMessage.sender.nickname || '未知用户';
        const senderQQ = originalMessage.sender.user_id;
        return { message: `您的昵称：${senderName}\n您的QQ号：${senderQQ}` };
      case 'get_conversation_context':
        const userId = originalMessage.sender.user_id;
        const context = this.conversationContext.get(userId) || [];
        if (context.length === 0) return { message: '暂无历史对话记录。' };
        const historyText = context.map(entry => `${entry.role === 'user' ? '用户' : '助手'}：${entry.content}`).join('\n');
        return { message: `历史对话：\n${historyText}` };
      case 'send_mc_message':
        if (!this.minecraft?.connected) return { error: 'Minecraft 机器人未连接' };
        const { message: mcMsg, target } = args;
        let finalMessage = mcMsg;
        if (originalMessage.sender && originalMessage.sender.user_id !== 0) {
          const senderName = originalMessage.sender.card || originalMessage.sender.nickname || 'QQ用户';
          const groupId = originalMessage.group_id;
          const groupName = await this.getGroupName(groupId);
          finalMessage = `[${groupName}] ${senderName}: ${mcMsg}`;
        }
        const mcMessage = target ? `/tell ${target} ${finalMessage}` : finalMessage;
        this.minecraft.mcBot.chat(mcMessage);
        this.logInfo(`[工具] 发送MC消息: ${mcMessage}`);
        return { message: `已发送到游戏${target ? '（私聊 ' + target + '）' : ''}：${mcMsg}` };
      case 'execute_mc_command':
        if (String(originalMessage.sender.user_id) !== String(this.adminQQ)) {
          return { error: '权限不足，仅管理员可执行此操作' };
        }
        if (!this.minecraft?.connected) return { error: 'Minecraft 机器人未连接' };
        this.minecraft.mcBot.chat(`/${args.command}`);
        this.logInfo(`[工具] 执行MC命令: /${args.command}`);
        return { message: `已在游戏执行命令：/${args.command}` };
      case 'send_qq_message':
        if (!this.qqEnabled) {
          return { error: 'QQ 功能未启用，无法转发消息到 QQ' };
        }
        if (!this.allowedGroups.size) return { error: '没有可用的 QQ 群' };
        let qqSenderName = '';
        if (originalMessage.sender && originalMessage.sender.user_id !== 0) {
          qqSenderName = originalMessage.sender.card || originalMessage.sender.nickname || 'QQ用户';
        } else if (originalMessage.sender && originalMessage.sender.user_id === 0) {
          qqSenderName = originalMessage.sender.nickname || originalMessage.sender.card || '游戏玩家';
        } else {
          qqSenderName = '未知用户';
        }
        const formattedMessage = `[MC] ${qqSenderName}: ${args.message}`;
        for (const groupId of this.allowedGroups) this.sendGroupMessage(groupId, formattedMessage);
        this.logInfo(`[工具] 转发到QQ: ${formattedMessage}`);
        return { message: `已转发到 QQ 群：${args.message}` };
      default:
        return { error: '未知工具' };
    }
  }

  async downloadImageAsBase64(url) {
    this.logDebug(`下载图片: ${url}`);
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: DEFAULT_IMAGE_TIMEOUT,
        maxContentLength: MAX_IMAGE_SIZE,
        maxBodyLength: MAX_IMAGE_SIZE
      });
      this.logDebug(`图片下载成功，大小: ${response.data.length} bytes`);
      return `data:${response.headers['content-type'] || 'image/jpeg'};base64,${Buffer.from(response.data, 'binary').toString('base64')}`;
    } catch (err) {
      this.logError('下载图片失败', err);
      return null;
    }
  }

  resetMessageCount() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => {
      this.messageCount = 0;
      this.requestCount = 0;
      this.logDebug('重置消息计数和请求计数');
    }, REQUEST_LIMIT_INTERVAL);
  }

  async askGameAI(question, username) {
    this.logInfo(`[游戏AI] 收到来自 ${username} 的消息: ${question}`);
    const now = Date.now();
    if (this.lastGameChatTime && now - this.lastGameChatTime < 5000) {
      this.logDebug(`游戏内AI请求限流，${username}: ${question}`);
      return;
    }
    this.lastGameChatTime = now;

    try {
      if (this.requestCount >= MAX_REQUEST_PER_MINUTE) {
        this.minecraft.mcBot.chat(`[AI] 当前请求繁忙，请稍后再试`);
        return;
      }

      const messages = [
        { role: 'system', content: this.buildSystemPrompt() },
        { role: 'user', content: `玩家 ${username} 说：${question}` }
      ];

      let finalAnswer = '';
      let maxIterations = 3;
      let iteration = 0;
      let shouldContinue = true;

      while (shouldContinue && iteration < maxIterations) {
        this.logDebug(`游戏AI迭代 ${iteration + 1}`);
        const result = await this.callAI(messages, true);
        if (result.error) {
          const errorMsg = result.error.substring(0, 100);
          this.minecraft.mcBot.chat(`[AI] 服务暂时不可用: ${errorMsg}`);
          return;
        }
        const assistantMsg = result.message;
        if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
          this.logInfo(`游戏AI请求工具调用: ${assistantMsg.tool_calls.map(tc => tc.function.name).join(', ')}`);
          messages.push(assistantMsg);
          for (const toolCall of assistantMsg.tool_calls) {
            const toolResult = await this.handleFunctionCall(
              toolCall.function.name,
              JSON.parse(toolCall.function.arguments),
              { sender: { user_id: 0, nickname: username, card: username } }
            );
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(toolResult)
            });
          }
          iteration++;
        } else {
          finalAnswer = assistantMsg.content || '';
          shouldContinue = false;
        }
      }

      if (finalAnswer) {
        let cleanedAnswer = finalAnswer;
        if (this.config.filterThink) cleanedAnswer = this.filterThinkContent(cleanedAnswer);
        cleanedAnswer = this.optimizeResponse(cleanedAnswer);
        cleanedAnswer = this.censorText(cleanedAnswer);
        if (cleanedAnswer.length > 200) cleanedAnswer = cleanedAnswer.substring(0, 200) + '…';
        this.minecraft.mcBot.chat(`[AI] ${cleanedAnswer}`);
        this.logInfo(`游戏AI回复: ${cleanedAnswer}`);
      } else {
        this.minecraft.mcBot.chat(`[AI] 抱歉，我没有理解你的问题。`);
      }
      this.requestCount++;
    } catch (error) {
      this.logError('游戏内AI处理出错:', error);
      this.minecraft.mcBot.chat(`[AI] 处理出错，请稍后再试`);
    }
  }

  sendQQToGame(groupName, senderName, message) {
    if (!this.minecraft?.connected) {
      this.logError('无法转发到游戏：Minecraft 机器人未连接');
      return;
    }
    const filteredMessage = this.censorText(message);
    const displayName = groupName || '未知';
    const gameMessage = `[${displayName}] ${senderName}: ${filteredMessage}`;
    this.minecraft.mcBot.chat(gameMessage);
    this.logInfo(`[转发] QQ->MC: ${gameMessage}`);
  }

  sendGroupMessage(groupId, message) {
    if (!this.qqEnabled) {
      this.logDebug('QQ 功能未启用，忽略发送群消息');
      return;
    }
    this.ws.send(JSON.stringify({ action: 'send_group_msg', params: { group_id: groupId, message } }));
    this.logDebug(`发送群消息到 ${groupId}: ${message}`);
  }

  sendPrivateMessage(userId, message) {
    if (!this.qqEnabled) {
      this.logDebug('QQ 功能未启用，忽略发送私聊消息');
      return;
    }
    this.ws.send(JSON.stringify({ action: 'send_private_msg', params: { user_id: userId, message } }));
    this.logDebug(`发送私聊消息到 ${userId}: ${message}`);
  }

  delayedReply(id, message, userId, messageId, elapsedTime, isError = false, isSystemCommand = false, totalTokens = 0, modelElapsed = 0, isPrivate = false) {
    setTimeout(() => this.replyMessage(id, message, userId, messageId, elapsedTime, isError, isSystemCommand, totalTokens, modelElapsed, isPrivate), this.config.replyDelay);
  }

  replyMessage(id, message, userId, messageId, elapsedTime, isError = false, isSystemCommand = false, totalTokens = 0, modelElapsed = 0, isPrivate = false) {
    const replyKey = `${id}_${messageId}_${isPrivate ? 'p' : 'g'}`;
    const now = Date.now();
    if (this.recentReplies.has(replyKey) && now - this.recentReplies.get(replyKey) < 5000) {
      this.logDebug('检测到重复回复，已忽略', replyKey);
      return;
    }
    this.recentReplies.set(replyKey, now);
    setTimeout(() => this.recentReplies.delete(replyKey), 5000);

    const filteredContent = this.censorText(message);
    if (isError) {
      this.logError('Error message:', filteredContent);
      const errorMsg = `[错误] ${filteredContent}`;
      if (isPrivate) {
        this.sendPrivateMessageWithCache(id, `[CQ:reply,id=${messageId}] ${errorMsg}`).catch(err => this.logError('发送错误消息失败', err));
      } else {
        this.sendGroupMessageWithCache(id, `[CQ:reply,id=${messageId}] [CQ:at,qq=${userId}] ${errorMsg}`).catch(err => this.logError('发送错误消息失败', err));
      }
      this.logInfo('发送错误消息:', errorMsg);
      return;
    }

    this.logDebug(`准备发送消息到 ${isPrivate ? `私聊${id}` : `群${id}`}，内容长度: ${filteredContent.length}`);

    if (isSystemCommand) {
      const replyMsg = isPrivate ? `[CQ:reply,id=${messageId}] ${filteredContent}` : `[CQ:reply,id=${messageId}] [CQ:at,qq=${userId}] ${filteredContent}`;
      if (isPrivate) {
        this.sendPrivateMessageWithCache(id, replyMsg).catch(err => this.logError('发送消息失败', err));
      } else {
        this.sendGroupMessageWithCache(id, replyMsg).catch(err => this.logError('发送消息失败', err));
      }
      this.logInfo('发送回复消息:', replyMsg);
      return;
    }

    if (filteredContent.length > SHORT_MSG_THRESHOLD) {
      if (filteredContent.length > MAX_AI_RESPONSE_LEN) {
        const messages = [];
        let start = 0;
        let partIndex = 1;
        while (start < filteredContent.length) {
          const end = Math.min(start + MAX_AI_RESPONSE_LEN, filteredContent.length);
          const part = filteredContent.substring(start, end);
          messages.push({ type: 'node', data: { name: `GPT 片段 ${partIndex}`, uin: this.config.botQQ, content: part } });
          start = end;
          partIndex++;
        }
        messages.push({
          type: 'node',
          data: {
            name: 'System',
            uin: this.config.botQQ,
            content: `生成完成！总耗时：${elapsedTime}秒${modelElapsed ? `\n思考耗时：${modelElapsed.toFixed(3)}秒` : ''}${totalTokens ? `\n总消耗Token: ${totalTokens}` : ''}\n\n**仅供参考，使用需判断**\n***自行承担使用后果***\nBy QQ2028356250`
          }
        });
        if (isPrivate) {
          for (const node of messages) {
            this.sendPrivateMessageWithCache(id, node.data.content).catch(err => this.logError('发送私聊消息失败', err));
          }
        } else {
          const forwardMessage = { action: 'send_group_forward_msg', params: { group_id: id, messages }, timeout: 10000 };
          this.ws.send(JSON.stringify(forwardMessage));
          this.logInfo('发送合并转发消息（长消息分段）:', forwardMessage);
        }
      } else {
        if (isPrivate) {
          this.sendPrivateMessageWithCache(id, filteredContent).catch(err => this.logError('发送私聊消息失败', err));
        } else {
          const forwardMessage = {
            action: 'send_group_forward_msg',
            params: {
              group_id: id,
              messages: [
                { type: 'node', data: { name: 'GPT', uin: this.config.botQQ, content: filteredContent } },
                {
                  type: 'node',
                  data: {
                    name: 'System',
                    uin: this.config.botQQ,
                    content: `生成完成！总耗时：${elapsedTime}秒${modelElapsed ? `\n思考耗时：${modelElapsed.toFixed(3)}秒` : ''}${totalTokens ? `\n总消耗Token: ${totalTokens}` : ''}\n\n**仅供参考，使用需判断**\n***自行承担使用后果***\nBy QQ2028356250`
                  }
                }
              ]
            },
            timeout: 10000
          };
          this.ws.send(JSON.stringify(forwardMessage));
          this.logInfo('发送转发消息:', forwardMessage);
        }
      }
    } else {
      const replyMsg = isPrivate ? `[CQ:reply,id=${messageId}] ${filteredContent}` : `[CQ:reply,id=${messageId}] [CQ:at,qq=${userId}] ${filteredContent}`;
      if (isPrivate) {
        this.sendPrivateMessageWithCache(id, replyMsg).catch(err => this.logError('发送消息失败', err));
      } else {
        this.sendGroupMessageWithCache(id, replyMsg).catch(err => this.logError('发送消息失败', err));
      }
      this.logInfo('发送回复消息:', replyMsg);
    }
  }

  sendGroupMessageWithCache(groupId, message) {
    if (!this.qqEnabled) {
      return Promise.reject(new Error('QQ功能未启用'));
    }
    return new Promise((resolve, reject) => {
      const echo = Date.now() + '_' + Math.random();
      const payload = { action: 'send_group_msg', params: { group_id: groupId, message }, echo };
      this.ws.send(JSON.stringify(payload));
      this.logDebug(`发送群消息并等待确认: ${JSON.stringify(payload)}`);
      const handler = (data) => {
        try {
          const resp = JSON.parse(data.toString());
          if (resp.echo === echo) {
            this.ws.off('message', handler);
            if (resp.status === 'ok' && resp.data?.message_id) {
              this.messageCache.set(resp.data.message_id, {
                content: message,
                sender: { user_id: this.config.botQQ, nickname: this.botNickname || '机器人', card: '' },
                time: Date.now()
              });
              this.logInfo(`[消息缓存] 成功缓存群消息ID ${resp.data.message_id}`);
              this.logDebug(`发送响应: ${JSON.stringify(resp)}`);
              if (this.messageCache.size > MAX_MESSAGE_CACHE) {
                const oldestKey = this.messageCache.keys().next().value;
                this.messageCache.delete(oldestKey);
              }
              resolve(resp.data.message_id);
            } else {
              this.logError(`[消息缓存] 发送失败，响应: ${JSON.stringify(resp)}`);
              reject(new Error('发送失败'));
            }
          }
        } catch (err) { reject(err); }
      };
      this.ws.on('message', handler);
      setTimeout(() => {
        this.ws.off('message', handler);
        reject(new Error('发送超时'));
      }, 10000);
    });
  }

  sendPrivateMessageWithCache(userId, message) {
    if (!this.qqEnabled) {
      return Promise.reject(new Error('QQ功能未启用'));
    }
    return new Promise((resolve, reject) => {
      const echo = Date.now() + '_' + Math.random();
      const payload = { action: 'send_private_msg', params: { user_id: userId, message }, echo };
      this.ws.send(JSON.stringify(payload));
      this.logDebug(`发送私聊消息并等待确认: ${JSON.stringify(payload)}`);
      const handler = (data) => {
        try {
          const resp = JSON.parse(data.toString());
          if (resp.echo === echo) {
            this.ws.off('message', handler);
            if (resp.status === 'ok' && resp.data?.message_id) {
              this.privateMessageCache.set(resp.data.message_id, {
                content: message,
                sender: { user_id: this.config.botQQ, nickname: this.botNickname || '机器人', card: '' },
                time: Date.now()
              });
              this.logInfo(`[消息缓存] 成功缓存私聊消息ID ${resp.data.message_id}`);
              this.logDebug(`发送响应: ${JSON.stringify(resp)}`);
              if (this.privateMessageCache.size > MAX_MESSAGE_CACHE) {
                const oldestKey = this.privateMessageCache.keys().next().value;
                this.privateMessageCache.delete(oldestKey);
              }
              resolve(resp.data.message_id);
            } else {
              this.logError(`[消息缓存] 发送失败，响应: ${JSON.stringify(resp)}`);
              reject(new Error('发送失败'));
            }
          }
        } catch (err) { reject(err); }
      };
      this.ws.on('message', handler);
      setTimeout(() => {
        this.ws.off('message', handler);
        reject(new Error('发送超时'));
      }, 10000);
    });
  }

  async handleRandomCat(originalMessage, isPrivate) {
    if (!this.qqEnabled) return;
    try {
      const imageUrl = 'https://sucyan.top/api/tupian/chaijun.php';
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 10000, maxContentLength: MAX_CAT_IMAGE_SIZE });
      const base64 = Buffer.from(response.data, 'binary').toString('base64');
      const base64Image = `base64://${base64}`;
      const id = isPrivate ? originalMessage.user_id : originalMessage.group_id;
      const message = isPrivate ? `你的柴郡来啦：\n[CQ:image,file=${base64Image}]` : `[CQ:at,qq=${originalMessage.sender.user_id}] 你的柴郡来啦：\n[CQ:image,file=${base64Image}]`;
      if (isPrivate) {
        this.ws.send(JSON.stringify({ action: 'send_private_msg', params: { user_id: id, message } }));
      } else {
        this.ws.send(JSON.stringify({ action: 'send_group_msg', params: { group_id: id, message } }));
      }
      this.logInfo('发送随机柴郡图片成功');
    } catch (error) {
      this.logError('获取随机柴郡图片失败', error);
      const id = isPrivate ? originalMessage.user_id : originalMessage.group_id;
      this.replyMessage(id, '获取柴郡图片失败，请稍后再试', originalMessage.sender.user_id, originalMessage.message_id, 0, false, true, 0, 0, isPrivate);
    }
  }

  async handleLike(originalMessage, isPrivate) {
    if (!this.qqEnabled) return;
    const userId = originalMessage.sender.user_id;
    const id = isPrivate ? userId : originalMessage.group_id;
    const now = Date.now();
    const today = new Date().toLocaleDateString('zh-CN');

    if (this.lastLikeTime && now - this.lastLikeTime < LIKE_COOLDOWN) {
      const remainSeconds = Math.ceil((LIKE_COOLDOWN - (now - this.lastLikeTime)) / 1000);
      this.replyMessage(id, `[!] 点赞指令冷却中，请 ${remainSeconds} 秒后再试～`, userId, originalMessage.message_id, 0, false, true, 0, 0, isPrivate);
      return;
    }

    const dailyKey = `like_${userId}`;
    if (this.dailyLikeRecord.get(dailyKey) === today) {
      this.replyMessage(id, '[i] 今日已点过赞，明天再来吧～', userId, originalMessage.message_id, 0, false, true, 0, 0, isPrivate);
      return;
    }

    const httpBase = this.config.apiEndpoints?.http || 'http://localhost:5700';
    const httpToken = this.config.apiEndpoints?.httpToken || '';
    const url = `${httpBase}/send_like`;
    try {
      const response = await axios.post(url, { user_id: userId, times: 10 }, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${httpToken}` },
        timeout: 10000
      });
      if (response.data?.retcode === 0) {
        this.dailyLikeRecord.set(dailyKey, today);
        this.lastLikeTime = now;
        this.replyMessage(id, '[i] 成功点赞', userId, originalMessage.message_id, 0, false, true, 0, 0, isPrivate);
      } else {
        const errorMsg = response.data?.msg || response.data?.message || '点赞失败';
        this.replyMessage(id, `[!] ${errorMsg}`, userId, originalMessage.message_id, 0, false, true, 0, 0, isPrivate);
      }
    } catch (error) {
      let errorMsg = '点赞失败，请稍后再试';
      if (error.response?.data?.msg) errorMsg = error.response.data.msg;
      else if (error.message) errorMsg = error.message;
      this.replyMessage(id, `[!] ${errorMsg}`, userId, originalMessage.message_id, 0, false, true, 0, 0, isPrivate);
    }
  }

  async showMenu(originalMessage, isPrivate) {
    const mcLine = this.minecraft?.config.enabled ? '  • @机器人 /cx | /查服 - 获取Minecraft服务器在线玩家列表\n  • 游戏内可使用 #cx 查询在线人数\n' : '';
    const menuText = `机器人指令菜单（所有指令需以"/"开头）

基础功能
  • @机器人 [问题] - 与机器人对话
  • 回复机器人消息 - 继续对话
  • @机器人 /dz | /点赞 - 给自己点赞10次（全局冷却30秒，每日1次）
  • @机器人 /cj | /随机柴郡 - 发送一张随机的柴郡表情包
  • @机器人 /sysinfo | /系统信息 - 查看系统信息及机器人状态
${mcLine}
系统设置
  • @机器人 /解密#G群号-序号 - 查看撤回消息（仅管理员）
  • @机器人 /清空记录 - 清空所有撤回记录（仅管理员）`;
    const id = isPrivate ? originalMessage.user_id : originalMessage.group_id;
    this.replyMessage(id, menuText, originalMessage.sender.user_id, originalMessage.message_id, 0, false, true, 0, 0, isPrivate);
  }

  async handleMessageRecall(recallNotice) {
    if (!this.qqEnabled) return;
    try {
      if (!this.config.recallEnabled) return;
      const groupId = recallNotice.group_id;
      if (recallNotice.user_id === this.config.botQQ) return;
      if (recallNotice.operator_id && recallNotice.operator_id !== recallNotice.user_id) return;
      if (!recallNotice.operator_id) return;

      const cachedMessage = this.messageCache.get(recallNotice.message_id) || {};
      const content = cachedMessage.content;
      if (!content) return;
      const filteredContent = this.censorText(content);

      const senderName = cachedMessage.sender?.nickname || '未知用户';
      const recordTime = cachedMessage.time ? new Date(cachedMessage.time).toLocaleString('zh-CN') : '未知时间';

      if (this.config.recallEncrypt) {
        if (!this.recallStorage.groups[groupId]) this.recallStorage.groups[groupId] = { records: [], imageCount: 0, textCount: 0 };
        const groupRecords = this.recallStorage.groups[groupId];
        let maxSeq = 0;
        for (const record of groupRecords.records) {
          const match = record.id.match(/#G(\d+)-(\d+)/);
          if (match) maxSeq = Math.max(maxSeq, parseInt(match[1]));
        }
        const seq = maxSeq + 1;
        const recordId = `#G${groupId}-${seq}`;
        const recordEntry = {
          id: recordId,
          time: new Date().toISOString(),
          content: filteredContent,
          user: { id: recallNotice.user_id, name: senderName },
          groupId,
          hasImage: /\[CQ:image/.test(filteredContent)
        };
        groupRecords.records.push(recordEntry);
        this.recallStorage.total++;
        if (recordEntry.hasImage) {
          this.recallStorage.imageCount++;
          groupRecords.imageCount++;
        } else {
          this.recallStorage.textCount++;
          groupRecords.textCount++;
        }
        if (this.recallStorage.total >= 1000) this.clearRecords(true);
        else this.saveRecallRecords();

        const noticeMsg = [`撤回者：${senderName} ${recallNotice.user_id}`, `记录编号：${recordId}`, `记录时间：${recordTime}`].join('\n');
        this.ws.send(JSON.stringify({
          action: 'send_group_msg',
          params: { group_id: groupId, message: `[!][CQ:at,qq=${this.config.botQQ}] 检测到消息撤回\n${noticeMsg}` }
        }));
      } else {
        const currentTime = new Date().toLocaleString('zh-CN');
        const fullMessage = `用户 ${senderName} (${recallNotice.user_id}) 于 ${currentTime} 撤回了一条消息：\n${filteredContent}`;
        this.ws.send(JSON.stringify({ action: 'send_group_msg', params: { group_id: groupId, message: fullMessage } }));
      }
      this.logInfo(`处理撤回消息: ${groupId} 用户 ${recallNotice.user_id} 撤回消息 ${recallNotice.message_id}`);
    } catch (error) {
      this.logError('处理消息撤回时出错', error);
    }
  }

  async handleDecryptRequest(command, originalMessage, isPrivate) {
    if (!this.qqEnabled) return;
    const id = isPrivate ? originalMessage.user_id : originalMessage.group_id;
    if (String(originalMessage.sender.user_id) !== String(this.adminQQ)) {
      this.replyMessage(id, '[错误] 权限不足，仅管理员可执行解密操作', originalMessage.sender.user_id, originalMessage.message_id, 0, false, true, 0, 0, isPrivate);
      return;
    }
    const cleanCommand = command.replace(/\s+/g, '');
    const recordIdMatch = cleanCommand.match(/^\$解密#G(\d+)-(\d+)$/);
    if (!recordIdMatch) {
      this.replyMessage(id, '[错误] 格式错误！请使用：@机器人 $解密#G群号-序号', originalMessage.sender.user_id, originalMessage.message_id, 0, false, true, 0, 0, isPrivate);
      return;
    }
    const groupId = parseInt(recordIdMatch[1]);
    const recordNum = parseInt(recordIdMatch[2]);
    const groupRecords = this.recallStorage.groups[groupId]?.records || [];
    const targetRecord = groupRecords[recordNum - 1];
    if (!targetRecord) {
      this.replyMessage(id, '[错误] 记录不存在或已过期', originalMessage.sender.user_id, originalMessage.message_id, 0, false, true, 0, 0, isPrivate);
      return;
    }
    const replyContent = [
      `[i] 记录 ${targetRecord.id}`,
      `├ 原发送者：${targetRecord.user.name} (${targetRecord.user.id})`,
      `├ 所属群聊：${targetRecord.groupId}`,
      `├ 记录时间：${new Date(targetRecord.time).toLocaleString('zh-CN')}`,
      `└ 原始内容：`
    ].join('\n');
    if (isPrivate) {
      this.sendPrivateMessage(id, replyContent);
      this.sendPrivateMessage(id, targetRecord.content);
    } else {
      this.ws.send(JSON.stringify({ action: 'send_group_msg', params: { group_id: id, message: replyContent } }));
      this.ws.send(JSON.stringify({ action: 'send_group_msg', params: { group_id: id, message: targetRecord.content } }));
    }
  }

  loadRecallRecords() {
    try {
      if (fs.existsSync(this.recallStorageFile)) {
        this.recallStorage = JSON.parse(fs.readFileSync(this.recallStorageFile, 'utf8'));
        this.logInfo(`已加载 ${this.recallStorage.total} 条撤回记录`);
      } else {
        this.recallStorage = { groups: {}, total: 0, imageCount: 0, textCount: 0 };
        this.saveRecallRecords();
      }
    } catch (error) {
      this.logError('加载撤回记录失败', error);
      this.recallStorage = { groups: {}, total: 0, imageCount: 0, textCount: 0 };
    }
  }

  saveRecallRecords() {
    try {
      fs.writeFileSync(this.recallStorageFile, JSON.stringify(this.recallStorage, null, 2), 'utf8');
    } catch (error) {
      this.logError('保存撤回记录失败', error);
    }
  }

  clearRecords(autoClear = false) {
    const stats = {
      total: this.recallStorage.total,
      groupCount: Object.keys(this.recallStorage.groups).length,
      imageCount: this.recallStorage.imageCount,
      textCount: this.recallStorage.textCount
    };
    this.recallStorage = { groups: {}, total: 0, imageCount: 0, textCount: 0 };
    this.saveRecallRecords();
    if (autoClear) this.notifyAllGroups(`[i]撤回消息记录池已超过最大次数，现已自动清空\n上次记录统计：${JSON.stringify(stats)}`);
    return stats;
  }

  notifyAllGroups(message) {
    if (!this.qqEnabled) return;
    for (const groupId of this.allowedGroups) {
      this.replyMessage(groupId, message, this.config.botQQ, null, 0, false, true, 0, 0, false);
    }
  }

  async handleClearRecords(originalMessage, isPrivate) {
    if (!this.qqEnabled) return;
    const id = isPrivate ? originalMessage.user_id : originalMessage.group_id;
    if (String(originalMessage.sender.user_id) !== String(this.adminQQ)) {
      this.replyMessage(id, '[错误] 权限不足，仅管理员可执行此操作', originalMessage.sender.user_id, originalMessage.message_id, 0, false, true, 0, 0, isPrivate);
      return;
    }
    try {
      const stats = this.clearRecords();
      const replyText = ['[i] 记录池已清空', `已清除记录：${stats.total} 条`, `涉及群组：${stats.groupCount} 个`, `包含图片：${stats.imageCount} 张`, `文本信息：${stats.textCount} 条`].join('\n');
      this.replyMessage(id, replyText, originalMessage.sender.user_id, originalMessage.message_id, 0, false, true, 0, 0, isPrivate);
    } catch (error) {
      this.logError('清空记录失败', error);
      this.replyMessage(id, '[错误] 清空记录时发生错误', originalMessage.sender.user_id, originalMessage.message_id, 0, false, true, 0, 0, isPrivate);
    }
  }

  optimizeResponse(text) {
    let cleaned = text.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, lang, code) => code.trim());
    cleaned = cleaned.replace(/`/g, '').replace(/\*\*/g, '');
    cleaned = cleaned.replace(/换句话说，/g, '').replace(/值得注意的是，/g, '');
    return cleaned;
  }

  filterThinkContent(text) {
    if (!text) return text;
    return text.replace(/<\s*think[^>]*>[\s\S]*?<\s*\/\s*think\s*>/gi, '').trim();
  }

  async healthCheck() {
    const testQuestion = '请回复字母序列：' + Math.random().toString(36).substr(2, 6);
    try {
      await this.callAI([{ role: 'user', content: testQuestion }]);
      this.logInfo('API自检通过');
    } catch (error) {
      this.logError('API自检失败:', error.message);
    }
  }
}

console.log('正在启动机器人...');
const bot = new Bot(botConfig, prompts);
