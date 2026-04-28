const express = require('express');
const expressWs = require('express-ws');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');

function createWebPanel(botInstance, options = {}) {
  const app = express();
  expressWs(app);
  const port = options.port || 3000;
  const publicDir = options.publicDir || path.join(__dirname, 'public');

  const wsClients = new Set();
  const MAX_CLIENTS = 10;
  let lastBroadcastTime = 0;
  const MIN_BROADCAST_INTERVAL = 50;

  app.use(bodyParser.json({ limit: '100kb' }));
  app.use(express.static(publicDir, { maxAge: '1h' }));

  app.ws('/ws/log', (ws, req) => {
    if (wsClients.size >= MAX_CLIENTS) {
      ws.close(1013, '服务器繁忙，请稍后重试');
      botInstance.logWarn('[WebPanel] WebSocket 连接被拒绝：已达到最大客户端数量');
      return;
    }

    wsClients.add(ws);
    botInstance.logInfo(`[WebPanel] 新的 WebSocket 客户端连接，当前在线: ${wsClients.size}`);

    ws.on('close', (code, reason) => {
      wsClients.delete(ws);
      botInstance.logInfo(`[WebPanel] WebSocket 客户端断开，当前在线: ${wsClients.size}`);
    });

    ws.on('error', (err) => {
      wsClients.delete(ws);
      botInstance.logError('[WebPanel] WebSocket 错误:', err);
    });
  });

  let logBuffer = [];
  let flushTimeout = null;

  function broadcastLog(level, message) {
    if (level === 'debug' && botInstance.debugLog !== true) {
      return;
    }

    const now = Date.now();
    if (now - lastBroadcastTime < MIN_BROADCAST_INTERVAL) {
      logBuffer.push({
        type: 'log',
        level,
        message,
        timestamp: new Date().toISOString()
      });
      
      if (!flushTimeout) {
        flushTimeout = setTimeout(flushLogBuffer, MIN_BROADCAST_INTERVAL);
      }
      return;
    }
    lastBroadcastTime = now;

    const data = JSON.stringify({
      type: 'log',
      level,
      message,
      timestamp: new Date().toISOString()
    });
    
    let sentCount = 0;
    wsClients.forEach(client => {
      if (client.readyState === 1) {
        client.send(data);
        sentCount++;
      }
    });
    
    if (sentCount === 0 && wsClients.size > 0) {
      cleanupDeadClients();
    }
  }

  function flushLogBuffer() {
    if (logBuffer.length === 0) {
      flushTimeout = null;
      return;
    }

    const batchData = JSON.stringify({
      type: 'log_batch',
      logs: logBuffer,
      timestamp: new Date().toISOString()
    });

    wsClients.forEach(client => {
      if (client.readyState === 1) {
        client.send(batchData);
      }
    });

    logBuffer = [];
    flushTimeout = null;
    lastBroadcastTime = Date.now();
  }

  function cleanupDeadClients() {
    let cleanedCount = 0;
    wsClients.forEach(client => {
      if (client.readyState !== 1) {
        wsClients.delete(client);
        cleanedCount++;
      }
    });
    if (cleanedCount > 0) {
      botInstance.logInfo(`[WebPanel] 清理了 ${cleanedCount} 个无效客户端连接`);
    }
  }

  botInstance._broadcastLog = broadcastLog;

  app.get('/api/config', (req, res) => {
    try {
      const config = JSON.parse(fs.readFileSync(botInstance.configPath, 'utf8'));
      const configKeys = Object.keys(config).join(', ');
      res.json({ success: true, data: config });
      broadcastLog('debug', `[API] GET /api/config - 获取配置成功，配置项: ${configKeys}`);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
      broadcastLog('error', `[API] GET /api/config - 获取配置失败: ${err.message}`);
    }
  });

  function isValidObject(obj) {
  return obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).length > 0;
}
app.post('/api/config', (req, res) => {
  try {
    const newConfig = req.body;
    const configSize = JSON.stringify(newConfig).length;
    const configKeys = newConfig ? Object.keys(newConfig).join(', ') : '无';
    if (isValidObject(newConfig)) {
      fs.writeFileSync(botInstance.configPath, JSON.stringify(newConfig, null, 2), 'utf8');
      broadcastLog('debug', `[API] POST /api/config - 配置文件已更新，配置项: ${configKeys}，数据大小: ${configSize} 字节`);
    }
    botInstance.reloadConfig();
    const currentConfig = JSON.parse(fs.readFileSync(botInstance.configPath, 'utf8'));
    broadcastLog('debug', '[API] POST /api/config - 配置文件已重载并通知所有客户端');
    
    const configUpdateData = JSON.stringify({
      type: 'config_update',
      timestamp: new Date().toISOString()
    });
    const onlineClients = wsClients.size;
    wsClients.forEach(client => {
      if (client.readyState === 1) {
        client.send(configUpdateData);
      }
    });
    broadcastLog('debug', `[API] POST /api/config - 已向 ${onlineClients} 个客户端发送配置更新通知`);
    
    res.json({ success: true, message: '配置已重载', data: currentConfig });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
    broadcastLog('error', `[API] POST /api/config - 更新配置失败: ${err.message}`);
  }
});

  app.get('/api/prompts', (req, res) => {
    try {
      const prompts = JSON.parse(fs.readFileSync(botInstance.promptsPath, 'utf8'));
      const promptCount = prompts ? Object.keys(prompts).length : 0;
      const promptKeys = prompts ? Object.keys(prompts).join(', ') : '无';
      res.json({ success: true, data: prompts });
      broadcastLog('debug', `[API] GET /api/prompts - 获取提示词成功，共 ${promptCount} 个提示词: ${promptKeys}`);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
      broadcastLog('error', `[API] GET /api/prompts - 获取提示词失败: ${err.message}`);
    }
  });

  app.post('/api/prompts', (req, res) => {
  try {
    const newPrompts = req.body;
    const promptCount = newPrompts ? Object.keys(newPrompts).length : 0;
    const promptKeys = newPrompts ? Object.keys(newPrompts).join(', ') : '无';
    if (!isValidObject(newPrompts)) {
      broadcastLog('warn', '[API] POST /api/prompts - 拒绝写入空提示词，数据无效');
      return res.status(400).json({ success: false, error: '提示词数据无效，不能为空对象' });
    }
    fs.writeFileSync(botInstance.promptsPath, JSON.stringify(newPrompts, null, 2), 'utf8');
    botInstance.reloadPrompts();
    broadcastLog('debug', `[API] POST /api/prompts - 提示词已更新并重载，共 ${promptCount} 个提示词: ${promptKeys}`);
    res.json({ success: true, message: '提示词已更新' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
    broadcastLog('error', `[API] POST /api/prompts - 更新提示词失败: ${err.message}`);
  }
});

  app.get('/api/banned_words', (req, res) => {
    try {
      const words = JSON.parse(fs.readFileSync(botInstance.bannedWordsPath, 'utf8'));
      const wordCount = Array.isArray(words) ? words.length : 0;
      res.json({ success: true, data: words });
      broadcastLog('debug', `[API] GET /api/banned_words - 获取违禁词列表成功，共 ${wordCount} 个违禁词`);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
      broadcastLog('error', `[API] GET /api/banned_words - 获取违禁词列表失败: ${err.message}`);
    }
  });

  app.post('/api/banned_words', (req, res) => {
  try {
    const newWords = req.body;
    const wordCount = Array.isArray(newWords) ? newWords.length : 0;
    if (!Array.isArray(newWords)) {
      broadcastLog('warn', '[API] POST /api/banned_words - 拒绝写入非数组违禁词');
      return res.status(400).json({ success: false, error: '违禁词数据必须为数组' });
    }
    fs.writeFileSync(botInstance.bannedWordsPath, JSON.stringify(newWords, null, 2), 'utf8');
    botInstance.reloadBannedWords();
    broadcastLog('debug', `[API] POST /api/banned_words - 违禁词列表已更新并重载，共 ${wordCount} 个违禁词`);
    res.json({ success: true, message: '违禁词已更新' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
    broadcastLog('error', `[API] POST /api/banned_words - 更新违禁词失败: ${err.message}`);
  }
});

  app.get('/api/groups', async (req, res) => {
    try {
      const groups = [];
      const allowedGroups = botInstance.allowedGroups;
      
      if (!allowedGroups || allowedGroups.size === 0) {
        res.json({ success: true, data: groups });
        broadcastLog('debug', '[API] GET /api/groups - 获取群列表成功，配置文件中无允许的群');
        return;
      }

      let joinedGroups = [];
      try {
        joinedGroups = await botInstance.getJoinedGroups();
        broadcastLog('debug', `[API] GET /api/groups - 从QQ获取已加入群列表成功，共 ${joinedGroups.length} 个群`);
      } catch (err) {
        broadcastLog('warn', '[API] GET /api/groups - 获取已加入群列表失败，将使用配置文件中的群');
      }

      const joinedGroupIds = new Set(joinedGroups.map(g => g.id));
      const allowedGroupArray = Array.from(allowedGroups);
      
      broadcastLog('debug', `[API] GET /api/groups - 配置文件中允许的群: ${allowedGroupArray.join(', ')}`);

      for (const groupId of allowedGroups) {
        if (joinedGroupIds.has(groupId)) {
          const joinedGroup = joinedGroups.find(g => g.id === groupId);
          const name = joinedGroup?.name || `群${groupId}`;
          groups.push({ id: groupId, name });
        } else {
          broadcastLog('debug', `[API] GET /api/groups - 群 ${groupId} 不在已加入列表中，跳过`);
        }
      }

      const groupNames = groups.map(g => `${g.name}(${g.id})`).join(', ');
      res.json({ success: true, data: groups });
      broadcastLog('debug', `[API] GET /api/groups - 获取群列表成功，共 ${groups.length} 个群（已加入且在配置中允许）: ${groupNames}`);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
      broadcastLog('error', `[API] GET /api/groups - 获取群列表失败: ${err.message}`);
    }
  });

  app.get('/api/mc/players', (req, res) => {
    try {
      if (!botInstance.minecraft || !botInstance.minecraft.connected) {
        broadcastLog('debug', '[API] GET /api/mc/players - Minecraft未连接，返回空列表');
        return res.json({ success: true, data: [] });
      }
      const result = botInstance.minecraft.getPlayerList();
      const playerNames = (result.list || []).join(', ');
      res.json({ success: true, data: result.list || [] });
      broadcastLog('debug', `[API] GET /api/mc/players - 获取MC玩家列表成功，在线 ${result.list?.length || 0} 人: ${playerNames}`);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
      broadcastLog('error', `[API] GET /api/mc/players - 获取MC玩家列表失败: ${err.message}`);
    }
  });

  app.post('/api/qq/send', async (req, res) => {
    const { message, target, all } = req.body;
    const messageLength = message?.length || 0;
    
    if (!message) {
      broadcastLog('warn', '[API] POST /api/qq/send - 参数校验失败: 消息不能为空');
      return res.status(400).json({ success: false, error: '消息不能为空' });
    }
    if (!botInstance.qqEnabled) {
      broadcastLog('warn', '[API] POST /api/qq/send - QQ功能未启用，拒绝发送');
      return res.status(400).json({ success: false, error: 'QQ 功能未启用' });
    }

    try {
      if (all) {
        const targetCount = botInstance.allowedGroups.size;
        broadcastLog('info', `[API] POST /api/qq/send - 开始向所有 ${targetCount} 个群发送消息，消息长度: ${messageLength} 字符`);
        for (const groupId of botInstance.allowedGroups) {
          botInstance.sendGroupMessage(groupId, message);
          const groupName = await botInstance.getGroupName(groupId).catch(() => `群${groupId}`);
          broadcastLog('info', `[API] POST /api/qq/send - 已发送到群: ${groupName} (${groupId})`);
        }
        broadcastLog('info', `[API] POST /api/qq/send - 消息发送完成，共发送到 ${targetCount} 个群`);
      } else if (target) {
        const targetGroupId = parseInt(target);
        const groupName = await botInstance.getGroupName(targetGroupId).catch(() => `群${targetGroupId}`);
        broadcastLog('info', `[API] POST /api/qq/send - 向群 ${groupName} (${targetGroupId}) 发送消息，消息长度: ${messageLength} 字符`);
        botInstance.sendGroupMessage(targetGroupId, message);
        broadcastLog('info', `[API] POST /api/qq/send - 消息发送成功`);
      } else {
        broadcastLog('warn', '[API] POST /api/qq/send - 参数校验失败: 未指定目标(target)或全部发送(all)');
        return res.status(400).json({ success: false, error: '未指定目标' });
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
      broadcastLog('error', `[API] POST /api/qq/send - 发送失败: ${err.message}`);
    }
  });

  app.post('/api/mc/send', (req, res) => {
    const { message, target } = req.body;
    const messageLength = message?.length || 0;
    
    if (!message) {
      broadcastLog('warn', '[API] POST /api/mc/send - 参数校验失败: 消息不能为空');
      return res.status(400).json({ success: false, error: '消息不能为空' });
    }
    if (!botInstance.minecraft || !botInstance.minecraft.connected) {
      broadcastLog('warn', '[API] POST /api/mc/send - Minecraft未连接，拒绝发送');
      return res.status(500).json({ success: false, error: 'Minecraft 未连接' });
    }

    let mcMessage;
    if (target) {
      mcMessage = `/tell ${target} ${message}`;
      broadcastLog('info', `[API] POST /api/mc/send - 向玩家 ${target} 发送私聊消息，消息长度: ${messageLength} 字符`);
    } else {
      mcMessage = message;
      broadcastLog('info', `[API] POST /api/mc/send - 发送广播消息，消息长度: ${messageLength} 字符`);
    }
    botInstance.minecraft.mcBot.chat(mcMessage);
    broadcastLog('info', `[API] POST /api/mc/send - Minecraft命令执行成功: ${mcMessage}`);
    res.json({ success: true });
  });

  app.post('/api/debug/cmd', (req, res) => {
    const { cmd } = req.body;
    broadcastLog('info', `[API] POST /api/debug/cmd - 收到调试命令: ${cmd}`);
    
    if (cmd === 'reload') {
      broadcastLog('info', '[API] POST /api/debug/cmd - 开始重载配置...');
      botInstance.reloadConfig();
      broadcastLog('debug', '[API] POST /api/debug/cmd - 配置文件已重载');
      botInstance.reloadPrompts();
      broadcastLog('debug', '[API] POST /api/debug/cmd - 提示词已重载');
      botInstance.reloadBannedWords();
      broadcastLog('debug', '[API] POST /api/debug/cmd - 违禁词列表已重载');
      broadcastLog('info', '[API] POST /api/debug/cmd - 所有配置重载完成');
      res.json({ success: true });
    } else if (cmd === 'clear_ctx') {
      const ctxSize = botInstance.conversationContext.size || 0;
      broadcastLog('info', `[API] POST /api/debug/cmd - 开始清空对话上下文，当前上下文数量: ${ctxSize}`);
      botInstance.conversationContext.clear();
      broadcastLog('info', '[API] POST /api/debug/cmd - 对话上下文已清空');
      res.json({ success: true });
    } else {
      broadcastLog('warn', `[API] POST /api/debug/cmd - 未知命令: ${cmd}，可用命令: reload, clear_ctx`);
      res.status(400).json({ success: false, error: '未知命令' });
    }
  });

  app.get('/api/status', (req, res) => {
    try {
      let mcStatus = 'disabled';
      let qqStatus = 'disabled';

      if (botInstance.minecraft && botInstance.config.minecraft?.enabled) {
        mcStatus = botInstance.minecraft.connected ? 'connected' : 'disconnected';
      }
      if (botInstance.qqEnabled) {
        const isConnected = botInstance.ws && botInstance.ws.readyState === 1;
        qqStatus = isConnected ? 'connected' : 'disconnected';
      }

      res.json({ success: true, data: { mc: mcStatus, qq: qqStatus } });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.listen(port, () => {
    botInstance.logInfo(`[WebPanel] 控制面板已启动，访问 http://localhost:${port}`, true);
  });

  return { app, broadcastLog };
}

module.exports = { createWebPanel };