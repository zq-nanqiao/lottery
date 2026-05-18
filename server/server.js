const express = require("express");
const opn = require("opn");
const bodyParser = require("body-parser");
const path = require("path");
const chokidar = require("chokidar");
const fs = require("fs");
const os = require("os");
const http = require("http");
const { Server } = require("socket.io");
const QRCode = require("qrcode");
const cfg = require("./config");

const {
  loadXML,
  loadTempData,
  writeXML,
  saveDataFile,
  shuffle,
  saveErrorDataFile,
  saveCheckinData,
  loadCheckinData,
  clearCheckinData,
  saveLotteryStatus,
  loadLotteryStatus,
  clearLotteryStatus,
  saveRegistrationStatus,
  loadRegistrationStatus,
  clearRegistrationStatus
} = require("./help");

let app = express(),
  router = express.Router(),
  cwd = process.cwd(),
  dataBath = __dirname,
  port = 8090,
  curData = {},
  luckyData = {},
  errorData = [],
  defaultType = cfg.prizes[0]["type"],
  defaultPage = `default data`,
  connectionInfo = null,
  cachedQRDataURL = null,
  io = null,
  isLotteryStarted = false,
  isRegistrationOpen = false,
  recentParticipants = [],
  checkedInUsers = new Map();

//这里指定参数使用 json 格式
app.use(
  bodyParser.json({
    limit: "50mb"
  })
);

app.use(
  bodyParser.urlencoded({
    extended: true
  })
);

if (process.argv.length > 2) {
  port = process.argv[2];
}

app.use(express.static(cwd));

//请求地址为空，默认重定向到index.html文件
app.get("/", (req, res) => {
  res.redirect(301, "index.html");
});

//设置跨域访问
app.all("*", function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "X-Requested-With");
  res.header("Access-Control-Allow-Methods", "PUT,POST,GET,DELETE,OPTIONS");
  res.header("X-Powered-By", " 3.2.1");
  next();
});

app.post("*", (req, res, next) => {
  log(`请求内容：${JSON.stringify(req.path, 2)}`);
  next();
});

// 获取之前设置的数据
router.post("/getTempData", (req, res, next) => {
  getLeftUsers();
  res.json({
    cfgData: cfg,
    leftUsers: curData.leftUsers,
    luckyData: luckyData,
    connectionInfo: connectionInfo,
    qrDataURL: cachedQRDataURL,
    totalUsers: curData.users.length,
    checkedInCount: checkedInUsers.size,
    recentParticipants: recentParticipants,
    isLotteryStarted: isLotteryStarted,
    isRegistrationOpen: isRegistrationOpen
  });
});

// 获取所有用户
router.post("/reset", (req, res, next) => {
  luckyData = {};
  errorData = [];
  isLotteryStarted = false;
  clearLotteryStatus();
  isRegistrationOpen = false;
  clearRegistrationStatus();
  recentParticipants = [];
  checkedInUsers.clear();
  clearCheckinData();
  log(`重置数据成功`);
  saveErrorDataFile(errorData);
  return saveDataFile(luckyData).then(data => {
    res.json({
      type: "success"
    });
  });
});

// 获取所有用户
router.post("/getUsers", (req, res, next) => {
  let users = checkedInUsers.size > 0
    ? Array.from(checkedInUsers.values())
    : curData.users;
  res.json(users);
  log(`成功返回抽奖用户数据`);
});

// 获取可报名部门列表
router.post("/getDepartments", (req, res, next) => {
  let departments;
  if (cfg.DEPARTMENTS && cfg.DEPARTMENTS.length > 0) {
    departments = [...cfg.DEPARTMENTS];
  } else {
    let deptSet = new Set();
    (curData.users || []).forEach(u => {
      if (u[2]) deptSet.add(u[2]);
    });
    departments = Array.from(deptSet).sort();
  }
  res.json(departments);
  log(`成功返回部门列表`);
});

// 根据工号查找可报名人员信息
router.post("/lookupUser", (req, res, next) => {
  let { employeeId } = req.body;
  if (!employeeId || !employeeId.trim()) {
    return res.json({ type: "error", message: "请提供工号" });
  }
  employeeId = employeeId.trim();
  let user = (curData.users || []).find(u => String(u[0]) === employeeId);
  if (user) {
    res.json({ type: "success", name: user[1], department: user[2] });
  } else {
    res.json({ type: "error", message: "未找到该工号" });
  }
});

// 开始报名
router.post("/startRegistration", (req, res, next) => {
  isRegistrationOpen = true;
  saveRegistrationStatus(true);
  if (io) io.emit("display:registration_state", { open: true });
  res.json({ type: "success" });
  log("报名通道已开启");
});

// 结束报名
router.post("/endRegistration", (req, res, next) => {
  isRegistrationOpen = false;
  saveRegistrationStatus(false);
  if (io) io.emit("display:registration_state", { open: false });
  res.json({ type: "success" });
  log("报名通道已关闭");
});

// 获取当前配置
router.post("/getConfig", (req, res, next) => {
  res.json({
    prizes: cfg.prizes,
    EACH_COUNT: cfg.EACH_COUNT,
    COMPANY: cfg.COMPANY,
    DEPARTMENTS: cfg.DEPARTMENTS,
    department_prizes: cfg.department_prizes
  });
});

// 保存配置
router.post("/saveConfig", (req, res, next) => {
  let body = req.body;
  if (!body) {
    return res.json({ type: "error", message: "无效的配置数据" });
  }
  let newCfg = {
    prizes: body.prizes || cfg.prizes,
    EACH_COUNT: body.EACH_COUNT || cfg.EACH_COUNT,
    COMPANY: body.COMPANY || cfg.COMPANY,
    DEPARTMENTS: body.DEPARTMENTS || cfg.DEPARTMENTS,
    department_prizes: body.department_prizes || cfg.department_prizes
  };

  let content = `/**
 * 奖品设置
 * type: 唯一标识，0是默认特别奖的占位符，其它奖品不可使用
 * count: 奖品数量
 * title: 奖品描述
 * text: 奖品标题
 * img: 图片地址
 */
const prizes = ${JSON.stringify(newCfg.prizes, null, 2)};

/**
 * 一次抽取的奖品个数与prizes对应
 */
const EACH_COUNT = ${JSON.stringify(newCfg.EACH_COUNT)};

/**
 * 卡片公司名称标识
 */
const COMPANY = ${JSON.stringify(newCfg.COMPANY)};

/**
 * 报名可选部门（若为空则自动从可报名清单中读取）
 */
const DEPARTMENTS = ${JSON.stringify(newCfg.DEPARTMENTS)};

/**
 * 部门最大中奖人数
 * department: 部门
 * quantity: 中奖数量
 */
const department_prizes = ${JSON.stringify(newCfg.department_prizes, null, 2)};
module.exports = {
  prizes,
  EACH_COUNT,
  COMPANY,
  DEPARTMENTS,
  department_prizes
};
`;

  fs.writeFile(path.join(dataBath, "config.js"), content, err => {
    if (err) {
      return res.json({ type: "error", message: "保存配置失败: " + err.message });
    }
    // 清除 require 缓存并重新加载
    delete require.cache[require.resolve("./config")];
    let newConfig = require("./config");
    Object.assign(cfg, newConfig);
    log("配置已更新并保存到 config.js");
    // 通知所有抽奖页面刷新
    if (io) io.emit("display:config_updated", {});
    res.json({ type: "success", message: "配置已保存" });
  });
});

// 上传奖品图片
router.post("/uploadPrizeImage", (req, res) => {
  let { fileName, data } = req.body;
  if (!data || !fileName) {
    return res.json({ type: "error", message: "缺少图片数据" });
  }
  // 提取 base64 数据
  let matches = data.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) {
    return res.json({ type: "error", message: "图片格式不正确" });
  }
  let ext = matches[1] === "jpeg" ? "jpg" : matches[1];
  let safeName = fileName.replace(/[^a-zA-Z0-9_\-一-龥\.]/g, "");
  if (!/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(safeName)) {
    safeName = safeName + "." + ext;
  }
  let buffer = Buffer.from(matches[2], "base64");

  let dirs = [
    path.join(dataBath, "..", "product", "dist", "img"),
    path.join(dataBath, "..", "product", "src", "img")
  ];
  let saved = false;
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch(e) {}
    }
    let filePath = path.join(dir, safeName);
    try {
      fs.writeFileSync(filePath, buffer);
      saved = true;
    } catch(e) {
      log("保存图片失败: " + e.message);
    }
  });

  if (saved) {
    log("图片已上传: " + safeName);
    res.json({ type: "success", fileName: safeName });
  } else {
    res.json({ type: "error", message: "保存图片失败" });
  }
});

// 上传用户列表 Excel
router.post("/uploadUsers", (req, res) => {
  let { data, fileName } = req.body;
  if (!data) {
    return res.json({ type: "error", message: "缺少文件数据" });
  }
  let matches = data.match(/^data:.*?;base64,(.+)$/);
  if (!matches) {
    return res.json({ type: "error", message: "文件格式不正确" });
  }
  let buffer = Buffer.from(matches[1], "base64");

  let userPath = path.join(dataBath, "data", "users.xlsx");
  try {
    fs.writeFileSync(userPath, buffer);
    log("用户列表已上传: " + (fileName || "users.xlsx"));
  } catch(e) {
    return res.json({ type: "error", message: "保存文件失败: " + e.message });
  }

  // 重新加载用户数据
  curData.users = loadXML(userPath);
  shuffle(curData.users);

  // 清除签到数据和抽奖状态
  checkedInUsers.clear();
  clearCheckinData();
  luckyData = {};
  errorData = [];
  isLotteryStarted = false;
  clearLotteryStatus();
  isRegistrationOpen = false;
  clearRegistrationStatus();
  recentParticipants = [];
  saveDataFile(luckyData);
  saveErrorDataFile(errorData);

  // 通知所有客户端
  if (io) {
    io.emit("display:lottery_started", { started: false });
    io.emit("display:registration_state", { open: false });
  }

  res.json({
    type: "success",
    message: "用户列表已导入，共 " + curData.users.length + " 人",
    totalUsers: curData.users.length
  });
});
router.get("/config.html", (req, res) => {
  let paths = [
    path.join(cwd, "config.html"),
    path.join(cwd, "src", "config.html"),
    path.join(dataBath, "..", "product", "dist", "config.html"),
    path.join(dataBath, "..", "product", "src", "config.html")
  ];
  for (let p of paths) {
    if (fs.existsSync(p)) {
      return sendHtml(res, p);
    }
  }
  res.status(404).end("config.html not found");
});

// 获取奖品信息
router.post("/getPrizes", (req, res, next) => {
  // res.json(curData.prize);
  log(`成功返回奖品数据`);
});

// 保存抽奖数据
router.post("/saveData", (req, res, next) => {
  let data = req.body;
  setLucky(data.type, data.data)
    .then(t => {
      res.json({
        type: "设置成功！"
      });
      log(`保存奖品数据成功`);
    })
    .catch(data => {
      res.json({
        type: "设置失败！"
      });
      log(`保存奖品数据失败`);
    });
});

// 作废指定中奖者
router.post("/invalidateWinner", (req, res, next) => {
  let { type, employeeId } = req.body;
  if (type == null || !employeeId) {
    return res.json({ type: "error", message: "缺少参数" });
  }
  let luckyList = luckyData[type];
  if (!luckyList || luckyList.length === 0) {
    return res.json({ type: "error", message: "该奖项无中奖记录" });
  }
  let idx = luckyList.findIndex(function(item) { return String(item[0]) === String(employeeId); });
  if (idx === -1) {
    return res.json({ type: "error", message: "未找到该中奖记录" });
  }
  let removed = luckyList.splice(idx, 1)[0];
  errorData.push(removed);
  getLeftUsers();
  Promise.all([
    saveDataFile(luckyData),
    saveErrorDataFile(errorData)
  ]).then(function() {
    log("作废中奖者: " + removed[0] + " " + removed[1] + " 奖项type=" + type);
    res.json({ type: "success" });
  }).catch(function(err) {
    res.json({ type: "error", message: "保存失败" });
  });
});

// 保存抽奖数据
router.post("/errorData", (req, res, next) => {
  let data = req.body;
  setErrorData(data.data)
    .then(t => {
      res.json({
        type: "设置成功！"
      });
      log(`保存没来人员数据成功`);
    })
    .catch(data => {
      res.json({
        type: "设置失败！"
      });
      log(`保存没来人员数据失败`);
    });
});

// 保存数据到excel中去
router.post("/export", (req, res, next) => {
  let type = [1, 2, 3, 4, 5, defaultType],
    outData = [["工号", "姓名", "部门"]];
  cfg.prizes.forEach(item => {
    outData.push([item.text]);
    outData = outData.concat(luckyData[item.type] || []);
  });

  writeXML(outData, "/抽奖结果.xlsx")
    .then(dt => {
      // res.download('/抽奖结果.xlsx');
      res.status(200).json({
        type: "success",
        url: "抽奖结果.xlsx"
      });
      log(`导出数据成功！`);
    })
    .catch(err => {
      res.json({
        type: "error",
        error: err.error
      });
      log(`导出数据失败！`);
    });
});

function sendHtml(res, filePath) {
  res.type("html");
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
    "X-Content-Type-Options": "nosniff"
  });
  return res.sendFile(filePath);
}

// 提供报名页面
router.get("/join.html", (req, res) => {
  let paths = [
    path.join(cwd, "join.html"),
    path.join(cwd, "src", "join.html"),
    path.join(dataBath, "..", "product", "dist", "join.html"),
    path.join(dataBath, "..", "product", "src", "join.html")
  ];
  for (let p of paths) {
    if (fs.existsSync(p)) {
      return sendHtml(res, p);
    }
  }
  res.status(404).end("join.html not found");
});

// 提供控制器页面
router.get("/controller.html", (req, res) => {
  let paths = [
    path.join(cwd, "controller.html"),
    path.join(cwd, "src", "controller.html"),
    path.join(dataBath, "..", "product", "dist", "controller.html"),
    path.join(dataBath, "..", "product", "src", "controller.html")
  ];
  for (let p of paths) {
    if (fs.existsSync(p)) {
      return sendHtml(res, p);
    }
  }
  res.status(404).end("controller.html not found");
});

// 手机端扫码加入抽奖
router.post("/join", (req, res, next) => {
  if (!isRegistrationOpen) {
    return res.json({ type: "error", message: "报名尚未开始，请稍后再试" });
  }
  if (isLotteryStarted) {
    return res.json({ type: "error", message: "抽奖已经开始，报名通道已关闭" });
  }
  let { employeeId, name, department, blessing } = req.body;
  if (!employeeId || !employeeId.trim()) {
    return res.json({ type: "error", message: "请填写工号" });
  }
  if (!name || !name.trim()) {
    return res.json({ type: "error", message: "请填写姓名" });
  }
  if (!department || !department.trim()) {
    return res.json({ type: "error", message: "请填写部门" });
  }
  employeeId = employeeId.trim();
  name = name.trim();
  department = department.trim();
  blessing = blessing ? blessing.trim().substring(0, 20) : "";

  // 在可报名名单中验证
  let matched = (curData.users || []).find(u =>
    String(u[0]) === employeeId && u[1] === name && u[2] === department
  );
  if (!matched) {
    return res.json({ type: "error", message: "你的信息不在可报名名单中，请确认工号、姓名和部门是否正确" });
  }

  // 检查是否已报名
  if (checkedInUsers.has(employeeId)) {
    return res.json({ type: "error", message: "你已报名成功，无需重复报名" });
  }

  let userRecord = [matched[0], matched[1], matched[2], blessing];
  checkedInUsers.set(employeeId, userRecord);
  getLeftUsers();

  recentParticipants.unshift({ employeeId: employeeId, name: name, department: department, blessing: blessing, time: Date.now() });
  if (recentParticipants.length > 50) {
    recentParticipants = recentParticipants.slice(0, 50);
  }

  if (io) {
    io.emit("display:participant_joined", {
      user: userRecord,
      checkedInCount: checkedInUsers.size,
      totalAllowed: curData.users.length,
      recentParticipants: recentParticipants
    });
  }

  saveCheckinData(checkedInUsers);
  res.json({ type: "success", message: "报名成功！" });
  log(`参与者签到: ${employeeId} ${name} (${department}) ${blessing ? "祝福语:" + blessing : ""} 已签到${checkedInUsers.size}人`);
});

//对于匹配不到的路径或者请求，返回默认页面
//区分不同的请求返回不同的页面内容
router.all("*", (req, res) => {
  if (req.method.toLowerCase() === "get") {
    if (/\.(html|htm)/.test(req.originalUrl)) {
      res.set("Content-Type", "text/html");
      res.send(defaultPage);
    } else {
      res.status(404).end();
    }
  } else if (req.method.toLowerCase() === "post") {
    let postBackData = {
      error: "empty"
    };
    res.send(JSON.stringify(postBackData));
  }
});

function log(text) {
  global.console.log(text);
  global.console.log("-----------------------------------------------");
}

function setLucky(type, data) {
  if (luckyData[type]) {
    luckyData[type] = luckyData[type].concat(data);
  } else {
    luckyData[type] = Array.isArray(data) ? data : [data];
  }

  return saveDataFile(luckyData);
}

function setErrorData(data) {
  errorData = errorData.concat(data);

  return saveErrorDataFile(errorData);
}

app.use(router);

function loadData() {
  console.log("加载EXCEL数据文件");
  let userPath = path.join(dataBath, "data/users.xlsx");

  if (fs.existsSync(userPath)) {
    curData.users = loadXML(userPath);
    shuffle(curData.users);
  } else {
    console.log("未找到user.xlsx，初始化为空列表（等待手机端扫码加入）");
    curData.users = [];
  }

  // 读取签到数据
  loadCheckinData().then(data => {
    if (data.size > 0) {
      checkedInUsers = data;
      console.log(`已恢复签到数据: ${checkedInUsers.size} 人`);
    }
  });

  // 读取抽奖状态
  loadLotteryStatus().then(started => {
    if (started) {
      isLotteryStarted = true;
      console.log("抽奖状态已恢复：抽奖进行中，报名通道关闭");
    }
  });

  // 读取报名状态
  loadRegistrationStatus().then(open => {
    isRegistrationOpen = open;
    if (open) {
      console.log("报名状态已恢复：报名进行中");
    }
  });

  // 读取已经抽取的结果
  loadTempData()
    .then(data => {
      luckyData = data[0];
      errorData = data[1];
      // 如果有已中奖数据，说明抽奖已经开始过
      if (Object.keys(luckyData).length > 0) {
        isLotteryStarted = true;
      }
    })
    .catch(data => {
      curData.leftUsers = Object.assign([], curData.users);
    });
}

function getLeftUsers() {
  //  记录当前已抽取的用户
  let lotteredUser = {};
  for (let key in luckyData) {
    let luckys = luckyData[key];
    luckys.forEach(item => {
      lotteredUser[item[0]] = true;
    });
  }
  // 记录当前已抽取但是不在线人员
  errorData.forEach(item => {
    lotteredUser[item[0]] = true;
  });

  // 优先使用已签到人员作为抽奖池；若无人签到则使用全部可报名名单
  let pool = checkedInUsers.size > 0
    ? Array.from(checkedInUsers.values())
    : Object.assign([], curData.users);

  let leftUsers = pool.filter(user => {
    return !lotteredUser[user[0]];
  });
  curData.leftUsers = leftUsers;
}

loadData();

function getLocalIP() {
  let interfaces = os.networkInterfaces();
  for (let name in interfaces) {
    for (let iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

function initConnectionInfo(serverPort) {
  let lanIP = getLocalIP();
  let baseUrl = `http://${lanIP}:${serverPort}`;
  connectionInfo = {
    ip: lanIP,
    port: serverPort,
    joinUrl: `${baseUrl}/join.html`,
    controllerUrl: `${baseUrl}/controller.html`
  };
  QRCode.toDataURL(connectionInfo.joinUrl, {
    width: 300,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" }
  }).then(url => {
    cachedQRDataURL = url;
    console.log("二维码生成成功");
  }).catch(err => {
    console.error("二维码生成失败:", err);
  });
}

module.exports = {
  run: function(devPort, noOpen) {
    let openBrowser = true;
    if (process.argv.length > 3) {
      if (process.argv[3] && (process.argv[3] + "").toLowerCase() === "n") {
        openBrowser = false;
      }
    }

    if (noOpen) {
      openBrowser = noOpen !== "n";
    }

    if (devPort) {
      port = devPort;
    }

    let httpServer = http.createServer(app);
    io = new Server(httpServer, {
      cors: { origin: "*", methods: ["GET", "POST"] }
    });

    let displayState = {};

    io.on("connection", (socket) => {
      let role = socket.handshake.query.role || "display";

      if (role === "display") {
        socket.join("display");

        socket.on("display:state", (data) => {
          displayState = data;
          socket.to("controller").emit("ctrl:state", {
            ...displayState,
            totalUsers: checkedInUsers.size > 0 ? checkedInUsers.size : (curData.users || []).length,
            joinUrl: connectionInfo ? connectionInfo.joinUrl : null,
            isRegistrationOpen: isRegistrationOpen
          });
        });

        socket.on("display:lottery_entered", () => {
          isLotteryStarted = true;
          saveLotteryStatus();
          io.emit("display:lottery_started", { started: true });
          log("抽奖已开始，报名通道关闭");
        });

        socket.on("display:registration_started", () => {
          isRegistrationOpen = true;
          saveRegistrationStatus(true);
          io.emit("display:registration_state", { open: true });
          log("报名通道已开启");
        });

        socket.on("display:registration_ended", () => {
          isRegistrationOpen = false;
          saveRegistrationStatus(false);
          io.emit("display:registration_state", { open: false });
          log("报名通道已关闭");
        });

        socket.on("display:lottery_reset", () => {
          isLotteryStarted = false;
          isRegistrationOpen = false;
          recentParticipants = [];
          checkedInUsers.clear();
          clearCheckinData();
          clearLotteryStatus();
          clearRegistrationStatus();
          io.emit("display:lottery_started", { started: false });
          io.emit("display:registration_state", { open: false });
          log("抽奖已重置，报名通道开放");
        });

        socket.emit("display:connected", {
          joinUrl: connectionInfo ? connectionInfo.joinUrl : null,
          isLotteryStarted: isLotteryStarted,
          isRegistrationOpen: isRegistrationOpen
        });

        socket.on("disconnect", () => {
          socket.leave("display");
        });

      } else if (role === "controller") {
        socket.join("controller");

        socket.emit("ctrl:state", {
          ...displayState,
          totalUsers: checkedInUsers.size > 0 ? checkedInUsers.size : (curData.users || []).length,
          joinUrl: connectionInfo ? connectionInfo.joinUrl : null,
          isRegistrationOpen: isRegistrationOpen
        });

        socket.on("ctrl:command", (data) => {
          let { action } = data || {};
          if (!action) return;
          log(`手机端指令: ${action}`);
          socket.to("display").emit("display:command", { action });
          socket.emit("ctrl:ack", { action, success: true });
        });

        socket.on("disconnect", () => {
          socket.leave("controller");
        });
      }
    });

    initConnectionInfo(port);

    httpServer.listen(port, () => {
      let host = httpServer.address().address;
      let serverPort = httpServer.address().port;
      global.console.log(`lottery server listening at http://${host}:${serverPort}`);
      global.console.log(`局域网IP: ${getLocalIP()}, 控制器: ${connectionInfo ? connectionInfo.controllerUrl : ""}`);
      openBrowser && opn(`http://127.0.0.1:${serverPort}`);
    });
  }
};
